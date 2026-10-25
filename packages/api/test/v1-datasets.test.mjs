import test from 'node:test';
import assert from 'node:assert/strict';
import { serving } from './v1-helpers.mjs';
import { authFixture } from './hosted-helpers.mjs';
import { upload } from './source-helpers.mjs';

/**
 * Contract tests for the headless v1 datasets slice (issue #95, IDD D-37).
 * Every assertion is a promise the frozen contract makes to agents:
 * versioned paths, Bearer tenant auth, named error codes, Limit/Cursor
 * pagination, Idempotency-Key on mutations, 429 RATE_LIMIT_EXCEEDED, and
 * the fail-closed source-deletion pin-down.
 */
const hasErrorCode = r => { assert.equal(typeof r.body.errorCode, 'string', `expected errorCode in ${JSON.stringify(r.body)}`); return r.body.errorCode; };

test('v1 datasets: list, pagination, composed describe and lineage', async t => {
  const f = await authFixture(t), call = await serving(t, f);
  let token = (await f.login()).token;
  const mutate = async (path, options) => { const r = await call(path, { token, ...options }); if (r.status < 400) token = (await f.login()).token; return r; };
  assert.equal((await call('/api/v1/datasets', { token: 'forged' })).status, 401);
  assert.deepEqual((await call('/api/v1/datasets', { token })).body, { items: [], nextCursor: null });
  const source = (await mutate('/api/uploads', { method: 'POST', body: upload() })).body;
  assert.equal((await mutate('/api/datasets/base/prep', { method: 'PUT', body: { name: 'Base', pipeline: { version: 1, input: source.id, steps: [] }, expectedVersion: 0 } })).status, 200);
  assert.equal((await mutate('/api/datasets/child/prep', { method: 'PUT', body: { name: 'Child', pipeline: { version: 1, input: { dataset: 'base' }, steps: [] }, expectedVersion: 0 } })).status, 200);

  let r = await call('/api/v1/datasets', { token });
  assert.equal(r.status, 200); assert.equal(r.body.items.length, 2); assert.equal(r.body.nextCursor, null);
  assert.deepEqual(Object.keys(r.body.items[0]).sort(), ['execution', 'id', 'name', 'version']);
  r = await call('/api/v1/datasets', { token, headers: { Limit: '1' } });
  assert.equal(r.body.items.length, 1); assert.equal(typeof r.body.nextCursor, 'string');
  const second = await call('/api/v1/datasets', { token, headers: { Limit: '1', Cursor: r.body.nextCursor } });
  assert.equal(second.body.items.length, 1); assert.equal(second.body.nextCursor, null);
  assert.notDeepEqual(r.body.items[0].id, second.body.items[0].id);
  assert.equal(hasErrorCode(await call('/api/v1/datasets', { token, headers: { Limit: '0' } })), 'INVALID_PAGINATION');
  assert.equal(hasErrorCode(await call('/api/v1/datasets', { token, headers: { Limit: '1001' } })), 'INVALID_PAGINATION');
  assert.equal(hasErrorCode(await call('/api/v1/datasets', { token, headers: { Cursor: 'not-a-cursor' } })), 'INVALID_PAGINATION');
  assert.equal(hasErrorCode(await call('/api/v1/datasets', { token, headers: { Cursor: Buffer.from('{"offset":-1}').toString('base64') } })), 'INVALID_PAGINATION');

  r = await call('/api/v1/datasets/child', { token });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'Child'); assert.equal(r.body.version, 1);
  assert.deepEqual(r.body.schema.columns.map(c => c.name), ['region', 'amount', 'private']);
  assert.deepEqual(r.body.lineage.sources, []); assert.deepEqual(r.body.lineage.datasets, [{ id: 'base' }]); assert.equal(r.body.lineage.steps, 0);
  assert.deepEqual(r.body.refresh, { supported: false, mode: 'DIRECT_QUERY', intervalMinutes: null });
  assert.ok(hasErrorCode(await call('/api/v1/datasets/missing', { token })));

  r = await call('/api/v1/datasets/child/lineage', { token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.dataset, { id: 'child', name: 'Child', version: 1 });
  assert.equal(r.body.sources.length, 0); assert.equal(r.body.datasets.length, 1);
  assert.equal(r.body.datasets[0].name, 'Base');
  assert.deepEqual(r.body.datasets[0].inputs, [{ kind: 'source', id: source.id }]);
  r = await call('/api/v1/datasets/base/lineage', { token });
  assert.equal(r.body.sources.length, 1);
  assert.equal(r.body.sources[0].connectorId, 'file'); assert.equal(r.body.sources[0].available, true);

  r = await call('/api/v1/datasets/child/refresh-status', { token });
  assert.deepEqual(r.body, { datasetId: 'child', version: 1, mode: 'DIRECT_QUERY', intervalMinutes: null, supported: false });
  // Refresh on a direct-query dataset fails closed, not silently.
  r = await mutate('/api/v1/datasets/child/refresh', { method: 'POST', body: {} });
  assert.equal(r.status, 409); assert.equal(hasErrorCode(r), 'BLAZE_MODE_REQUIRED');

  // Existing unversioned routes keep working for the UI (D-37).
  r = await call('/api/prep-datasets', { token });
  assert.equal(r.status, 200); assert.equal(r.body.datasets.length, 2); assert.equal(r.body.persistence, 'durable');
});

