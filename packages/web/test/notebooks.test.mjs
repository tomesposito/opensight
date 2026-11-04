import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { Notebooks } from '../build/test/Notebooks.js';
import { notebookVisual } from '../build/test/notebooks.js';
import { compileVisual } from '../build/test/compiler.js';
import { AccessProvider } from '../build/test/access.js';
import { parseRoute, routeHash, routeProblem } from '../build/test/app-navigation.js';
import { createApiClient } from '../build/test/api-client.js';
const data = { columns: [{ name: 'region', type: 'STRING' }, { name: 'amount', type: 'DECIMAL' }], rows: [{ region: 'East', amount: 2 }, { region: 'East', amount: 4 }, { region: 'West', amount: 8 }], rowCount: 3, truncated: false };
for (const type of ['bar', 'line', 'pie', 'table']) for (const [aggregation, east] of [['SUM', 6], ['AVG', 3], ['COUNT', 2], ['MIN', 2], ['MAX', 4]]) test(`notebook visuals: ${type}/${aggregation} uses shared evaluation and compiler`, () => {
  const visual = notebookVisual({ id: 'v', kind: 'visual', sourceCellId: 's', chart: { type, dimension: 'region', measure: 'amount', aggregation } }, data);
  const compiled = compileVisual(visual);
  assert.equal(compiled.state, 'ready'); assert.equal(compiled.model.kind, type);
  assert.ok(compiled.table.rows.some(row => row[0] === 'East' && row[1] === east), JSON.stringify(compiled.table));
});
const sql = { id: 's', kind: 'sql', text: 'SELECT * FROM sales', datasetRefs: ['sales'] };
const notebook = { id: 'n', namespaceId: 'default', name: 'Notebook', published: false, ownerId: 'author', cells: [sql], parameters: [{ name: 'minimum', type: 'number', default: 0 }], version: 1, snapshots: [], canEdit: true, canManage: true };
const result = { id: 'r', notebookId: 'n', notebookVersion: 1, executedBy: 'author', executedAt: '2026-11-04T00:00:00Z', results: [{ cellId: 's', kind: 'sql', executedAt: '2026-11-04T00:00:00Z', elapsedMs: 1, data }] };
const button = (ui, text) => ui.root.findAllByType('button').find(b => b.children.join('') === text);
const input = (ui, label) => ui.root.findAllByType('label').find(l => l.children[0] === label).findByType('input');
async function mount(t, props, role = 'author') {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let ui; await act(async () => { ui = create(createElement(AccessProvider, { access: { mode: 'hosted', session: { id: role, role } } }, createElement(Notebooks, { onOpen() {}, ...props }))); });
  t.after(async () => { await act(() => ui.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = previous; }); return ui;
}
const client = extra => ({ getNotebook: async () => structuredClone(notebook), notebookDatasets: async () => ({ datasets: [{ id: 'sales', columns: data.columns }] }), notebookRuns: async () => ({ runs: [] }), ...extra });
test('notebook UI: saves edited SQL, binds typed values and saves timestamped snapshots', async t => {
  const calls = [];
  const api = client({ updateNotebook: async (id, body) => { calls.push(['save', id, body]); return { ...notebook, ...body, version: 2 }; }, runNotebook: async (...args) => { calls.push(['run', ...args]); return result; }, snapshotNotebookCell: async (...args) => { calls.push(['snapshot', ...args]); } });
  const ui = await mount(t, { id: 'n', client: api });
  await act(() => ui.root.findByType('textarea').props.onChange({ target: { value: 'SELECT region, amount FROM sales' } }));
  assert.equal(button(ui, 'Run all').props.disabled, true);
  await act(async () => button(ui, 'Save notebook').props.onClick());
  assert.equal(calls[0][2].cells[0].text, 'SELECT region, amount FROM sales'); assert.equal(calls[0][2].version, 1);
  await act(() => input(ui, 'minimum').props.onChange({ target: { value: '2' } }));
  await act(async () => button(ui, 'Run all').props.onClick());
  assert.deepEqual(calls[1], ['run', 'n', { minimum: 2 }, undefined]);
  assert.match(JSON.stringify(ui.toJSON()), /Executed as /);
  await act(async () => button(ui, 'Save result as dataset snapshot').props.onClick()); assert.deepEqual(calls[2], ['snapshot', 'n', 's']);
});
test('notebook UI: published readers only run and see named denials', async t => {
  const ui = await mount(t, { id: 'n', client: client({ getNotebook: async () => ({ ...notebook, canEdit: false, canManage: false, published: true }), runNotebook: async () => ({ ...result, results: [{ cellId: 's', kind: 'sql', error: { code: 'NOTEBOOK_DATASET_ACCESS_DENIED', message: 'No dataset access.' } }] }) }) }, 'reader');
  assert.equal(ui.root.findAllByType('textarea').length, 0); assert.equal(button(ui, 'Edit notebook'), undefined); assert.equal(button(ui, 'Save notebook'), undefined);
  await act(async () => button(ui, 'Run all').props.onClick()); assert.match(JSON.stringify(ui.toJSON()), /NOTEBOOK_DATASET_ACCESS_DENIED/);
  assert.equal(button(ui, 'Save result as dataset snapshot'), undefined);
});
test('notebook UI: draft cells reorder, parameters edit, publish is an explicit save', async t => {
  const calls = [], ui = await mount(t, { id: 'n', client: client({ updateNotebook: async (id, value) => { calls.push(value); return { ...notebook, ...value, version: 2 }; } }) });
  await act(() => button(ui, 'Add markdown cell').props.onClick());
  await act(() => ui.root.findAllByType('button').find(b => b.props['aria-label'] === 'Move cell 2 up').props.onClick());
  await act(() => button(ui, 'Add parameter').props.onClick());
  const publish = ui.root.findAllByType('input').find(i => i.props.type === 'checkbox' && i.parent.children.some(c => typeof c === 'string' && c.includes('Publish')));
  await act(() => publish.props.onChange({ target: { checked: true } }));
  await act(async () => button(ui, 'Save notebook').props.onClick());
  assert.equal(calls[0].cells[0].kind, 'markdown'); assert.equal(calls[0].parameters.length, 2); assert.equal(calls[0].published, true);
});
test('notebook UI: static demo is honest and reader routes remain reachable', async t => {
  const ui = await mount(t, {}); assert.match(JSON.stringify(ui.toJSON()), /static demo cannot store or run notebooks/); assert.equal(button(ui, 'Run all'), undefined);
  assert.equal(routeProblem({ mode: 'hosted', session: { role: 'reader' } }, 'notebooks'), undefined);
  const route = { page: 'notebooks', notebookId: 'notebook-1' }; assert.deepEqual(parseRoute(routeHash(route)), route);
});
test('notebook API client preserves structured payloads and named errors', async () => {
  const calls = [], api = createApiClient('', async (url, init) => { calls.push([url, init]); return new Response(JSON.stringify({ errorCode: 'NOTEBOOK_DATASET_ACCESS_DENIED', Message: 'Denied' }), { status: 403 }); });
  await assert.rejects(() => api.runNotebook('n', { minimum: 2 }, 's'), /NOTEBOOK_DATASET_ACCESS_DENIED/);
  assert.deepEqual(JSON.parse(calls[0][1].body), { parameters: { minimum: 2 }, cellId: 's' });
});
