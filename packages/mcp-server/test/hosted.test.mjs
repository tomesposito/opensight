import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { authFixture, decode32 } from '../../api/test/hosted-helpers.mjs';
import { serving } from '../../api/test/v1-helpers.mjs';
import { upload } from '../../api/test/source-helpers.mjs';
import { totp } from '../../api/dist/auth-crypto.js';
import { refreshCredentials } from '../dist/index.js';
import { connect, call, json } from './helpers.mjs';

const query = { dimensions: [{ fieldId: 'region', columnName: 'region' }], measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] };
const queryPath = '/api/v1/datasets/sales/query';
async function fixture(t, env = {}) {
  const f = await authFixture(t), http = await serving(t, f, env);
  let session = await f.login();
  const renew = async () => { session = await f.login(); };
  const request = (path, options = {}) => http(path, { token: session.token, ...options });
  const source = await request('/api/uploads', { method: 'POST', body: upload() }); assert.equal(source.status, 201); await renew();
  const prepared = await request('/api/datasets/sales/prep', { method: 'PUT', body: { name: 'Sales', pipeline: { version: 1, input: source.body.id, steps: [] }, expectedVersion: 0 } });
  assert.equal(prepared.status, 200); await renew();
  const clients = [];
  const clientFor = async (getSession = () => session) => {
    const refresh = randomBytes(32).toString('hex');
    const creds = refreshCredentials({ tokenUrl: 'https://auth.example/token', refreshToken: refresh,
      // The separate operator exchange is stubbed; every v1 request below uses the actual hosted HTTP server.
      fetch: async (_url, init) => {
        assert.equal(new URLSearchParams(init.body).get('refresh_token'), refresh);
        return json({ access_token: getSession().token, token_type: 'Bearer', expires_in: 900 });
      } });
    const client = await connect(t, { credentials: creds, fetch: async (url, init) => {
      const headers = Object.fromEntries(init.headers), token = headers.authorization?.slice(7); delete headers.authorization;
      const r = await http(url.pathname + url.search, { method: init.method, token, headers, ...(init.body === undefined ? {} : { rawBody: init.body }) });
      return json(r.body, r.status, r.headers);
    } });
    clients.push(creds); return client;
  };
  return { ...f, request, http, source: source.body, renew: async () => { await renew(); for (const creds of clients) creds.invalidate(); }, clientFor, token: () => session.token };
}
function error(result, code, status) {
  assert.equal(result.isError, true, JSON.stringify(result)); assert.equal(result.structuredContent.errorCode, code);
  if (status) assert.equal(result._meta.status, status);
  assert.equal('rows' in result.structuredContent, false);
}

test('MCP query uses real hosted HTTP validation: SQL, envelopes, extra fields, unknown operators and forged identity', async t => {
  const f = await fixture(t), client = await f.clientFor();
  const expected = (await f.request(queryPath, { method: 'POST', body: query })).body;
  assert.deepEqual((await call(client, 'run_dataset_query', { id: 'sales', query })).structuredContent, expected);
  const sql = 'SELECT * FROM sales; DROP TABLE sales; --';
  for (const body of [sql, { sql }, { query: sql }, { ...query, sql }, { ...query, extra: true }, { ...query, filters: [{ columnName: 'region', value: 'east', operator: 'OR 1=1' }] },
    { ...query, dimensions: [{ ...query.dimensions[0], sql }] }, { ...query, measures: [{ ...query.measures[0], aggregation: 'SUM); DROP TABLE sales; --' }] },
    { ...query, calculatedFields: [{ name: 'injected', expression: sql }], measures: [{ fieldId: 'bad', columnName: 'injected', aggregation: 'SUM' }] }]) {
    const direct = await f.request(queryPath, { method: 'POST', body });
    error(await call(client, 'run_dataset_query', { id: 'sales', query: body }), direct.body.errorCode, direct.status);
  }
  for (const key of ['principal', 'policy', 'userId', 'groups']) {
    const body = { ...query, [key]: 'another' }, direct = await f.request(queryPath, { method: 'POST', body });
    assert.equal(direct.body.errorCode, 'FORGED_PRINCIPAL'); error(await call(client, 'run_dataset_query', { id: 'sales', query: body }), 'FORGED_PRINCIPAL');
  }
  const literal = { ...query, filters: [{ columnName: 'region', value: "east' OR 1=1 --" }] };
  assert.deepEqual((await call(client, 'run_dataset_query', { id: 'sales', query: literal })).structuredContent.rows, []);
  // Identity-like parameter names are data; they do not become assertions.
  const binding = { ...query, filters: [{ columnName: 'region', parameterName: 'userId' }], parameterDeclarations: [{ name: 'userId', type: 'string', multiple: false }], parameterBindings: { userId: ['east'] } };
  assert.equal((await call(client, 'run_dataset_query', { id: 'sales', query: binding })).structuredContent.rows.length, 1);
  assert.deepEqual((await call(client, 'run_dataset_query', { id: 'sales', query })).structuredContent, expected);
});

