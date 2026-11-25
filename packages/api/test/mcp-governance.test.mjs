import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpFixture, readScope } from './mcp-helpers.mjs';
import { decode32 } from './hosted-helpers.mjs';
import { upload } from './source-helpers.mjs';
import { totp } from '../dist/auth-crypto.js';
import { providerAdapters } from '../dist/ai-providers.js';
import { TenantMetadata } from '../dist/metadata.js';
const query = { dimensions: [{ fieldId: 'region', columnName: 'region' }], measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] };
const analysis = { analysisId: 'mcp-draft', name: 'MCP draft', definition: { dataSetIdentifierDeclarations: [], sheets: [], calculatedFields: [], filterGroups: [] }, datasetBindings: {} };
function error(result, code, status) { assert.equal(result.isError, true, JSON.stringify(result)); assert.equal(result.structuredContent.errorCode, code); if (status) assert.equal(result._meta.status, status); assert.equal('rows' in result.structuredContent, false); }
async function dataset(f, id = 'sales', input = upload()) {
  const source = await f.http('/api/uploads', { method: 'POST', token: f.token(), body: input }); assert.equal(source.status, 201, JSON.stringify(source.body)); await f.renew();
  const prep = await f.http(`/api/datasets/${id}/prep`, { method: 'PUT', token: f.token(), body: { name: id, pipeline: { version: 1, input: source.body.id, steps: [] }, expectedVersion: 0 } }); assert.equal(prep.status, 200, JSON.stringify(prep.body)); await f.renew(); return source.body;
}
async function member(f, role = 'reader') {
  const email = 'other@example.test', password = randomBytes(24).toString('base64');
  await f.provisioning.inviteMember('oauth-other', f.tenant.tenantId, { email, name: 'Other member', role });
  const invitation = f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
  const enrollment = await f.auth.enroll(invitation, password, 'local'), secret = decode32(enrollment.secret);
  const code = () => totp(secret, Math.floor(f.clock() / 30000));
  await f.auth.accept(invitation, password, code(), 'local'); f.advance();
  const session = await f.auth.login(email, password, code(), f.tenant.tenantId, 'local'); f.advance(); return session;
}

