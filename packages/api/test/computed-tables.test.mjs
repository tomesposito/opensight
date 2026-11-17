import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createApiServer, emptySecurityState, StubMailTransport } from '@opensight/api';
const root = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
async function api(t, authenticated = true, options = {}) {
  const state = emptySecurityState();
  state.namespaces.push({ id: 'other', name: 'Other' });
  state.users = [{ id: 'author', name: 'Author', namespaceId: 'default', role: 'author' }, { id: 'reader', name: 'Reader', namespaceId: 'default', role: 'reader' }, { id: 'other-author', name: 'Other author', namespaceId: 'default', role: 'author' }, { id: 'author', name: 'Author', namespaceId: 'other', role: 'author' }];
  const server = await createApiServer({ dataRoot: root, ...options, mailTransport: new StubMailTransport(), ...(authenticated ? { security: { initialState: state, authenticate: r => {
    const id = r.headers.authorization?.replace('Bearer ', '');
    return id === 'tenant-author' ? { namespaceId: 'other', userId: 'author' } : ['author', 'reader', 'other-author'].includes(id) ? { namespaceId: 'default', userId: id } : undefined;
  } } } : {}) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  return async (path, method = 'GET', body, user = authenticated ? 'author' : undefined) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
}
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executionSettings } from '../dist/blaze.js';
import { ConnectorRoutes } from '../dist/connector-routes.js';
import { PrepRoutes } from '../dist/prep-routes.js';
const stored = { mode: 'STORED', intervalMinutes: null };
const csv = text => ({ config: { format: 'csv' }, base64: Buffer.from(text).toString('base64') });
async function directory(t) { const dir = await mkdtemp(join(tmpdir(), 'computed-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
async function prepare(call, id = 'computed', text = 'id,amount\n1,2\n2,3\n') {
  const upload = await call('/api/uploads', 'POST', csv(text)); assert.equal(upload.status, 201);
  const pipeline = { version: 1, input: upload.body.id, steps: [] };
  assert.equal((await call(`/api/datasets/${id}/prep`, 'PUT', { name: id, pipeline })).status, 201);
  assert.equal((await call(`/api/datasets/${id}/execution`, 'PUT', stored)).status, 200);
  return pipeline;
}
test('STORED is unscheduled and publish survives a new store/server over the same directory', async t => {
  assert.deepEqual(executionSettings(stored), stored);
  assert.throws(() => executionSettings({ ...stored, intervalMinutes: 1 }), { code: 'BLAZE_CONFIG_INVALID' });
  const dir = await directory(t), prepStorePath = join(dir, 'prep.json'), call = await api(t, true, { prepStorePath });
  await prepare(call);
  const result = await call('/api/datasets/computed/publish', 'POST', {});
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.state, 'current'); assert.equal(result.body.rowCount, 2); assert.ok(result.body.bytes > 0);
  const state = JSON.parse(await readFile(prepStorePath, 'utf8'));
  assert.equal(state.datasets[0].materialization.rowCount, 2);
  const restarted = await api(t, true, { prepStorePath });
  const rows = await restarted('/api/datasets/computed/rows');
  assert.equal(rows.status, 200, JSON.stringify(rows.body)); assert.deepEqual(rows.body.rows, [{ id: 1, amount: 2 }, { id: 2, amount: 3 }]); assert.equal(rows.body.execution.mode, 'STORED');
});
test('storage quota refuses before executing, reports overage and writes no artifact', async t => {
  const dir = await directory(t), path = join(dir, 'prep.json'), call = await api(t, true, { prepStorePath: path });
  await prepare(call);
  const connectors = new ConnectorRoutes(false), routes = await PrepRoutes.create(connectors, path); t.after(() => connectors.close());
  routes.storageLimit = () => 1;
  let executed = false; connectors.streamPrep = async () => { executed = true; throw Error('must not execute'); };
  await assert.rejects(routes.publishStored({ namespaceId: 'default', userId: 'author' }, 'computed'), error => {
    assert.equal(error.code, 'USAGE_LIMIT_EXCEEDED'); assert.equal(error.detail.limitBytes, 1); assert.ok(error.detail.overageBytes > 0); return true;
  });
  assert.equal(executed, false); assert.equal((await readdir(dir)).some(name => name.endsWith('.tables')), false);
});
test('refresh serves the old generation until commit, then swaps rows and records named failures', async t => {
  const dir = await directory(t), path = join(dir, 'prep.json'), call = await api(t, true, { prepStorePath: path });
  await prepare(call); await call('/api/datasets/computed/publish', 'POST', {});
  const connectors = new ConnectorRoutes(false), routes = await PrepRoutes.create(connectors, path); t.after(() => connectors.close());
  const identity = { namespaceId: 'default', userId: 'author' }, key = JSON.stringify(['default', 'author', 'computed']);
  const old = routes.find(identity, 'computed').materialization;
  let enter, release; const entered = new Promise(r => enter = r), pending = new Promise(r => release = r);
  routes.materialize = async (_identity, _id, table) => { table.start(old.columns); enter(); await pending; table.row([9, 20]); };
  const refreshing = routes.refreshStored(identity, 'computed'); await entered;
  assert.deepEqual((await routes.files.read(key, routes.find(identity, 'computed').materialization, routes.blaze.limits)).rows(), [{ id: 1, amount: 2 }, { id: 2, amount: 3 }]);
  release(); await refreshing;
  const current = routes.find(identity, 'computed').materialization;
  assert.notEqual(current.generation, old.generation); assert.ok(current.lastRefreshedAt >= old.lastRefreshedAt); assert.equal(current.rowCount, 1);
  assert.deepEqual((await routes.files.read(key, current, routes.blaze.limits)).rows(), [{ id: 9, amount: 20 }]);
  const failure = Object.assign(new Error('Expected source column amount'), { code: 'PREP_SCHEMA_MISMATCH' });
  routes.materialize = async () => { throw failure; };
  await assert.rejects(routes.refreshStored(identity, 'computed'), { code: failure.code });
  const failed = routes.find(identity, 'computed').materialization;
  assert.equal(failed.state, 'refresh-failed'); assert.equal(failed.error.code, failure.code); assert.equal(failed.error.message, failure.message); assert.ok(Date.parse(failed.failedAt));
  assert.deepEqual((await routes.files.read(key, failed, routes.blaze.limits)).rows(), [{ id: 9, amount: 20 }]);
  const restarted = await PrepRoutes.create(connectors, path); assert.equal(restarted.find(identity, 'computed').materialization.state, 'refresh-failed');
});
test('input dataset edits label computed output stale without changing stored rows', async t => {
  const dir = await directory(t), call = await api(t, true, { prepStorePath: join(dir, 'prep.json') });
  const upload = await call('/api/uploads', 'POST', csv('id,amount\n1,2\n2,3\n'));
  const pipeline = { version: 1, input: upload.body.id, steps: [] };
  await call('/api/datasets/base/prep', 'PUT', { name: 'base', pipeline });
  await call('/api/datasets/computed/prep', 'PUT', { name: 'computed', pipeline: { version: 1, input: { dataset: 'base' }, steps: [] } });
  await call('/api/datasets/computed/execution', 'PUT', stored);
  assert.equal((await call('/api/datasets/computed/publish', 'POST', {})).status, 200);
  await call('/api/datasets/base/prep', 'PUT', { name: 'changed', pipeline });
  assert.equal((await call('/api/datasets/computed/execution')).body.state, 'stale');
  assert.equal((await call('/api/datasets/computed/rows')).body.rowCount, 2);
});
test('input-table edits mark stored dependents stale', async t => {
  const dir = await directory(t), call = await api(t, false, { localData: true, prepStorePath: join(dir, 'prep.json') });
  const created = await call('/api/input-tables', 'POST', { name: 'Plan', columns: [{ name: 'amount', type: 'number', required: true }] });
  const table = created.body;
  await call(`/api/input-tables/${table.id}/rows`, 'POST', { values: { amount: 5 } });
  await call('/api/datasets/plan/prep', 'PUT', { name: 'Plan output', pipeline: { version: 1, input: `input-table-${table.id}`, steps: [] } });
  await call('/api/datasets/plan/execution', 'PUT', stored);
  assert.equal((await call('/api/datasets/plan/publish', 'POST', {})).status, 200);
  await call(`/api/input-tables/${table.id}/rows`, 'POST', { values: { amount: 8 } });
  assert.equal((await call('/api/datasets/plan/execution')).body.state, 'stale');
  assert.deepEqual((await call('/api/datasets/plan/rows')).body.rows, [{ amount: 5 }]);
});
test('stored output feeds nested pipelines, visual queries and the notebook input seam without source execution', async t => {
  const dir = await directory(t), path = join(dir, 'prep.json'), call = await api(t, true, { prepStorePath: path });
  await prepare(call); await call('/api/datasets/computed/publish', 'POST', {});
  // A new server has no ephemeral upload payloads. Stored reads must still work.
  const restarted = await api(t, true, { prepStorePath: path });
  const query = { dimensions: [], measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] };
  assert.deepEqual((await restarted('/api/datasets/computed/query', 'POST', query)).body.rows, [{ total: 5 }]);
  assert.equal((await restarted('/api/datasets/nested/prep', 'PUT', { name: 'Nested', pipeline: { version: 1, input: { dataset: 'computed' }, steps: [] } })).status, 201);
  await restarted('/api/datasets/nested/execution', 'PUT', stored);
  assert.equal((await restarted('/api/datasets/nested/publish', 'POST', {})).body.rowCount, 2);
  const connectors = new ConnectorRoutes(false), routes = await PrepRoutes.create(connectors, path); t.after(() => connectors.close());
  connectors.streamPrep = async () => assert.fail('Notebook inputs must not rerun stored pipelines');
  const table = await routes.notebookTable({ namespaceId: 'default', userId: 'author' }, 'prepared-computed');
  assert.equal(table.rowCount, 2); assert.equal(table.value(1, 1), 3);
  for (const user of ['reader', 'other-author', 'tenant-author']) {
    for (const [action, method, body] of [['rows', 'GET'], ['refresh', 'POST', {}], ['publish', 'POST', {}]]) {
      const response = await restarted(`/api/datasets/computed/${action}`, method, body, user);
      assert.equal(response.status, user === 'reader' ? 403 : 404);
    }
  }
});
