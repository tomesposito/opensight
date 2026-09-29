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
import { UploadStaging } from '@opensight/query-engine';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const csv = text => ({ config: { format: 'csv' }, base64: Buffer.from(text).toString('base64') });
const query = { dimensions: [], measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] };
const blaze = { mode: 'BLAZE', intervalMinutes: null };
async function prepare(call, id = 'cached', text = 'id,amount\n1,2\n2,3\n') {
  const uploaded = await call('/api/uploads', 'POST', csv(text)); assert.equal(uploaded.status, 201);
  const pipeline = { version: 1, input: uploaded.body.id, steps: [] };
  assert.equal((await call(`/api/datasets/${id}/prep`, 'PUT', { name: id, pipeline })).status, 201);
  return pipeline;
}
test('prepared direct and Blaze queries agree; cached reads bypass source execution and label provenance', async t => {
  const call = await api(t), pipeline = await prepare(call), path = '/api/datasets/cached';
  const direct = await call(`${path}/query`, 'POST', query); assert.equal(direct.status, 200, JSON.stringify(direct.body)); assert.deepEqual(direct.body.rows, [{ total: 5 }]); assert.equal(direct.body.execution.cached, false);
  assert.equal((await call(`${path}/execution`, 'PUT', blaze)).status, 200);
  assert.equal((await call(`${path}/query`, 'POST', query)).body.errorCode, 'BLAZE_INVALIDATED');
  const refreshed = await call(`${path}/refresh`, 'POST', {}); assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body)); assert.equal(refreshed.body.rowCount, 2);
  const source = t.mock.method(UploadStaging.prototype, 'streamPrep', async () => { throw new Error('source must not run'); });
  const cached = await call(`${path}/query`, 'POST', query); assert.deepEqual(cached.body.rows, direct.body.rows); assert.equal(cached.body.execution.cached, true); assert.equal(cached.body.execution.refreshedAt, refreshed.body.lastRefreshedAt); assert.equal(source.mock.callCount(), 0);
  const rows = await call(`${path}/rows`); assert.deepEqual(rows.body.rows, [{ id: 1, amount: 2 }, { id: 2, amount: 3 }]);
  assert.equal((await call('/api/prep-sources')).body.find(s => s.id === 'cached').execution.mode, 'BLAZE');
  const failure = await call(`${path}/refresh`, 'POST', {}); assert.equal(failure.body.errorCode, 'BLAZE_REFRESH_FAILED'); assert.doesNotMatch(JSON.stringify(failure), /must not run/);
  assert.equal((await call(`${path}/query`, 'POST', query)).body.errorCode, 'BLAZE_REFRESH_FAILED');
  const status = (await call(`${path}/execution`)).body; assert.equal(status.lastRefreshedAt, refreshed.body.lastRefreshedAt); assert.equal(status.rowCount, null);
  source.mock.restore();
  await call(`${path}/refresh`, 'POST', {});
  await call(`${path}/prep`, 'PUT', { name: 'new', pipeline });
  assert.equal((await call(`${path}/rows`)).body.errorCode, 'BLAZE_INVALIDATED');
  await call(`${path}/execution`, 'PUT', { mode: 'DIRECT_QUERY', intervalMinutes: null });
  assert.deepEqual((await call(`${path}/query`, 'POST', query)).body.rows, [{ total: 5 }]);
  assert.equal((await call(`${path}/refresh`, 'POST', {})).body.errorCode, 'BLAZE_MODE_REQUIRED');
});
test('materialization includes full output beyond preview, then refuses configured size without truncation', async t => {
  const old = process.env.OPENSIGHT_BLAZE_MAX_ROWS; process.env.OPENSIGHT_BLAZE_MAX_ROWS = '650';
  t.after(() => { if (old === undefined) delete process.env.OPENSIGHT_BLAZE_MAX_ROWS; else process.env.OPENSIGHT_BLAZE_MAX_ROWS = old; });
  const call = await api(t);
  for (const [id, count] of [['fits',600],['oversize',651]]) {
    await prepare(call, id, 'id,amount\n' + Array.from({ length: count }, (_, i) => `${i},2`).join('\n'));
    await call(`/api/datasets/${id}/execution`, 'PUT', blaze);
    const result = await call(`/api/datasets/${id}/refresh`, 'POST', {});
    if (count === 600) { assert.equal(result.body.rowCount, 600); assert.deepEqual((await call(`/api/datasets/${id}/query`, 'POST', query)).body.rows, [{ total: 1200 }]); const rows = (await call(`/api/datasets/${id}/rows`)).body; assert.equal(rows.rows.length,100); assert.equal(rows.truncated,true); }
    else { assert.equal(result.status,413); assert.equal(result.body.errorCode,'BLAZE_DATASET_TOO_LARGE'); assert.equal((await call(`/api/datasets/${id}/execution`)).body.rowCount,null); }
  }
});
test('Blaze datasets feed all join types and dependent caches invalidate on metadata changes/deletion', async t => {
  const call = await api(t), left = await prepare(call, 'left'), right = await prepare(call, 'right', 'id,amount\n1,7\n3,9\n');
  for (const id of ['left','right']) { await call(`/api/datasets/${id}/execution`, 'PUT', blaze); await call(`/api/datasets/${id}/refresh`, 'POST', {}); }
  for (const joinType of ['inner','left','right','full']) {
    const pipeline = { version: 1, input: { dataset: 'left' }, steps: [{ id: 'join', kind: 'join', config: { source: { dataset: 'right' }, joinType, keys: [{ left: 'id', right: 'id' }], prefix: 'r_' } }] };
    assert.equal((await call('/api/datasets/joined/prep','PUT',{ name:'Joined',pipeline })).status,joinType === 'inner' ? 201 : 200);
    const result = await call('/api/datasets/joined/prep/preview', 'POST', {}); assert.equal(result.status,200,JSON.stringify(result.body)); assert.equal(result.body.rows.length,{inner:1,left:2,right:2,full:3}[joinType]); assert.equal(result.body.cachedInputs.length,2);
  }
  await call('/api/datasets/joined/execution','PUT',blaze);
  assert.equal((await call('/api/datasets/joined/refresh','POST',{})).body.rowCount,3);
  const result = (await call('/api/datasets/joined/rows')).body; assert.equal(result.execution.cachedInputs.length,2);
  const cyclic = { ...left, input: { dataset: 'joined' } };
  assert.equal((await call('/api/datasets/left/prep','PUT',{ name:'cycle',pipeline:cyclic })).body.errorCode,'INVALID_PREP_PIPELINE');
  await call('/api/datasets/right/prep','DELETE');
  assert.equal((await call('/api/datasets/joined/rows')).body.errorCode,'BLAZE_INVALIDATED');
  const failed = await call('/api/datasets/joined/refresh','POST',{}); assert.equal(failed.body.errorCode,'BLAZE_PIPELINE_INVALID'); assert.equal(failed.body.causeCode,'PREP_SOURCE_NOT_FOUND');
});
test('execution and cached rows stay private, reject forged settings and require author capability', async t => {
  const call = await api(t); await prepare(call);
  await call('/api/datasets/cached/execution','PUT',blaze); await call('/api/datasets/cached/refresh','POST',{});
  for (const user of ['other-author','tenant-author','reader']) for (const [action,method,body] of [['execution','GET'],['execution','PUT',blaze],['refresh','POST',{}],['rows','GET'],['query','POST',query]]) {
    assert.equal((await call(`/api/datasets/cached/${action}`,method,body,user)).status,user === 'reader' ? 403 : 404);
  }
  assert.equal((await call('/api/datasets/cached/query','POST',{ ...query, userId:'other-author' })).body.errorCode,'FORGED_PRINCIPAL');
  assert.equal((await call('/api/datasets/cached/execution','PUT',{ ...blaze, table:'forged' })).body.errorCode,'BLAZE_CONFIG_INVALID');
  assert.equal((await call('/api/datasets/cached/refresh','POST',{ pipeline:{} })).status,400);
  assert.equal((await call('/api/datasets/cached/rows?limit=999999')).status,400);
});
test('restart keeps mode and schedule but never claims cached rows survived', async t => {
  const directory = await mkdtemp(join(tmpdir(),'blaze-')); t.after(() => rm(directory,{recursive:true,force:true}));
  const prepStorePath = join(directory,'prep.json'), call = await api(t,true,{ prepStorePath }); await prepare(call);
  await call('/api/datasets/cached/execution','PUT',{ ...blaze,intervalMinutes:5 }); await call('/api/datasets/cached/refresh','POST',{});
  const restarted = await api(t,true,{ prepStorePath }), status = (await restarted('/api/datasets/cached/execution')).body;
  assert.equal(status.mode,'BLAZE'); assert.equal(status.intervalMinutes,5); assert.equal(status.state,'empty'); assert.equal(status.lastRefreshedAt,null);
  assert.equal((await restarted('/api/datasets/cached/rows')).body.errorCode,'BLAZE_NOT_READY');
  const failure = await restarted('/api/datasets/cached/refresh','POST',{}); assert.equal(failure.body.errorCode,'BLAZE_PIPELINE_INVALID'); assert.equal(failure.body.causeCode,'PREP_SOURCE_NOT_FOUND');
});
test('saving during an HTTP refresh prevents obsolete output from being published',async t=>{
  const call=await api(t),pipeline=await prepare(call);await call('/api/datasets/cached/execution','PUT',blaze);
  let ready,release;const entered=new Promise(resolve=>ready=resolve),blocked=new Promise(resolve=>release=resolve);
  const original=UploadStaging.prototype.streamPrep;
  t.mock.method(UploadStaging.prototype,'streamPrep',async function(...args){await original.apply(this,args);ready();await blocked;});
  const pending=call('/api/datasets/cached/refresh','POST',{});await entered;
  assert.equal((await call('/api/datasets/cached/rows')).body.errorCode,'BLAZE_REFRESH_IN_PROGRESS');
  assert.equal((await call('/api/datasets/cached/prep','PUT',{name:'Changed',pipeline})).status,200);
  release();assert.equal((await pending).body.errorCode,'BLAZE_INVALIDATED');assert.equal((await call('/api/datasets/cached/rows')).body.errorCode,'BLAZE_INVALIDATED');
});
test('issue #15 advanced prep always serves materialized output and refuses direct mode', async t => {
  const call = await api(t), base = await prepare(call), other = await prepare(call, 'other');
  const steps = [
    { id: 'sum', kind: 'aggregate', config: { groupBy: [], measures: [{ column: 'amount', name: 'amount', aggregation: 'SUM' }] } },
    { id: 'pivot', kind: 'pivot', config: { groupBy: [], column: 'id', value: 'amount', aggregation: 'SUM', values: [{ value: 1, name: 'amount' }] } },
    { id: 'unpivot', kind: 'unpivot', config: { columns: ['amount'], nameColumn: 'metric', valueColumn: 'amount' } },
    { id: 'append', kind: 'append', config: { source: other.input } },
  ];
  for (const step of steps) {
    const path = `/api/datasets/${step.kind}`, pipeline = { ...base, steps: [step] };
    const preview = await call(`${path}/prep/preview`, 'POST', { pipeline }); assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal((await call(`${path}/prep`, 'PUT', { name: step.kind, pipeline })).status, 201);
    const status = (await call(`${path}/execution`)).body; assert.equal(status.mode, 'BLAZE'); assert.match(status.materializationReason, new RegExp(step.kind));
    const refused = await call(`${path}/execution`, 'PUT', { mode: 'DIRECT_QUERY', intervalMinutes: null });
    assert.equal(refused.status, 409); assert.equal(refused.body.errorCode, 'BLAZE_MATERIALIZATION_REQUIRED');
    assert.equal((await call(`${path}/rows`)).body.errorCode, 'BLAZE_INVALIDATED');
    assert.equal((await call(`${path}/query`, 'POST', query)).body.errorCode, 'BLAZE_INVALIDATED');
    assert.equal((await call(`${path}/refresh`, 'POST', {})).status, 200);
    const source = t.mock.method(UploadStaging.prototype, 'streamPrep', async () => { throw new Error('No live advanced output'); });
    const rows = await call(`${path}/rows`); assert.equal(rows.body.execution.cached, true); assert.deepEqual(rows.body.rows, preview.body.rows);
    assert.equal((await call(`${path}/query`, 'POST', query)).body.execution.cached, true); assert.equal(source.mock.callCount(), 0); source.mock.restore();
  }
});
test('issue #15 distinguishes cross-source joins from simple single-source and self joins', async t => {
  const call = await api(t), base = await prepare(call), right = await prepare(call, 'right');
  const step = source => ({ id: 'join', kind: 'join', config: { source, joinType: 'left', keys: [{ left: 'id', right: 'id' }], prefix: 'r_' } });
  for (const [id, steps, required] of [
    ['simple', [{ id: 'filter', kind: 'filter', config: { filters: [{ columnName: 'id', value: 1 }] } }], false],
    ['self', [step(base.input)], false],
    ['previous', [{ id: 'select', kind: 'select', config: { columns: ['id', 'amount'] } }, step({ step: 'select' })], false],
    ['cross', [step(right.input)], true],
    ['prepared-cross', [step({ dataset: 'right' })], true],
  ]) {
    const path = `/api/datasets/${id}`;
    assert.equal((await call(`${path}/prep`, 'PUT', { name: id, pipeline: { ...base, steps } })).status, 201);
    assert.equal((await call(`${path}/execution`)).body.mode, required ? 'BLAZE' : 'DIRECT_QUERY');
    if (required) {
      assert.equal((await call(`${path}/execution`, 'PUT', { mode: 'DIRECT_QUERY', intervalMinutes: null })).body.errorCode, 'BLAZE_MATERIALIZATION_REQUIRED');
      assert.equal((await call(`${path}/refresh`, 'POST', {})).status, 200);
    }
    assert.equal((await call(`${path}/query`, 'POST', query)).body.execution.cached, required);
  }
});
test('dependency changes and legacy persisted pipelines cannot bypass mandatory materialization', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'blaze-policy-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const prepStorePath = join(directory, 'prep.json'), call = await api(t, true, { prepStorePath }), base = await prepare(call, 'base');
  for (const [id, input] of [['child', 'base'], ['grandchild', 'child']]) {
    assert.equal((await call(`/api/datasets/${id}/prep`, 'PUT', { name: id, pipeline: { version: 1, input: { dataset: input }, steps: [] } })).status, 201);
  }
  const pipeline = { ...base, steps: [{ id: 'aggregate', kind: 'aggregate', config: { groupBy: ['id'], measures: [{ column: 'amount', name: 'amount', aggregation: 'SUM' }] } }] };
  assert.equal((await call('/api/datasets/base/prep', 'PUT', { name: 'Base', pipeline })).status, 200);
  for (const id of ['base', 'child', 'grandchild']) {
    assert.equal((await call(`/api/datasets/${id}/execution`)).body.mode, 'BLAZE');
    assert.equal((await call(`/api/datasets/${id}/execution`, 'PUT', { mode: 'DIRECT_QUERY', intervalMinutes: null })).body.errorCode, 'BLAZE_MATERIALIZATION_REQUIRED');
    assert.equal((await call(`/api/datasets/${id}/refresh`, 'POST', {})).status, 200);
  }
  // Model a store written before #15. Startup must migrate metadata without source reads.
  const stored = JSON.parse(await readFile(prepStorePath, 'utf8'));
  for (const entry of stored.datasets) delete entry.execution;
  await writeFile(prepStorePath, JSON.stringify(stored));
  const restarted = await api(t, true, { prepStorePath });
  for (const id of ['base', 'child', 'grandchild']) {
    const status = (await restarted(`/api/datasets/${id}/execution`)).body;
    assert.equal(status.mode, 'BLAZE'); assert.equal(status.state, 'empty');
    assert.equal((await restarted(`/api/datasets/${id}/query`, 'POST', query)).body.errorCode, 'BLAZE_NOT_READY');
  }
  assert.ok(JSON.parse(await readFile(prepStorePath, 'utf8')).datasets.every(e => e.execution.mode === 'BLAZE'));
});