test('real hosted idempotency prevents duplicate writes; delete preconditions and pagination survive', async t => {
  const f = await fixture(t), client = await f.clientFor();
  const body = { analysisId: 'example', name: 'Example', definition: { dataSetIdentifierDeclarations: [], sheets: [], calculatedFields: [], filterGroups: [] }, datasetBindings: {} };
  const first = await call(client, 'create_analysis', { body, idempotencyKey: 'create-once' }); assert.equal(first.isError, undefined); await f.renew();
  const replay = await call(client, 'create_analysis', { body, idempotencyKey: 'create-once' });
  assert.equal(replay._meta.headers['Idempotent-Replayed'], 'true'); assert.deepEqual(replay.structuredContent, first.structuredContent);
  assert.equal((await call(client, 'list_analyses')).structuredContent.items.length, 1);
  error(await call(client, 'delete_analysis', { id: 'example' }), 'V1_IF_MATCH_REQUIRED', 428);
  error(await call(client, 'delete_dataset', { id: 'sales' }), 'V1_IF_MATCH_REQUIRED', 428);
  error(await call(client, 'delete_source', { id: f.source.id }), 'V1_IF_MATCH_REQUIRED', 428);
  const page = await call(client, 'list_datasets', { limit: 1 }); assert.ok(Object.hasOwn(page.structuredContent, 'nextCursor'));
  const deleted = await call(client, 'delete_analysis', { id: 'example', ifMatch: first._meta.headers.ETag, idempotencyKey: 'delete-once' }); assert.equal(deleted.isError, undefined);
});

async function member(f) {
  const email = 'other@example.test', password = randomBytes(24).toString('hex');
  await f.provisioning.inviteMember('mcp-other', f.tenant.tenantId, { email, name: 'Other', role: 'administrator' });
  const invitation = f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
  const enrollment = await f.auth.enroll(invitation, password, 'local'), key = decode32(enrollment.secret);
  const code = () => totp(key, Math.floor(f.clock() / 30000));
  await f.auth.accept(invitation, password, code(), 'local'); f.advance();
  const session = await f.auth.login(email, password, code(), f.tenant.tenantId, 'local'); f.advance();
  session.renew = async () => {
    const next = await f.auth.login(email, password, code(), f.tenant.tenantId, 'local'); f.advance(); session.token = next.token;
  };
  return session;
}
async function tenant(f) {
  const other = await f.provisioning.provision('mcp-tenant', { ...f.input, name: 'Other tenant' });
  const invitation = f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
  await f.auth.accept(invitation, f.password, f.code(), 'local'); f.advance();
  const session = await f.auth.login(f.email, f.password, f.code(), other.tenantId, 'local'); f.advance(); return session;
}