test('v1 datasets: create/update/delete honor Idempotency-Key and If-Match', async t => {
  const f = await authFixture(t), call = await serving(t, f);
  let token = (await f.login()).token;
  const mutate = async (path, options) => { const r = await call(path, { token, ...options }); if (r.status < 400 && !r.headers['idempotent-replayed']) token = (await f.login()).token; return r; };
  const source = (await mutate('/api/uploads', { method: 'POST', body: upload() })).body;
  const pipeline = { version: 1, input: source.id, steps: [] };

  let r = await mutate('/api/v1/datasets/agent', { method: 'PUT', body: { name: 'Agent', pipeline, expectedVersion: 0 }, headers: { 'Idempotency-Key': 'create-once' } });
  assert.equal(r.status, 200); assert.equal(r.body.version, 1);
  r = await call('/api/v1/datasets/agent', { method: 'PUT', body: { name: 'Agent', pipeline, expectedVersion: 0 }, token, headers: { 'Idempotency-Key': 'create-once' } });
  assert.equal(r.status, 200); assert.equal(r.headers['idempotent-replayed'], 'true'); assert.equal(r.body.version, 1, 'replay must not bump the version');
  assert.equal((await call('/api/v1/datasets/agent', { token })).body.version, 1);

  for (const change of [{ name: 'Renamed' }, { pipeline: { ...pipeline, steps: [{ id: 'east', kind: 'filter', config: { filters: [{ columnName: 'region', value: 'east' }] } }] } }, { expectedVersion: 1 }]) {
    r = await mutate('/api/v1/datasets/agent', { method: 'PUT', body: { name: 'Agent', pipeline, expectedVersion: 0, ...change }, headers: { 'Idempotency-Key': 'create-once' } });
    assert.equal(r.status, 409); assert.equal(hasErrorCode(r), 'IDEMPOTENCY_CONFLICT');
    assert.equal(r.headers['idempotent-replayed'], undefined);
  }
  for (const options of [{ rawBody: '{' }, { body: { name: 'Agent', pipeline, expectedVersion: 0, extra: true } }]) {
    r = await mutate('/api/v1/datasets/agent', { method: 'PUT', headers: { 'Idempotency-Key': 'create-once', 'Content-Type': 'application/json' }, ...options });
    assert.equal(r.status, 400); assert.ok(hasErrorCode(r)); assert.equal(r.headers['idempotent-replayed'], undefined);
  }
  // Property order, including nested objects, does not change request contents.
  r = await mutate('/api/v1/datasets/agent', { method: 'PUT', body: { expectedVersion: 0, pipeline: { steps: [], input: source.id, version: 1 }, name: 'Agent' }, headers: { 'Idempotency-Key': 'create-once' } });
  assert.equal(r.status, 200); assert.equal(r.headers['idempotent-replayed'], 'true'); assert.equal(r.body.version, 1);
  const stored = await call('/api/v1/datasets/agent', { token });
  assert.equal(stored.status, 200); assert.equal(stored.body.name, 'Agent'); assert.equal(stored.body.version, 1);

  assert.equal(hasErrorCode(await mutate('/api/v1/datasets/agent', { method: 'DELETE' })), 'V1_IF_MATCH_REQUIRED');
  assert.equal(hasErrorCode(await mutate('/api/v1/datasets/agent', { method: 'DELETE', headers: { 'If-Match': '"abc"' } })), 'V1_IF_MATCH_INVALID');
  const staleDelete = await mutate('/api/v1/datasets/agent', { method: 'DELETE', headers: { 'If-Match': '"7"' } });
  assert.equal(staleDelete.status, 412); assert.equal(hasErrorCode(staleDelete), 'ASSET_PRECONDITION_FAILED');
  r = await mutate('/api/v1/datasets/agent', { method: 'DELETE', headers: { 'If-Match': '"1"', 'Idempotency-Key': 'delete-once' } });
  assert.equal(r.status, 200); assert.deepEqual(r.body, { id: 'agent', removed: true });
  r = await call('/api/v1/datasets/agent', { method: 'DELETE', token, headers: { 'If-Match': '"1"', 'Idempotency-Key': 'delete-once' } });
  assert.equal(r.headers['idempotent-replayed'], 'true'); assert.deepEqual(r.body, { id: 'agent', removed: true });
  r = await mutate('/api/v1/datasets/agent', { method: 'DELETE', headers: { 'If-Match': '"2"', 'Idempotency-Key': 'delete-once' } });
  assert.equal(r.status, 409); assert.equal(hasErrorCode(r), 'IDEMPOTENCY_CONFLICT'); assert.equal(r.headers['idempotent-replayed'], undefined);
  for (const [precondition, status, code] of [[{}, 428, 'V1_IF_MATCH_REQUIRED'], [{ 'If-Match': '"abc"' }, 400, 'V1_IF_MATCH_INVALID']]) {
    r = await mutate('/api/v1/datasets/agent', { method: 'DELETE', headers: { 'Idempotency-Key': 'delete-once', ...precondition } });
    assert.equal(r.status, status); assert.equal(hasErrorCode(r), code); assert.equal(r.headers['idempotent-replayed'], undefined);
  }
  r = await mutate('/api/v1/datasets/agent', { method: 'DELETE', headers: { 'If-Match': '"1"', 'Idempotency-Key': 'delete-once' } });
  assert.equal(r.status, 200); assert.equal(r.headers['idempotent-replayed'], 'true'); assert.deepEqual(r.body, { id: 'agent', removed: true });
});

