import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { AccessProvider } from '../build/test/access.js';
import { CreateDatasetDialog, creationConnectors } from '../build/test/CreateDatasetDialog.js';
import { connectors } from '@opensight/query-engine/browser';
import { parseRoute, routeHash } from '../build/test/app-navigation.js';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const raw = { id: 'upload-1', connectorId: 'file', available: true, columns: [] };
const client = { listPrepDatasets: async () => ({ datasets: [] }), listPrepSources: async () => [raw], uploadFile: async () => ({ id: 'upload-2', rowCount: 1, columns: [] }), validateConnector: async () => { throw new Error('Do not pretend validation creates a connection'); } };
const button = (ui, label) => ui.root.findAllByType('button').find(node => node.children.join('') === label);
const click = (ui, label) => act(() => button(ui, label).props.onClick());
const change = (node, value) => act(() => node.props.onChange({ target: { value } }));
async function mount(t, props = {}, access = { mode: 'local' }) {
  let ui;
  await act(() => { ui = create(createElement(AccessProvider, { access }, createElement(CreateDatasetDialog, { onClose() {}, onPrep() {}, ...props }))); });
  t.after(() => act(() => ui.unmount()));
  return { get root() { return ui.root; }, text: () => JSON.stringify(ui.toJSON()) };
}
test('source selection searches real sources, excludes datasets, and enters prep only with available selection', async t => {
  const selected = [];
  const denied = { ...raw, id: 'denied', available: false, errorCode: 'ACCESS_DENIED' };
  const ui = await mount(t, { client: { ...client, listPrepSources: async () => [raw, denied, { ...raw, id: 'prepared', ref: { dataset: 'prepared' } }] }, onPrep: source => selected.push(source) });
  assert.equal(button(ui, 'Select').props.disabled, true);
  assert.equal(ui.root.findAllByProps({ type: 'radio' }).length, 2);
  assert.equal(ui.root.findByProps({ 'aria-label': 'Select denied' }).props.disabled, true);
  await act(() => ui.root.findByProps({ 'aria-label': 'Select upload-1' }).props.onChange());
  await click(ui, 'Select'); assert.deepEqual(selected, ['upload-1']);
  await change(ui.root.findByProps({ type: 'search' }), 'absent');
  assert.equal(button(ui, 'Select').props.disabled, true); assert.match(ui.text(), /No data sources match/);
  await click(ui, 'Select'); assert.equal(selected.length, 1);
});
test('empty, loading, and failed source states cannot submit invented sources', async t => {
  const empty = await mount(t); assert.match(empty.text(), /No data sources yet/); assert.equal(button(empty, 'Select').props.disabled, true);
  const failed = await mount(t, { client: { ...client, listPrepSources: async () => { throw new Error('SOURCE_DENIED'); } } });
  assert.match(failed.text(), /SOURCE_DENIED/); assert.equal(button(failed, 'Select').props.disabled, true);
  const loading = await mount(t, { client: { ...client, listPrepSources: () => new Promise(() => {}) } });
  assert.match(loading.text(), /Loading data sources/); assert.equal(button(loading, 'Select').props.disabled, true);
});
test('connector grid follows live registry, exposes honest MySQL limitation, and omits AWS services', async t => {
  const expected = connectors.filter(item => item.category !== 'AWS' && ['upload', 'query'].includes(item.implementation));
  assert.deepEqual(creationConnectors.filter(item => item.id !== 'mysql'), expected);
  const ui = await mount(t, { start: 'source' });
  assert.deepEqual(ui.root.findAllByProps({ type: 'radio' }).map(node => node.props['aria-label']), creationConnectors.map(item => item.name));
  assert.equal(ui.root.findByProps({ 'aria-label': 'MySQL' }).props.disabled, true);
  assert.match(ui.text(), /Not yet implemented/); assert.doesNotMatch(ui.text(), /Athena|Redshift|S3|Aurora/);
  assert.equal(button(ui, 'Next').props.disabled, true);
  await change(ui.root.findByProps({ type: 'search' }), 'post'); assert.equal(ui.root.findAllByProps({ type: 'radio' }).length, 1);
  await act(() => ui.root.findByProps({ 'aria-label': 'PostgreSQL' }).props.onChange()); await click(ui, 'Next');
  assert.match(ui.text(), /PostgreSQL setup/); assert.match(ui.text(), /environment variables/);
  assert.equal(button(ui, 'Select').props.disabled, true);
});
test('cancel and Escape close dialogs; back returns to source selection', async t => {
  let closed = 0;
  const ui = await mount(t, { onClose: () => closed++ });
  await click(ui, 'Create data source'); await click(ui, 'Back'); assert.match(ui.text(), /Choose a data source to create a dataset/);
  await click(ui, 'Cancel');
  await act(() => ui.root.findByType('dialog').props.onCancel({ preventDefault() {} })); assert.equal(closed, 2);
});
test('upload file and connector Next reach the validated upload form and navigate with returned source ID', async t => {
  const sent = [], prepared = [];
  const ui = await mount(t, { client: { ...client, uploadFile: async body => { sent.push(body); return { id: 'staged-file', rowCount: 1, columns: [] }; } }, onPrep: id => prepared.push(id) });
  await click(ui, 'Upload file');
  await act(() => ui.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [new File(['amount\n12'], 'orders.csv')] } }));
  await act(async () => { ui.root.findByType('form').props.onSubmit({ preventDefault() {} }); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.deepEqual(sent.map(item => ({ ...item, config: { ...item.config } })), [{ config: { format: 'csv' }, base64: btoa('amount\n12') }]); assert.deepEqual(prepared, ['staged-file']);
  await click(ui, 'Back'); await act(() => ui.root.findByProps({ 'aria-label': 'Upload a file' }).props.onChange()); await click(ui, 'Next');
  assert.ok(ui.root.findByProps({ type: 'file' }));
});
test('upload failures retain form and never enter prep; static upload controls stay disabled', async t => {
  let prepared = false;
  const ui = await mount(t, { start: 'file', client: { ...client, uploadFile: async () => { throw new Error('UPLOAD_INVALID'); } }, onPrep: () => { prepared = true; } });
  await act(() => ui.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [new File(['bad'], 'orders.csv')] } }));
  await act(async () => { ui.root.findByType('form').props.onSubmit({ preventDefault() {} }); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.match(ui.text(), /UPLOAD_INVALID/); assert.equal(prepared, false);
  const offline = await mount(t, { start: 'file' }); assert.equal(offline.root.findByProps({ type: 'file' }).props.disabled, true);
});
test('PostgreSQL uses only discovered available hosted raw sources, never creates connections', async t => {
  const prepared = [], pg = { ...raw, id: 'postgres-table', connectorId: 'postgresql' };
  const props = { start: 'source', client: { ...client, listPrepSources: async () => [pg, { ...pg, id: 'blocked', available: false }, { ...pg, id: 'prepared', ref: { dataset: 'prepared' } }] }, onPrep: id => prepared.push(id) };
  const ui = await mount(t, props, { mode: 'hosted', session: { role: 'author' } });
  await act(() => ui.root.findByProps({ 'aria-label': 'PostgreSQL' }).props.onChange()); await click(ui, 'Next');
  const select = ui.root.findByProps({ 'aria-label': 'Configured PostgreSQL source' }); assert.equal(select.findAllByType('option').length, 2);
  await change(select, pg.id); await click(ui, 'Select'); assert.deepEqual(prepared, [pg.id]);
  const local = await mount(t, props); await act(() => local.root.findByProps({ 'aria-label': 'PostgreSQL' }).props.onChange()); await click(local, 'Next');
  assert.equal(local.root.findByProps({ 'aria-label': 'Configured PostgreSQL source' }).findAllByType('option').length, 1);
});
test('creation and source routes survive reload and malformed source URLs fail closed', () => {
  for (const route of [{ page: 'data', createDataset: true }, { page: 'data-prep', sourceId: 'upload-1' }, { page: 'data-prep', sourceId: 'table/region' }]) assert.deepEqual(parseRoute(routeHash(route)), route);
  for (const hash of ['#/data/preparation/source/%ZZ', '#/data/preparation/source/%00', '#/data/preparation/source/']) assert.equal(parseRoute(hash), undefined);
});
