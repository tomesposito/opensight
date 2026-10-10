import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { AccessProvider } from '../build/test/access.js';
import { DatasetDetail } from '../build/test/DatasetDetail.js';
import { DatasetRefresh } from '../build/test/DatasetRefresh.js';
import { DataPrep } from '../build/test/DataPrep.js';
import { createDraftStore } from '../build/test/local-drafts.js';
import { emptyDraft } from '../build/test/authoring.js';
import { parseRoute, routeHash } from '../build/test/app-navigation.js';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// The mount helper swaps globalThis.window per mount. Node's t.after hooks run in
// registration order, so restoring a per-mount "previous" value leaves a stale stub
// behind when a test mounts more than once — and with --test-isolation=none that stub
// leaks into later test files. Restore the file's original window from every hook
// instead; the target is order-independent.
const originalWindow = globalThis.window;
const columns = [{ name: 'region', type: 'STRING' }, { name: 'amount', type: 'DECIMAL' }];
const dataset = { resourceType: 'dataset', dataSetId: 'orders', name: 'Orders', physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: { version: 1, input: 'upload-1', steps: [] } };
const execution = { mode: 'BLAZE', intervalMinutes: null, state: 'ready', rowCount: 12, bytes: 1024, lastRefreshedAt: '2026-10-01T12:00:00Z', nextRefreshAt: null, error: null };
const source = { id: 'orders', ref: { dataset: 'orders' }, connectorId: 'file', available: true, name: 'Orders', columns, execution };
const raw = { id: 'upload-1', connectorId: 'file', available: true, name: 'orders.csv', columns };
const client = { listPrepDatasets: async () => ({ datasets: [dataset] }), listPrepSources: async () => [source, raw], getDatasetExecution: async () => execution,
  setDatasetExecution: async (_id, settings) => ({ ...execution, ...settings }), refreshBlaze: async () => execution,
  getPreparedRows: async () => ({ columns, rows: [], rowCount: 0 }), savePrep: async (id, name, pipeline) => ({ resource: { ...dataset, dataSetId: id, name, opensightPrep: pipeline } }), deletePrep: async () => ({ deleted: true }), previewPrep: async () => ({ columns, rows: [], returnedRows: 0, totalRows: 0, limit: 100 }) };
async function mount(t, props = {}, Component = DatasetDetail, access = { mode: 'local' }, seed) {
  const storage = new Map();
  globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
  const store = createDraftStore(() => window.localStorage, access); seed?.(store);
  let ui;
  const element = props => createElement(AccessProvider, { access }, createElement(Component, { client, datasetId: dataset.dataSetId, navigate() {}, onGenerate() {}, ...props }));
  await act(() => { ui = create(element(props)); });
  t.after(async () => { await act(() => ui.unmount()); globalThis.window = originalWindow; });
  return { get root() { return ui.root; }, store, text: () => JSON.stringify(ui.toJSON()), update: props => act(() => ui.update(element(props))) };
}
const button = (ui, label) => ui.root.findAllByType('button').find(node => node.children.join('') === label);
const click = (ui, label) => act(() => button(ui, label).props.onClick());
const change = (node, value) => act(() => node.props.onChange({ target: { value } }));
const submit = ui => act(async () => ui.root.findByType('dialog').findByType('form').props.onSubmit({ preventDefault() {} }));

