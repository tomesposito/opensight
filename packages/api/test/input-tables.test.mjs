import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiServer, emptySecurityState, StubMailTransport } from '@opensight/api';
import { appendAudit, InputTableStore, MAX_INPUT_AUDIT_ENTRIES_PER_TABLE, MAX_INPUT_AUDIT_ENTRIES_TOTAL } from '../dist/input-tables.js';
import { AutomationStore } from '../dist/automation-store.js';
const root = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

async function api(t, options = {}) {
  const state = emptySecurityState();
  state.namespaces.push({ id: 'other', name: 'Other' });
  state.users = [
    { id: 'author', name: 'Author', namespaceId: 'default', role: 'author' },
    { id: 'other-author', name: 'Other author', namespaceId: 'default', role: 'author' },
    { id: 'reader', name: 'Reader', namespaceId: 'default', role: 'reader' },
    { id: 'admin', name: 'Admin', namespaceId: 'default', role: 'administrator' },
    { id: 'author', name: 'Author', namespaceId: 'other', role: 'author' },
  ];
  const server = await createApiServer({ dataRoot: root, mailTransport: new StubMailTransport(), ...options, security: { initialState: state, authenticate: r => {
    const id = r.headers.authorization?.replace('Bearer ', '');
    return id === 'tenant-author' ? { namespaceId: 'other', userId: 'author' } : ['author', 'other-author', 'reader', 'admin'].includes(id) ? { namespaceId: 'default', userId: id } : undefined;
  } } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  const call = async (path, method = 'GET', body, user = 'author') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  call.port = server.address().port;
  return call;
}

/** Start a JSON request, send only the first half of its body, and return a finisher.
 *  The caller can revoke a grant while the handler is parked in readBody, then
 *  complete the body: the mutation must be re-authorized when it commits (#218). */
function startDelayedBody(port, path, method, user, payload) {
  const bytes = JSON.stringify(payload);
  const split = Math.max(1, Math.floor(bytes.length / 2));
  let req;
  const done = new Promise((resolve, reject) => {
    req = httpRequest({ host: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user}`, 'Content-Length': Buffer.byteLength(bytes) } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on('error', reject);
    req.write(bytes.slice(0, split));
  });
  return { finish: async () => { req.end(bytes.slice(split)); return done; } };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 200));

const columns = [
  { name: 'region', type: 'text', required: true },
  { name: 'forecast', type: 'number', required: true },
  { name: 'starts_on', type: 'date', required: false },
  { name: 'active', type: 'boolean', required: false },
];
async function createTable(call, extra = {}) {
  const created = await call('/api/input-tables', 'POST', { name: 'Regional forecast', columns, ...extra });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body;
}

test('input tables (#220): append retains the newest 1000 entries per table without pruning other tables', async () => {
  assert.equal(MAX_INPUT_AUDIT_ENTRIES_PER_TABLE, 1000);
  const store = await InputTableStore.load();
  const table = { id: 'forecast', namespaceId: 'default' };
  const last = await store.change(draft => {
    for (let i = 0; i < 1007; i++) {
      if (i % 100 === 0) appendAudit(draft, { ...table, id: 'other' }, 'author', 'table_renamed', { sequence: i });
      appendAudit(draft, table, 'author', 'row_deleted', { row: { id: `row-${i}`, values: { forecast: i } } });
    }
    return draft.audit.at(-1);
  });
  const audit = store.read().audit;
  const entries = audit.filter(e => e.tableId === table.id);
  assert.equal(entries.length, 1000);
  assert.deepEqual(entries.map(e => e.detail.row.values.forecast), Array.from({ length: 1000 }, (_, i) => i + 7));
  assert.deepEqual(entries.at(-1), last);
  assert.equal(entries.at(-1).detail.row.id, 'row-1006');
  assert.deepEqual(audit.filter(e => e.tableId === 'other').map(e => e.detail.sequence), Array.from({ length: 11 }, (_, i) => i * 100));
});

test('input tables (#220): append retains the newest 10000 entries overall across tables and namespaces', async () => {
  assert.equal(MAX_INPUT_AUDIT_ENTRIES_TOTAL, 10000);
  const store = await InputTableStore.load();
  const last = await store.change(draft => {
    for (let i = 0; i < 10037; i++) {
      const table = { id: `table-${i % 11}`, namespaceId: i % 11 < 5 ? 'default' : 'other' };
      appendAudit(draft, table, 'author', 'table_renamed', { sequence: i });
    }
    return draft.audit.at(-1);
  });
  const entries = store.read().audit;
  assert.equal(entries.length, 10000);
  assert.deepEqual(entries.map(e => e.detail.sequence), Array.from({ length: 10000 }, (_, i) => i + 37));
  assert.deepEqual(entries.at(-1), last);
  for (let i = 0; i < 11; i++) assert.ok(entries.filter(e => e.tableId === `table-${i}`).length <= 1000);
});

test('input tables (#220): legacy audit above both caps loads intact and is pruned on append', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'opensight-input-audit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'input-tables.json');
  const table = { id: 'deleted-table', namespaceId: 'default' };
  const audit = Array.from({ length: 10005 }, (_, i) => ({
    id: `audit-${i}`, tableId: table.id, namespaceId: table.namespaceId, actorId: 'author',
    action: 'row_deleted', at: '2026-11-01T00:00:00.000Z', detail: { row: { id: `row-${i}`, values: { forecast: i } } },
  }));
  await writeFile(path, JSON.stringify({ version: 1, tables: [], audit }));
  const store = await InputTableStore.load(path);
  assert.deepEqual(store.read().audit, audit);
  await store.change(draft => appendAudit(draft, table, 'author', 'table_deleted', { name: 'Forecast' }));
  const retained = store.read().audit;
  assert.equal(retained.length, 1000);
  assert.deepEqual(retained.slice(0, -1), audit.slice(-999));
  assert.equal(retained.at(-1).action, 'table_deleted');
  assert.deepEqual((await InputTableStore.load(path)).read().audit, retained);
});

test('input tables (#220): audit pagination preserves the default response and slices oldest first', async t => {
  const call = await api(t);
  const table = await createTable(call);
  const path = `/api/input-tables/${table.id}`;
  for (let i = 0; i < 4; i++) assert.equal((await call(`${path}/rows`, 'POST', { values: { region: 'East', forecast: i } })).status, 201);
  // Unrelated entries must not affect this table's total or its pages.
  await createTable(call);
  const all = await call(`${path}/audit`);
  assert.equal(all.status, 200);
  assert.deepEqual(Object.keys(all.body), ['entries']);
  assert.equal(all.body.entries.length, 5);
  assert.deepEqual(all.body.entries.map(e => e.action), ['table_created', 'row_added', 'row_added', 'row_added', 'row_added']);
  assert.deepEqual(all.body.entries.slice(1).map(e => e.detail.row.values.forecast), [0, 1, 2, 3]);
  for (const [query, limit, offset] of [
    ['limit=2', 2, 0], ['limit=2&offset=2', 2, 2], ['offset=2', 1000, 2],
    ['limit=1&offset=0', 1, 0], ['limit=1000', 1000, 0], ['limit=2&offset=5', 2, 5],
    ['offset=9007199254740991', 1000, Number.MAX_SAFE_INTEGER],
  ]) {
    assert.deepEqual(await call(`${path}/audit?${query}`), {
      status: 200, body: { entries: all.body.entries.slice(offset, offset + limit), total: 5, limit, offset },
    });
  }
  assert.deepEqual(await call(`${path}/audit`), all);
});

test('input tables (#220): invalid pagination fails with a named error and other query strings remain rejected', async t => {
  const call = await api(t);
  const table = await createTable(call);
  const path = `/api/input-tables/${table.id}`;
  const before = await call(`${path}/audit`);
  for (const query of [
    'limit=0', 'limit=-1', 'limit=1001', 'limit=1.5', 'limit=', 'limit=abc', 'limit=Infinity',
    'limit=1e2', 'limit=0x10', 'limit=%20', 'limit=%2B2', 'limit=2&limit=3',
    'offset=-1', 'offset=1.5', 'offset=', 'offset=abc', 'offset=Infinity',
    'offset=9007199254740992', 'offset=0&offset=1',
  ]) {
    const rejected = await call(`${path}/audit?${query}`);
    assert.equal(rejected.status, 400, query);
    assert.equal(rejected.body.errorCode, 'INPUT_TABLE_AUDIT_PAGINATION_INVALID', query);
  }
  for (const [route, method] of [
    ['/api/input-tables', 'GET'], ['/api/input-tables', 'POST'], [path, 'GET'], [path, 'PATCH'], [path, 'DELETE'],
    [`${path}/rows`, 'POST'], [`${path}/rows/missing`, 'PATCH'], [`${path}/rows/missing`, 'DELETE'],
    [`${path}/editors`, 'PUT'], [`${path}/audit`, 'POST'],
  ]) assert.deepEqual(await call(`${route}?limit=2`, method), { status: 400, body: { Message: 'Query parameters are not supported' } });
  assert.deepEqual(await call(`${path}/audit?unknown=1`), { status: 400, body: { Message: 'Query parameters are not supported' } });
  assert.deepEqual(await call(`${path}/audit`), before);
});

test('input tables (#220): paginated audit remains namespace-scoped before and after deletion', async t => {
  const call = await api(t);
  const table = await createTable(call);
  const path = `/api/input-tables/${table.id}`;
  const foreign = { status: 404, body: { errorCode: 'INPUT_TABLE_NOT_FOUND', Message: 'Input table not found' } };
  for (const deleted of [false, true]) {
    if (deleted) assert.equal((await call(path, 'DELETE')).status, 200);
    const all = await call(`${path}/audit`);
    assert.equal(all.status, 200);
    for (const offset of [0, 100]) {
      assert.deepEqual(await call(`${path}/audit?limit=1&offset=${offset}`, 'GET', undefined, 'reader'), {
        status: 200, body: { entries: all.body.entries.slice(offset, offset + 1), total: all.body.entries.length, limit: 1, offset },
      });
      assert.deepEqual(await call(`${path}/audit?limit=1&offset=${offset}`, 'GET', undefined, 'tenant-author'), foreign);
    }
  }
  assert.deepEqual(await call('/api/input-tables/missing/audit?limit=2'), foreign);
});

test('input tables (#220): projections clone only their result and isolate nested values', async () => {
  // An uncloneable unrelated value proves project never clones the full state.
  const store = await AutomationStore.load({ selected: { values: [1, 2] }, unrelated: () => {} });
  const selected = store.project(state => state.selected);
  selected.values[0] = 99;
  selected.values.push(3);
  assert.deepEqual(store.project(state => state.selected), { values: [1, 2] });
  assert.equal(store.project(state => state.selected.values.length), 2);
  assert.equal(store.project(() => undefined), undefined);
});

test('input tables (#220): tableById and auditFor return isolated slices including nested rows', async () => {
  const store = await InputTableStore.load();
  await store.change(draft => {
    for (const id of ['forecast', 'other']) {
      const table = {
        id, namespaceId: 'default', ownerId: 'author', name: id, boundDatasetId: null,
        columns: structuredClone(columns), rows: [{ id: 'row-1', values: { region: 'East', forecast: 10, starts_on: null, active: null } }],
        editors: ['other-author'], version: 1, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
      };
      draft.tables.push(table);
      appendAudit(draft, table, 'author', 'row_added', { row: structuredClone(table.rows[0]) });
    }
  });
  const before = store.read();
  const table = store.tableById('forecast');
  const audit = store.auditFor('forecast');
  assert.deepEqual(table, before.tables[0]);
  assert.deepEqual(audit, [before.audit[0]]);
  table.name = 'Changed'; table.columns[0].name = 'changed'; table.editors.push('reader');
  table.rows[0].values.forecast = 99; table.rows.pop();
  audit[0].actorId = 'reader'; audit[0].detail.row.values.forecast = 99; audit.pop();
  assert.deepEqual(store.read(), before);
  assert.deepEqual(store.tableById('forecast'), before.tables[0]);
  assert.deepEqual(store.auditFor('forecast'), [before.audit[0]]);
  assert.equal(store.tableById('missing'), undefined);
  const missing = store.auditFor('missing');
  assert.deepEqual(missing, []);
  missing.push(before.audit[0]);
  assert.deepEqual(store.auditFor('missing'), []);
});

test('input tables (#220): single-table and audit routes never read the whole store', async t => {
  const call = await api(t);
  const table = await createTable(call);
  const path = `/api/input-tables/${table.id}`;
  assert.equal((await call(`${path}/rows`, 'POST', { values: { region: 'East', forecast: 10 } })).status, 201);
  const before = await call(path);
  const audit = await call(`${path}/audit`);
  t.mock.method(InputTableStore.prototype, 'read', () => { throw new Error('Unexpected full input-table store read'); });
  assert.deepEqual(await call(path), before);
  assert.deepEqual(await call(`${path}/audit`), audit);
  assert.deepEqual(await call(`${path}/audit?limit=1`), {
    status: 200, body: { entries: audit.body.entries.slice(0, 1), total: 2, limit: 1, offset: 0 },
  });
  assert.equal((await call(path, 'GET', undefined, 'tenant-author')).status, 404);
  assert.equal((await call(`${path}/audit?limit=1`, 'GET', undefined, 'tenant-author')).status, 404);
  assert.equal((await call(path, 'DELETE')).status, 200);
  assert.equal((await call(path)).status, 404);
  const retained = await call(`${path}/audit?limit=1&offset=2`);
  assert.equal(retained.status, 200);
  assert.equal(retained.body.entries[0].action, 'table_deleted');
});

test('input tables: create validates the schema and lists summaries', async t => {
  const call = await api(t);
  const table = await createTable(call);
  assert.equal(table.ownerId, 'author'); assert.equal(table.rowCount, undefined);
  assert.deepEqual(table.columns, columns); assert.equal(table.canEdit, true); assert.equal(table.canManage, true);
  const list = await call('/api/input-tables');
  assert.equal(list.status, 200); assert.equal(list.body.tables.length, 1);
  assert.equal(list.body.tables[0].rowCount, 0); assert.equal(list.body.tables[0].columnCount, 4);
  for (const [body, code] of [
    [{ name: 'x', columns: [{ name: 'a', type: 'json', required: true }] }, 'INPUT_TABLE_INVALID_COLUMN_TYPE'],
    [{ name: 'x', columns: [{ name: 'a', type: 'text', required: true }, { name: 'A', type: 'text', required: false }] }, 'INPUT_TABLE_DUPLICATE_COLUMN'],
    [{ name: 'x', columns: [{ name: '1bad', type: 'text', required: true }] }, 'INPUT_TABLE_INVALID_COLUMN_NAME'],
    [{ name: 'x', columns: [] }, 'INPUT_TABLE_COLUMN_LIMIT_EXCEEDED'],
    [{ name: '', columns }, 'INPUT_TABLE_INVALID_NAME'],
  ]) {
    const rejected = await call('/api/input-tables', 'POST', body);
    assert.equal(rejected.status, 400, JSON.stringify(rejected.body)); assert.equal(rejected.body.errorCode, code);
  }
  // Readers never create (editing is an author-class act).
  assert.equal((await call('/api/input-tables', 'POST', { name: 'x', columns }, 'reader')).status, 403);
});

test('input tables: row CRUD enforces typed validation on add and merged patch', async t => {
  const call = await api(t);
  const table = await createTable(call);
  const rows = `/api/input-tables/${table.id}/rows`;
  const added = await call(rows, 'POST', { values: { region: 'East', forecast: 10, starts_on: '2026-11-01', active: true } });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  const rowId = added.body.row.id;
  for (const [values, code] of [
    [{ region: 'West', forecast: '20' }, 'INPUT_TABLE_INVALID_NUMBER'],
    [{ region: 'West', forecast: 20, starts_on: '2026-02-30' }, 'INPUT_TABLE_INVALID_DATE'],
    [{ region: 'West', forecast: 20, starts_on: '11/01/2026' }, 'INPUT_TABLE_INVALID_DATE'],
    [{ region: 'West' }, 'INPUT_TABLE_REQUIRED_VALUE_MISSING'],
    [{ region: 'West', forecast: 20, bogus: 1 }, 'INPUT_TABLE_UNKNOWN_COLUMN'],
    [{ region: 'West', forecast: 20, active: 'yes' }, 'INPUT_TABLE_INVALID_VALUE_TYPE'],
    [{ region: 'West', forecast: null }, 'INPUT_TABLE_REQUIRED_VALUE_MISSING'],
  ]) {
    const rejected = await call(rows, 'POST', { values });
    assert.equal(rejected.status, 400, JSON.stringify(rejected.body)); assert.equal(rejected.body.errorCode, code);
  }
  const patched = await call(`${rows}/${rowId}`, 'PATCH', { values: { forecast: 12 } });
  assert.equal(patched.status, 200, JSON.stringify(patched.body)); assert.equal(patched.body.row.values.forecast, 12);
  // Merged-row validation retains precise named errors inside the mutation.
  for (const [values, code] of [
    [{ region: null }, 'INPUT_TABLE_REQUIRED_VALUE_MISSING'],
    [{ forecast: '20' }, 'INPUT_TABLE_INVALID_NUMBER'],
    [{ starts_on: '2026-02-30' }, 'INPUT_TABLE_INVALID_DATE'],
    [{ active: 'yes' }, 'INPUT_TABLE_INVALID_VALUE_TYPE'],
    [{ bogus: 1 }, 'INPUT_TABLE_UNKNOWN_COLUMN'],
  ]) {
    const rejected = await call(`${rows}/${rowId}`, 'PATCH', { values });
    assert.equal(rejected.status, 400); assert.equal(rejected.body.errorCode, code);
  }
  assert.equal((await call(`/api/input-tables/${table.id}`)).body.version, patched.body.version);
  assert.equal((await call(`/api/input-tables/${table.id}/audit`)).body.entries.filter(e => e.action === 'row_updated').length, 1);
  // Last write wins: a second patch overwrites the first.
  await call(`${rows}/${rowId}`, 'PATCH', { values: { forecast: 15 } });
  const after = await call(`/api/input-tables/${table.id}`);
  assert.equal(after.body.rows[0].values.forecast, 15);
  const deleted = await call(`${rows}/${rowId}`, 'DELETE');
  assert.equal(deleted.status, 200);
  assert.equal((await call(`/api/input-tables/${table.id}`)).body.rows.length, 0);
});

test('input tables (#219): concurrent patches to different cells preserve both writes and their audit changes', async t => {
  const call = await api(t);
  const table = await createTable(call, { editors: ['other-author'] });
  const path = `/api/input-tables/${table.id}`;
  const added = await call(`${path}/rows`, 'POST', { values: { region: 'East', forecast: 10 } });
  assert.equal(added.status, 201);
  const rowPath = `${path}/rows/${added.body.row.id}`;
  const delayed = startDelayedBody(call.port, rowPath, 'PATCH', 'author', { values: { forecast: 99 } });
  await settle();
  const other = await call(rowPath, 'PATCH', { values: { region: 'West' } }, 'other-author');
  assert.equal(other.status, 200, JSON.stringify(other.body));
  const patched = await delayed.finish();
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  const after = await call(path);
  assert.deepEqual(after.body.rows[0].values, { region: 'West', forecast: 99, starts_on: null, active: null });
  assert.equal(after.body.version, added.body.version + 2);
  const audit = await call(`${path}/audit`);
  const updates = audit.body.entries.filter(e => e.action === 'row_updated');
  assert.deepEqual(updates.map(e => ({ actorId: e.actorId, ...e.detail })), [
    { actorId: 'other-author', rowId: added.body.row.id, changes: [{ column: 'region', oldValue: 'East', newValue: 'West' }] },
    { actorId: 'author', rowId: added.body.row.id, changes: [{ column: 'forecast', oldValue: 10, newValue: 99 }] },
  ]);
});

test('input tables (#219): concurrent same-cell patches without a version audit the latest value and remain last-write-wins', async t => {
  const call = await api(t);
  const table = await createTable(call, { editors: ['other-author'] });
  const path = `/api/input-tables/${table.id}`;
  const added = await call(`${path}/rows`, 'POST', { values: { region: 'East', forecast: 10 } });
  const rowPath = `${path}/rows/${added.body.row.id}`;
  const delayed = startDelayedBody(call.port, rowPath, 'PATCH', 'author', { values: { forecast: 99 } });
  await settle();
  assert.equal((await call(rowPath, 'PATCH', { values: { forecast: 20 } }, 'other-author')).status, 200);
  const patched = await delayed.finish();
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.equal((await call(path)).body.rows[0].values.forecast, 99);
  const audit = await call(`${path}/audit`);
  assert.deepEqual(audit.body.entries.filter(e => e.action === 'row_updated').map(e => e.detail.changes), [
    [{ column: 'forecast', oldValue: 10, newValue: 20 }],
    [{ column: 'forecast', oldValue: 20, newValue: 99 }],
  ]);
});

test('input tables (#219): expectedVersion rejects a stale same-cell patch without changing the table or audit', async t => {
  const call = await api(t);
  const table = await createTable(call, { editors: ['other-author'] });
  const path = `/api/input-tables/${table.id}`;
  const added = await call(`${path}/rows`, 'POST', { values: { region: 'East', forecast: 10 } });
  const expectedVersion = added.body.version;
  const rowPath = `${path}/rows/${added.body.row.id}`;
  // Both editors load the same version; the delayed editor must check it again at commit.
  const delayed = startDelayedBody(call.port, rowPath, 'PATCH', 'other-author', { values: { forecast: 99 }, expectedVersion });
  await settle();
  const first = await call(rowPath, 'PATCH', { values: { forecast: 20 }, expectedVersion });
  const before = await call(path);
  const auditBefore = await call(`${path}/audit`);
  const conflict = await delayed.finish();
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.version, expectedVersion + 1);
  assert.equal(auditBefore.body.entries.filter(e => e.action === 'row_updated').length, 1);
  assert.equal(conflict.status, 412, JSON.stringify(conflict.body));
  assert.equal(conflict.body.errorCode, 'INPUT_TABLE_VERSION_CONFLICT');
  const after = await call(path);
  assert.equal(after.body.rows[0].values.forecast, 20);
  assert.deepEqual(after, before);
  assert.deepEqual(await call(`${path}/audit`), auditBefore);
  // A rejected mutation does not prevent a later patch with the refreshed version.
  assert.equal((await call(rowPath, 'PATCH', { values: { forecast: 30 }, expectedVersion: after.body.version })).status, 200);
});

test('input tables (#219): expectedVersion must be a positive safe integer', async t => {
  const call = await api(t);
  const table = await createTable(call);
  const path = `/api/input-tables/${table.id}`;
  const added = await call(`${path}/rows`, 'POST', { values: { region: 'East', forecast: 10 } });
  const before = await call(path);
  const auditBefore = await call(`${path}/audit`);
  for (const expectedVersion of [0, -1, 1.5, '3', null, true, [], {}, Number.MAX_SAFE_INTEGER + 1]) {
    const rejected = await call(`${path}/rows/${added.body.row.id}`, 'PATCH', { values: { forecast: 99 }, expectedVersion });
    assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
    assert.equal(rejected.body.errorCode, 'INPUT_TABLE_INVALID_VERSION');
  }
  assert.deepEqual(await call(path), before);
  assert.deepEqual(await call(`${path}/audit`), auditBefore);
});

test('input tables: per-table editors, reader bar, admin manage, namespace isolation', async t => {
  const call = await api(t);
  const table = await createTable(call);
  const rows = `/api/input-tables/${table.id}/rows`;
  // A same-namespace author who is not an editor can view but not write.
  assert.equal((await call(`/api/input-tables/${table.id}`, 'GET', undefined, 'other-author')).status, 200);
  const denied = await call(rows, 'POST', { values: { region: 'East', forecast: 1 } }, 'other-author');
  assert.equal(denied.status, 403); assert.equal(denied.body.errorCode, 'INPUT_TABLE_EDIT_REQUIRED');
  // Only owner/admins manage the editor list.
  const manageDenied = await call(`/api/input-tables/${table.id}/editors`, 'PUT', { editors: ['other-author'] }, 'other-author');
  assert.equal(manageDenied.status, 403); assert.equal(manageDenied.body.errorCode, 'INPUT_TABLE_MANAGE_REQUIRED');
  // Granting edit rights makes the same write succeed.
  assert.equal((await call(`/api/input-tables/${table.id}/editors`, 'PUT', { editors: ['other-author', 'reader'] })).status, 200);
  assert.equal((await call(rows, 'POST', { values: { region: 'East', forecast: 1 } }, 'other-author')).status, 201);
  // A reader stays read-only even when listed as an editor.
  const readerDenied = await call(rows, 'POST', { values: { region: 'West', forecast: 2 } }, 'reader');
  assert.equal(readerDenied.status, 403);
  // An administrator can manage a table they do not own.
  assert.equal((await call(`/api/input-tables/${table.id}/editors`, 'PUT', { editors: [] }, 'admin')).status, 200);
  // Editors must be workspace users.
  const ghost = await call(`/api/input-tables/${table.id}/editors`, 'PUT', { editors: ['ghost'] });
  assert.equal(ghost.status, 400); assert.equal(ghost.body.errorCode, 'INPUT_TABLE_EDITOR_NOT_IN_WORKSPACE');
  // Another namespace sees nothing.
  const foreign = await call(`/api/input-tables/${table.id}`, 'GET', undefined, 'tenant-author');
  assert.equal(foreign.status, 404); assert.equal(foreign.body.errorCode, 'INPUT_TABLE_NOT_FOUND');
  assert.equal((await call('/api/input-tables', 'GET', undefined, 'tenant-author')).body.tables.length, 0);
});

test('input tables: append-only audit records old -> new and survives table deletion (D-84)', async t => {
  const call = await api(t);
  const table = await createTable(call);
  const rows = `/api/input-tables/${table.id}/rows`;
  const added = await call(rows, 'POST', { values: { region: 'East', forecast: 10 } });
  const rowId = added.body.row.id;
  await call(`${rows}/${rowId}`, 'PATCH', { values: { forecast: 12 } });
  await call(`/api/input-tables/${table.id}/editors`, 'PUT', { editors: ['other-author'] });
  await call(`${rows}/${rowId}`, 'DELETE');
  const audit = await call(`/api/input-tables/${table.id}/audit`);
  assert.equal(audit.status, 200);
  const actions = audit.body.entries.map(e => e.action);
  assert.deepEqual(actions, ['table_created', 'row_added', 'row_updated', 'editors_changed', 'row_deleted']);
  const updated = audit.body.entries.find(e => e.action === 'row_updated');
  assert.deepEqual(updated.detail.changes, [{ column: 'forecast', oldValue: 10, newValue: 12 }]);
  assert.equal(updated.actorId, 'author');
  const addedEntry = audit.body.entries.find(e => e.action === 'row_added');
  assert.equal(addedEntry.detail.row.values.region, 'East');
  // Deleting the table keeps its audit trail readable by the owning namespace only.
  assert.equal((await call(`/api/input-tables/${table.id}`, 'DELETE')).status, 200);
  assert.equal((await call(`/api/input-tables/${table.id}`)).status, 404);
  const retained = await call(`/api/input-tables/${table.id}/audit`);
  assert.equal(retained.status, 200);
  assert.equal(retained.body.entries.at(-1).action, 'table_deleted');
  assert.equal((await call(`/api/input-tables/${table.id}/audit`, 'GET', undefined, 'tenant-author')).status, 404);
});

test('input tables: store persists across restarts and a corrupt store fails closed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'opensight-input-tables-'));
  const storePath = join(dir, 'input-tables.json');
  const first = await api(t, { inputTableStorePath: storePath });
  const table = await createTable(first);
  await first(`/api/input-tables/${table.id}/rows`, 'POST', { values: { region: 'East', forecast: 7 } });
  const second = await api(t, { inputTableStorePath: storePath });
  const reloaded = await second(`/api/input-tables/${table.id}`);
  assert.equal(reloaded.status, 200); assert.equal(reloaded.body.rows.length, 1); assert.equal(reloaded.body.rows[0].values.forecast, 7);
  await writeFile(storePath, JSON.stringify({ version: 1, tables: [{ id: 'broken' }], audit: [] }));
  await assert.rejects(() => api(t, { inputTableStorePath: storePath }), /INPUT_TABLE_STORE_CORRUPT/);
});

test('input tables: prep can use a table as its input and join against it; foreign tables fail closed', async t => {
  const call = await api(t);
  const table = await createTable(call);
  const rows = `/api/input-tables/${table.id}/rows`;
  await call(rows, 'POST', { values: { region: 'East', forecast: 10 } });
  await call(rows, 'POST', { values: { region: 'West', forecast: 20 } });
  const sourceId = `input-table-${table.id}`;
  const sources = await call('/api/prep-sources');
  assert.ok(sources.body.some(s => s.id === sourceId), 'input table listed as a prep source');
  // As the pipeline input.
  const direct = await call('/api/datasets/itdirect/prep/preview', 'POST', { pipeline: { version: 1, input: sourceId, steps: [] } });
  assert.equal(direct.status, 200, JSON.stringify(direct.body));
  assert.deepEqual(direct.body.rows.map(r => [r.region, Number(r.forecast)]).sort(), [['East', 10], ['West', 20]]);
  // As a join source against an uploaded dataset.
  const upload = { config: { format: 'csv' }, base64: Buffer.from('region,amount\nEast,2\nWest,3\n').toString('base64') };
  const staged = await call('/api/uploads', 'POST', upload);
  assert.equal(staged.status, 201, JSON.stringify(staged.body));
  const joinPipeline = { version: 1, input: staged.body.id, steps: [{ id: 'join', kind: 'join', config: { source: sourceId, joinType: 'inner', keys: [{ left: 'region', right: 'region' }], prefix: 'fc_' } }] };
  const joined = await call('/api/datasets/itjoin/prep/preview', 'POST', { pipeline: joinPipeline });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.equal(joined.body.rows.length, 2);
  const east = joined.body.rows.find(r => r.region === 'East');
  assert.equal(Number(east.amount), 2); assert.equal(Number(east.fc_forecast), 10);
  // Another namespace cannot reference the table at all.
  const foreign = await call('/api/datasets/itjoin/prep/preview', 'POST', { pipeline: { version: 1, input: sourceId, steps: [] } }, 'tenant-author');
  assert.equal(foreign.body.errorCode, 'PREP_SOURCE_NOT_FOUND', JSON.stringify(foreign.body));
});

test('input tables (#218): an editor revoked while a row-add body is in flight cannot commit the write', async t => {
  const call = await api(t);
  const table = await createTable(call);
  const rows = `/api/input-tables/${table.id}/rows`;
  assert.equal((await call(`/api/input-tables/${table.id}/editors`, 'PUT', { editors: ['other-author'] })).status, 200);
  // The request passes its initial editor check, then parks awaiting the rest of its body.
  const delayed = startDelayedBody(call.port, rows, 'POST', 'other-author', { values: { region: 'East', forecast: 99 } });
  await settle();
  // The owner revokes the grant before the body completes.
  assert.equal((await call(`/api/input-tables/${table.id}/editors`, 'PUT', { editors: [] })).status, 200);
  const denied = await delayed.finish();
  assert.equal(denied.status, 403, JSON.stringify(denied.body));
  assert.equal(denied.body.errorCode, 'INPUT_TABLE_EDIT_REQUIRED');
  const after = await call(`/api/input-tables/${table.id}`);
  assert.equal(after.body.rows.length, 0);
  const audit = await call(`/api/input-tables/${table.id}/audit`);
  assert.ok(!audit.body.entries.some(e => e.action === 'row_added'), 'revoked write left no audit entry');
});

test('input tables (#218): an editor revoked while a patch or rename body is in flight cannot commit either', async t => {
  const call = await api(t);
  const table = await createTable(call);
  const rows = `/api/input-tables/${table.id}/rows`;
  const added = await call(rows, 'POST', { values: { region: 'East', forecast: 10 } });
  const rowId = added.body.row.id;
  assert.equal((await call(`/api/input-tables/${table.id}/editors`, 'PUT', { editors: ['other-author'] })).status, 200);
  const patch = startDelayedBody(call.port, `${rows}/${rowId}`, 'PATCH', 'other-author', { values: { forecast: 999 } });
  await settle();
  assert.equal((await call(`/api/input-tables/${table.id}/editors`, 'PUT', { editors: [] })).status, 200);
  const deniedPatch = await patch.finish();
  assert.equal(deniedPatch.status, 403, JSON.stringify(deniedPatch.body));
  assert.equal(deniedPatch.body.errorCode, 'INPUT_TABLE_EDIT_REQUIRED');
  // Re-grant, then revoke again during a delayed rename of the table itself.
  assert.equal((await call(`/api/input-tables/${table.id}/editors`, 'PUT', { editors: ['other-author'] })).status, 200);
  const rename = startDelayedBody(call.port, `/api/input-tables/${table.id}`, 'PATCH', 'other-author', { name: 'Renamed by revoked editor' });
  await settle();
  assert.equal((await call(`/api/input-tables/${table.id}/editors`, 'PUT', { editors: [] })).status, 200);
  const deniedRename = await rename.finish();
  assert.equal(deniedRename.status, 403, JSON.stringify(deniedRename.body));
  assert.equal(deniedRename.body.errorCode, 'INPUT_TABLE_EDIT_REQUIRED');
  const after = await call(`/api/input-tables/${table.id}`);
  assert.equal(after.body.rows[0].values.forecast, 10);
  assert.equal(after.body.name, 'Regional forecast');
});

test('input tables (#218): a still-authorized editor write that queues behind a revocation of someone else commits normally', async t => {
  const call = await api(t);
  const table = await createTable(call);
  const rows = `/api/input-tables/${table.id}/rows`;
  assert.equal((await call(`/api/input-tables/${table.id}/editors`, 'PUT', { editors: ['other-author'] })).status, 200);
  // Owner and editor write concurrently through the serialized store; the owner's
  // own authorization is unaffected by the editor-list change in between.
  const [ownerAdd, editorAdd] = await Promise.all([
    call(rows, 'POST', { values: { region: 'East', forecast: 1 } }, 'author'),
    call(rows, 'POST', { values: { region: 'West', forecast: 2 } }, 'other-author'),
  ]);
  assert.equal(ownerAdd.status, 201, JSON.stringify(ownerAdd.body));
  assert.equal(editorAdd.status, 201, JSON.stringify(editorAdd.body));
  assert.equal((await call(`/api/input-tables/${table.id}`)).body.rows.length, 2);
});
