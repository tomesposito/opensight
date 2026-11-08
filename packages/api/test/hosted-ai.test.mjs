import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { h8Fixture, serveH8, referenceEnv } from './h8-helpers.mjs';
import { initializeUsage, HostedUsage } from '../dist/hosted-usage.js';
import { TenantMetadata } from '../dist/metadata.js';
import { HostedSources } from '../dist/hosted-sources.js';
import { HostedData } from '../dist/hosted-data.js';
import { HostedDataRoutes } from '../dist/hosted-data-routes.js';
import { loadBudgets } from '../dist/budget-store.js';
import { changeDashboard, describeDashboard } from '../dist/dashboard-model.js';
import { convertDefinition } from '@opensight/web/analysis';
import { interactiveRequest } from '@opensight/query-engine';
import { managedAI } from '../dist/hosted-ai-settings.js';
import { serverlessDataPath } from '../dist/serverless-application.js';
const limits = { apiCalls: 10000, storageBytes: 10000000, computeAttempts: 100, aiCallsPerMonth: 10, aiSpendCapCents: 1000, aiCostCentsPerMillionTokens: 1000000 };
const query = { dimensions: [{ fieldId: 'region', columnName: 'region' }], measures: [{ fieldId: 'revenue', columnName: 'revenue', aggregation: 'SUM' }], filters: [] };
const providerResponse = (text, bedrock = true) => Response.json(bedrock ? { output: { message: { content: [{ text }] } }, usage: { inputTokens: 2, outputTokens: 3 } } : { output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 2, output_tokens: 3 } });
async function fixture(t, { managed = true, entitlement = {}, stub = false } = {}) {
  const cleanup = [], owner = { after: fn => cleanup.push(fn) }; t.after(async () => { for (const fn of cleanup.reverse()) await fn(); });
  const f = await h8Fixture(owner); await initializeUsage(f.db);
  await f.db.transaction(async c => { await c.query("INSERT INTO h2_identities (subject,email,status) VALUES ('other','other@example.test','active')"); await c.query("INSERT INTO h2_memberships (subject,tenant_id,namespace_id,user_id,status) VALUES ('other','tenant-one','one','other','active')"); });
  f.env = { ...f.env, ...referenceEnv, OPENSIGHT_ENTITLEMENTS: JSON.stringify({ defaults: { ...limits, ...entitlement }, tenants: {} }),
    ...(managed ? { OPENSIGHT_AI_MANAGED: 'bedrock', OPENSIGHT_AI_BEDROCK_MODEL: 'test-model', AWS_REGION: 'us-east-1' } : {}),
    ...(stub ? { OPENSIGHT_AI_MANAGED: 'stub', OPENSIGHT_AI_BEDROCK_MODEL: undefined, NODE_ENV: 'test', OPENSIGHT_AI_TEST_STUB: '1' } : {}) };
  const metadata = new TenantMetadata(f.db, f.db), budgets = await loadBudgets(f.db, metadata);
  owner.after(() => budgets.shutdown());
  const sources = new HostedSources(metadata, f.env.OPENSIGHT_AUTH_ENCRYPTION_KEY, []), data = new HostedData(sources, undefined, budgets), routes = new HostedDataRoutes(data);
  const login = (userId = 'admin', namespaceId = 'one') => metadata.authenticate(null, async () => ({ namespaceId, userId }));
  const file = async (userId, csv) => {
    const source = await sources.upload(await login(userId), { config: { format: 'csv' }, base64: Buffer.from(csv).toString('base64'), policy: { rowLevel: false, rowRules: [] }, expiresAt: '2099-01-01T00:00:00.000Z' });
    const c = await login(userId), oldKey = sources.key(c, 'source', source.id), old = await metadata.get(c, oldKey);
    await metadata.batch(c, [{ key: { ...oldKey, id: 'orders' }, body: old.body, expectedVersion: 0 }, { key: oldKey, body: null, expectedVersion: 1 }]);
  };
  await file('admin', 'region,revenue,private\neast,1000,secret\nwest,2000,secret\n');
  await file('other', 'region,revenue,private\neast,4,hidden\nwest,6,hidden\n');
  await routes.prep.save(await login(), 'sales', { name: 'Sales', pipeline: { version: 1, input: 'orders', steps: [] }, expectedVersion: 0 });
  const wire = interactiveRequest(query, { dataSet: { DataSet: { Arn: 'urn:synthetic:sales' } }, dataSource: {}, localData: {} }).analysis.Definition;
  const record = changeDashboard(undefined, { kind: 'publish', create: true, dashboardId: 'daily', publishedAt: '2026-11-05T00:00:00Z', errors: [], source: { id: 'analysis', name: 'Daily', definition: convertDefinition(wire), datasetBindings: { sales_data: { kind: 'prepared-dataset', id: 'sales' } }, version: 1 } }, 'admin');
  await metadata.put(await login(), { kind: 'dashboard', id: 'daily' }, { definition: describeDashboard(record), published: record, datasets: [{ kind: 'prepared-dataset', id: 'sales', ownerId: 'admin' }], folderId: null, grants: [{ principal: { type: 'user', id: 'other' }, role: 'viewer' }] });
  let text = '{"question":"sum revenue by region"}', fail = false, pending;
  const calls = [];
  const { request } = await serveH8(owner, f, { security: { authenticate: async r => ['one', 'two', 'other'].includes(r.headers.authorization) ? { namespaceId: r.headers.authorization === 'two' ? 'two' : 'one', userId: r.headers.authorization === 'other' ? 'other' : 'admin' } : undefined },
    ai: { bedrock: { region: 'us-east-1', credentials: async () => ({ accessKeyId: 'test', secretAccessKey: 'test' }) }, fetcher: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); await pending?.(); if (fail) return new Response('private error', { status: 500 }); return providerResponse(text, url.includes('bedrock')); } } });
  const api = (path, body, user = 'one') => request(path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: user }, body });
  const role = async role => { const c = await login(), r = await metadata.get(c, { kind: 'user', id: 'other' }); await metadata.put(c, { kind: 'user', id: 'other' }, { name: 'Other', role }, r.version); };
  const usage = new HostedUsage(f.db, { defaults: { ...limits, ...entitlement }, tenants: {} });
  return { ...f, api, metadata, login, role, calls, usage, setText: value => { text = value; }, fail: value => { fail = value; }, pending: value => { pending = value; } };
}
const ask = { question: 'Which region drove revenue?', dashboardId: 'daily' };
test('#190 hosted status, grounded answer, reader result visual query and calculation share scope', async t => {
  const f = await fixture(t); await f.role('reader_ai');
  const status = await f.api('/api/o/status', undefined, 'other'); assert.equal(status.status, 200, JSON.stringify(status)); assert.equal(status.body.mode, 'managed');
  const answer = await f.api('/api/o/generate', ask, 'other'); assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.deepEqual(answer.body.interpretations[0].grounding.fieldsUsed, ['revenue', 'region']);
  const rows = await f.api('/api/o/query', { dashboardId: 'daily', query }, 'other'); assert.equal(rows.status, 200, JSON.stringify(rows.body));
  assert.deepEqual(rows.body.rows, [{ region: 'east', revenue: 4 }, { region: 'west', revenue: 6 }]);
  assert.equal((await f.api('/api/o/calculation', ask, 'other')).body.errorCode, 'SECURITY_BUILD_REQUIRED');
  f.setText(JSON.stringify({ name: 'Double revenue', expression: '{revenue} * 2', role: 'measure', explanation: 'Double revenue.' }));
  assert.equal((await f.api('/api/o/calculation', { question: 'Double revenue', datasetId: 'sales' })).status, 200);
  assert.equal((await f.api('/api/o/status')).body.credits.used, 2);
  assert.equal((await f.api('/api/o/generate', { question: 'sum revenue' }, 'other')).body.errorCode, 'SECURITY_BUILD_REQUIRED');
  assert.equal((await f.api('/api/o/generate', { ...ask, datasetId: 'other' }, 'other')).body.errorCode, 'SECURITY_DATASET_SCOPE');
});
test('#190 failed responses, unsupported answers and pre-call denials never consume credits', async t => {
  const f = await fixture(t);
  for (const [text, code] of [['not-json', 'O_INVALID_PROVIDER_RESPONSE'], ['{"question":""}', 'O_UNSUPPORTED_QUESTION'], ['{"question":"sum unknown"}', 'O_UNSUPPORTED_QUESTION']]) {
    f.setText(text); assert.equal((await f.api('/api/o/generate', ask)).body.errorCode, code);
  }
  f.fail(true); assert.equal((await f.api('/api/o/generate', ask)).body.errorCode, 'AI_PROVIDER_FAILED'); f.fail(false);
  f.setText('{"question":"sum revenue"}');
  const count = f.calls.length;
  const pii = await f.api('/api/o/generate', { ...ask, calculatedFields: [{ name: 'test.person@example.com', expression: '{revenue}', role: 'measure' }] });
  assert.equal(pii.body.errorCode, 'AI_FIELD_NAME_PII'); assert.equal(f.calls.length, count);
  assert.equal((await f.api('/api/o/status')).body.credits.used, 0);
  assert.equal((await f.api('/api/admin/ai/test', {})).status, 200);
  assert.equal((await f.api('/api/o/status')).body.credits.used, 0);
});
test('#217 managed connection tests record token spend, stay credit-free and stop at the daily spend cap', async t => {
  const f = await fixture(t, { entitlement: { aiSpendCapCents: 12 } });
  // Each stubbed provider reply reports 5 tokens; at the fixture rate of
  // 1,000,000 cents per million tokens that is 5 cents of operator spend.
  for (let i = 0; i < 3; i++) assert.equal((await f.api('/api/admin/ai/test', {})).status, 200);
  assert.equal(f.calls.length, 3);
  assert.equal((await f.api('/api/o/status')).body.credits.used, 0);
  assert.match(await f.usage.metrics(), /opensight_ai_tokens\{[^}]*\} 15/);
  // 15 cents recorded against a 12-cent daily cap: the next test is gated
  // before any provider call is made, and still consumes no credits.
  const blocked = await f.api('/api/admin/ai/test', {});
  assert.equal(blocked.status, 429, JSON.stringify(blocked.body)); assert.equal(blocked.body.errorCode, 'AI_SPEND_CAP_EXCEEDED');
  assert.equal(f.calls.length, 3);
  assert.equal((await f.api('/api/o/status')).body.credits.used, 0);
});
test('#190 hosted BYO settings encrypt keys, isolate tenants, reject tenant Bedrock and bypass credits', async t => {
  const f = await fixture(t, { entitlement: { aiCallsPerMonth: 0, aiSpendCapCents: 0 } });
  const key = randomBytes(20).toString('hex');
  assert.equal((await f.api('/api/o/status')).body.state, 'credit-limit');
  assert.equal((await f.api('/api/o/generate', ask)).body.errorCode, 'AI_CREDITS_EXHAUSTED'); assert.equal(f.calls.length, 0);
  assert.equal((await f.api('/api/admin/ai', { mode: 'byo', provider: 'bedrock', model: 'test' })).body.errorCode, 'AI_BEDROCK_APPROVAL_REQUIRED');
  assert.equal((await f.api('/api/admin/ai', { mode: 'byo', provider: 'openai', model: 'test' })).status, 200);
  const saved = await f.api('/api/admin/ai/key', { key }); assert.equal(saved.status, 200, JSON.stringify(saved.body)); assert.equal(saved.body.hasKey, true); assert.ok(!JSON.stringify(saved.body).includes(key));
  assert.equal((await f.api('/api/admin/ai', undefined, 'two')).body.hasKey, false);
  const secret = await f.metadata.get(await f.login(), { kind: 'secret', id: 'ai-provider' }); assert.equal(secret.body.aadVersion, 2); assert.ok(!JSON.stringify(secret).includes(key));
  await assert.rejects(f.metadata.get(await f.login('admin', 'two'), { kind: 'secret', id: 'ai-provider' }), { code: 'RESOURCE_NOT_FOUND' });
  assert.equal((await f.api('/api/o/generate', ask)).status, 200); assert.equal((await f.api('/api/admin/ai/test', {})).status, 200);
  assert.equal((await f.api('/api/o/status')).body.credits.used, 0);
  await f.role('author_ai'); assert.equal((await f.api('/api/admin/ai', undefined, 'other')).body.errorCode, 'SECURITY_ADMIN_REQUIRED');
  await f.role('author'); assert.equal((await f.api('/api/o/status', undefined, 'other')).body.errorCode, 'SECURITY_AI_REQUIRED');
  await f.api('/api/admin/ai', { mode: 'off' }); assert.equal((await f.api('/api/o/generate', ask)).body.errorCode, 'AI_NOT_CONFIGURED');
});
test('#190 hosted CLS removes denied names before prompting and forbids calculation bypasses', async t => {
  const f = await fixture(t); await f.role('reader_ai');
  // Trusted fixture policy edit: readers cannot edit their own source policy.
  await f.db.transaction(async db => { const r = (await db.query("SELECT body FROM h1_resources WHERE tenant_id = 'tenant-one' AND namespace_id = 'one' AND kind = 'source' AND owner_id = 'other' AND resource_id = 'orders'"))[0]; const body = JSON.parse(r.body); body.policy.protectedColumns = ['private']; body.policy.columnGrants = []; await db.query("UPDATE h1_resources SET body = ? WHERE tenant_id = 'tenant-one' AND namespace_id = 'one' AND kind = 'source' AND owner_id = 'other' AND resource_id = 'orders'", [JSON.stringify(body)]); });
  assert.equal((await f.api('/api/o/generate', ask, 'other')).status, 200);
  const prompt = JSON.parse(f.calls[0].body.messages[0].content[0].text); assert.ok(!prompt.fields.some(c => c.name === 'private'));
  const count = f.calls.length;
  assert.equal((await f.api('/api/o/generate', { ...ask, calculatedFields: [{ name: 'leak', expression: '{private}', role: 'dimension' }] }, 'other')).body.errorCode, 'UNRESOLVED_BINDING');
  assert.equal(f.calls.length, count); assert.equal((await f.api('/api/o/status')).body.credits.used, 1);
  assert.equal((await f.api('/api/o/generate', ask, 'two')).status, 404);
});
test('#190 post-provider authorization recheck prevents delivery and charging', async t => {
  const f = await fixture(t); await f.role('reader_ai');
  let entered, release; const started = new Promise(r => { entered = r; }), waiting = new Promise(r => { release = r; });
  f.pending(async () => { entered(); await waiting; });
  const answer = f.api('/api/o/generate', ask, 'other'); await Promise.race([started, answer.then(r => { throw Error(JSON.stringify(r)); })]); await f.role('reader'); release();
  assert.equal((await answer).status, 403); assert.equal((await f.api('/api/o/status')).body.credits.used, 0);
});
test('#190 neither configured mode fails closed; explicit test stub returns a grounded answer', async t => {
  const f = await fixture(t, { managed: false });
  assert.equal((await f.api('/api/o/status')).body.configured, false); assert.equal((await f.api('/api/o/generate', ask)).body.errorCode, 'AI_NOT_CONFIGURED'); assert.equal(f.calls.length, 0);
  const stub = await fixture(t, { stub: true }); assert.equal((await stub.api('/api/o/generate', ask)).status, 200); assert.equal(stub.calls.length, 0);
  assert.throws(() => managedAI({ OPENSIGHT_AI_MANAGED: 'stub', NODE_ENV: 'production', OPENSIGHT_AI_TEST_STUB: '1' }), { code: 'AI_MANAGED_CONFIG_INVALID' });
  for (const path of ['/api/o/status', '/api/o/generate', '/api/o/calculation', '/api/o/query', '/api/admin/ai', '/api/admin/ai/key', '/api/admin/ai/test']) assert.equal(serverlessDataPath(path), true, path);
});

