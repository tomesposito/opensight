import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { AccessProvider } from '../build/test/access.js';
import { DataLanding } from '../build/test/DataLanding.js';
import { DatasetDetail } from '../build/test/DatasetDetail.js';
import { loadDataCatalog, filterDatasets } from '../build/test/data-section.js';
import { draftSourceProblem } from '../build/test/draft-source.js';
import { hostedDataFixture } from './hosted-data-helpers.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const access = { mode: 'hosted', session: { id: 'admin', name: 'Owner', namespaceId: 'one', tenantId: 'tenant-one', role: 'administrator' } };
async function mount(t, Component, props) {
  let ui;
  await act(async () => { ui = create(createElement(AccessProvider, { access }, createElement(Component, props))); });
  t.after(() => act(() => ui.unmount()));
  return { get root() { return ui.root; }, text: () => JSON.stringify(ui.toJSON()) };
}
const button = (ui, label) => ui.root.findAllByType('button').find(node => node.children.join('') === label);
const click = (ui, label) => act(async () => { const node = button(ui, label); assert.ok(node, label); assert.ok(!node.props.disabled, label); await node.props.onClick(); });
const change = (node, value) => act(() => node.props.onChange({ target: { value } }));

test('hosted nonempty catalog unwraps resources, versions, execution and transformed schemas', async t => {
  const f = await hostedDataFixture(t), saved = await f.client.listPrepDatasets();
  assert.equal(saved.persistence, 'durable'); assert.deepEqual(Object.keys(saved.datasets[0]).sort(), ['execution', 'resource', 'version']);
  const catalog = await loadDataCatalog(f.client);
  assert.equal(filterDatasets(catalog, 'ORD', 'direct', true)[0].dataSetId, 'orders');
  assert.equal(catalog.versions.orders, 1);
  const prepared = catalog.sources.find(source => source.ref?.dataset === 'orders');
  assert.deepEqual(prepared.columns.map(c => c.name), ['region', 'revenue', 'private']);
  assert.equal(prepared.available, true);
  assert.equal(draftSourceProblem({ id: 'orders', columns: prepared.columns }, await f.client.listPrepSources()), undefined);
  assert.ok(f.calls.every(call => !/\/(rows|preview|query)$/.test(call.path)), 'catalog uses schema, never data execution');
  const opened = [];
  const ui = await mount(t, DataLanding, { client: f.client, onOpen: dataset => opened.push(dataset.dataSetId), onCreate() {}, onCreateSource() {}, onEdit() {}, onPrep() {} });
  await click(ui, 'Orders'); assert.deepEqual(opened, ['orders']);
  await change(ui.root.findByProps({ type: 'search' }), 'ORD'); assert.ok(button(ui, 'Orders'));
  await change(ui.root.findByProps({ 'aria-label': 'Filter datasets' }), 'cached'); assert.match(ui.text(), /No datasets match/);
});

test('hosted detail loads derived columns and generates a usable analysis dataset', async t => {
  const f = await hostedDataFixture(t), generated = [];
  const ui = await mount(t, DatasetDetail, { client: f.client, datasetId: 'orders', navigate() {}, onGenerate: dataset => generated.push(dataset) });
  assert.match(ui.text(), /revenue/); assert.doesNotMatch(ui.text(), /PREP_NOT_FOUND/);
  await click(ui, 'Generate analysis');
  assert.equal(generated[0].id, 'orders'); assert.deepEqual(generated[0].columns.map(c => c.name), ['region', 'revenue', 'private']);
  assert.equal(draftSourceProblem(generated[0], await f.client.listPrepSources()), undefined);
});

test('hosted recursive prepared schemas preserve output selection and unknown cache telemetry', async t => {
  const f = await hostedDataFixture(t);
  const pipeline = { version: 1, input: { dataset: 'orders' }, steps: [
    { id: 'base', kind: 'select', config: { columns: ['region', 'revenue'] } },
    { id: 'total', kind: 'aggregate', config: { groupBy: [], measures: [{ name: 'total', column: 'revenue', aggregation: 'SUM' }] } },
    { id: 'branch', from: 'base', kind: 'select', config: { columns: ['region'] } },
  ], output: 'total' };
  await f.prep.save(await f.login(), 'totals', { name: 'Totals', pipeline, expectedVersion: 0 });
  const catalog = await loadDataCatalog(f.client), source = catalog.sources.find(s => s.ref?.dataset === 'totals');
  assert.deepEqual(source.columns.map(c => c.name), ['total']); assert.equal(source.execution.state, 'unknown'); assert.equal(source.execution.bytes, null);
  const ui = await mount(t, DatasetDetail, { client: f.client, datasetId: 'totals', navigate() {}, onGenerate() {} });
  assert.match(ui.text(), /Status unavailable/); assert.doesNotMatch(ui.text(), /0 bytes|undefined rows/);
});

test('hosted source revocation fails closed on landing and detail', async t => {
  const f = await hostedDataFixture(t);
  await f.sources.bind(await f.login(), f.source.id, { expectedVersion: 1, policy: { rowLevel: true, rowRules: [] } });
  const ui = await mount(t, DataLanding, { client: f.client, onCreate() {}, onCreateSource() {}, onOpen() {}, onEdit() {}, onPrep() {} });
  assert.match(ui.text(), /PREP_SECURITY_REJECTED/); assert.equal(button(ui, 'Orders'), undefined);
  const detail = await mount(t, DatasetDetail, { client: f.client, datasetId: 'orders', navigate() {}, onGenerate() {} });
  assert.match(detail.text(), /PREP_SECURITY_REJECTED/); assert.equal(button(detail, 'Generate analysis'), undefined);
});
