import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { AccessProvider, demoAccess } from '../build/test/access.js';
import { DataLanding } from '../build/test/DataLanding.js';
import { datasetBadges, filterDatasets } from '../build/test/data-section.js';
import { parseRoute, productSections, routeHash, routeProblem } from '../build/test/app-navigation.js';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const dataset = { resourceType: 'dataset', dataSetId: 'orders', name: 'Orders', physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: { version: 1, input: 'upload-1', steps: [] } };
const source = { id: 'orders', ref: { dataset: 'orders' }, name: 'Orders', connectorId: 'file', available: true, columns: [{ name: 'amount', type: 'DECIMAL' }], execution: { mode: 'BLAZE' } };
const catalog = { datasets: [dataset], sources: [source] };
const client = { listPrepDatasets: async () => ({ datasets: catalog.datasets }), listPrepSources: async () => catalog.sources };
const text = node => JSON.stringify(node.toJSON());
async function mount(t, props = {}, access = demoAccess) {
  let ui;
  const element = next => createElement(AccessProvider, { access }, createElement(DataLanding, { onCreate() {}, onCreateSource() {}, onOpen() {}, onEdit() {}, onPrep() {}, ...next }));
  await act(() => { ui = create(element(props)); });
  t.after(() => act(() => ui.unmount()));
  return { get root() { return ui.root; }, text: () => text(ui), update: props => act(() => ui.update(element(props))) };
}
const button = (ui, label) => ui.root.findAllByType('button').find(node => node.children.join('') === label);
const change = (node, value) => act(() => node.props.onChange({ target: { value } }));
test('Data rail lands on /data while prep remains a separate gated entry', () => {
  assert.equal(productSections.find(section => section.title === 'Data').page, 'data');
  assert.deepEqual(parseRoute('#/data'), { page: 'data' });
  assert.equal(routeHash({ page: 'data-prep' }), '#/data/preparation');
  for (const page of ['data', 'data-prep', 'data-sources']) assert.match(routeProblem({ mode: 'hosted', session: { role: 'reader' } }, page), /SECURITY_BUILD_REQUIRED/);
});
test('empty landing has creation, all tabs, and no staged dataset rows', async t => {
  let created = 0;
  const ui = await mount(t, { onCreate: () => created++ });
  assert.match(ui.text(), /No datasets yet/); assert.doesNotMatch(ui.text(), /Orders|demo-sales/);
  assert.deepEqual(ui.root.findAllByProps({ role: 'tab' }).map(node => node.children[0]), ['Datasets', 'Topics', 'Data sources']);
  await act(() => button(ui, 'Create dataset').props.onClick()); assert.equal(created, 1);
  await act(() => button(ui, 'Topics').props.onClick()); assert.match(ui.text(), /No topics available/);
  await act(() => button(ui, 'Data sources').props.onClick()); assert.match(ui.text(), /No data sources yet/);
  await act(() => button(ui, 'Datasets').props.onKeyDown({ key: 'ArrowRight', preventDefault() {}, currentTarget: {} }));
  assert.equal(button(ui, 'Topics').props['aria-selected'], true);
});
test('landing searches and filters real datasets, shows badges and opens exact row/menu targets', async t => {
  const opened = [], edited = [];
  const ui = await mount(t, { client, onOpen: row => opened.push(row.dataSetId), onEdit: row => edited.push(row.dataSetId) }, { mode: 'local' });
  assert.match(ui.text(), /BLAZE · Cached/); assert.match(ui.text(), /Local workspace/);
  await act(() => button(ui, 'Orders').props.onClick()); await act(() => button(ui, 'Edit dataset').props.onClick());
  assert.deepEqual(opened, ['orders']); assert.deepEqual(edited, ['orders']);
  assert.equal(ui.root.findByProps({ 'aria-label': 'Actions for Orders' }).type, 'summary');
  await change(ui.root.findByProps({ type: 'search' }), 'wrong'); assert.match(ui.text(), /No datasets match/);
  await change(ui.root.findByProps({ type: 'search' }), 'ORD'); assert.ok(button(ui, 'Orders'));
  await change(ui.root.findByProps({ 'aria-label': 'Filter datasets' }), 'direct'); assert.match(ui.text(), /No datasets match/);
  await change(ui.root.findByProps({ 'aria-label': 'Filter datasets' }), 'cached'); assert.ok(button(ui, 'Orders'));
});
test('badges and owner/type filters reflect metadata without inventing cache or security', () => {
  const protectedData = { ...dataset, rowLevelPermissionDataSet: { status: 'ENABLED' }, useAs: 'RLS_RULES' };
  assert.deepEqual(datasetBadges(dataset), []);
  assert.deepEqual(datasetBadges(protectedData, source), ['BLAZE · Cached', 'RLS enabled', 'Rules dataset']);
  assert.deepEqual(datasetBadges({ ...protectedData, rowLevelPermissionDataSet: { status: 'DISABLED' } }), ['Rules dataset']);
  for (const filter of ['rls', 'rules']) assert.equal(filterDatasets({ ...catalog, datasets: [protectedData] }, '', filter, false).length, 1);
  assert.equal(filterDatasets(catalog, '', 'mine', false).length, 0);
  assert.equal(filterDatasets(catalog, '', 'mine', true).length, 1);
});
test('failed or late catalog requests cannot reveal stale datasets and reload retries', async t => {
  let finish;
  const slow = { ...client, listPrepDatasets: () => new Promise(resolve => { finish = resolve; }) };
  const ui = await mount(t, { client: slow }); assert.match(ui.text(), /Loading data/);
  const failed = { ...client, listPrepDatasets: async () => { throw new Error('DATASET_DENIED'); } };
  await ui.update({ client: failed }); await act(() => finish({ datasets: [dataset] }));
  assert.match(ui.text(), /DATASET_DENIED/); assert.equal(button(ui, 'Orders'), undefined);
  await ui.update({ client }); assert.ok(button(ui, 'Orders'));
  await ui.update({}); assert.equal(button(ui, 'Orders'), undefined);
});
test('sources tab lists only real raw sources and refuses unavailable sources', async t => {
  const raw = { id: 'upload-1', connectorId: 'file', available: false, columns: [] };
  const ui = await mount(t, { client: { ...client, listPrepSources: async () => [source, raw] }, initialTab: 'Data sources' });
  assert.match(ui.text(), /SOURCE_UNAVAILABLE/);
  const rows = ui.root.findByType('tbody').findAllByType('tr'); assert.equal(rows.length, 1);
  assert.equal(rows[0].findByType('button').props.disabled, true);
});
