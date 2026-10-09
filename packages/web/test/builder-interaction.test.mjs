import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { GridLayout } from 'react-grid-layout';
import { AuthorCanvas } from '../build/test/Author.js';
import { activeSheet, authorReducer, emptyDraft, loadDraft, saveDraft } from '../build/test/authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { createApiClient } from '../build/test/api-client.js';
import { importBundle, exportBundle } from '../build/test/bundle-authoring.js';

async function mount(t, initial = emptyDraft(), client) {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  let draft, renderer, saved;
  const store = { getItem: () => saved ?? null, setItem: (_, value) => { saved = value; } };
  function Harness() {
    const [state, dispatch] = useReducer(authorReducer, initial);
    draft = state; saveDraft(state, () => store);
    return createElement(AuthorCanvas, { draft: state, dispatch, client });
  }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const find = (type, predicate) => renderer.root.findAllByType(type).find(n => predicate(n.props));
  const button = label => find('button', p => p['aria-label'] === label || p.children === label);
  return { state: () => draft, store, renderer, find, button,
    click: async label => { const node = button(label); assert.ok(node, label); await act(() => node.props.onClick({ stopPropagation() {} })); },
    change: async (node, value) => { assert.ok(node); await act(() => node.props.onChange({ target: { value, checked: value } })); },
    submit: async node => { assert.ok(node); await act(() => node.props.onSubmit({ preventDefault() {} })); },
  };
}
const selected = d => activeSheet(d).visuals.find(v => v.id === activeSheet(d).selectedId);

test('empty wells select the destination and Data assignment creates a bar, then edits it in place', async t => {
  const ui = await mount(t);
  await ui.click('Select GROUP/COLOR well');
  assert.equal(ui.button('Select GROUP/COLOR well').props['aria-pressed'], true);
  assert.equal(activeSheet(ui.state()).visuals.length, 0);
  const hint = ui.find('p', p => p.className === 'field-hint');
  assert.ok(hint.props.children.includes('Group/Color'));
  await ui.click('Assign category');
  assert.equal(selected(ui.state()).kind, 'bar');
  assert.equal(selected(ui.state()).dimension, 'category');
  assert.deepEqual(selected(ui.state()).measures, []);
  await ui.click('Assign profit');
  assert.equal(activeSheet(ui.state()).visuals.length, 1);
  assert.deepEqual(selected(ui.state()).measures, ['profit']);
  await ui.click('Remove category from Group/Color');
  assert.equal(selected(ui.state()).dimension, null);
  await ui.click('Assign region');
  assert.deepEqual(loadDraft(() => ui.store).draft, ui.state());
  await ui.click('Remove Visual 1');
  assert.ok(ui.button('Select VALUE well'));
  await ui.click('Select VALUE well');
  await ui.click('Assign revenue');
  assert.equal(selected(ui.state()).dimension, null);
  assert.deepEqual(selected(ui.state()).measures, ['revenue']);
});

test('empty dataset fields retain BOOLEAN refusal and tooltip while valid fields create a visual', async t => {
  const ui = await mount(t, { ...emptyDraft(), dataset: { id: 'custom', name: 'Custom', columns: [{ name: 'enabled', type: 'BOOLEAN' }, { name: 'amount', type: 'DECIMAL' }] } });
  assert.equal(ui.button('Assign enabled').props.disabled, true);
  assert.match(ui.button('Assign enabled').props.title, /convert to text or number/);
  assert.equal(ui.button('Assign amount').props.disabled, false);
  await ui.click('Assign amount');
  assert.deepEqual(selected(ui.state()).measures, ['amount']);
});

test('offline pivot toggles persist through authoring, draft reload and bundle import/edit/export', async t => {
  let initial = authorReducer(emptyDraft(), { type: 'add', kind: 'pivot' });
  initial = authorReducer(initial, { type: 'assign', well: 'rows', field: 'category' });
  initial = authorReducer(initial, { type: 'display', property: 'subtotals', value: true });
  initial = authorReducer(initial, { type: 'add', kind: 'pivot' });
  const ui = await mount(t, initial);
  const target = () => activeSheet(ui.state()).visuals[0];
  await ui.click('Collapse row group East');
  assert.deepEqual(target().formatting.pivot.collapsedRowGroups, [['East']]);
  assert.equal(selected(ui.state()).formatting, undefined);
  assert.deepEqual(activeSheet(loadDraft(() => ui.store).draft).visuals[0].formatting, target().formatting);
  const imported = importBundle(exportBundle(ui.state()));
  const edited = authorReducer(imported, { type: 'pivot-row-group', id: target().id, path: ['West'], collapsed: true });
  assert.deepEqual(activeSheet(importBundle(exportBundle(edited))).visuals[0].formatting.pivot.collapsedRowGroups, [['East'], ['West']]);
  await ui.click('Expand row group East');
  assert.deepEqual(target().formatting.pivot.collapsedRowGroups, []);
});

