import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { ManageDataDialog, datasetTypeLabel, replaceableSources, sampleDataset } from '../build/test/ManageDataDialog.js';
import { AuthorToolbar } from '../build/test/AuthorToolbar.js';
import { authorReducer, emptyDraft } from '../build/test/authoring.js';
import { authorHistoryReducer, createAuthorHistory } from '../build/test/author-history.js';

const dataset = (id, name = id) => ({ id, name, columns: [{ name: 'region', type: 'STRING' }] });
const source = (id, overrides = {}) => ({
  id, name: `${id}-name`, connectorId: 'file', ref: { dataset: id },
  columns: [{ name: 'region', type: 'STRING' }], available: true, ...overrides,
});

test('datasetTypeLabel names what OpenSight actually uses and never guesses', () => {
  const d = dataset('d1');
  assert.equal(datasetTypeLabel({ id: 'sales', name: 'Sample', columns: [] }), 'Sample');
  assert.equal(datasetTypeLabel(d, source('d1', { execution: { mode: 'BLAZE' } })), 'BLAZE · Cached');
  assert.equal(datasetTypeLabel(d, source('d1', { execution: { mode: 'DIRECT_QUERY' } })), 'Direct query');
  assert.equal(datasetTypeLabel(d, source('d1')), 'Prepared');
  assert.equal(datasetTypeLabel(d, undefined), 'Unknown');
});

test('replaceableSources keeps only available prepared datasets other than the current one', () => {
  const sources = [
    source('current'),
    source('other'),
    source('down', { available: false, errorCode: 'SOURCE_UNAVAILABLE' }),
    source('raw', { ref: 'raw-upload' }),
  ];
  assert.deepEqual(replaceableSources(sources, 'current').map(s => s.id), ['other']);
});

test('dataset action swaps the dataset, keeps the analysis, and is undoable', () => {
  let draft = authorReducer(emptyDraft(), { type: 'dataset', dataset: dataset('d1', 'Grants') });
  draft = authorReducer(draft, { type: 'add', kind: 'bar' });
  assert.equal(draft.dataset?.id, 'd1');
  const swapped = authorReducer(draft, { type: 'dataset', dataset: dataset('d2', 'Direct') });
  assert.equal(swapped.dataset?.id, 'd2');
  assert.equal(swapped.sheets.length, draft.sheets.length, 'sheets are kept');
  assert.equal(swapped.sheets[0].visuals.length, 1, 'visuals are kept');
  const cleared = authorReducer(swapped, { type: 'dataset' });
  assert.equal(cleared.dataset, undefined);
  assert.equal(cleared.sheets[0].visuals.length, 1, 'clearing keeps the canvas too');

  let history = createAuthorHistory(draft);
  history = authorHistoryReducer(history, { type: 'dataset', dataset: dataset('d2', 'Direct') });
  assert.equal(history.draft.dataset?.id, 'd2');
  assert.equal(history.undo.length, 1, 'the swap is an undoable edit, not a document boundary');
  history = authorHistoryReducer(history, { type: 'undo' });
  assert.equal(history.draft.dataset?.id, 'd1');
});

async function mountDialog(t, props) {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = {};
  const full = {
    datasets: [], onClose: () => { calls.closed = true; }, onReplace: d => { calls.replaced = d; },
    onRemove: d => { calls.removed = d; }, ...props,
  };
  let renderer;
  await act(async () => { renderer = create(createElement(ManageDataDialog, full)); });
  // Let the source-list promise (resolve or reject) settle through its handlers.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  t.after(async () => { await act(async () => { renderer.unmount(); }); globalThis.IS_REACT_ACT_ENVIRONMENT = previous; });
  const text = () => JSON.stringify(renderer.toJSON());
  const buttons = label => renderer.root.findAllByType('button').filter(b => b.props.children === label);
  const click = async label => { const found = buttons(label); assert.ok(found.length, `button ${label}`); await act(async () => { found[0].props.onClick(); }); };
  return { renderer, calls, text, buttons, click };
}

