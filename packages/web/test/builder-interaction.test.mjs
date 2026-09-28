import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { GridLayout } from 'react-grid-layout';
import { AuthorCanvas } from '../build/test/Author.js';
import { activeSheet, authorReducer, emptyDraft, loadDraft, saveDraft } from '../build/test/authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { createApiClient } from '../build/test/api-client.js';

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

test('gallery ADD, field buttons, well pickers and pill removal change the live editor state', async t => {
  const ui = await mount(t);
  assert.equal(ui.button('Assign region').props.disabled, true);
  assert.equal(activeSheet(ui.state()).visuals.length, 0);
  await ui.click('Pivot');
  await ui.submit(ui.find('form', p => p.className === 'add-visual'));
  assert.equal(selected(ui.state()).kind, 'pivot');
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
  await ui.click('+ CALCULATED FIELD');
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
