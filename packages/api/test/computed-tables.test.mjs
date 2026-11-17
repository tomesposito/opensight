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
