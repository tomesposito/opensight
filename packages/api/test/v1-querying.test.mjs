import test from 'node:test';
import assert from 'node:assert/strict';
import { authFixture } from './hosted-helpers.mjs';
import { upload } from './source-helpers.mjs';
import { serving } from './v1-helpers.mjs';

const path = '/api/v1/datasets/sales/query';
const query = { dimensions: [{ fieldId: 'region', columnName: 'region' }],
  measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] };
const expected = { columns: [{ name: 'region', type: 'string' }, { name: 'total', type: 'number' }],
  rows: [{ region: 'east', total: 40 }, { region: 'west', total: 20 }] };

async function fixture(t, env = {}, sourceInput = upload()) {
  const f = await authFixture(t), call = await serving(t, f, env);
  let token = (await f.login()).token;
  const request = (url, options = {}) => call(url, { token, ...options });
  const mutate = async (url, options) => {
    const r = await request(url, options);
    assert.ok(r.status < 400, JSON.stringify(r.body));
    token = (await f.login()).token;
    return r;
  };
  const source = (await mutate('/api/uploads', { method: 'POST', body: sourceInput })).body;
  // Seed through the unversioned API; v1 limiter tests start with a fresh bucket.
  await mutate('/api/datasets/sales/prep', { method: 'PUT', body: { name: 'Sales',
    pipeline: { version: 1, input: source.id, steps: [] }, expectedVersion: 0 } });
  return { ...f, call, request, mutate, source, run: (body = query, options = {}) => request(path, { method: 'POST', body, ...options }) };
}

function error(r, status, code) {
  assert.equal(r.status, status, JSON.stringify(r.body));
  assert.equal(r.body.errorCode, code);
  assert.equal(typeof r.body.errorCode, 'string');
  assert.equal('rows' in r.body, false);
}
function shape(body, cached = false) {
  assert.deepEqual(Object.keys(body).sort(), cached ? ['columns', 'execution', 'rows'] : ['columns', 'rows']);
  for (const c of body.columns) {
    assert.deepEqual(Object.keys(c).sort(), ['name', 'type']);
    assert.equal(typeof c.name, 'string');
    assert.ok(['string', 'number'].includes(c.type));
  }
  for (const row of body.rows) {
    assert.deepEqual(Object.keys(row).sort(), body.columns.map(c => c.name).sort());
    for (const c of body.columns) assert.ok(row[c.name] === null || typeof row[c.name] === c.type);
  }
  if (cached) assert.deepEqual(body.execution, { mode: 'BLAZE', cached: true });
}

test('v1 querying: exact direct result shape and unchanged unversioned endpoint', async t => {
  const f = await fixture(t), r = await f.run();
  assert.equal(r.status, 200); shape(r.body); assert.deepEqual(r.body, expected);
  assert.deepEqual((await f.request('/api/datasets/sales/query', { method: 'POST', body: query })).body, expected);
  const filtered = await f.run({ ...query, filters: [{ columnName: 'region', value: 'east' }] });
  assert.deepEqual(filtered.body, { ...expected, rows: [expected.rows[0]] });
  // Queries do not gain the list endpoint's pagination envelope.
  assert.deepEqual((await f.run(query, { headers: { Limit: '1' } })).body, expected);
});

test('v1 querying: BLAZE provenance and cold/stale cache fail closed', async t => {
  const f = await fixture(t);
  await f.mutate('/api/datasets/sales/execution', { method: 'PUT', body: { mode: 'BLAZE', intervalMinutes: null, expectedVersion: 1 } });
  error(await f.run(), 429, 'BLAZE_NOT_READY');
  assert.equal((await f.request('/api/datasets/sales/refresh', { method: 'POST', body: {} })).status, 200);
  const r = await f.run(); assert.equal(r.status, 200); shape(r.body, true);
  assert.deepEqual(r.body, { ...expected, execution: { mode: 'BLAZE', cached: true } });
  assert.deepEqual((await f.request('/api/datasets/sales/query', { method: 'POST', body: query })).body, expected);
  await f.mutate(`/api/sources/${f.source.id}/bind`, { method: 'POST', body: { expectedVersion: 1, policy: { rowLevel: false, rowRules: [] } } });
  error(await f.run(), 429, 'BLAZE_NOT_READY');
});
