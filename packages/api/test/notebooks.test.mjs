import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiServer, emptySecurityState, StubMailTransport } from '@opensight/api';
const root = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

async function api(t, options = {}, configure = () => {}) {
  const state = emptySecurityState();
  state.namespaces.push({ id: 'other', name: 'Other' });
  state.users = [
    { id: 'author', name: 'Author', namespaceId: 'default', role: 'author' },
    { id: 'other-author', name: 'Other author', namespaceId: 'default', role: 'author' },
    { id: 'reader', name: 'Reader', namespaceId: 'default', role: 'reader' },
    { id: 'admin', name: 'Admin', namespaceId: 'default', role: 'administrator' },
    { id: 'author', name: 'Author', namespaceId: 'other', role: 'author' },
  ];
  configure(state);
  const server = await createApiServer({ dataRoot: root, mailTransport: new StubMailTransport(), ...options, security: { initialState: state, authenticate: r => {
    const id = r.headers.authorization?.replace('Bearer ', '');
    return id === 'tenant-author' ? { namespaceId: 'other', userId: 'author' } : ['author', 'other-author', 'reader', 'admin'].includes(id) ? { namespaceId: 'default', userId: id } : undefined;
  } } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  return async (path, method = 'GET', body, user = 'author') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
}

const sql = (text = 'SELECT region, SUM(revenue) AS total FROM sales GROUP BY region ORDER BY region', datasetRefs = ['sales'], id = 'sql1') => ({ id, kind: 'sql', text, datasetRefs });
const visual = { id: 'chart', kind: 'visual', sourceCellId: 'sql1', chart: { type: 'bar', dimension: 'region', measure: 'total', aggregation: 'SUM' } };
async function create(call, extra = {}, user = 'author') {
  const response = await call('/api/notebooks', 'POST', { name: 'Notebook', cells: [sql(), visual], ...extra }, user);
  assert.equal(response.status, 201, JSON.stringify(response.body)); return response.body;
}
const path = n => `/api/notebooks/${n.id}`;
async function run(call, n, body = {}, user = 'author') {
  const response = await call(`${path(n)}/run`, 'POST', body, user);
  assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body;
}
test('notebooks: CRUD, author and manage permissions, namespace isolation and versions', async t => {
  const call = await api(t), n = await create(call);
  assert.equal(n.ownerId, 'author'); assert.equal(n.canEdit, true);
  assert.equal((await call('/api/notebooks')).body.notebooks.length, 1);
  assert.equal((await call('/api/notebooks', 'GET', undefined, 'reader')).body.notebooks.length, 0);
  assert.equal((await call('/api/notebooks', 'POST', { name: 'Reader' }, 'reader')).body.errorCode, 'NOTEBOOK_AUTHOR_REQUIRED');
  for (const user of ['reader', 'other-author', 'tenant-author']) assert.equal((await call(path(n), 'GET', undefined, user)).status, 404);
  const published = await call(path(n), 'PATCH', { published: true, version: n.version });
  assert.equal(published.status, 200); assert.equal(published.body.version, 2);
  assert.equal((await call(path(n), 'PATCH', { name: 'Stale', version: 1 })).body.errorCode, 'NOTEBOOK_VERSION_CONFLICT');
  for (const user of ['reader', 'other-author']) {
    assert.equal((await call(path(n), 'GET', undefined, user)).status, 200);
    assert.equal((await call(path(n), 'PATCH', { name: 'Hijack', version: 2 }, user)).body.errorCode, 'NOTEBOOK_EDIT_REQUIRED');
    assert.equal((await call(path(n), 'DELETE', undefined, user)).body.errorCode, 'NOTEBOOK_MANAGE_REQUIRED');
  }
  for (const suffix of ['', '/runs', '/run', '/cells/sql1/snapshot']) assert.equal((await call(path(n) + suffix, suffix === '/run' || suffix.endsWith('/snapshot') ? 'POST' : 'GET', suffix === '/run' || suffix.endsWith('/snapshot') ? {} : undefined, 'tenant-author')).status, 404);
  assert.equal((await call(path(n), 'PATCH', { name: 'Managed', version: 2 }, 'admin')).status, 200);
  assert.equal((await call(path(n), 'DELETE', undefined, 'admin')).status, 200);
  assert.equal((await call(path(n))).status, 404);
});
test('notebooks: model validation refuses invalid cells, limits, fields and defaults', async t => {
  const call = await api(t);
  for (const extra of [
    { name: '' }, { name: 'x'.repeat(121) }, { cells: Array.from({ length: 101 }, (_, i) => ({ id: `c${i}`, kind: 'markdown', text: '' })) },
    { cells: [{ id: 'm', kind: 'markdown', text: 'x'.repeat(10001) }] }, { cells: [sql(), sql()] }, { cells: [visual, sql()] },
    { cells: [{ id: 'p', kind: 'python', text: 'print(1)' }] }, { cells: [sql('SELECT 1', ['sales', 'SALES'])] },
    { parameters: [{ name: 'bad-name', type: 'string' }] }, { parameters: [{ name: 'x', type: 'number', default: '1' }] },
    { parameters: [{ name: 'x', type: 'date', default: '2026-02-30' }] }, { parameters: [{ name: 'x', type: 'string' }, { name: 'x', type: 'string' }] },
    { published: 'yes' }, { published: null }, { cells: null }, { parameters: null }, { ownerId: 'admin' },
  ]) {
    const result = await call('/api/notebooks', 'POST', { name: 'Bad', ...extra });
    assert.equal(result.status, 400, JSON.stringify(extra)); assert.match(result.body.errorCode, /^NOTEBOOK_/);
  }
});
test('notebooks: fixture execution, typed bindings, injection stays data, results and executing identity', async t => {
  const call = await api(t), n = await create(call, { published: true, parameters: [{ name: 'minimum', type: 'number', default: 0 }, { name: 'region', type: 'string', default: 'East' }, { name: 'day', type: 'date', default: '2026-01-01' }], cells: [sql('SELECT region, SUM(revenue) AS total FROM sales WHERE revenue > $minimum AND region = $region GROUP BY region'), visual] });
  const r = await run(call, n, {}, 'reader');
  assert.equal(r.executedBy, 'reader'); assert.equal(r.notebookVersion, 1);
  assert.ok(r.results[0].data.rowCount > 0, JSON.stringify(r));
  assert.equal(r.results[0].data.rows[0].region, 'East');
  assert.equal(r.results[1].sourceCellId, 'sql1'); assert.equal(r.results[1].error, undefined);
  assert.ok(Number.isFinite(Date.parse(r.results[0].executedAt))); assert.ok(r.results[0].elapsedMs >= 0);
  assert.deepEqual((await run(call, n, { parameters: { region: "East' OR true --" } })).results[0].data.rows, []);
  for (const parameters of [null, { unknown: 1 }, { minimum: '2' }, { day: '2026-02-30' }, { minimum: [2] }]) {
    const result = await call(`${path(n)}/run`, 'POST', { parameters }); assert.equal(result.status, 400); assert.match(result.body.errorCode, /^NOTEBOOK_/);
  }
  const missing = await create(call, { parameters: [{ name: 'missing', type: 'string' }] });
  assert.equal((await call(`${path(missing)}/run`, 'POST', {})).body.errorCode, 'NOTEBOOK_PARAMETER_INVALID');
  assert.equal((await call(`${path(n)}/run`, 'POST', { cellId: 'missing' })).status, 404);
  const single = await run(call, n, { cellId: 'sql1' }); assert.equal(single.results.length, 1);
  assert.equal((await run(call, n, { cellId: 'chart' })).results[0].error.code, 'NOTEBOOK_DEPENDENCY_FAILED');
  const history = (await call(`${path(n)}/runs`, 'GET', undefined, 'reader')).body.runs;
  assert.ok(history.some(r => r.executedBy === 'reader' && r.results?.[0].data));
  assert.ok(history.filter(r => r.executedBy !== 'reader').every(r => r.resultsRedacted && !r.results));
});
test('notebooks: every declared dataset is checked before SQL and dependent visuals fail visibly', async t => {
  const call = await api(t);
  const upload = await call('/api/uploads', 'POST', { config: { format: 'csv' }, base64: Buffer.from('region,amount\nEast,2\nWest,3\n').toString('base64') });
  assert.equal(upload.status, 201);
  const ref = upload.body.id, n = await create(call, { published: true, cells: [sql(`SELECT region, amount AS total FROM "${ref}"`, [ref, 'sales']), visual] });
  assert.equal((await run(call, n)).results[0].data.rowCount, 2);
  const denied = await run(call, n, {}, 'reader');
  assert.equal(denied.results[0].error.code, 'NOTEBOOK_DATASET_ACCESS_DENIED'); assert.equal(denied.results[0].data, undefined);
  assert.equal(denied.results[1].error.code, 'NOTEBOOK_DEPENDENCY_FAILED');
  assert.ok(!(await call('/api/notebooks/datasets', 'GET', undefined, 'reader')).body.datasets.some(d => d.id === ref));
});
test('notebooks: shared fixture RLS and CLS narrow the actual materialized tables', async t => {
  const call = await api(t, {}, state => {
    state.datasets = [{ datasetId: 'sales', namespaceId: 'default', dataSetArn: 'arn:aws:quicksight:us-east-1:123456789012:dataset/renderable-sales', rowLevel: true,
      rowRules: [{ id: 'east', principals: [{ type: 'user', id: 'reader' }], predicate: { column: 'region', operator: 'eq', value: 'East' } }, { id: 'all', principals: [{ type: 'user', id: 'author' }], predicate: { column: 'revenue', operator: 'gte', value: 0 } }],
      protectedColumns: ['profit'], columnGrants: [{ id: 'profit-owner', column: 'profit', effect: 'allow', principals: [{ type: 'user', id: 'author' }] }] }];
  });
  const n = await create(call, { published: true, cells: [sql('SELECT * FROM sales')] });
  const reader = (await run(call, n, {}, 'reader')).results[0];
  assert.ok(reader.data.rowCount > 0); assert.ok(reader.data.rows.every(r => r.region === 'East'));
  assert.ok(!reader.data.columns.some(c => c.name === 'profit'));
  assert.ok((await run(call, n)).results[0].data.columns.some(c => c.name === 'profit'));
  assert.equal((await run(call, n, {}, 'other-author')).results[0].error.code, 'NOTEBOOK_DATASET_ACCESS_DENIED');
  const cls = await create(call, { published: true, cells: [sql('SELECT profit FROM sales')] });
  const denied = (await run(call, cls, {}, 'reader')).results[0]; assert.equal(denied.data, undefined); assert.equal(denied.error.code, 'NOTEBOOK_SQL_EXECUTION_FAILED');
});
for (const [text, code] of [
  ['SELECT 1; SELECT 2', 'NOTEBOOK_SQL_SINGLE_STATEMENT_REQUIRED'], ['INSERT INTO sales VALUES(1)', 'NOTEBOOK_SQL_READ_ONLY_REQUIRED'],
  ['UPDATE sales SET revenue=0', 'NOTEBOOK_SQL_READ_ONLY_REQUIRED'], ['DELETE FROM sales', 'NOTEBOOK_SQL_READ_ONLY_REQUIRED'],
  ['CREATE TABLE x(i INTEGER)', 'NOTEBOOK_SQL_READ_ONLY_REQUIRED'], ['PRAGMA version', 'NOTEBOOK_SQL_READ_ONLY_REQUIRED'],
  ["ATTACH '/tmp/x' AS x", 'NOTEBOOK_SQL_READ_ONLY_REQUIRED'], ['SELECT * FROM missing', 'NOTEBOOK_SQL_UNDECLARED_TABLE'],
  ['SELECT $undeclared', 'NOTEBOOK_SQL_PARAMETER_UNDECLARED'],
]) test(`notebooks API SQL safety: ${text}`, async t => {
  const call = await api(t), n = await create(call, { cells: [sql(text, [])] });
  const result = (await run(call, n)).results[0]; assert.equal(result.error.code, code); assert.equal(result.data, undefined);
});
test('notebooks: row cap, snapshots as-of, source lineage and cross-notebook reuse', async t => {
  const original = process.env.OPENSIGHT_BLAZE_MAX_ROWS; process.env.OPENSIGHT_BLAZE_MAX_ROWS = '2';
  t.after(() => { if (original === undefined) delete process.env.OPENSIGHT_BLAZE_MAX_ROWS; else process.env.OPENSIGHT_BLAZE_MAX_ROWS = original; });
  const call = await api(t);
  const input = await call('/api/input-tables', 'POST', { name: 'Numbers', columns: [{ name: 'amount', type: 'number', required: true }] });
  for (const amount of [1, 2]) await call(`/api/input-tables/${input.body.id}/rows`, 'POST', { values: { amount } });
  const ref = `input-table-${input.body.id}`;
  const n = await create(call, { published: true, cells: [sql(`SELECT a.amount FROM "${ref}" a CROSS JOIN "${ref}" b`, [ref])] });
  assert.equal((await call(`${path(n)}/cells/sql1/snapshot`, 'POST', {})).body.errorCode, 'NOTEBOOK_RESULT_REQUIRED');
  const r = await run(call, n); assert.equal(r.results[0].data.rowCount, 2); assert.equal(r.results[0].data.truncated, true);
  const saved = await call(`${path(n)}/cells/sql1/snapshot`, 'POST', {}); assert.equal(saved.status, 201, JSON.stringify(saved.body));
  assert.equal(saved.body.asOf, r.results[0].executedAt); assert.equal(saved.body.truncated, true);
  assert.equal((await call(`${path(n)}/cells/sql1/snapshot`, 'POST', {}, 'other-author')).body.errorCode, 'NOTEBOOK_RESULT_REQUIRED');
  const n2 = await create(call, { cells: [sql(`SELECT * FROM "${saved.body.id}"`, [saved.body.id])] });
  assert.deepEqual((await run(call, n2)).results[0].data.rows, r.results[0].data.rows);
  assert.equal((await call(path(n))).body.snapshots[0].asOf, saved.body.asOf);
  assert.equal((await call(path(n), 'GET', undefined, 'reader')).body.snapshots.length, 0);
  await call(`/api/input-tables/${input.body.id}`, 'DELETE');
  assert.equal((await run(call, n2)).results[0].error.code, 'NOTEBOOK_DATASET_ACCESS_DENIED');
  assert.ok((await call(`${path(n)}/runs`)).body.runs[0].resultsRedacted);
});
test('notebooks: retention, persistence, delete cascades, corrupt JSON and state fail closed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'opensight-notebooks-')), storePath = join(dir, 'notebooks.json');
  const call = await api(t, { notebookStorePath: storePath }), n = await create(call, { cells: [sql('SELECT 1 AS value', [])] });
  for (let i = 0; i < 21; i++) await run(call, n);
  const history = (await call(`${path(n)}/runs`)).body.runs; assert.equal(history.length, 20); assert.equal(history[0].executedBy, 'author');
  await call(`${path(n)}/cells/sql1/snapshot`, 'POST', {});
  const reloaded = await api(t, { notebookStorePath: storePath });
  assert.equal((await reloaded(path(n))).body.snapshots.length, 1);
  assert.equal((await reloaded(`${path(n)}/runs`)).body.runs.length, 20);
  await reloaded(path(n), 'DELETE');
  const third = await api(t, { notebookStorePath: storePath }); assert.equal((await third(`${path(n)}/runs`)).status, 404);
  for (const content of ['{', JSON.stringify({ version: 1, notebooks: [{ id: 'broken' }], runs: [], snapshots: [] }), JSON.stringify({ version: 1, notebooks: [], runs: [], snapshots: [], injected: true })]) {
    await writeFile(storePath, content); await assert.rejects(() => api(t, { notebookStorePath: storePath }), /NOTEBOOK_STORE_CORRUPT/);
  }
});

test('notebooks: saved results and snapshots cannot replay an earlier security policy', async t => {
  const call = await api(t), n = await create(call, { published: true, cells: [sql('SELECT * FROM sales')] });
  await run(call, n);
  const saved = await call(`${path(n)}/cells/sql1/snapshot`, 'POST', {}); assert.equal(saved.status, 201);
  const policy = await call('/api/datasets/sales/row-rules/east', 'PUT', { principals: [{ type: 'user', id: 'author' }], predicate: { column: 'region', operator: 'eq', value: 'East' } }, 'admin');
  assert.equal(policy.status, 200);
  assert.equal((await call(path(n))).body.snapshots.length, 0);
  assert.equal((await call(`${path(n)}/runs`)).body.runs[0].resultsRedacted, true);
  assert.equal((await call(`${path(n)}/cells/sql1/snapshot`, 'POST', {})).body.errorCode, 'NOTEBOOK_DATASET_ACCESS_DENIED');
  const next = await run(call, n); assert.ok(next.results[0].data.rows.every(r => r.region === 'East'));
  assert.equal((await call(`${path(n)}/cells/sql1/snapshot`, 'POST', {}, 'reader')).body.errorCode, 'NOTEBOOK_AUTHOR_REQUIRED');
});
test('notebooks: load rejects missing required content and corrupted result state', async () => {
  const { validateNotebookState } = await import('../dist/notebooks.js');
  const n = { id: 'n', namespaceId: 'default', ownerId: 'author', name: 'n', published: false, parameters: [], cells: [sql()], version: 1, createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z' };
  for (const key of ['published', 'cells', 'parameters']) {
    const partial = { ...n }; delete partial[key];
    assert.throws(() => validateNotebookState({ version: 1, notebooks: [partial], runs: [], snapshots: [] }), /NOTEBOOK_STORE_CORRUPT/);
  }
  const result = { cellId: 'sql1', kind: 'sql', executedAt: n.createdAt, elapsedMs: 1, datasetRefs: ['sales'], data: { columns: [{ name: 'x', type: 'INTEGER' }], rows: [{ x: 1 }], rowCount: 1, truncated: false } };
  const state = { version: 1, notebooks: [n], snapshots: [], runs: [{ id: 'r', namespaceId: 'default', notebookId: 'n', notebookVersion: 1, executedBy: 'author', executedAt: n.createdAt, accessStamp: 'stamp', results: [result] }] };
  assert.equal(validateNotebookState(state).runs.length, 1);
  for (const change of [r => { r.kind = 'markdown'; }, r => { r.data.rowCount = 2; }, r => { r.data.rows[0].x = {}; }, r => { r.error = { code: 'NOTEBOOK_ERROR', message: 'failed' }; }]) {
    const copy = structuredClone(state); change(copy.runs[0].results[0]); assert.throws(() => validateNotebookState(copy), /NOTEBOOK_STORE_CORRUPT/);
  }
});

// #230: aggregate byte budgets. Each test measures one real result's JSON
// bytes under the default budgets, then sets budgets relative to that size so
// every cell result is individually valid and only the aggregate can bind.
const NOTEBOOK_BYTE_ENV = ['OPENSIGHT_NOTEBOOK_RUN_BYTES', 'OPENSIGHT_NOTEBOOK_NOTEBOOK_BYTES', 'OPENSIGHT_NOTEBOOK_STORE_BYTES'];
function byteEnv(t, values) {
  const saved = Object.fromEntries(NOTEBOOK_BYTE_ENV.map(k => [k, process.env[k]]));
  t.after(() => { for (const k of NOTEBOOK_BYTE_ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
  for (const k of NOTEBOOK_BYTE_ENV) delete process.env[k];
  Object.assign(process.env, values);
}
async function resultBytes(t, options = {}) {
  const call = await api(t, options), n = await create(call, { cells: [sql()] });
  const r = await run(call, n);
  return Buffer.byteLength(JSON.stringify(r.results[0].data));
}
test('notebooks: a run drops results past its aggregate byte budget and dependent visuals fail', async t => {
  const bytes = await resultBytes(t);
  byteEnv(t, { OPENSIGHT_NOTEBOOK_RUN_BYTES: String(bytes + Math.floor(bytes / 2)) });
  const call = await api(t);
  const n = await create(call, { cells: [sql(), sql(undefined, undefined, 'sql2'), { ...visual, sourceCellId: 'sql2' }] });
  const r = await run(call, n);
  assert.ok(r.results[0].data, JSON.stringify(r.results));
  assert.equal(r.results[1].data, undefined); assert.equal(r.results[1].error.code, 'NOTEBOOK_RESULT_BUDGET_EXCEEDED');
  assert.equal(r.results[2].error.code, 'NOTEBOOK_DEPENDENCY_FAILED');
  const history = (await call(`${path(n)}/runs`)).body.runs;
  assert.equal(history[0].results[1].error.code, 'NOTEBOOK_RESULT_BUDGET_EXCEEDED');
});
test('notebooks: byte eviction retains fewer runs than the count cap when the notebook budget binds', async t => {
  const bytes = await resultBytes(t);
  byteEnv(t, { OPENSIGHT_NOTEBOOK_RUN_BYTES: String(bytes + Math.floor(bytes / 2)), OPENSIGHT_NOTEBOOK_NOTEBOOK_BYTES: String(2 * bytes + Math.floor(bytes / 2)) });
  const dir = await mkdtemp(join(tmpdir(), 'opensight-notebook-bytes-')), storePath = join(dir, 'notebooks.json');
  const call = await api(t, { notebookStorePath: storePath }), n = await create(call, { cells: [sql()] });
  for (let i = 0; i < 5; i++) await run(call, n);
  const history = (await call(`${path(n)}/runs`)).body.runs;
  assert.equal(history.length, 2, JSON.stringify(history.map(r => r.id)));
  const retained = history.reduce((total, r) => total + r.results.reduce((sum, c) => sum + (c.data ? Buffer.byteLength(JSON.stringify(c.data)) : 0), 0), 0);
  assert.ok(retained <= 2 * bytes + Math.floor(bytes / 2));
  const reloaded = await api(t, { notebookStorePath: storePath });
  assert.equal((await reloaded(`${path(n)}/runs`)).body.runs.length, 2);
});
test('notebooks: a snapshot that would exceed the notebook byte budget is refused, never evicted silently', async t => {
  const bytes = await resultBytes(t);
  byteEnv(t, { OPENSIGHT_NOTEBOOK_RUN_BYTES: String(bytes + Math.floor(bytes / 2)), OPENSIGHT_NOTEBOOK_NOTEBOOK_BYTES: String(2 * bytes + Math.floor(bytes / 2)) });
  const call = await api(t), n = await create(call, { cells: [sql()] });
  await run(call, n);
  assert.equal((await call(`${path(n)}/cells/sql1/snapshot`, 'POST', {})).status, 201);
  const second = await call(`${path(n)}/cells/sql1/snapshot`, 'POST', {});
  assert.equal(second.status, 409); assert.equal(second.body.errorCode, 'NOTEBOOK_SNAPSHOT_LIMIT_EXCEEDED');
  assert.equal((await call(path(n))).body.snapshots.length, 1);
});
test('notebooks: state validation enforces run, notebook and store aggregate byte budgets', async () => {
  const { validateNotebookState } = await import('../dist/notebooks.js');
  const cell = (cellId, x) => ({ cellId, kind: 'sql', executedAt: '2026-11-04T00:00:00Z', elapsedMs: 1, datasetRefs: ['sales'], data: { columns: [{ name: 'x', type: 'INTEGER' }], rows: [{ x }], rowCount: 1, truncated: false } });
  const one = Buffer.byteLength(JSON.stringify(cell('sql1', 1).data));
  const nb = id => ({ id, namespaceId: 'default', ownerId: 'author', name: id, published: false, parameters: [], cells: [sql()], version: 1, createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z' });
  const runState = (id, notebookId, results) => ({ id, namespaceId: 'default', notebookId, notebookVersion: 1, executedBy: 'author', executedAt: '2026-11-04T00:00:00Z', accessStamp: 'stamp', results });
  const generous = { runBytes: 100 * one, notebookBytes: 100 * one, storeBytes: 100 * one };
  const twoCells = { version: 1, notebooks: [nb('n')], snapshots: [], runs: [runState('r', 'n', [cell('sql1', 1), cell('sql2', 2)])] };
  assert.equal(validateNotebookState(twoCells, generous).runs.length, 1);
  assert.throws(() => validateNotebookState(twoCells, { ...generous, runBytes: one + Math.floor(one / 2) }), /NOTEBOOK_STORE_CORRUPT/);
  assert.throws(() => validateNotebookState(twoCells, { ...generous, notebookBytes: one + Math.floor(one / 2) }), /NOTEBOOK_STORE_CORRUPT/);
  const twoNotebooks = { version: 1, notebooks: [nb('a'), nb('b')], snapshots: [], runs: [runState('r1', 'a', [cell('sql1', 1)]), runState('r2', 'b', [cell('sql1', 2)])] };
  assert.equal(validateNotebookState(twoNotebooks, generous).runs.length, 2);
  assert.throws(() => validateNotebookState(twoNotebooks, { ...generous, storeBytes: one + Math.floor(one / 2) }), /NOTEBOOK_STORE_CORRUPT/);
});
