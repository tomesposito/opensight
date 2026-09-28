import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { organizationApi } from './organization-helpers.mjs';
const route = '/api/o/generate';
const response = text => Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: typeof text === 'string' ? text : JSON.stringify(text) }] }] });
const options = fetcher => ({ bootstrap: { provider: 'openai', model: 'test-model', key: randomBytes(20).toString('hex') }, fetcher });

test('generative O uses registered capabilities, server metadata and namespace-scoped dashboard access', async t => {
  const calls = [];
  const { api } = await organizationApi(t, { ai: options(async (url, init) => { calls.push(JSON.parse(init.body)); return response({ question: 'sum revenue by region' }); }) });
  for (const role of ['administrator', 'author', 'author_ai', 'reader', 'reader_ai']) {
    await api('/api/users/alice', 'PUT', { name: 'Alice', role });
    const expected = ['administrator', 'author_ai', 'reader_ai'].includes(role);
    assert.equal((await api('/api/o/status', 'GET', undefined, 'default-alice')).status, expected ? 200 : 403);
    const body = { question: 'How much did we sell in each region?', dashboardId: 'sales-dashboard' };
    const r = await api(route, 'POST', body, 'default-alice');
    assert.equal(r.status, expected ? 200 : 403, JSON.stringify(r.body));
    if (expected) { assert.equal(r.body.interpretations[0].measure, 'revenue'); assert.deepEqual(r.body.interpretations[0].dimensions, ['region']); }
  }
  assert.equal(calls.length, 3);
  const prompt = JSON.parse(calls[0].input); assert.deepEqual(Object.keys(prompt), ['question', 'fields']);
  assert.ok(prompt.fields.every(f => Object.keys(f).every(k => ['name', 'type'].includes(k))));
  assert.equal((await api(route, 'POST', { question: 'sum revenue' }, 'default-alice')).body.errorCode, 'SECURITY_BUILD_REQUIRED');
  assert.equal((await api('/api/o/calculation', 'POST', { question: 'profit margin', dashboardId: 'sales-dashboard' }, 'default-alice')).body.errorCode, 'SECURITY_BUILD_REQUIRED');
  assert.equal((await api(route, 'POST', { question: 'sum revenue', dashboardId: 'missing' }, 'default-alice')).status, 404);
});
test('generative request validation rejects forged context and never calls providers before authorization', async t => {
  let calls = 0;
  const { api } = await organizationApi(t, { ai: options(async () => { calls++; return response({ question: 'sum revenue' }); }) });
  for (const body of [{}, { question: '' }, { question: 'x'.repeat(2001) }, { question: 'sum revenue', role: 'administrator' }, { question: 'sum revenue', namespaceId: 'tenant' }, { question: 'sum revenue', provider: 'openai' }, { question: 'sum revenue', calculatedFields: [{ name: 'revenue', expression: '1', role: 'measure' }] }]) assert.ok((await api(route, 'POST', body)).status >= 400);
  assert.equal((await api(route, 'POST', { question: 'sum revenue' }, '')).status, 401);
  assert.equal((await api(route, 'POST', { question: 'sum revenue' }, 'default-alice', { 'x-role': 'administrator' })).status, 403);
  assert.equal(calls, 0);
});
test('unconfigured and Bedrock generative calls have named failures and make no transport calls', async t => {
  let calls = 0;
  const { api } = await organizationApi(t, { ai: { fetcher: async () => { calls++; throw new Error(); } } });
  assert.equal((await api(route, 'POST', { question: 'sum revenue' })).body.errorCode, 'AI_NOT_CONFIGURED');
  await api('/api/admin/ai', 'POST', { provider: 'bedrock', model: 'future' });
  assert.deepEqual((await api('/api/o/status')).body, { configured: false, state: 'needs-approval' });
  assert.equal((await api(route, 'POST', { question: 'sum revenue' })).body.errorCode, 'AI_BEDROCK_APPROVAL_REQUIRED');
  assert.equal(calls, 0);
});
test('provider JSON and grammar are validated; executable snippets and unknown fields never become answers', async t => {
  let text;
  const { api } = await organizationApi(t, { ai: options(async () => response(text)) });
  for (const value of ['not-json', { question: 'sum revenue', sql: 'SELECT secret' }, { question: 'sum mystery' }, { question: '' }, { question: 'sum revenue where region is' }, { question: 'sum revenue; DROP TABLE sales' }]) {
    text = value; const r = await api(route, 'POST', { question: 'question' });
    assert.ok(r.status >= 400, JSON.stringify(value)); assert.match(r.body.errorCode, /^O_/);
  }
});
test('AI calculated fields bind actual fields and validate syntax/types before returning suggestions', async t => {
  let value = { name: 'Margin', expression: 'sum({profit}) / nullIf(sum({revenue}), 0)', role: 'measure', explanation: 'Ratio of total profit to total revenue.' };
  const { api } = await organizationApi(t, { ai: options(async () => response(value)) });
  const path = '/api/o/calculation';
  assert.deepEqual((await api(path, 'POST', { question: 'profit margin' })).body.suggestion, value);
  for (const expression of ['fetch("secret")', 'sum({unknown})', '${undeclared}', '1; DROP TABLE sales', "'text'"]) {
    value = { ...value, expression }; assert.ok((await api(path, 'POST', { question: 'margin' })).status >= 400, expression);
  }
});
test('RLS denies before provider call; CLS omits denied fields and blocks calculated bypasses', async t => {
  const calls = [];
  const { api } = await organizationApi(t, { ai: options(async (_url, init) => { calls.push(JSON.parse(JSON.parse(init.body).input)); return response({ question: 'sum revenue' }); }) });
  await api('/api/users/alice', 'PUT', { name: 'Alice', role: 'author_ai' });
  await api('/api/datasets/sales/column-grants/profit', 'PUT', { column: 'profit', effect: 'deny', principals: [{ type: 'user', id: 'alice' }] });
  assert.equal((await api(route, 'POST', { question: 'sum revenue' }, 'default-alice')).status, 200);
  assert.ok(!calls[0].fields.some(f => f.name === 'profit'));
  assert.equal((await api(route, 'POST', { question: 'sum leak', calculatedFields: [{ name: 'leak', role: 'measure', expression: '{profit}' }] }, 'default-alice')).body.errorCode, 'COLUMN_ACCESS_DENIED');
  await api('/api/datasets/sales/row-rules/admin', 'PUT', { principals: [{ type: 'user', id: 'admin' }], predicate: { column: 'region', operator: 'eq', value: 'East' } });
  assert.equal((await api(route, 'POST', { question: 'sum revenue' }, 'default-alice')).body.errorCode, 'ROW_ACCESS_DENIED');
  assert.equal(calls.length, 1);
});
test('revoking AI capability while provider is pending prevents releasing the response', async t => {
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  const { api } = await organizationApi(t, { ai: options(async () => { started(); await waiting; return response({ question: 'sum revenue' }); }) });
  await api('/api/users/alice', 'PUT', { name: 'Alice', role: 'author_ai' });
  const pending = api(route, 'POST', { question: 'sum revenue' }, 'default-alice');
  await entered; await api('/api/users/alice', 'PUT', { name: 'Alice', role: 'author' }); release();
  assert.equal((await pending).body.errorCode, 'SECURITY_AI_REQUIRED');
});