test('v1 datasets: refresh retries validate the empty body before replay', async t => {
  const f = await authFixture(t), call = await serving(t, f);
  let token = (await f.login()).token;
  const mutate = async (path, options) => { const r = await call(path, { token, ...options }); if (r.status < 400 && !r.headers['idempotent-replayed']) token = (await f.login()).token; return r; };
  const source = (await mutate('/api/uploads', { method: 'POST', body: upload() })).body;
  let r = await mutate('/api/v1/datasets/cached', { method: 'PUT', body: { name: 'Cached', pipeline: { version: 1, input: source.id, steps: [] }, expectedVersion: 0 } });
  assert.equal(r.status, 200);
  r = await mutate('/api/datasets/cached/execution', { method: 'PUT', body: { mode: 'BLAZE', intervalMinutes: null, expectedVersion: 1 } });
  assert.equal(r.status, 200);
  const headers = { 'Idempotency-Key': 'refresh-once' }, path = '/api/v1/datasets/cached/refresh';
  const first = await mutate(path, { method: 'POST', body: {}, headers });
  assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(first.headers['idempotent-replayed'], undefined);
  for (const body of [{ unexpected: true }, []]) {
    r = await mutate(path, { method: 'POST', body, headers });
    assert.equal(r.status, 400); assert.equal(hasErrorCode(r), 'METADATA_INVALID'); assert.equal(r.headers['idempotent-replayed'], undefined);
  }
  r = await mutate(path, { method: 'POST', body: {}, headers });
  assert.equal(r.status, 200); assert.deepEqual(r.body, first.body); assert.equal(r.headers['idempotent-replayed'], 'true');
});