test('detail shows searchable real columns, metadata, sources, breadcrumbs and all four tabs', async t => {
  const ui = await mount(t);
  assert.deepEqual(ui.root.findAllByProps({ role: 'tab' }).map(node => node.children[0]), ['Summary', 'Refresh', 'Permissions', 'Usage']);
  for (const value of ['orders.csv', '1,024 bytes', '12', '2026-10-01T12:00:00Z']) assert.ok(ui.text().includes(value), value);
  assert.equal(ui.root.findByProps({ 'aria-label': 'Dataset breadcrumb' }).findByType('a').props.href, '#/data');
  await change(ui.root.findByProps({ 'aria-label': 'Search columns' }), 'AMO');
  assert.equal(ui.root.findByType('tbody').findAllByType('tr').length, 1);
  assert.match(ui.text(), /amount/);
  await change(ui.root.findByProps({ 'aria-label': 'Search columns' }), 'unknown'); assert.match(ui.text(), /No columns match/);
});
test('detail edit, reuse, security setup and generate analysis target this dataset', async t => {
  const routes = [], analyses = [];
  const ui = await mount(t, { navigate: route => routes.push(route), onGenerate: value => analyses.push(value) });
  await click(ui, 'Edit dataset'); await click(ui, 'Use in new dataset'); await click(ui, 'Set up row-level security'); await click(ui, 'Generate analysis');
  assert.deepEqual(routes, [{ page: 'data-prep', datasetId: 'orders' }, { page: 'data-prep', baseDatasetId: 'orders' }, { page: 'security' }]);
  assert.deepEqual(analyses, [{ id: 'orders', name: 'Orders', columns }]);
  assert.equal(button(ui, 'Add to folder').props.disabled, true);
  assert.equal(button(ui, 'Duplicate as rules dataset'), undefined);
});
test('missing, failed, offline and unavailable datasets never fall back to another dataset', async t => {
  const ui = await mount(t, { datasetId: 'missing' }); assert.match(ui.text(), /PREP_NOT_FOUND/); assert.equal(button(ui, 'Generate analysis'), undefined);
  await ui.update({ client: undefined }); assert.match(ui.text(), /Needs local or hosted API/);
  await ui.update({ client: { ...client, listPrepDatasets: async () => { throw new Error('ACCESS_DENIED'); } } }); assert.match(ui.text(), /ACCESS_DENIED/);
  const calls = [];
  await ui.update({ onGenerate: value => calls.push(value), client: { ...client, listPrepSources: async () => [{ ...source, available: false, columns: [], errorCode: 'BLAZE_CACHE_INVALIDATED' }] } });
  assert.equal(button(ui, 'Generate analysis').props.disabled, true); await click(ui, 'Generate analysis'); assert.deepEqual(calls, []);
  assert.match(ui.text(), /BLAZE_CACHE_INVALIDATED/);
});
test('duplicate persists a separate pipeline with a fresh ID and the chosen name', async t => {
  const calls = [], routes = [];
  const ui = await mount(t, { client: { ...client, savePrep: async (...args) => { calls.push(args); return client.savePrep(...args); } }, navigate: route => routes.push(route) });
  await click(ui, 'Duplicate'); await change(ui.root.findByProps({ 'aria-label': 'Dataset name' }), 'Orders copy'); await submit(ui);
  assert.match(calls[0][0], /^prepared-[\w-]+$/); assert.notEqual(calls[0][0], dataset.dataSetId);
  assert.equal(calls[0][1], 'Orders copy'); assert.deepEqual(calls[0][2], dataset.opensightPrep);
  assert.deepEqual(routes, [{ page: 'data', datasetId: calls[0][0] }]);
});
test('duplicate errors remain visible, blank names cannot submit, and protected copies fail closed', async t => {
  let calls = 0;
  const ui = await mount(t, { client: { ...client, savePrep: async () => { calls++; throw new Error('SOURCE_DENIED'); } } });
  await click(ui, 'Duplicate'); await change(ui.root.findByProps({ 'aria-label': 'Dataset name' }), ' '); await submit(ui); assert.equal(calls, 0);
  await change(ui.root.findByProps({ 'aria-label': 'Dataset name' }), 'copy'); await submit(ui); assert.match(ui.text(), /SOURCE_DENIED/);
  for (const security of [{ rowLevelPermissionDataSet: { status: 'ENABLED' } }, { rowLevelPermissionDataSet: { status: 'DISABLED' } }, { columnLevelPermissionRules: [{ columnNames: ['amount'] }] }, { useAs: 'RLS_RULES' }]) {
    const protectedUI = await mount(t, { client: { ...client, listPrepDatasets: async () => ({ datasets: [{ ...dataset, ...security }] }) } });
    assert.equal(button(protectedUI, 'Duplicate').props.disabled, true);
  }
});
test('delete requires explicit confirmation, handles dependency denial, then returns to Datasets', async t => {
  const routes = [], deleted = []; let denied = true;
  const ui = await mount(t, { navigate: route => routes.push(route), client: { ...client, deletePrep: async id => { deleted.push(id); if (denied) throw new Error('PREP_DATASET_IN_USE'); return { deleted: true }; } } });
  await click(ui, 'Delete'); assert.deepEqual(deleted, []); await click(ui, 'Cancel'); assert.deepEqual(deleted, []);
  await click(ui, 'Delete'); await submit(ui); assert.match(ui.text(), /PREP_DATASET_IN_USE/); assert.deepEqual(routes, []);
  denied = false; await submit(ui); assert.deepEqual(routes, [{ page: 'data' }]); assert.deepEqual(deleted, ['orders', 'orders']);
});
test('permissions list actual hosted owner, keep roles/revocation unavailable, and show local empty grants', async t => {
  const ui = await mount(t); await click(ui, 'Permissions'); assert.match(ui.text(), /Local datasets have no user or group grants/);
  assert.equal(button(ui, 'Add users & groups').props.disabled, true);
  const hosted = await mount(t, {}, DatasetDetail, { mode: 'hosted', session: { id: 'owner', name: 'Dataset owner', namespaceId: 'workspace', role: 'author' } });
  await click(hosted, 'Permissions'); assert.equal(hosted.root.findByProps({ 'aria-label': 'Permissions for Dataset owner' }).props.value, 'Owner');
  assert.equal(hosted.root.findByProps({ 'aria-label': 'Permissions for Dataset owner' }).props.disabled, true); assert.equal(button(hosted, 'Revoke access').props.disabled, true);
});
test('usage reads scoped saved analyses and dependent datasets without changing the active draft', async t => {
  const dependent = { ...dataset, dataSetId: 'derived', name: 'Derived', opensightPrep: { version: 1, input: { dataset: 'orders' }, steps: [] } };
  const ui = await mount(t, { client: { ...client, listPrepDatasets: async () => ({ datasets: [dataset, dependent] }) } }, DatasetDetail, { mode: 'local' }, store => {
    store.save({ ...emptyDraft(), title: 'Revenue analysis', dataset: { id: 'orders', name: 'Orders', columns } }); store.save({ ...emptyDraft(), title: 'Unrelated active draft' });
  });
  assert.match(ui.text(), /Analyses on this device/);
  await click(ui, 'Usage'); assert.match(ui.text(), /Revenue analysis/); assert.match(ui.text(), /Derived/); assert.doesNotMatch(ui.text(), /Unrelated active draft/);
  assert.equal(ui.store.restore().draft.title, 'Unrelated active draft');
  assert.ok(ui.root.findAllByType('button').filter(node => node.children[0] === 'Revoke access').every(node => node.props.disabled));
});
test('corrupt draft storage reports unavailable usage without rewriting saved data', async t => {
  const ui = await mount(t, {}, DatasetDetail, { mode: 'local' }, () => window.localStorage.setItem('opensight.author.drafts.v1.local', '{broken'));
  await click(ui, 'Usage'); assert.match(ui.text(), /could not be read/); assert.equal(window.localStorage.getItem('opensight.author.drafts.v1.local'), '{broken');
});
test('refresh uses existing API; schedule add/edit/remove persists a validated UTC interval', async t => {
  const calls = [];
  const ui = await mount(t, { client: { ...client, refreshBlaze: async id => { calls.push(['refresh', id]); return execution; }, setDatasetExecution: async (id, settings) => { calls.push([id, settings]); return { ...execution, ...settings }; } } }, DatasetRefresh);
  await click(ui, 'Refresh now'); assert.deepEqual(calls[0], ['refresh', 'orders']);
  await click(ui, 'Add new schedule'); await change(ui.root.findByProps({ 'aria-label': 'Occurrence (minutes)' }), '0'); await submit(ui); assert.equal(calls.length, 1);
  await change(ui.root.findByProps({ 'aria-label': 'Occurrence (minutes)' }), '15'); await submit(ui);
  assert.deepEqual(calls[1], ['orders', { mode: 'BLAZE', intervalMinutes: 15 }]); assert.match(ui.text(), /Every /);
  assert.equal(button(ui, 'Add new schedule').props.disabled, true);
  await click(ui, 'Edit'); await change(ui.root.findByProps({ 'aria-label': 'Occurrence (minutes)' }), '30'); await submit(ui);
  assert.deepEqual(calls[2][1], { mode: 'BLAZE', intervalMinutes: 30 });
  await click(ui, 'Remove'); assert.deepEqual(calls[3][1], { mode: 'BLAZE', intervalMinutes: null }); assert.match(ui.text(), /No schedules/);
});
test('refresh errors are surfaced and direct query cannot refresh or schedule', async t => {
  const ui = await mount(t, { client: { ...client, refreshBlaze: async () => { throw new Error('BLAZE_REFRESH_FAILED'); } } }, DatasetRefresh);
  await click(ui, 'Refresh now'); assert.match(ui.text(), /BLAZE_REFRESH_FAILED/);
  let writes = 0;
  await ui.update({ client: { ...client, getDatasetExecution: async () => ({ ...execution, mode: 'DIRECT_QUERY', state: 'direct' }), refreshBlaze: async () => { writes++; return execution; } } });
  assert.equal(button(ui, 'Refresh now').props.disabled, true); await click(ui, 'Refresh now'); assert.equal(writes, 0);
  assert.equal(button(ui, 'Add new schedule').props.disabled, true);
});
test('refresh history and email controls explain missing support and never invent runs', async t => {
  const ui = await mount(t, {}, DatasetRefresh);
  assert.match(ui.text(), /Refresh history is not supplied/); assert.match(ui.text(), /notification API/);
  assert.equal(ui.root.findByProps({ 'aria-label': 'Refresh history status' }).props.disabled, true);
  assert.equal(ui.root.findByProps({ 'aria-label': 'Refresh history time range' }).props.disabled, true);
  assert.equal(ui.root.findByProps({ type: 'checkbox' }).props.checked, false);
  assert.equal(ui.root.findByProps({ type: 'checkbox' }).props.disabled, true);
});
test('late refresh responses cannot relabel another dataset or client', async t => {
  let finish;
  const slow = { ...client, getDatasetExecution: () => new Promise(resolve => { finish = resolve; }) };
  const ui = await mount(t, { client: slow }, DatasetRefresh);
  await ui.update({ datasetId: 'new', client: { ...client, getDatasetExecution: async () => ({ ...execution, state: 'error', error: { code: 'NEW_ERROR', message: 'Unavailable' } }) } });
  await act(() => finish({ ...execution, state: 'ready' })); assert.match(ui.text(), /NEW_ERROR/);
});
test('Edit opens and saves the selected pipeline, while missing IDs expose no editable fallback', async t => {
  const saves = [], saved = [];
  const ui = await mount(t, { initialDatasetId: 'orders', onSaved: value => saved.push(value), client: { ...client, savePrep: async (...args) => { saves.push(args); return client.savePrep(...args); } } }, DataPrep);
  const nameInput = ui.root.findAllByType('label').find(node => node.children[0] === 'Dataset name').findByType('input');
  assert.equal(nameInput.props.value, 'Orders'); await change(nameInput, 'Orders edited'); await click(ui, 'Save pipeline');
  assert.equal(saves[0][0], 'orders'); assert.equal(saves[0][1], 'Orders edited'); assert.equal(saved[0].dataSetId, 'orders');
  const missing = await mount(t, { initialDatasetId: 'missing' }, DataPrep); assert.match(missing.text(), /PREP_NOT_FOUND/); assert.equal(button(missing, 'Save pipeline'), undefined);
});
test('detail/edit/reuse routes round trip and reject malformed dataset IDs', () => {
  for (const route of [{ page: 'data', datasetId: 'orders' }, { page: 'data-prep', datasetId: 'orders' }, { page: 'data-prep', baseDatasetId: 'orders' }]) assert.deepEqual(parseRoute(routeHash(route)), route);
  for (const hash of ['#/data/datasets/%2F', '#/data/datasets/', '#/data/preparation/edit/%00']) assert.equal(parseRoute(hash), undefined);
});
