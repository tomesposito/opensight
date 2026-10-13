import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { CardTitle, CardStyle, CardLayout, MultiplesOptions, GroupColorOptions, LegendOptions, DataLabelsOptions } from '../build/test/PropertiesSections.js';
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


test('CARD LAYOUT exposes disabled 24px reference padding with an accessible reason', async t => {
  const ui = await mount(t, CardLayout);
  const group = unavailable(ui.root, 'Card layout controls', /Per-card padding is not supported/);
  assert.equal(group.findByType('select').props.defaultValue, '24px');
  assert.equal(ui.visual().formatting, undefined); ui.verifySaved();
});


test('Multiples Options provides the complete disabled layout and typography controls', async t => {
  const ui = await mount(t, MultiplesOptions);
  const group = unavailable(ui.root, 'Multiples options controls', /Faceted preview and panel styling are not supported/);
  const labels = group.findAllByType('label').map(n => n.children.filter(c => typeof c === 'string').join(''));
  assert.deepEqual(labels, ['Visible rows', 'Visible columns', 'Number of panels', 'Panel title', 'Title options', 'Panel border', 'Border options', 'Panel gutter', 'Panel background']);
  assert.equal(group.findByProps({ placeholder: '20 (Default)' }).type, 'input');
  for (const action of ['bold', 'italic', 'underline', 'align left', 'align center', 'align right']) assert.ok(group.findByProps({ 'aria-label': `Panel title ${action}` }));
  assert.equal(ui.visual().smallMultiples, undefined); ui.verifySaved();
});


test('Group/Color field name updates the compiled title and table without renaming source data', async t => {
  const ui = await mount(t, GroupColorOptions);
  const sourceField = ui.visual().dimension;
  await ui.change('Field name', 'Territory');
  assert.equal(ui.visual().dimension, sourceField);
  assert.match(ui.compile().model.title, /by Territory$/);
  assert.equal(ui.compile().table.columns[0], 'Territory');
  unavailable(ui.root, 'Group title controls', /separate Group\/Color title.*not supported/);
  unavailable(ui.root, 'Group sort controls', /Sort editing is not supported/);
  unavailable(ui.root, 'Slice limit controls', /all supplied result rows are shown/);
  ui.verifySaved();
  await ui.change('Field name', '');
  assert.equal(ui.compile().table.columns[0], sourceField); ui.verifySaved();
});


test('Legend visibility and every position compile, persist, and retain unsupported title/value controls', async t => {
  const ui = await mount(t, LegendOptions);
  assert.equal(ui.root.findAllByType('select')[0].props.value, 'AUTO');
  for (const position of ['AUTO', 'TOP', 'BOTTOM', 'LEFT', 'RIGHT']) {
    await ui.change('Legend position', position, 'select');
    const option = ui.compile().option;
    assert.equal(option.legend[position === 'AUTO' ? 'bottom' : position.toLowerCase()], 0);
    ui.verifySaved();
  }
  await ui.change('Show legend', false); assert.equal(ui.compile().option.legend.show, false);
  await ui.change('Show legend', true); assert.equal(ui.compile().option.legend.show, true);
  unavailable(ui.root, 'Legend title controls', /not supported/);
  unavailable(ui.root, 'Legend value controls', /Font and color follow the analysis theme/);
  ui.verifySaved();
});


test('Data labels visibility and precision reach the compiler while content/layout controls stay disabled', async t => {
  const ui = await mount(t, DataLabelsOptions);
  await ui.change('Show data labels', true);
  await ui.change('Data label decimal places', '3');
  assert.equal(ui.compile().option.series[0].label.show, true);
  assert.equal(ui.compile().option.series[0].label.formatter({ name: 'A', percent: 12.3456 }), 'A: 12.346%');
  await ui.change('Data label decimal places', '-1');
  assert.equal(ui.visual().formatting.decimalPlaces, 3, 'invalid precision is rejected');
  await ui.change('Show data labels', false); assert.equal(ui.compile().option.series[0].label.show, false);
  await ui.change('Data label decimal places', ''); assert.equal(ui.visual().formatting.decimalPlaces, undefined);
  const group = unavailable(ui.root, 'Data label content and styling controls', /not supported yet/);
  for (const label of ['Category', 'Metric', 'Allow labels to overlap']) assert.ok(group.findAllByType('label').some(n => n.children.includes(label)));
  assert.equal(group.findByProps({ 'aria-label': 'Data label position' }).props.defaultValue, 'Outside');
  ui.verifySaved();
});
