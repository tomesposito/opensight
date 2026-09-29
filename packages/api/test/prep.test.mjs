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

const csv = text => ({ config: { format: 'csv' }, base64: Buffer.from(text).toString('base64') });
const joined = (input, source, joinType = 'left') => ({ version: 1, input, steps: [{ id: 'join', kind: 'join', config: { source, joinType, keys: [{ left: 'id', right: 'id' }], prefix: 'r_' } }] });
test('hosted joins preview all outer cases before save, persist typed refs and re-resolve prepared dependencies', async t => {
  const call = await api(t), left = (await call('/api/uploads', 'POST', csv('id,label\n1,Left\n2,Only left\n'))).body.id;
  const right = (await call('/api/uploads', 'POST', csv('id,label\n1,Right\n3,Only right\n'))).body.id;
  const base = { version: 1, input: right, steps: [] };
  assert.equal((await call('/api/datasets/lookup/prep', 'PUT', { name: 'Lookup', pipeline: base })).status, 201);
  const summary = (await call('/api/prep-sources')).body.find(s => s.ref?.dataset === 'lookup');
  assert.deepEqual(summary.columns.map(c => c.name), ['id', 'label']); assert.equal(summary.available, true); assert.equal(summary.table, undefined);
  const path = '/api/datasets/joined/prep';
  for (const joinType of ['inner', 'left', 'right', 'full']) {
    const p = joined(left, { dataset: 'lookup' }, joinType);
    const preview = await call(`${path}/preview`, 'POST', { pipeline: p, limit: 1 });
    assert.equal(preview.status, 200, JSON.stringify(preview.body)); assert.equal(preview.body.rows.length, 1);
    assert.equal(preview.body.truncated, joinType !== 'inner');
    const full = (await call(`${path}/preview`, 'POST', { pipeline: p })).body;
    assert.equal(full.rows.length, { inner: 1, left: 2, right: 2, full: 3 }[joinType]);
    if (joinType === 'right' || joinType === 'full') assert.ok(full.rows.some(r => r.id === null && r.r_id === 3));
  }
  const pipeline = joined(left, { dataset: 'lookup' }, 'full');
  assert.equal((await call(path, 'PUT', { name: 'Joined', pipeline })).status, 201);
  assert.deepEqual((await call(path)).body.resource.opensightPrep, pipeline);
  // Cross-source output is a Blaze input under #15, so refresh before reuse.
  assert.equal((await call('/api/datasets/joined/refresh', 'POST', {})).status, 200);
  const reused = { version: 1, input: { dataset: 'joined' }, steps: [{ id: 'select', kind: 'select', config: { columns: ['r_label'] } }] };
  assert.equal((await call('/api/datasets/reused/prep/preview', 'POST', { pipeline: reused })).body.rows.length, 3);
  const changed = { ...base, steps: [{ id: 'filter', kind: 'filter', config: { filters: [{ columnName: 'id', value: 3 }] } }] };
  await call('/api/datasets/lookup/prep', 'PUT', { name: 'Lookup', pipeline: changed });
  const latest = (await call(`${path}/preview`, 'POST', {})).body;
  assert.ok(latest.rows.every(r => r.r_label !== 'Right'));
  await call('/api/datasets/lookup/prep', 'DELETE');
  assert.equal((await call(`${path}/preview`, 'POST', {})).body.errorCode, 'PREP_SOURCE_NOT_FOUND');
  const unavailable = (await call('/api/prep-sources')).body.find(s => s.ref?.dataset === 'joined');
  assert.equal(unavailable.available, false); assert.equal(unavailable.errorCode, 'BLAZE_INVALIDATED');
});
test('prepared references cannot bypass ownership, namespace, authentication, or source security', async t => {
  const call = await api(t), uploadId = (await call('/api/uploads', 'POST', csv('id,label\n1,private\n'))).body.id;
  const p = { version: 1, input: uploadId, steps: [] };
  await call('/api/datasets/private-prepared/prep', 'PUT', { name: 'Private', pipeline: p });
  for (const user of ['other-author', 'tenant-author']) {
    const own = (await call('/api/uploads', 'POST', csv('id,label\n1,owned\n'), user)).body.id;
    for (const pipeline of [joined(own, { dataset: 'private-prepared' }), { ...p, input: { dataset: 'private-prepared' } }]) {
      const result = await call('/api/datasets/attack/prep/preview', 'POST', { pipeline }, user);
      assert.equal(result.body.errorCode, 'PREP_SOURCE_NOT_FOUND'); assert.equal(result.status, 404);
    }
  }
  const forged = joined(uploadId, { dataset: 'private-prepared', security: 'unrestricted' });
  assert.equal((await call('/api/datasets/attack/prep/preview', 'POST', { pipeline: forged })).body.errorCode, 'INVALID_PREP_PIPELINE');
});
test('prepared saves reject direct, indirect and concurrent cycles atomically', async t => {
  const call = await api(t), input = (await call('/api/uploads', 'POST', csv('id\n1\n'))).body.id;
  const p = { version: 1, input, steps: [] }, put = (id, pipeline) => call(`/api/datasets/${id}/prep`, 'PUT', { name: id, pipeline });
  await put('a', p); await put('b', { ...p, input: { dataset: 'a' } });
  assert.equal((await put('a', { ...p, input: { dataset: 'a' } })).body.errorCode, 'INVALID_PREP_PIPELINE');
  assert.equal((await put('a', { ...p, input: { dataset: 'b' } })).body.errorCode, 'INVALID_PREP_PIPELINE');
  assert.deepEqual((await call('/api/datasets/a/prep')).body.resource.opensightPrep, p);
  await put('b', p);
  const results = await Promise.all([put('a', { ...p, input: { dataset: 'b' } }), put('b', { ...p, input: { dataset: 'a' } })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
});
test('join API surfaces key mismatch and output collisions and rejects cross-connection prepared joins', async t => {
  const bindings = ['one', 'two'].map(id => ({ namespaceId: 'default', userId: 'author', source: { id, connectorId: 'postgresql', table: id, columns: [{ name: 'id', type: 'INTEGER' }], security: 'unrestricted' }, config: { connectionEnv: `PREP_TEST_${id.toUpperCase()}` } }));
  const call = await api(t, true, { prepPostgresBindings: bindings });
  const put = (id, pipeline) => call(`/api/datasets/${id}/prep`, 'PUT', { name: id, pipeline });
  assert.equal((await put('pg', { version: 1, input: 'two', steps: [] })).status, 201);
  assert.equal((await put('mixed', joined('one', { dataset: 'pg' }))).body.errorCode, 'PREP_SOURCE_NOT_FOUND');
  const left = (await call('/api/uploads', 'POST', csv('id,label\n1,left\n'))).body.id;
  assert.equal((await put('mixed', joined(left, { dataset: 'pg' }))).body.errorCode, 'PREP_SOURCE_NOT_FOUND');
  const right = (await call('/api/uploads', 'POST', csv('id,label\na,right\n'))).body.id;
  const mismatch = await call('/api/datasets/draft/prep/preview', 'POST', { pipeline: joined(left, right) });
  assert.equal(mismatch.body.errorCode, 'PREP_SCHEMA_MISMATCH'); assert.match(mismatch.body.Message, /INTEGER.*STRING/);
  const collision = joined(left, left); delete collision.steps[0].config.prefix;
  collision.steps[0].config.columns = [{ column: 'label', name: 'LABEL' }];
  assert.equal((await put('collision', collision)).body.errorCode, 'PREP_SCHEMA_MISMATCH');
});