test('#190 hosted prompt merges only published governed vocabulary for the bound dataset', async t => {
  const f = await fixture(t), at = '2026-11-05T00:00:00.000Z';
  const definition = { name: 'Net sales', expression: '{revenue}', defaultAggregation: 'SUM', format: { style: 'number', decimalPlaces: 2 }, description: '', synonyms: ['turnover'] };
  for (const [id, published] of [['net', true], ['draft', false]]) await f.metadata.put(await f.login(), { kind: 'metric', id }, {
    dataset: { kind: 'prepared-dataset', id: 'sales', ownerId: 'admin' }, createdBy: 'admin', publishedVersion: published ? 1 : null,
    versions: [{ version: 1, state: published ? 'published' : 'draft', actor: 'admin', at, definition: { ...definition, name: published ? 'Net sales' : 'Draft measure' } }],
    audit: [{ action: published ? 'publish' : 'create', version: 1, actor: 'admin', at }],
  });
  f.setText('{"question":"sum turnover by region"}');
  const answer = await f.api('/api/o/generate', ask); assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.equal(answer.body.interpretations[0].grounding.metricsUsed[0].id, 'net');
  const prompt = JSON.parse(f.calls[0].body.messages[0].content[0].text);
  assert.ok(prompt.fields.some(c => c.name === 'Net sales' && c.metric.id === 'net'));
  assert.ok(!prompt.fields.some(c => c.name === 'Draft measure'));
});

