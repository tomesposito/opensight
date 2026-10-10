import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { AccessProvider } from '../build/test/access.js';
import { DataLanding } from '../build/test/DataLanding.js';
import { DatasetDetail } from '../build/test/DatasetDetail.js';
import { DatasetRefresh } from '../build/test/DatasetRefresh.js';
import { DataPrep } from '../build/test/DataPrep.js';
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
const submit = ui => act(async () => ui.root.findByType('dialog').findByType('form').props.onSubmit({ preventDefault() {} }));
const datasetName = ui => ui.root.findAllByType('label').find(node => node.children[0] === 'Dataset name').findByType('input');
async function settled(check) {
  for (let i = 0; i < 300 && !check(); i++) await act(() => new Promise(resolve => setTimeout(resolve, 10)));
  assert.ok(check(), 'UI operation completed');
}

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

test('hosted duplicate creates version zero and delete sends the viewed version', async t => {
  const f = await hostedDataFixture(t), routes = [];
  const ui = await mount(t, DatasetDetail, { client: f.client, datasetId: 'orders', navigate: route => routes.push(route), onGenerate() {} });
  await click(ui, 'Duplicate'); await change(ui.root.findByProps({ 'aria-label': 'Dataset name' }), 'Orders copy'); await submit(ui);
  await settled(() => routes.length === 1);
  const id = routes[0].datasetId, copy = await f.prep.get(await f.login(), id);
  assert.match(id, /^prepared-/); assert.equal(copy.version, 1); assert.equal(copy.resource.name, 'Orders copy');
  assert.deepEqual(copy.resource.opensightPrep, f.pipeline);
  assert.equal(f.calls.find(call => call.method === 'PUT').body.expectedVersion, 0);
  const detail = await mount(t, DatasetDetail, { client: f.client, datasetId: id, navigate: route => routes.push(route), onGenerate() {} });
  await click(detail, 'Delete'); assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 0);
  await submit(detail); await settled(() => routes.length === 2);
  assert.deepEqual(f.calls.find(call => call.method === 'DELETE').body, { expectedVersion: 1 });
  assert.deepEqual(routes[1], { page: 'data' });
  await assert.rejects(f.prep.get(await f.login(), id), { code: 'RESOURCE_NOT_FOUND' });
  assert.equal((await f.prep.get(await f.login(), 'orders')).version, 1);
});

test('hosted stale detail delete surfaces METADATA_CONFLICT and preserves the dataset', async t => {
  const f = await hostedDataFixture(t), routes = [];
  const ui = await mount(t, DatasetDetail, { client: f.client, datasetId: 'orders', navigate: route => routes.push(route), onGenerate() {} });
  await f.prep.save(await f.login(), 'orders', { name: 'Newer name', pipeline: f.pipeline, expectedVersion: 1 });
  await click(ui, 'Delete'); await submit(ui); await settled(() => ui.text().includes('METADATA_CONFLICT'));
  assert.deepEqual(routes, []); assert.equal((await f.prep.get(await f.login(), 'orders')).resource.name, 'Newer name');
});

test('hosted prep editor creates, edits and deletes using durable optimistic versions', async t => {
  const f = await hostedDataFixture(t), saved = [];
  const ui = await mount(t, DataPrep, { client: f.client, initialSource: f.source.id, onSaved: dataset => saved.push(dataset) });
  await change(datasetName(ui), 'Created dataset'); await click(ui, 'Save pipeline'); await settled(() => saved.length === 1);
  assert.equal(f.calls.find(call => call.method === 'PUT').body.expectedVersion, 0);
  assert.match(ui.text(), /Dataset pipeline saved\./); assert.doesNotMatch(ui.text(), /saved for this API session/);
  const id = saved[0].dataSetId;
  const edit = await mount(t, DataPrep, { client: f.client, initialDatasetId: id, onSaved: dataset => saved.push(dataset) });
  assert.equal(datasetName(edit).props.value, 'Created dataset');
  await change(datasetName(edit), 'Edited dataset'); await click(edit, 'Save pipeline'); await settled(() => saved.length === 2);
  assert.equal(f.calls.filter(call => call.method === 'PUT').at(-1).body.expectedVersion, 1);
  assert.equal((await f.prep.get(await f.login(), id)).version, 2);
  await click(edit, 'Delete saved pipeline'); await settled(() => edit.text().includes('Saved pipeline deleted.'));
  assert.deepEqual(f.calls.find(call => call.method === 'DELETE').body, { expectedVersion: 2 });
});

test('hosted prep edit refuses a stale save and keeps the newer server recipe', async t => {
  const f = await hostedDataFixture(t);
  const ui = await mount(t, DataPrep, { client: f.client, initialDatasetId: 'orders' });
  await change(datasetName(ui), 'My edit');
  await f.prep.save(await f.login(), 'orders', { name: 'Concurrent edit', pipeline: f.pipeline, expectedVersion: 1 });
  await click(ui, 'Save pipeline'); await settled(() => ui.text().includes('METADATA_CONFLICT'));
  assert.equal(datasetName(ui).props.value, 'My edit');
  assert.equal((await f.prep.get(await f.login(), 'orders')).resource.name, 'Concurrent edit');
});

