import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { AuthorCanvas } from '../build/test/Author.js';
import { VisualCard } from '../build/test/VisualCard.js';
import { HierarchyEditor } from '../build/test/HierarchyEditor.js';
import { activeSheet, authorReducer, emptyDraft } from '../build/test/authoring.js';
async function mount(t, initial, editor = false) {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, draft;
  function Harness() {
    const [state, dispatch] = useReducer(authorReducer, initial); draft = state;
    return createElement(editor ? HierarchyEditor : AuthorCanvas, { draft: state, dispatch, ...(editor ? { visual: activeSheet(state).visuals[0] } : {}) });
  }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  return { renderer, draft: () => draft, cards: () => renderer.root.findAllByType(VisualCard),
    click: async label => { const button = renderer.root.findAllByType('button').find(b => b.props.children === label); assert.ok(button, label); await act(() => button.props.onClick({ stopPropagation() {} })); },
  };
}
test('table row action recomputes other cards, toggles off and resets through actual UI controls', async t => {
  let d = authorReducer(emptyDraft(), { type: 'add', kind: 'table' });
  d = authorReducer(d, { type: 'filter-actions', actions: [{ id: 'a', name: 'Filter', sourceField: 'region', targets: 'all', mappings: {} }] });
  d = authorReducer(d, { type: 'add', kind: 'bar' });
  const ui = await mount(t, d);
  const clickWest = async () => { const row = ui.cards()[0].findAllByType('tr').find(row => row.props.onClick && row.findAllByType('button').some(b => b.props.children === 'West')); assert.ok(row); await act(() => row.props.onClick()); };
  await clickWest(); assert.deepEqual(ui.cards()[1].props.visual.rows, [{ region: 'West', revenue: 400 }]);
  assert.equal(ui.cards()[0].props.visual.rows.length, 2);
  await clickWest(); assert.equal(ui.cards()[1].props.visual.rows.length, 2);
  await clickWest(); await ui.click('Reset actions'); assert.equal(ui.cards()[1].props.visual.rows.length, 2);
  await ui.click('+ Add sheet'); assert.equal(ui.cards().length, 0);
});
test('drill mode, chart selection, up and breadcrumb controls recompute the rendered grain', async t => {
  let d = authorReducer(emptyDraft(), { type: 'add', kind: 'bar' });
  d = authorReducer(d, { type: 'hierarchy', hierarchy: { id: 'dates', name: 'Order date', levels: ['YEAR','QUARTER','MONTH'].map(granularity => ({ columnName: 'order_date', granularity })) } });
  const ui = await mount(t, d);
  assert.deepEqual(ui.cards()[0].props.visual.rows, [{ year: '2025', revenue: 900 }]);
  await ui.click('Drill down'); await act(() => ui.cards()[0].props.interaction.onSelect({ values: { order_date: '2025' } }));
  assert.deepEqual(ui.cards()[0].props.visual.rows, [{ quarter: '2025-Q1', revenue: 650 }, { quarter: '2025-Q2', revenue: 250 }]);
  await ui.click('Drill down'); await act(() => ui.cards()[0].props.interaction.onSelect({ values: { order_date: '2025-Q1' } }));
  assert.deepEqual(ui.cards()[0].props.visual.rows, [{ month: '2025-01', revenue: 600 }, { month: '2025-03', revenue: 50 }]);
  assert.ok(ui.renderer.root.findAllByType('button').some(b => String(b.props.children).includes('2025-Q1')));
  await ui.click('Drill up'); assert.equal(ui.cards()[0].props.visual.rows[0].quarter, '2025-Q1');
  await ui.click('Order date'); assert.equal(ui.cards()[0].props.visual.rows[0].year, '2025');
});
test('builder hierarchy shortcut and save define ordered levels without persisting a drill selection', async t => {
  const ui = await mount(t, authorReducer(emptyDraft(), { type: 'add', kind: 'pivot' }), true);
  await ui.click('Year → Quarter → Month'); await ui.click('Save hierarchy');
  assert.deepEqual(activeSheet(ui.draft()).visuals[0].hierarchy.levels.map(l => l.granularity), ['YEAR','QUARTER','MONTH']);
  assert.equal(activeSheet(ui.draft()).visuals[0].interactionFilters, undefined);
  await ui.click('Remove hierarchy'); assert.equal(activeSheet(ui.draft()).visuals[0].hierarchy, undefined);
});