test('#196 hosted plans charge per delivered tile, enforce remaining credit cap and revise once', async t => {
  const f = await fixture(t, { entitlement: { aiCallsPerMonth: 4 } });
  f.setText(JSON.stringify({ sheetTitle: 'Sales', questions: ['sum revenue', 'sum missing', 'sum revenue by region'] }));
  const first = await f.api('/api/o/plan', { question: 'overview', datasetId: 'sales' });
  assert.equal(first.status, 200, JSON.stringify(first)); assert.equal(first.body.delivered, 2);
  assert.equal((await f.api('/api/o/status')).body.credits.used, 2);
  f.setText(JSON.stringify({ question: 'sum revenue' }));
  assert.equal((await f.api('/api/o/revise', { question: 'total', currentQuestion: 'sum revenue by region', datasetId: 'sales' })).status, 200);
  assert.equal((await f.api('/api/o/status')).body.credits.used, 3);
  f.setText(JSON.stringify({ questions: ['sum revenue', 'sum revenue by region'] }));
  const last = await f.api('/api/o/plan', { question: 'overview', datasetId: 'sales' });
  assert.deepEqual(last.body.tiles.map(t => t.status), ['ok', 'credit-limited']);
  assert.equal((await f.api('/api/o/status')).body.credits.used, 4);
  assert.equal((await f.api('/api/o/plan', { question: 'overview', datasetId: 'sales' })).body.errorCode, 'AI_CREDITS_EXHAUSTED');
  for (const path of ['/api/o/plan', '/api/o/revise']) assert.equal(serverlessDataPath(path), true);
});
for (const path of ['/api/o/plan', '/api/o/revise']) test(`#196 hosted ${path} rechecks policy after I/O without charging`, async t => {
  const f = await fixture(t); await f.role('author_ai');
  let entered, release; const started = new Promise(r => { entered = r; }), waiting = new Promise(r => { release = r; });
  f.pending(async () => { entered(); await waiting; });
  f.setText(JSON.stringify(path.endsWith('plan') ? { questions: ['sum revenue'] } : { question: 'sum revenue' }));
  const pending = f.api(path, { ...ask, ...(path.endsWith('revise') ? { currentQuestion: 'sum revenue' } : {}) }, 'other');
  await started; await f.role('author'); release(); assert.equal((await pending).status, 403);
  assert.equal((await f.api('/api/o/status')).body.credits.used, 0);
});
