import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { CardTitle, CardStyle, CardLayout, MultiplesOptions, GroupColorOptions, LegendOptions, DataLabelsOptions } from '../build/test/PropertiesSections.js';
import { activeSheet, authorReducer, defaultMultiplesOptions, emptyDraft, parseDraft } from '../build/test/authoring.js';
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
    draft: () => state,
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


test('Multiples Options edits reach the draft, compile, and survive storage', async t => {
  const ui = await mount(t, MultiplesOptions);
  for (const label of ['Visible rows', 'Visible columns', 'Number of panels', 'Title options', 'Panel border', 'Panel gutter', 'Panel background']) {
    assert.ok(ui.root.findAllByType('label').some(n => n.children.includes(label)), `missing control: ${label}`);
  }
  for (const action of ['bold', 'italic', 'underline', 'align left', 'align center', 'align right']) assert.ok(ui.root.findByProps({ 'aria-label': `Panel title ${action}` }));
  assert.equal(ui.visual().multiplesOptions, undefined);
  await ui.change('Visible rows', '2');
  await ui.change('Number of panels', '8');
  await ui.change('Title options', 'medium', 'select');
  await ui.change('Panel border', true);
  const defaults = defaultMultiplesOptions();
  assert.deepEqual(ui.visual().multiplesOptions, { ...defaults, visibleRows: 2, panelCount: 8,
    title: { ...defaults.title, size: 'medium' }, border: { ...defaults.border, enabled: true } });
  const model = ui.compile().model;
  assert.equal(model.multiplesOptions.title.size, 'medium');
  assert.equal(model.multiplesOptions.visibleRows, 2);
  assert.equal(model.multiplesOptions.border.enabled, true);
  assert.deepEqual(parseDraft(JSON.stringify(ui.draft())).sheets[0].visuals[1].multiplesOptions, ui.visual().multiplesOptions);
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


test('Legend title and value styling edit, compile, persist, and round-trip', async t => {
  const ui = await mount(t, LegendOptions);
  assert.equal(ui.root.findAllByType('select')[0].props.value, 'AUTO');
  await ui.change('Legend position', 'RIGHT', 'select');
  assert.equal(ui.compile().option.legend.right, 0);
  await ui.change('Show legend', false); assert.equal(ui.compile().option.legend.show, false);
  await ui.change('Show legend', true); assert.equal(ui.compile().option.legend.show, true);
  assert.equal(ui.visual().formatting?.legendTitle, undefined);
  assert.equal(ui.visual().formatting?.legendValueStyle, undefined);

  // Title: the show toggle reveals text + styling; title state is saved but not
  // drawn — ECharts has no legend-title primitive.
  await ui.change('Show legend title', true);
  assert.deepEqual(ui.visual().formatting.legendTitle, { show: true });
  await ui.change('Legend title', 'My legend');
  assert.equal(ui.visual().formatting.legendTitle.text, 'My legend');
  const titleSize = ui.root.findByProps({ 'aria-label': 'Legend title font size' });
  await act(() => titleSize.props.onChange({ target: { value: '16' } }));
  await act(() => ui.root.findByProps({ 'aria-label': 'Legend title bold' }).props.onClick());
  assert.deepEqual(ui.visual().formatting.legendTitle.style, { fontSize: 16, bold: true });
  assert.equal(ui.compile().option.legend.textStyle, undefined);

  // Value styling renders into the compiled legend text style.
  const valueSize = ui.root.findByProps({ 'aria-label': 'Legend value font size' });
  await act(() => valueSize.props.onChange({ target: { value: '18' } }));
  await act(() => ui.root.findByProps({ 'aria-label': 'Legend value bold' }).props.onClick());
  await act(() => ui.root.findByProps({ 'aria-label': 'Legend value italic' }).props.onClick());
  await act(() => ui.root.findByProps({ 'aria-label': 'Legend value underline' }).props.onClick());
  await act(() => ui.root.findByProps({ 'aria-label': 'Legend value color' }).props.onChange({ target: { value: '#ff0000' } }));
  assert.deepEqual(ui.visual().formatting.legendValueStyle, { fontSize: 18, color: '#ff0000', bold: true, italic: true, underline: true });
  const textStyle = ui.compile().option.legend.textStyle;
  assert.equal(textStyle.fontSize, 18);
  assert.equal(textStyle.fontWeight, 700);
  assert.equal(textStyle.fontStyle, 'italic');
  assert.equal(textStyle.color, '#ff0000');
  assert.equal(textStyle.textDecoration, undefined);

  // Fail-closed editing: out-of-range sizes are ignored, clearing restores defaults.
  await act(() => valueSize.props.onChange({ target: { value: '200' } }));
  assert.equal(ui.visual().formatting.legendValueStyle.fontSize, 18);
  await act(() => valueSize.props.onChange({ target: { value: '' } }));
  assert.equal(ui.visual().formatting.legendValueStyle.fontSize, undefined);
  for (const flag of ['bold', 'italic', 'underline']) await act(() => ui.root.findByProps({ 'aria-label': `Legend value ${flag}` }).props.onClick());
  await act(() => ui.root.findByProps({ 'aria-label': 'Legend value reset color to theme default' }).props.onClick());
  assert.equal(ui.visual().formatting.legendValueStyle, undefined);
  await ui.change('Show legend title', false);
  // Unchecking hides the title but retains its text and styling for next time.
  assert.deepEqual(ui.visual().formatting.legendTitle, { text: 'My legend', style: { fontSize: 16, bold: true } });

  // Reducer rejects invalid legend actions without touching the visual.
  const before = ui.visual();
  const draft = ui.draft();
  assert.deepEqual(activeSheet(authorReducer(draft, { type: 'legend-value-style', style: { fontSize: 200 } })).visuals[1], before);
  assert.deepEqual(activeSheet(authorReducer(draft, { type: 'legend-title', title: { text: 'x'.repeat(200) } })).visuals[1], before);

  // Round-trip through storage keeps both legend formatting fields.
  await ui.change('Show legend title', true);
  await ui.change('Legend title', 'Persisted');
  await act(() => ui.root.findByProps({ 'aria-label': 'Legend value font size' }).props.onChange({ target: { value: '13' } }));
  const revived = parseDraft(JSON.stringify(ui.draft())).sheets[0].visuals[1];
  assert.deepEqual(revived.formatting.legendTitle, { show: true, text: 'Persisted', style: { fontSize: 16, bold: true } });
  assert.deepEqual(revived.formatting.legendValueStyle, { fontSize: 13 });
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