test('cross-owner/cross-tenant queries and replays match REST denial', async t => {
  const f = await fixture(t), otherOwner = await member(f), otherTenant = await tenant(f); await f.renew();
  const owner = await f.clientFor(), headers = { 'Idempotency-Key': 'private-result' };
  assert.equal((await call(owner, 'run_dataset_query', { id: 'sales', query, idempotencyKey: 'private-result' })).isError, undefined);
  for (const session of [otherOwner, otherTenant]) {
    const direct = await f.http(queryPath, { method: 'POST', body: query, token: session.token, headers });
    assert.equal(direct.status, 404); assert.equal(direct.body.errorCode, 'RESOURCE_NOT_FOUND');
    const client = await f.clientFor(() => session);
    error(await call(client, 'run_dataset_query', { id: 'sales', query, idempotencyKey: 'private-result' }), direct.body.errorCode, direct.status);
  }
});

test('MCP and direct REST consume the identical tenant rate-limit bucket', async t => {
  const f = await fixture(t, { OPENSIGHT_V1_RATE_LIMIT_PER_MINUTE: '2' }), client = await f.clientFor();
  assert.equal((await f.request('/api/v1/datasets')).status, 200);
  assert.equal((await call(client, 'run_dataset_query', { id: 'sales', query })).isError, undefined);
  const exhausted = await call(client, 'list_sources'); error(exhausted, 'RATE_LIMIT_EXCEEDED', 429);
  assert.ok(Number(exhausted._meta.headers['Retry-After']) > 0);
  assert.equal((await f.request('/api/v1/datasets')).body.errorCode, 'RATE_LIMIT_EXCEEDED');
});

test('revoked hosted access and protected source graphs fail closed even with an idempotency key', async t => {
  const f = await fixture(t), client = await f.clientFor();
  const args = { id: 'sales', query, idempotencyKey: 'private-query' };
  assert.equal((await call(client, 'run_dataset_query', args)).isError, undefined);
  await f.auth.logout(f.token());
  error(await call(client, 'run_dataset_query', args), 'AUTHENTICATION_FAILED', 401);
  await f.renew();
  const protectedSource = await f.request(`/api/sources/${f.source.id}/bind`, { method: 'POST', body: { expectedVersion: 1, policy: { rowLevel: true, rowRules: [] } } });
  assert.equal(protectedSource.status, 200); await f.renew();
  const direct = await f.request(queryPath, { method: 'POST', body: query });
  assert.equal(direct.body.errorCode, 'PREP_SECURITY_REJECTED');
  error(await call(client, 'run_dataset_query', args), direct.body.errorCode, direct.status);
});


test('documented share target principals work, while definition grants never widen data access', async t => {
  const f = await fixture(t), other = await member(f);
  const target = await f.auth.verify(other.token); await f.renew();
  const owner = await f.clientFor();
  const body = { analysisId: 'shared', name: 'Shared definition',
    definition: { dataSetIdentifierDeclarations: [{ identifier: 'sales', dataSetArn: 'urn:synthetic:sales' }], sheets: [], calculatedFields: [], filterGroups: [] },
    datasetBindings: { sales: { kind: 'prepared-dataset', id: 'sales' } } };
  const created = await call(owner, 'create_analysis', { body }); assert.equal(created.isError, undefined); await f.renew();
  const grant = await call(owner, 'set_asset_share', { id: 'shared', principalType: 'user', principalId: target.userId, body: { role: 'viewer' }, ifMatch: created._meta.headers.ETag });
  assert.equal(grant.isError, undefined); await f.renew(); await other.renew();
  const reader = await f.clientFor(() => other);
  const visible = await call(reader, 'list_assets');
  assert.equal(visible.isError, undefined, JSON.stringify(visible.structuredContent));
  assert.ok(visible.structuredContent.items.some(asset => asset.id === 'shared'));
  const described = await f.http('/api/v1/analyses/shared', { token: other.token });
  const throughMcp = await call(reader, 'describe_analysis', { id: 'shared' });
  assert.equal(throughMcp.structuredContent.errorCode, described.body.errorCode);
  const direct = await f.http(queryPath, { token: other.token, method: 'POST', body: query });
  assert.equal(direct.body.errorCode, 'RESOURCE_NOT_FOUND');
  error(await call(reader, 'run_dataset_query', { id: 'sales', query }), direct.body.errorCode, direct.status);
});