test('pivot collapse in a live preview does not issue another query', async t => {
  let initial = authorReducer(emptyDraft(), { type: 'add', kind: 'pivot' });
  initial = authorReducer(initial, { type: 'assign', well: 'rows', field: 'category' });
  initial = authorReducer(initial, { type: 'display', property: 'subtotals', value: true });
  let queries = 0;
  const client = { queryDataset: async () => { queries++; return { rows: [{ region: 'East', category: 'A', revenue: 100 }, { region: 'East', category: 'B', revenue: 300 }] }; } };
  const ui = await mount(t, initial, client);
  const before = queries; // The properties panel also requests distinct filter values.
  assert.ok(before > 0);
  await ui.click('Collapse row group East');
  await ui.click('Expand row group East');
  assert.equal(queries, before);
});

test('gallery ADD, field buttons, well pickers and pill removal change the live editor state', async t => {
  const ui = await mount(t);
  assert.equal(ui.button('Assign region').props.disabled, false);
  assert.equal(activeSheet(ui.state()).visuals.length, 0);
  await ui.click('Pivot');
  await ui.submit(ui.find('form', p => p.className === 'add-visual'));
  assert.equal(selected(ui.state()).kind, 'pivot');
  assert.deepEqual(selected(ui.state()).measures, []);
  await ui.click('Assign revenue');
  await ui.change(ui.find('select', p => p['aria-label'] === 'Assign Columns'), 'category');
  await ui.click('Assign profit');
  assert.deepEqual(selected(ui.state()).columns, ['category']);
  assert.deepEqual(selected(ui.state()).measures, ['revenue', 'profit']);
  await ui.click('Remove category from Columns');
  await ui.click('Remove revenue from Values');
  assert.deepEqual(selected(ui.state()).columns, []);
  assert.deepEqual(selected(ui.state()).measures, ['profit']);
  await ui.change(ui.find('input', p => p.type === 'search'), 'prof');
  assert.ok(ui.button('Assign profit')); assert.equal(ui.button('Assign revenue'), undefined);
  await ui.change(ui.find('select', p => p.value === 'pivot' && !p['aria-label']), 'kpi');
  assert.equal(selected(ui.state()).kind, 'kpi');
  assert.deepEqual(buildAuthorQuery(selected(ui.state())).dimensions, []);
});

test('grid drag and resize callbacks save geometry, preserve gaps and isolate sheets', async t => {
  const initial = authorReducer(emptyDraft(), { type: 'add', kind: 'bar' });
  const ui = await mount(t, initial);
  const drag = [{ i: 'visual-1', x: 5, y: 7, w: 6, h: 8 }];
  await act(() => ui.renderer.root.findByType(GridLayout).props.onDragStop(drag));
  assert.deepEqual(activeSheet(ui.state()).layout, drag);
  const resize = [{ ...drag[0], w: 7, h: 11 }];
  await act(() => ui.renderer.root.findByType(GridLayout).props.onResizeStop(resize));
  await ui.click('+ Add sheet');
  assert.deepEqual(activeSheet(ui.state()).layout, []);
  assert.deepEqual(ui.state().sheets[0].layout, resize);
  assert.deepEqual(loadDraft(() => ui.store).draft, ui.state());
  await ui.click('Rename sheet');
  await ui.change(ui.find('input', p => p.value === 'Sheet 2'), 'Detail');
  await ui.submit(ui.find('form', p => p.className === 'rename-sheet'));
  assert.equal(activeSheet(ui.state()).name, 'Detail');
  await ui.click('Delete sheet');
  assert.equal(ui.state().activeSheetId, 'sheet-1');
  assert.deepEqual(activeSheet(ui.state()).layout, resize);
  assert.equal(ui.button('Delete sheet').props.disabled, true);
});

