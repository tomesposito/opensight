import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiServer, emptySecurityState, StubMailTransport } from '@opensight/api';
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
  // A patch that nulls a required column fails on the merged row.
  const nulled = await call(`${rows}/${rowId}`, 'PATCH', { values: { region: null } });
  assert.equal(nulled.status, 400); assert.equal(nulled.body.errorCode, 'INPUT_TABLE_REQUIRED_VALUE_MISSING');
  // Last write wins: a second patch overwrites the first.
  await call(`${rows}/${rowId}`, 'PATCH', { values: { forecast: 15 } });
  const after = await call(`/api/input-tables/${table.id}`);
  assert.equal(after.body.rows[0].values.forecast, 15);
  const deleted = await call(`${rows}/${rowId}`, 'DELETE');
  assert.equal(deleted.status, 200);
  assert.equal((await call(`/api/input-tables/${table.id}`)).body.rows.length, 0);
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