test('J10 HTTP: SDK client discovers 58 tools and executes a real read using a dynamically issued OAuth token', async t => {
  const f = await mcpFixture(t); await dataset(f); const g = await f.grant();
  const client = new Client({ name: 'local-connector-proof', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(`${f.config.origin}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${g.access_token}` } }, fetch: async (url, init) => {
    assert.equal(new URL(url).origin, f.config.origin);
    const r = await f.http(new URL(url).pathname, { method: init?.method ?? 'GET', headers: Object.fromEntries(new Headers(init?.headers)), rawBody: typeof init?.body === 'string' ? init.body : undefined });
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status, headers: r.headers });
  } });
  await client.connect(transport); t.after(() => client.close());
  assert.equal((await client.listTools()).tools.length, 58);
  const result = await client.callTool({ name: 'run_dataset_query', arguments: { id: 'sales', query } });
  assert.deepEqual(result.structuredContent.rows, [{ region: 'east', total: 40 }, { region: 'west', total: 20 }]);
});
test('J10 HTTP: query PII stop, CLS, forged principals and current policy checks retain the v1 boundary', async t => {
  const f = await mcpFixture(t), source = await dataset(f); const g = await f.grant(readScope);
  const args = { id: 'sales', query, idempotencyKey: 'read-once' };
  assert.equal((await f.call(g.access_token, 'run_dataset_query', args)).isError, undefined);
  error(await f.call(g.access_token, 'run_dataset_query', { ...args, query: { ...query, userId: 'someone-else' } }), 'FORGED_PRINCIPAL');
  error(await f.call(g.access_token, 'run_dataset_query', { id: 'sales', query: { ...query, dimensions: [{ fieldId: 'private', columnName: 'person@example.test' }] } }), 'AI_FIELD_NAME_PII', 400);
  await dataset(f, 'pii', { ...upload(), base64: Buffer.from('region,amount,person@example.test\neast,10,private\n').toString('base64') });
  const stop = await f.call(g.access_token, 'run_dataset_query', { id: 'pii', query }); error(stop, 'AI_FIELD_NAME_PII', 400); assert.ok(!JSON.stringify(stop).includes('person@example.test'));
  const changed = await f.http(`/api/sources/${source.id}/bind`, { method: 'POST', token: f.token(), body: { expectedVersion: 1, policy: { rowLevel: false, rowRules: [], protectedColumns: ['amount'], columnGrants: [] } } }); assert.equal(changed.status, 200); await f.renew();
  const denied = await f.call(g.access_token, 'run_dataset_query', args);
  assert.equal(denied.isError, true); assert.equal('rows' in denied.structuredContent, false);
  const direct = await f.http('/api/v1/datasets/sales/query', { method: 'POST', token: f.token(), body: query });
  assert.equal(denied.structuredContent.errorCode, direct.body.errorCode);
});
test('J10 HTTP: member roles, cross-owner/tenant isolation and action history attribution survive the transport', async t => {
  const f = await mcpFixture(t); await dataset(f); const other = await member(f); await f.renew();
  const g = await f.grant(), reader = await f.grant(undefined, other.token);
  error(await f.call(reader.access_token, 'create_analysis', { body: analysis }), 'SOURCE_ACCESS_DENIED', 403);
  const own = await f.call(g.access_token, 'create_analysis', { body: analysis, idempotencyKey: 'draft-once' }); assert.equal(own.isError, undefined, JSON.stringify(own));
  const identity = await f.auth.verify(f.token());
  const history = await f.call(g.access_token, 'list_workspace_action_history', { limit: 200 });
  const entry = history.structuredContent.items.find(row => row.action === 'create_analysis' && row.detail.status === 201);
  assert.equal(entry.actor, identity.userId); assert.equal(entry.tenantId, f.tenant.tenantId);
  assert.ok(!JSON.stringify(history).includes(g.access_token));
  const list = await f.browser('/api/mcp/connections'); const ownerConnection = list.body.connections.find(c => !c.revoked);
  assert.equal((await f.browser('/api/mcp/connections', { id: ownerConnection.id }, other.token)).status, 404);
  assert.equal((await f.browser('/api/mcp/connections', undefined, other.token)).body.connections.length, 1);
  const second = await f.provisioning.provision('oauth-second-tenant', { ...f.input, name: 'Other workspace', displayName: 'Other workspace' });
  const invitation = f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
  await f.auth.accept(invitation, f.password, f.code(), 'local'); f.advance();
  const session = await f.auth.login(f.email, f.password, f.code(), second.tenantId, 'local'); f.advance();
  const foreign = await f.grant(readScope, session.token);
  error(await f.call(foreign.access_token, 'run_dataset_query', { id: 'sales', query, idempotencyKey: 'draft-once' }), 'RESOURCE_NOT_FOUND', 404);
  assert.ok((await f.call(foreign.access_token, 'list_workspace_action_history')).structuredContent.items.every(row => row.tenantId === second.tenantId));
  const metadata = new TenantMetadata(f.db, f.db), context = await metadata.authenticate(null, async () => identity), user = await metadata.get(context, { kind: 'user', id: identity.userId });
  await metadata.put(context, { kind: 'user', id: identity.userId }, { ...user.body, role: 'reader' }, user.version);
  error(await f.call(g.access_token, 'create_analysis', { body: { ...analysis, analysisId: 'role-denied' } }), 'SOURCE_ACCESS_DENIED', 403);
});
test('J10 HTTP: tenant compute quota and v1 rate buckets cannot be bypassed with MCP', async t => {
  const f = await mcpFixture(t, { OPENSIGHT_ENTITLEMENTS: JSON.stringify({ defaults: { apiCalls: 10000, storageBytes: 10000000, computeAttempts: 1 }, tenants: {} }) });
  await dataset(f);
  const execution = await f.http('/api/datasets/sales/execution', { method: 'PUT', token: f.token(), body: { mode: 'BLAZE', intervalMinutes: null, expectedVersion: 1 } }); assert.equal(execution.status, 200); await f.renew();
  const g = await f.grant();
  assert.equal((await f.call(g.access_token, 'refresh_dataset', { id: 'sales', idempotencyKey: 'refresh-first' })).isError, undefined);
  error(await f.call(g.access_token, 'refresh_dataset', { id: 'sales', idempotencyKey: 'refresh-second' }), 'USAGE_LIMIT_EXCEEDED', 429);
});
test('J10 HTTP: AI spend cap stops the next provider call, even under read scope', async t => {
  const provider = t.mock.method(Object.getPrototypeOf(providerAdapters().stub), 'complete');
  const f = await mcpFixture(t, { OPENSIGHT_AI_MANAGED: 'stub', NODE_ENV: 'test', OPENSIGHT_AI_TEST_STUB: '1', OPENSIGHT_ENTITLEMENTS: JSON.stringify({ defaults: { apiCalls: 10000, storageBytes: 10000000, computeAttempts: 100, aiCallsPerMonth: 10, aiSpendCapCents: 12, aiCostCentsPerMillionTokens: 1000000 }, tenants: {} }) });
  await dataset(f, 'sales', { ...upload(), base64: Buffer.from('region,revenue\neast,17\nwest,23\n').toString('base64') });
  const g = await f.grant(readScope), args = { body: { question: 'sum revenue by region', datasetId: 'sales' } };
  const first = await f.call(g.access_token, 'ask_question', args); assert.equal(first.isError, undefined, JSON.stringify(first)); assert.equal(provider.mock.callCount(), 1);
  error(await f.call(g.access_token, 'ask_question', args), 'AI_SPEND_CAP_EXCEEDED', 429); assert.equal(provider.mock.callCount(), 1);
});
test('HTTP and direct REST consume the same v1 rate limit', async t => {
  const f = await mcpFixture(t, { OPENSIGHT_V1_RATE_LIMIT_PER_MINUTE: '1' }), g = await f.grant(readScope);
  assert.equal((await f.http('/api/v1/datasets', { token: f.token() })).status, 200);
  error(await f.call(g.access_token, 'list_datasets'), 'RATE_LIMIT_EXCEEDED', 429);
});

test('J10 HTTP: another author cannot read the delegating member’s private dataset or replay its result', async t => {
  const f = await mcpFixture(t); await dataset(f); const other = await member(f, 'author_ai'); await f.renew();
  const own = await f.grant(readScope), foreign = await f.grant(readScope, other.token), args = { id: 'sales', query, idempotencyKey: 'private-result' };
  assert.equal((await f.call(own.access_token, 'run_dataset_query', args)).isError, undefined);
  error(await f.call(foreign.access_token, 'run_dataset_query', args), 'RESOURCE_NOT_FOUND', 404);
});