test('rows show dataset, honest type, and availability from the source list', async t => {
  const sources = [
    source('d1', { execution: { mode: 'BLAZE' } }),
    source('d2', { execution: { mode: 'DIRECT_QUERY' } }),
    source('d3'),
    source('d4', { available: false, errorCode: 'SOURCE_UNAVAILABLE' }),
  ];
  const ui = await mountDialog(t, {
    client: { listPrepSources: async () => sources },
    datasets: [dataset('d1', 'Grants'), dataset('d2', 'Live'), dataset('d3', 'Prep'), dataset('d4', 'Down'), dataset('d9', 'Gone')],
  });
  assert.match(ui.text(), /Manage data/);
  assert.match(ui.text(), /Grants/);
  assert.match(ui.text(), /BLAZE · Cached/);
  assert.match(ui.text(), /Direct query/);
  assert.match(ui.text(), /Prepared/);
  assert.match(ui.text(), /Unavailable.*SOURCE_UNAVAILABLE/);
  assert.match(ui.text(), /Gone/);
  assert.match(ui.text(), /Unknown/, 'a dataset with no matching source is Unknown, never Available');
  assert.equal((ui.text().match(/Available/g) ?? []).length, 3, 'only the three available sources read Available');
});

test('sample dataset row in demo mode; empty state otherwise', async t => {
  const demo = await mountDialog(t, { sampleLoaded: true });
  assert.match(demo.text(), /Sample sales data/);
  assert.match(demo.text(), /Sample/);
  assert.match(demo.text(), /Available/);

  const empty = await mountDialog(t, { onAddData: () => {} });
  assert.match(empty.text(), /No datasets in this analysis yet/);
  await empty.click('Add data');
  assert.ok(empty.calls.closed !== true, 'Add data does not close the dialog by itself');
});

test('replace flow swaps to the chosen prepared dataset', async t => {
  const sources = [source('d1'), source('d2'), source('d3', { available: false })];
  const ui = await mountDialog(t, {
    client: { listPrepSources: async () => sources },
    datasets: [dataset('d1', 'Grants')],
  });
  await ui.click('Replace');
  const select = ui.renderer.root.findByType('select');
  const options = select.findAllByType('option').map(o => o.props.value);
  assert.ok(options.includes('d2'), 'available prepared datasets are candidates');
  assert.ok(!options.includes('d1'), 'the current dataset is not a candidate');
  assert.ok(!options.includes('d3'), 'unavailable sources are not candidates');
  await act(async () => { select.props.onChange({ target: { value: 'd2' } }); });
  await ui.click('Replace dataset');
  assert.deepEqual(ui.calls.replaced, { id: 'd2', name: 'd2-name', columns: [{ name: 'region', type: 'STRING' }] });
});

test('remove flow confirms before removing the dataset', async t => {
  const ui = await mountDialog(t, { datasets: [dataset('d1', 'Grants')] });
  await ui.click('Remove dataset');
  assert.match(ui.text(), /Remove.*Grants/, 'a confirm step names the dataset');
  assert.equal(ui.calls.removed, undefined, 'nothing removed before confirmation');
  const confirm = ui.buttons('Remove dataset').find(b => String(b.props.className).includes('data-danger'));
  assert.ok(confirm, 'confirm button is marked dangerous');
  await act(async () => { confirm.props.onClick(); });
  assert.deepEqual(ui.calls.removed, dataset('d1', 'Grants'));
});

test('footer Cancel closes; source errors surface with retry', async t => {
  const ui = await mountDialog(t, { datasets: [dataset('d1', 'Grants')] });
  await ui.click('Cancel');
  assert.ok(ui.calls.closed);

  let fail = true;
  const broken = await mountDialog(t, {
    client: { listPrepSources: async () => { if (fail) throw new Error('boom'); return [source('d1')]; } },
    datasets: [dataset('d1', 'Grants')],
  });
  assert.match(broken.text(), /Could not load data sources.*boom/);
  fail = false;
  await broken.click('Retry');
  await act(async () => {});
  assert.match(broken.text(), /Grants/);
});

test('Data menu opens with Manage data first and runs the callback', async t => {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [];
  const props = {
    draft: authorReducer(emptyDraft(), { type: 'add', kind: 'bar' }), dispatch: () => {}, fit: true,
    onFit: () => {}, onJson: () => {}, onBundle: () => {}, onImport: () => {},
    onManageData: () => calls.push('manage'),
  };
  let renderer;
  await act(async () => { renderer = create(createElement(AuthorToolbar, props)); });
  t.after(async () => { await act(async () => { renderer.unmount(); }); globalThis.IS_REACT_ACT_ENVIRONMENT = previous; });
  const menu = renderer.root.findAllByType('details').find(n => n.findByType('summary').props.children === 'Data');
  const { AuthorMenuItem } = await import('../build/test/AuthorMenuItem.js');
  const labels = menu.findAllByType(AuthorMenuItem).map(n => n.props.label);
  assert.equal(labels[0], 'Manage data…');
  const button = menu.findAllByType(AuthorMenuItem).find(n => n.props.label === 'Manage data…').findByType('button');
  await act(async () => { button.props.onClick(); });
  assert.deepEqual(calls, ['manage']);
});
