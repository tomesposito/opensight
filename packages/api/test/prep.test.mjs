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
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const upload = { config: { format: 'csv' }, base64: Buffer.from('region,amount\nEast,2\nWest,3\n').toString('base64') };
const prepared = input => ({ version: 1, input, steps: [{ id: 'sum', kind: 'aggregate', config: { groupBy: [], measures: [{ column: 'amount', name: 'total', aggregation: 'SUM' }] } }] });
test('prep API creates, updates, reads and deletes private dataset resources with live per-step previews', async t => {
  const call = await api(t), staged = await call('/api/uploads', 'POST', upload), pipeline = prepared(staged.body.id), path = '/api/datasets/prepared/prep';
  const sources = await call('/api/prep-sources'); assert.equal(sources.status, 200); assert.equal(sources.body[0].id, staged.body.id); assert.equal(sources.body[0].table, undefined);
  const saved = await call(path, 'PUT', { name: 'Prepared', pipeline }); assert.equal(saved.status, 201); assert.equal(saved.body.persistence, 'ephemeral');
  assert.deepEqual((await call(path)).body.resource.opensightPrep, pipeline);
  assert.equal((await call('/api/prep-datasets')).body.datasets.length, 1);
  const result = await call(`${path}/preview`, 'POST', { through: 'sum', limit: 2 }); assert.equal(result.status, 200); assert.deepEqual(result.body.rows, [{ total: 5 }]); assert.equal(result.body.totalRows, 1);
  const input = await call(`${path}/preview`, 'POST', { through: null, limit: 1 }); assert.equal(input.body.truncated, true); assert.equal(input.body.totalRows, null); assert.equal(input.body.rows.length, 1);
  assert.equal((await call(path, 'PUT', { name: 'Renamed', pipeline })).status, 200);
  assert.equal((await call(path, 'DELETE')).status, 200); assert.equal((await call(path)).body.errorCode, 'PREP_NOT_FOUND');
});
test('prep APIs reject reader, cross-owner/namespace and forged source bindings', async t => {
  const call = await api(t), staged = await call('/api/uploads', 'POST', upload), pipeline = prepared(staged.body.id), path = '/api/datasets/private/prep';
  assert.equal((await call(path, 'PUT', { name: 'Private', pipeline })).status, 201);
  for (const user of ['other-author', 'tenant-author']) {
    assert.deepEqual((await call('/api/prep-sources', 'GET', undefined, user)).body, []);
    assert.equal((await call(path, 'GET', undefined, user)).status, 404);
    assert.equal((await call(`${path}/preview`, 'POST', { pipeline }, user)).body.errorCode, 'PREP_SOURCE_NOT_FOUND');
    assert.equal((await call(path, 'PUT', { name: 'Forged', pipeline }, user)).status, 404);
    assert.equal((await call(path, 'DELETE', undefined, user)).status, 404);
  }
  for (const endpoint of ['/api/prep-sources', '/api/prep-datasets', path]) assert.equal((await call(endpoint, 'GET', undefined, 'reader')).status, 403);
  assert.equal((await call(`${path}/preview`, 'POST', { pipeline }, 'reader')).status, 403);
  for (const extra of [{ userId: 'other-author' }, { security: 'unrestricted' }, { source: { table: 'sales' } }]) assert.equal((await call(path, 'PUT', { name: 'Forged', pipeline, ...extra })).status, 400);
});
test('prep validation is atomic and preview requests cannot bypass downstream validation', async t => {
  const call = await api(t), staged = await call('/api/uploads', 'POST', upload), pipeline = prepared(staged.body.id), path = '/api/datasets/checked/prep';
  await call(path, 'PUT', { name: 'Original', pipeline });
  const invalid = { ...pipeline, steps: [...pipeline.steps, { id: 'bad', kind: 'select', config: { columns: ['missing'] } }] };
  assert.equal((await call(path, 'PUT', { name: 'Changed', pipeline: invalid })).body.errorCode, 'PREP_SCHEMA_MISMATCH');
  assert.equal((await call(path)).body.resource.name, 'Original');
  assert.equal((await call(`${path}/preview`, 'POST', { pipeline: invalid, through: null })).body.errorCode, 'PREP_SCHEMA_MISMATCH');
  assert.equal((await call(`${path}/preview`, 'POST', { limit: 501 })).body.errorCode, 'PREP_LIMIT_EXCEEDED');
  assert.equal((await call(`${path}/preview`, 'POST', { through: 'missing' })).body.errorCode, 'PREP_NOT_FOUND');
  assert.equal((await call(`${path}/preview`, 'POST', { pipeline: null })).body.errorCode, 'INVALID_PREP_PIPELINE');
  assert.equal((await call('/api/datasets/missing/prep/preview', 'POST', {})).body.errorCode, 'PREP_NOT_FOUND');
  assert.equal((await call(path, 'PATCH', {})).status, 405);
  assert.equal((await call(path + '?sql=1')).status, 400);
});
test('prep metadata persists across restart; expired upload bindings fail closed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'opensight-prep-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const prepStorePath = join(dir, 'prep.json'), call = await api(t, true, { prepStorePath }), staged = await call('/api/uploads', 'POST', upload);
  const pipeline = prepared(staged.body.id), path = '/api/datasets/persisted/prep';
  assert.equal((await call(path, 'PUT', { name: 'Persistent', pipeline })).body.persistence, 'file');
  assert.equal(JSON.parse(await readFile(prepStorePath, 'utf8')).datasets.length, 1);
  const restarted = await api(t, true, { prepStorePath });
  assert.deepEqual((await restarted(path)).body.resource.opensightPrep, pipeline);
  assert.equal((await restarted(`${path}/preview`, 'POST', {})).body.errorCode, 'PREP_SOURCE_NOT_FOUND');
});
test('prep requires authenticated hosted API and rejects protected Postgres bindings without connecting', async t => {
  const call = await api(t, false);
  assert.equal((await call('/api/prep-sources')).body.errorCode, 'SECURITY_NOT_CONFIGURED');
  const protectedCall = await api(t, true, { prepPostgresBindings: [{ namespaceId: 'default', userId: 'author', source: { id: 'protected', connectorId: 'postgresql', table: 'source', columns: [{ name: 'amount', type: 'INTEGER' }], security: 'protected' }, config: { connectionEnv: 'UNSET_PREP_TEST_URL' } }] });
  assert.equal((await protectedCall('/api/datasets/pg/prep/preview', 'POST', { pipeline: prepared('protected') })).body.errorCode, 'PREP_SECURITY_REJECTED');
});