test('v1 sources: list, describe, fail-closed deletion pin-down', async t => {
  const f = await authFixture(t), call = await serving(t, f);
  let token = (await f.login()).token;
  const mutate = async (path, options) => { const r = await call(path, { token, ...options }); if (r.status < 400 && !r.headers['idempotent-replayed']) token = (await f.login()).token; return r; };
  const source = (await mutate('/api/uploads', { method: 'POST', body: upload() })).body;
  await mutate('/api/datasets/base/prep', { method: 'PUT', body: { name: 'Base', pipeline: { version: 1, input: source.id, steps: [] }, expectedVersion: 0 } });
  await mutate('/api/datasets/child/prep', { method: 'PUT', body: { name: 'Child', pipeline: { version: 1, input: { dataset: 'base' }, steps: [] }, expectedVersion: 0 } });

  let r = await call('/api/v1/sources', { token });
  assert.equal(r.status, 200); assert.equal(r.body.nextCursor, null);
  const listed = r.body.items.find(s => s.id === source.id);
  assert.equal(listed.available, true); assert.equal(listed.connectorId, 'file'); assert.equal(listed.version, 1);
  r = await call(`/api/v1/sources/${source.id}`, { token });
  assert.equal(r.status, 200); assert.deepEqual(r.body.columns.map(c => c.name), ['region', 'amount', 'private']);

  // Deletion is fail-closed while any dataset references the source,
  // including transitively through nested dataset refs.
  r = await mutate(`/api/v1/sources/${source.id}`, { method: 'DELETE', headers: { 'If-Match': '"1"', 'Idempotency-Key': 'retire-blocked' } });
  assert.equal(r.status, 409); assert.equal(hasErrorCode(r), 'SOURCE_DELETE_BLOCKED_BY_DATASET');
  assert.ok(r.body.message.includes('child'));
  await mutate('/api/v1/datasets/child', { method: 'DELETE', headers: { 'If-Match': '"1"' } });
  r = await mutate(`/api/v1/sources/${source.id}`, { method: 'DELETE', headers: { 'If-Match': '"1"', 'Idempotency-Key': 'retire-blocked' } });
  assert.equal(r.status, 409); assert.equal(hasErrorCode(r), 'SOURCE_DELETE_BLOCKED_BY_DATASET');
  assert.ok(r.body.message.includes('base'));
  await mutate('/api/v1/datasets/base', { method: 'DELETE', headers: { 'If-Match': '"1"' } });
  r = await mutate(`/api/v1/sources/${source.id}`, { method: 'DELETE', headers: { 'If-Match': '"1"', 'Idempotency-Key': 'retire-blocked' } });
  assert.equal(r.status, 200); assert.deepEqual(r.body, { id: source.id, retired: true, version: 2 });
  r = await mutate(`/api/v1/sources/${source.id}`, { method: 'DELETE', headers: { 'If-Match': '"2"', 'Idempotency-Key': 'retire-blocked' } });
  assert.equal(r.status, 409); assert.equal(hasErrorCode(r), 'IDEMPOTENCY_CONFLICT'); assert.equal(r.headers['idempotent-replayed'], undefined);
  for (const [precondition, status, code] of [[{}, 428, 'V1_IF_MATCH_REQUIRED'], [{ 'If-Match': '"abc"' }, 400, 'V1_IF_MATCH_INVALID']]) {
    r = await mutate(`/api/v1/sources/${source.id}`, { method: 'DELETE', headers: { 'Idempotency-Key': 'retire-blocked', ...precondition } });
    assert.equal(r.status, status); assert.equal(hasErrorCode(r), code); assert.equal(r.headers['idempotent-replayed'], undefined);
  }
  r = await mutate(`/api/v1/sources/${source.id}`, { method: 'DELETE', headers: { 'If-Match': '"1"', 'Idempotency-Key': 'retire-blocked' } });
  assert.equal(r.status, 200); assert.deepEqual(r.body, { id: source.id, retired: true, version: 2 }); assert.equal(r.headers['idempotent-replayed'], 'true');
  assert.equal(hasErrorCode(await call(`/api/v1/sources/${source.id}`, { token })), 'SOURCE_RETIRED');
  assert.equal(hasErrorCode(await call('/api/v1/sources/nope', { token })), 'RESOURCE_NOT_FOUND');
});