test('calculated field dialog validates, creates a pill and submits expression through the live query client', async t => {
  const requests = [];
  const client = createApiClient('/', async (_, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    return Response.json({ columns: [...body.dimensions.map(d => ({ name: d.fieldId, type: 'string' })), ...body.measures.map(m => ({ name: m.fieldId, type: 'number' }))], rows: [] });
  });
  const ui = await mount(t, authorReducer(emptyDraft(), { type: 'add', kind: 'kpi' }), client);
  await ui.click('+ Calculated field');
  const dialogForm = () => ui.renderer.root.findByType('dialog').findByType('form');
  await ui.submit(dialogForm());
  assert.ok(ui.find('p', p => p.role === 'alert'));
  await ui.change(ui.find('input', p => p.autoFocus), 'Net');
  await ui.change(ui.find('textarea', () => true), '{revenue} - {profit}');
  await ui.submit(dialogForm());
  assert.equal(ui.renderer.root.findAllByType('dialog').length, 0);
  await ui.click('Assign Net');
  const request = requests.at(-1);
  assert.deepEqual(request.calculatedFields, [{ name: 'Net', expression: '{revenue} - {profit}' }]);
  assert.deepEqual(request.measures, [{ fieldId: 'Net', columnName: 'Net', aggregation: 'SUM' }]);
  assert.ok(ui.button('Remove Net from Values'));
  await ui.click('Remove Net from Values');
  assert.equal(buildAuthorQuery(selected(ui.state()), ui.state().calculatedFields), null);
});

test('filter checkboxes, select-none and removable pills apply static filters to just the selected visual', async t => {
  const ui = await mount(t, authorReducer(emptyDraft(), { type: 'add', kind: 'bar' }));
  await ui.click('Interaction');
  const group = ui.find('div', p => p['aria-label'] === 'region values');
  await ui.change(group.findByType('input'), false);
  assert.deepEqual(buildAuthorQuery(selected(ui.state())).filters, [{ columnName: 'region', values: [] }]);
  await ui.click('Select all');
  assert.deepEqual(buildAuthorQuery(selected(ui.state())).filters, [{ columnName: 'region', values: ['East'] }]);
  await ui.click('Remove region filter');
  assert.deepEqual(buildAuthorQuery(selected(ui.state())).filters, []);
});

test('Small multiples placeholder routes Data clicks and pickers to a saved removable pill', async t => {
  const ui = await mount(t);
  await ui.click('Select SMALL MULTIPLES well');
  await ui.click('Assign category');
  assert.equal(selected(ui.state()).dimension, null);
  assert.deepEqual(selected(ui.state()).smallMultiples, ['category']);
  assert.deepEqual(loadDraft(() => ui.store).draft, ui.state());
  await ui.change(ui.find('select', p => p['aria-label'] === 'Assign Small multiples'), 'order_date');
  assert.deepEqual(selected(ui.state()).smallMultiples, ['order_date']);
  await ui.click('Remove order_date from Small multiples');
  assert.ok(ui.button('Select SMALL MULTIPLES well'));
  assert.ok(ui.renderer.root.findAll(n => n.props.className === 'author-visual-empty').length);
  await ui.click('Select VALUE well');
  await ui.click('Assign revenue');
  assert.equal(ui.button('Select VALUE well'), undefined);
  await ui.click('Remove revenue from Value');
  assert.ok(ui.button('Select VALUE well'));
});

test('field drag-and-drop assigns the selected well and refuses external text and incompatible fields', async t => {
  const ui = await mount(t);
  const drag = { types: [], data: {}, setData(type, value) { this.types.push(type); this.data[type] = value; }, getData(type) { return this.data[type] ?? ''; } };
  await act(() => ui.button('Assign revenue').props.onDragStart({ dataTransfer: drag }));
  assert.equal(drag.effectAllowed, 'copy');
  const well = label => ui.renderer.root.findAllByType('fieldset').find(n => n.findByType('legend').children.includes(label));
  let prevented = false;
  await act(() => well('VALUE').props.onDragOver({ dataTransfer: drag, preventDefault() { prevented = true; } }));
  assert.equal(prevented, true);
  await act(() => well('VALUE').props.onDrop({ dataTransfer: drag, preventDefault() {}, stopPropagation() {} }));
  assert.deepEqual(selected(ui.state()).measures, ['revenue']);
  assert.equal(ui.button('Select VALUE well'), undefined);
  await act(() => well('SMALL MULTIPLES').props.onDrop({ dataTransfer: drag, preventDefault() {}, stopPropagation() {} }));
  assert.equal(selected(ui.state()).smallMultiples, undefined);
  const before = ui.state();
  await act(() => well('GROUP/COLOR').props.onDrop({ dataTransfer: { types: ['text/plain'], getData: () => 'category' }, preventDefault() { assert.fail('External drag must be ignored'); } }));
  assert.equal(ui.state(), before);
  await act(() => ui.button('Assign order_date').props.onDragStart({ dataTransfer: drag }));
  await act(() => well('SMALL MULTIPLES').props.onDrop({ dataTransfer: drag, preventDefault() {}, stopPropagation() {} }));
  assert.deepEqual(selected(ui.state()).smallMultiples, ['order_date']);
  assert.equal(ui.button('Select SMALL MULTIPLES well'), undefined);
});