test('hosted storage, schedule add/edit/remove, refresh and delete compose with current versions', async t => {
  const f = await hostedDataFixture(t), navigated = [];
  const ui = await mount(t, DatasetDetail, { client: f.client, datasetId: 'orders', navigate: route => navigated.push(route), onGenerate() {} });
  await change(ui.root.findByProps({ 'aria-label': 'Execution mode' }), 'BLAZE');
  await settled(() => ui.text().includes('BLAZE · Cached'));
  assert.deepEqual(f.calls.find(call => call.method === 'PUT').body, { mode: 'BLAZE', intervalMinutes: null, expectedVersion: 1 });
  await click(ui, 'Refresh'); assert.match(ui.text(), /Cache status is not supplied/);
  assert.doesNotMatch(ui.text(), /undefined|0 bytes/);
  await click(ui, 'Add new schedule'); await change(ui.root.findByProps({ 'aria-label': 'Occurrence (minutes)' }), '15'); await submit(ui);
  await settled(() => !ui.root.findAllByType('dialog').length);
  assert.equal(f.calls.filter(call => call.method === 'PUT').at(-1).body.expectedVersion, 2);
  let jobs = await f.store.list(await f.login()); assert.equal(jobs[0].spec.schedule.minutes, 15); assert.equal(jobs[0].spec.schedule.timeZone, 'UTC');
  await click(ui, 'Edit'); await change(ui.root.findByProps({ 'aria-label': 'Occurrence (minutes)' }), '30'); await submit(ui);
  await settled(() => !ui.root.findAllByType('dialog').length);
  assert.equal(f.calls.filter(call => call.method === 'PUT').at(-1).body.expectedVersion, 3);
  assert.equal((await f.store.list(await f.login()))[0].spec.schedule.minutes, 30);
  await click(ui, 'Remove'); await settled(() => ui.text().includes('No schedules.'));
  assert.equal(f.calls.filter(call => call.method === 'PUT').at(-1).body.expectedVersion, 4);
  jobs = await f.store.list(await f.login()); assert.equal(jobs[0].stopped, true);
  await click(ui, 'Refresh now'); await settled(() => !button(ui, 'Refresh now').props.disabled);
  assert.deepEqual(ui.root.findAllByProps({ role: 'alert' }).map(node => node.children), []);
  assert.equal(f.calls.filter(call => call.path.endsWith('/refresh')).length, 1);
  assert.deepEqual((await f.prep.execute(await f.login(), 'orders', 'rows')).rows.map(row => row.revenue), [10, 20, 30]);
  assert.match(ui.text(), /Cache status is not supplied/); assert.doesNotMatch(ui.text(), /undefined/);
  await click(ui, 'Delete'); await submit(ui); await settled(() => navigated.length === 1);
  assert.deepEqual(f.calls.find(call => call.method === 'DELETE').body, { expectedVersion: 5 });
});

test('hosted schedule keeps its opening version across polling and rejects concurrent changes', async t => {
  const f = await hostedDataFixture(t);
  await f.prep.configure(await f.login(), 'orders', { mode: 'BLAZE', intervalMinutes: 15, expectedVersion: 1 });
  t.mock.timers.enable({ apis: ['setInterval'] });
  const ui = await mount(t, DatasetRefresh, { client: f.client, datasetId: 'orders' });
  await click(ui, 'Edit'); await change(ui.root.findByProps({ 'aria-label': 'Occurrence (minutes)' }), '30');
  await f.prep.configure(await f.login(), 'orders', { mode: 'BLAZE', intervalMinutes: 45, expectedVersion: 2 });
  await act(async () => t.mock.timers.tick(5000));
  await submit(ui); await settled(() => ui.text().includes('METADATA_CONFLICT'));
  assert.equal(f.calls.filter(call => call.method === 'PUT').at(-1).body.expectedVersion, 2);
  assert.equal((await f.prep.get(await f.login(), 'orders')).execution.intervalMinutes, 45);
});

test('hosted schedule without automation reports the real unavailable error', async t => {
  const f = await hostedDataFixture(t, { automation: false });
  await f.prep.configure(await f.login(), 'orders', { mode: 'BLAZE', intervalMinutes: null, expectedVersion: 1 });
  const ui = await mount(t, DatasetRefresh, { client: f.client, datasetId: 'orders' });
  await click(ui, 'Add new schedule'); await submit(ui); await settled(() => ui.text().includes('HOSTED_AUTOMATION_UNAVAILABLE'));
  assert.equal((await f.prep.get(await f.login(), 'orders')).execution.intervalMinutes, null);
});