test('v1 sources: deletion guard sees stored references from unavailable prepared datasets', async t => {
  const f = await authFixture(t), call = await serving(t, f);
  let token = (await f.login()).token;
  const mutate = async (path, options) => { const r = await call(path, { token, ...options }); if (r.status < 400 && !r.headers['idempotent-replayed']) token = (await f.login()).token; return r; };
  const target = (await mutate('/api/uploads', { method: 'POST', body: upload() })).body;
  const other = (await mutate('/api/uploads', { method: 'POST', body: upload() })).body;
  assert.notEqual(target.id, other.id);
  // guarded references the target only through a join step source; its
  // pipeline input is the other source.
  let r = await mutate('/api/datasets/guarded/prep', { method: 'PUT', body: { name: 'Guarded', expectedVersion: 0, pipeline: { version: 1, input: other.id, steps: [{ id: 'join', kind: 'join', config: { source: target.id, joinType: 'left', keys: [{ left: 'region', right: 'region' }], prefix: 'r_' } }] } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await mutate('/api/datasets/outer/prep', { method: 'PUT', body: { name: 'Outer', pipeline: { version: 1, input: { dataset: 'guarded' }, steps: [] }, expectedVersion: 0 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  // Retire the other source through the unversioned route (no v1 guard on
  // it), making guarded — and transitively outer — unavailable for a reason
  // unrelated to the target source.
  r = await mutate(`/api/sources/${other.id}`, { method: 'DELETE', body: { expectedVersion: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call('/api/prep-datasets', { token });
  assert.equal(r.status, 200);
  assert.ok(r.body.unavailable.some(u => u.id === 'guarded'), `guarded must be unavailable: ${JSON.stringify(r.body.unavailable)}`);
  assert.ok(hasErrorCode(await call('/api/v1/datasets/guarded', { token })), 'guarded describe must fail while unavailable');

  // The stored-reference guard must still block: guarded directly (join step
  // source) and outer transitively through the unavailable intermediate.
  r = await mutate(`/api/v1/sources/${target.id}`, { method: 'DELETE', headers: { 'If-Match': '"1"' } });
  assert.equal(r.status, 409, JSON.stringify(r.body)); assert.equal(hasErrorCode(r), 'SOURCE_DELETE_BLOCKED_BY_DATASET');
  assert.ok(r.body.message.includes('guarded'), r.body.message);
  assert.ok(r.body.message.includes('outer'), r.body.message);

  // Once the stored references are gone the guard must not over-block.
  r = await mutate('/api/v1/datasets/outer', { method: 'DELETE', headers: { 'If-Match': '"1"' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await mutate('/api/v1/datasets/guarded', { method: 'DELETE', headers: { 'If-Match': '"1"' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await mutate(`/api/v1/sources/${target.id}`, { method: 'DELETE', headers: { 'If-Match': '"1"' } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.deepEqual(r.body, { id: target.id, retired: true, version: 2 });
});

test('v1: rate limiting returns 429 RATE_LIMIT_EXCEEDED with Retry-After', async t => {
  const f = await authFixture(t), call = await serving(t, f, { OPENSIGHT_V1_RATE_LIMIT_PER_MINUTE: '2' });
  const token = (await f.login()).token;
  assert.equal((await call('/api/v1/datasets', { token })).status, 200);
  assert.equal((await call('/api/v1/datasets', { token })).status, 200);
  const r = await call('/api/v1/datasets', { token });
  assert.equal(r.status, 429); assert.equal(hasErrorCode(r), 'RATE_LIMIT_EXCEEDED');
  assert.ok(Number(r.headers['retry-after']) >= 1, 'Retry-After header is set');
  // Non-v1 routes are unaffected by the v1 limiter.
  assert.equal((await call('/api/session', { token })).status, 200);
});

test('v1: unknown routes and bad ids fail with named codes, never bare 500s', async t => {
  const f = await authFixture(t), call = await serving(t, f);
  const token = (await f.login()).token;
  assert.equal(hasErrorCode(await call('/api/v1/nope', { token })), 'RESOURCE_NOT_FOUND');
  assert.equal((await call('/api/v1/nope', { token })).status, 404);
  assert.equal((await call('/api/v1/datasets', { token, method: 'POST', body: {} })).status, 405);
  assert.equal(hasErrorCode(await call('/api/v1/datasets', { token, method: 'POST', body: {} })), 'METHOD_NOT_ALLOWED');
  assert.equal(hasErrorCode(await call('/api/v1/datasets/child/lineage/extra', { token })), 'RESOURCE_NOT_FOUND');
});
