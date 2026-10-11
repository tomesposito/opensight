import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { activeSheet, authorReducer, emptyDraft } from '../build/test/authoring.js';
import { ActionPanel, ActionsSection, ACTION_LIMIT } from '../build/test/ActionEditor.js';

const tableDraft = () => authorReducer(emptyDraft(), { type: 'add', kind: 'table' });
// t.after hooks run in registration order, so nested mounts share one refcounted stub.
let stubDepth = 0;
const stubOriginal = { window: undefined, act: undefined };
async function mountPanel(t, initial, props = {}) {
  if (!stubDepth) { stubOriginal.window = globalThis.window; stubOriginal.act = globalThis.IS_REACT_ACT_ENVIRONMENT; }
  stubDepth++;
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, draft, closed = 0;
  function Harness() {
    const [state, dispatch] = useReducer(authorReducer, initial); draft = state;
    const sheet = activeSheet(state);
    const visual = sheet.visuals.find(v => v.id === sheet.selectedId) ?? sheet.visuals[0];
    return createElement(ActionPanel, { draft: state, visual, dispatch, onClose: () => { closed++; }, ...props });
  }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => {
    await act(() => renderer.unmount());
    if (--stubDepth === 0) { globalThis.window = stubOriginal.window; globalThis.IS_REACT_ACT_ENVIRONMENT = stubOriginal.act; }
  });
  const label = name => renderer.root.findAllByType('label').find(l => l.children[0] === name);
  return {
    renderer, draft: () => draft, closed: () => closed,
    change: async (name, value, kind = 'input') => { const n = label(name); assert.ok(n, name); await act(() => n.findByType(kind).props.onChange({ target: { value, checked: value } })); },
    radio: async (name, value) => { const input = renderer.root.findAllByType('input').find(i => i.props.type === 'radio' && i.props.name === name && i.props.value === value); assert.ok(input, `${name}=${value}`); await act(() => input.props.onChange()); },
    click: async text => { const b = renderer.root.findAllByType('button').find(b => b.props.children === text); assert.ok(b, text); await act(() => b.props.onClick()); },
  };
}

test('new action panel stages a URL action with menu activation and saves it', async t => {
  const ui = await mountPanel(t, tableDraft());
  await ui.change('Action name', 'Drill to details');
  await ui.change('Action type', 'url', 'select');
  await ui.change('URL template', 'https://example.com/{region}');
  await ui.radio('action-activation', 'menu');
  await ui.click('Save');
  assert.equal(ui.closed(), 1);
  const [action] = activeSheet(ui.draft()).visuals[0].urlActions;
  assert.equal(action.name, 'Drill to details');
  assert.equal(action.activation, 'menu');
  assert.equal(action.urlTemplate, 'https://example.com/{region}');
  assert.equal(activeSheet(ui.draft()).visuals[0].filterActions, undefined);
});

test('editing an action replaces it in place and keeps the other kinds untouched', async t => {
  let d = authorReducer(tableDraft(), { type: 'filter-actions', actions: [{ id: 'action-1', name: 'Filter', sourceField: 'region', targets: 'all', mappings: {} }] });
  const ui = await mountPanel(t, d, { actionId: 'action-1' });
  await ui.change('Action name', 'Renamed');
  await ui.radio('action-activation', 'menu');
  await ui.click('Save');
  const visual = activeSheet(ui.draft()).visuals[0];
  assert.equal(visual.filterActions.length, 1);
  assert.equal(visual.filterActions[0].name, 'Renamed');
  assert.equal(visual.filterActions[0].activation, 'menu');
});

test('delete removes the action and close discards staged edits', async t => {
  let d = authorReducer(tableDraft(), { type: 'filter-actions', actions: [{ id: 'action-1', name: 'Filter', sourceField: 'region', targets: 'all', mappings: {} }] });
  const deleter = await mountPanel(t, d, { actionId: 'action-1' });
  await deleter.click('Delete');
  assert.equal(deleter.closed(), 1);
  assert.equal(activeSheet(deleter.draft()).visuals[0].filterActions.length, 0);
  const closer = await mountPanel(t, d, { actionId: 'action-1' });
  await closer.change('Action name', 'Discarded');
  await closer.click('Close');
  assert.equal(closer.closed(), 1);
  assert.equal(activeSheet(closer.draft()).visuals[0].filterActions[0].name, 'Filter');
});

test('filter scope and target visuals stage selected fields and targets', async t => {
  let d = tableDraft();
  d = authorReducer(d, { type: 'add', kind: 'bar' });
  const ui = await mountPanel(t, d);
  await ui.radio('filter-scope', 'selected');
  const regionLabel = ui.renderer.root.findAllByType('label').find(l => l.children.includes('region'));
  assert.ok(regionLabel);
  const regionBox = regionLabel.findByType('input');
  assert.equal(regionBox.props.checked, true);
  await act(() => regionBox.props.onChange({ target: { checked: false } }));
  await ui.radio('filter-targets', 'selected');
  await ui.click('Save');
  const sheet = activeSheet(ui.draft());
  const saved = sheet.visuals.find(v => v.id === sheet.selectedId);
  const [action] = saved.filterActions;
  assert.deepEqual(action.scopeFields, []);
  assert.deepEqual(action.targets, []);
});

test('actions section lists actions and disables new action at the limit', async t => {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let opened;
  const visual = activeSheet(tableDraft()).visuals[0];
  visual.filterActions = [{ id: 'action-1', name: 'Filter', sourceField: 'region', targets: 'all', mappings: {} }];
  let renderer;
  await act(() => { renderer = create(createElement(ActionsSection, { visual, onOpenPanel: id => { opened = id; } })); });
  const rows = renderer.root.findAllByProps({ className: 'action-row' });
  assert.equal(rows.length, 1);
  await act(() => rows[0].props.onClick());
  assert.equal(opened, 'action-1');
  const crowded = { ...visual, filterActions: Array.from({ length: ACTION_LIMIT }, (_, i) => ({ id: `a${i}`, name: `A${i}`, sourceField: 'region', targets: 'all', mappings: {} })) };
  await act(() => { renderer.update(createElement(ActionsSection, { visual: crowded, onOpenPanel() {} })); });
  const button = renderer.root.findAllByType('button').find(b => b.props.children === `Action limit reached (${ACTION_LIMIT})`);
  assert.ok(button); assert.equal(button.props.disabled, true);
  await act(() => renderer.unmount());
  globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
});
