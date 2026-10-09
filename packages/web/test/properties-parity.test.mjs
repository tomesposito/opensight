import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { CardTitle, CardStyle } from '../build/test/PropertiesSections.js';
import { activeSheet, authorReducer, emptyDraft, parseDraft } from '../build/test/authoring.js';
import { compileVisual } from '../build/test/compiler.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';

const selected = draft => activeSheet(draft).visuals.find(v => v.id === activeSheet(draft).selectedId);
async function mount(t, Component, kind = 'pie') {
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, state;
  const initial = authorReducer(authorReducer(emptyDraft(), { type: 'add', kind }), { type: 'add', kind });
  const untouched = structuredClone(activeSheet(initial).visuals[0]);
  function Harness() {
    const [draft, dispatch] = useReducer(authorReducer, initial); state = draft;
    return createElement(Component, { visual: selected(draft), dispatch });
  }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  return {
    root: renderer.root,
    visual: () => selected(state),
    compile: () => compileVisual({ ...buildAuthorVisual(selected(state)), rows: [{ region: 'East', category: 'A', revenue: 12.345 }] }),
    verifySaved() { assert.deepEqual(parseDraft(JSON.stringify(state)), state); assert.deepEqual(activeSheet(state).visuals[0], untouched); },
    async change(label, value, type = 'input') {
      const control = renderer.root.findAllByType('label').find(n => n.children.includes(label)).findByType(type);
      assert.notEqual(control.props.disabled, true);
      await act(() => control.props.onChange({ target: { value, checked: value } }));
    },
  };
}
function unavailable(root, label, reason) {
  const group = root.findByProps({ 'aria-label': label, disabled: true });
  const note = root.findByProps({ id: group.props['aria-describedby'] });
  assert.match(note.props.children, reason);
  for (const control of group.findAll(n => ['input', 'select', 'textarea', 'button'].includes(n.type))) {
    assert.equal(control.props.onChange, undefined);
    assert.equal(control.props.onClick, undefined);
  }
  return group;
}

test('CARD TITLE edits survive storage, affect compilation, and leave the other visual unchanged', async t => {
  const ui = await mount(t, CardTitle);
  await ui.change('Edit title', 'Regional revenue');
  await ui.change('Edit subtitle', 'Synthetic sample');
  await ui.change('Title font size', '24');
  await ui.change('Show title', false);
  await ui.change('Show subtitle', false);
  const model = ui.compile().model;
  assert.equal(model.title, 'Regional revenue'); assert.equal(model.subtitle, 'Synthetic sample');
  assert.equal(model.titleVisible, false); assert.equal(model.subtitleVisible, false);
  assert.equal(model.formatting.titleFontSize, 24);
  unavailable(ui.root, 'Alt text', /Custom alt text is not supported/);
  ui.verifySaved();
});


test('CARD STYLE shows reference controls without handlers or persisted fake settings', async t => {
  const ui = await mount(t, CardStyle);
  const before = structuredClone(ui.visual());
  const group = unavailable(ui.root, 'Card style controls', /not supported yet.*reference defaults, not applied/);
  for (const label of ['Background opacity (%)', 'Border opacity (%)', 'Border width', 'Selection opacity (%)']) assert.ok(group.findByProps({ 'aria-label': label }));
  assert.equal(group.findAllByType('label').filter(n => n.children.includes('Loading animation')).length, 1);
  assert.deepEqual(ui.visual(), before); ui.verifySaved();
});
