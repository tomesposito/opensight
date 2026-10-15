import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { CardTitle, CardStyle, CardLayout, MultiplesOptions, GroupColorOptions, LegendOptions, DataLabelsOptions } from '../build/test/PropertiesSections.js';
import { activeSheet, authorReducer, defaultMultiplesOptions, emptyDraft, groupSortValid, parseDraft, serializeVisual, sliceLimitValid } from '../build/test/authoring.js';
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
test('CARD TITLE edits survive storage, affect compilation, and leave the other visual unchanged', async t => {
  const ui = await mount(t, CardTitle);
  await ui.change('Edit title', 'Regional revenue');
  await ui.change('Edit subtitle', 'Synthetic sample');
  await ui.change('Title font size', '24');
  await ui.change('Show title', false);
  await ui.change('Show subtitle', false);
  await ui.change('Alt text', '  Bars per region  ', 'textarea');
  const model = ui.compile().model;
  assert.equal(model.title, 'Regional revenue'); assert.equal(model.subtitle, 'Synthetic sample');
  assert.equal(model.titleVisible, false); assert.equal(model.subtitleVisible, false);
  assert.equal(model.formatting.titleFontSize, 24);
  assert.equal(model.formatting.altText, 'Bars per region');
  assert.equal(ui.visual().formatting.altText, 'Bars per region');
  ui.verifySaved();
});


test('CARD STYLE controls save lean card style settings and strip reference defaults', async t => {
  const ui = await mount(t, CardStyle);
  assert.equal(ui.visual().formatting, undefined);
  const control = name => ui.root.findByProps({ 'aria-label': name });
  await act(() => control('Background color').props.onChange({ target: { value: '#1a2b3c' } }));
  assert.deepEqual(ui.visual().formatting.cardStyle, { background: { color: '#1a2b3c' } });
  await act(() => control('Background opacity (%)').props.onChange({ target: { value: '50' } }));
  assert.deepEqual(ui.visual().formatting.cardStyle.background, { color: '#1a2b3c', opacityPct: 50 });
  await act(() => control('Border width').props.onChange({ target: { value: '3' } }));
  assert.deepEqual(ui.visual().formatting.cardStyle.border, { color: '#cccccc', widthPx: 3 });
  await act(() => control('Selection color').props.onChange({ target: { value: '#112233' } }));
  assert.deepEqual(ui.visual().formatting.cardStyle.selection, { color: '#112233' });
  assert.match(ui.root.findByProps({ 'aria-label': 'Card style' }).findAllByType('p').map(p => p.children.join('')).join(' '), /does not draw a separate selection highlight/);
  await ui.change('Loading animation', false);
  assert.equal(ui.visual().formatting.cardStyle.loadingAnimation, false);
  assert.deepEqual(ui.compile().model.formatting.cardStyle.background, { color: '#1a2b3c', opacityPct: 50 });
  const reset = ui.root.findAllByType('button').find(n => n.children.includes('Reset card style to defaults'));
  await act(() => reset.props.onClick());
  assert.equal(ui.visual().formatting, undefined);
  ui.verifySaved();
});


test('CARD LAYOUT padding saves, strips the 24px default, and resets', async t => {
  const ui = await mount(t, CardLayout);
  assert.equal(ui.visual().formatting, undefined);
  await ui.change('Padding (px)', '8');
  assert.deepEqual(ui.visual().formatting.cardLayout, { paddingPx: 8 });
  assert.deepEqual(ui.compile().model.formatting.cardLayout, { paddingPx: 8 });
  await ui.change('Padding (px)', '24');
  assert.equal(ui.visual().formatting, undefined); // The 24px reference default strips clean.
  await ui.change('Padding (px)', '0');
  assert.deepEqual(ui.visual().formatting.cardLayout, { paddingPx: 0 });
  const reset = ui.root.findAllByType('button').find(n => n.children.includes('Reset to default'));
  await act(() => reset.props.onClick());
  assert.equal(ui.visual().formatting, undefined);
  ui.verifySaved();
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


test('groupSortValid accepts only complete field sorts', () => {
  assert.equal(groupSortValid({ fieldId: 'category', direction: 'ASC' }), true);
  assert.equal(groupSortValid({ fieldId: 'revenue', direction: 'DESC' }), true);
  for (const bad of [undefined, null, 'category', [], 42, { fieldId: '', direction: 'ASC' }, { fieldId: 'category' },
    { direction: 'ASC' }, { fieldId: 'category', direction: 'UP' }, { fieldId: 'category', direction: 'asc' },
    { fieldId: 'category', direction: 'ASC', extra: 1 }, { fieldId: 'a\0b', direction: 'ASC' }]) {
    assert.equal(groupSortValid(bad), false, JSON.stringify(bad));
  }
});


test('sliceLimitValid accepts only complete, bounded limits', () => {
  assert.equal(sliceLimitValid({ count: 1, includeOther: true }), true);
  assert.equal(sliceLimitValid({ count: 100, includeOther: false }), true);
  for (const bad of [undefined, null, 'limit', [], 5, { count: 5 }, { includeOther: true },
    { count: 0, includeOther: true }, { count: 101, includeOther: true }, { count: 2.5, includeOther: true },
    { count: '5', includeOther: true }, { count: 5, includeOther: 'yes' }, { count: 5, includeOther: true, extra: 1 }]) {
    assert.equal(sliceLimitValid(bad), false, JSON.stringify(bad));
  }
});


test('Group/Color title controls edit, persist, and round-trip; sort and slice limit are wired', async t => {
  const ui = await mount(t, GroupColorOptions);
  const sourceField = ui.visual().dimension;
  await ui.change('Field name', 'Territory');
  assert.equal(ui.visual().dimension, sourceField);
  assert.match(ui.compile().model.title, /by Territory$/);
  assert.equal(ui.compile().table.columns[0], 'Territory');
  assert.equal(ui.visual().formatting?.groupTitle, undefined);

  // Title: the show toggle reveals text + styling; title state is saved but not
  // drawn — ECharts has no group-title primitive.
  await ui.change('Show Group/Color title', true);
  assert.deepEqual(ui.visual().formatting.groupTitle, { show: true });
  await ui.change('Group/Color title', 'Client groups');
  assert.equal(ui.visual().formatting.groupTitle.text, 'Client groups');
  const titleSize = ui.root.findByProps({ 'aria-label': 'Group/Color title font size' });
  await act(() => titleSize.props.onChange({ target: { value: '16' } }));
  await act(() => ui.root.findByProps({ 'aria-label': 'Group/Color title bold' }).props.onClick());
  assert.deepEqual(ui.visual().formatting.groupTitle.style, { fontSize: 16, bold: true });
  assert.ok(!JSON.stringify(ui.compile().option).includes('Client groups'), 'group title must not reach the compiled option');

  // Fail-closed editing: out-of-range sizes are ignored, clearing restores defaults.
  await act(() => titleSize.props.onChange({ target: { value: '200' } }));
  assert.equal(ui.visual().formatting.groupTitle.style.fontSize, 16);
  await act(() => titleSize.props.onChange({ target: { value: '' } }));
  assert.equal(ui.visual().formatting.groupTitle.style.fontSize, undefined);
  await act(() => ui.root.findByProps({ 'aria-label': 'Group/Color title bold' }).props.onClick());
  assert.equal(ui.visual().formatting.groupTitle.style, undefined);
  await ui.change('Show Group/Color title', false);
  // Unchecking hides the title but retains its text for next time.
  assert.deepEqual(ui.visual().formatting.groupTitle, { text: 'Client groups' });

  // Reducer rejects invalid group-title actions without touching the visual.
  const snapshot = ui.visual();
  const draft = ui.draft();
  assert.deepEqual(activeSheet(authorReducer(draft, { type: 'group-title', title: { text: 'x'.repeat(200) } })).visuals[1], snapshot);
  assert.deepEqual(activeSheet(authorReducer(draft, { type: 'group-title', title: { style: { fontSize: 200 } } })).visuals[1], snapshot);

  // Round-trip through storage keeps the group title.
  await ui.change('Show Group/Color title', true);
  await ui.change('Group/Color title', 'Persisted');
  const revived = parseDraft(JSON.stringify(ui.draft())).sheets[0].visuals[1];
  assert.deepEqual(revived.formatting.groupTitle, { show: true, text: 'Persisted' });

  // Sort is wired: pick the group dimension, flip direction, switch fields, reset to default.
  assert.equal(ui.visual().groupSort, undefined);
  await ui.change('Sort by', 'category', 'select');
  assert.deepEqual(ui.visual().groupSort, { fieldId: 'category', direction: 'ASC' });
  assert.deepEqual(ui.compile().model.sort, { fieldId: 'category', direction: 'ASC' });
  await act(() => ui.root.findByProps({ 'aria-label': 'Sort descending' }).props.onClick());
  assert.deepEqual(ui.visual().groupSort, { fieldId: 'category', direction: 'DESC' });
  await ui.change('Sort by', 'revenue', 'select');
  assert.deepEqual(ui.visual().groupSort, { fieldId: 'revenue', direction: 'DESC' }); // keeps the chosen direction
  await ui.change('Sort by', '', 'select');
  assert.equal(ui.visual().groupSort, undefined);
  assert.equal(ui.compile().model.sort, undefined);

  // Reducer rejects invalid sorts without touching the visual.
  const sortSnapshot = ui.visual(), sortDraft = ui.draft();
  const bad = sort => activeSheet(authorReducer(sortDraft, { type: 'group-sort', sort })).visuals[1];
  assert.deepEqual(bad({ fieldId: 'category', direction: 'UP' }), sortSnapshot);
  assert.deepEqual(bad({ fieldId: '', direction: 'ASC' }), sortSnapshot);
  assert.deepEqual(bad({ fieldId: 'category', direction: 'ASC', extra: 1 }), sortSnapshot);
  assert.deepEqual(bad(null), sortSnapshot);

  // Round-trip through storage keeps the sort.
  await ui.change('Sort by', 'revenue', 'select');
  const revivedSort = parseDraft(JSON.stringify(ui.draft())).sheets[0].visuals[1];
  assert.deepEqual(revivedSort.groupSort, { fieldId: 'revenue', direction: 'DESC' });

  // Export writes SortConfiguration; the compiler re-validates it on the way back.
  const exported = serializeVisual(ui.visual()).pieChartVisual.chartConfiguration.sortConfiguration;
  assert.deepEqual(exported, { categorySort: [{ fieldSort: { fieldId: 'revenue', direction: 'DESC' } }] });

  // Unassigning the sorted field drops the stale sort instead of keeping an unbound reference.
  const unassigned = authorReducer(ui.draft(), { type: 'unassign', field: 'revenue' });
  assert.equal(activeSheet(unassigned).visuals[1].groupSort, undefined);

  // Slice limit is wired: set the count, toggle the Other bucket, clear it.
  assert.equal(ui.visual().sliceLimit, undefined);
  await ui.change('Number of slices displayed', '5');
  assert.deepEqual(ui.visual().sliceLimit, { count: 5, includeOther: true });
  assert.deepEqual(ui.compile().model.sliceLimit, { count: 5, includeOther: true });
  const otherToggle = ui.root.findByProps({ 'aria-label': 'Group the rest as Other' });
  await act(() => otherToggle.props.onChange({ target: { checked: false } }));
  assert.deepEqual(ui.visual().sliceLimit, { count: 5, includeOther: false });
  // Fail-closed editing: out-of-range or non-numeric input keeps the last valid limit.
  const sliceInput = ui.root.findByProps({ 'aria-label': 'Number of slices displayed' });
  await act(() => sliceInput.props.onChange({ target: { value: '0' } }));
  assert.deepEqual(ui.visual().sliceLimit, { count: 5, includeOther: false });
  await act(() => sliceInput.props.onChange({ target: { value: '500' } }));
  assert.deepEqual(ui.visual().sliceLimit, { count: 5, includeOther: false });
  await act(() => sliceInput.props.onChange({ target: { value: 'abc' } }));
  assert.deepEqual(ui.visual().sliceLimit, { count: 5, includeOther: false });
  // Clearing the input removes the limit (all rows shown).
  await act(() => sliceInput.props.onChange({ target: { value: '' } }));
  assert.equal(ui.visual().sliceLimit, undefined);
  assert.equal(ui.compile().model.sliceLimit, undefined);

  // Reducer rejects invalid limits without touching the visual.
  const limitSnapshot = ui.visual(), limitDraft = ui.draft();
  const badLimit = limit => activeSheet(authorReducer(limitDraft, { type: 'slice-limit', limit })).visuals[1];
  assert.deepEqual(badLimit({ count: 0, includeOther: true }), limitSnapshot);
  assert.deepEqual(badLimit({ count: 101, includeOther: true }), limitSnapshot);
  assert.deepEqual(badLimit({ count: 2.5, includeOther: true }), limitSnapshot);
  assert.deepEqual(badLimit(null), limitSnapshot);

  // Round-trip through storage keeps the limit.
  await ui.change('Number of slices displayed', '8');
  const revivedLimit = parseDraft(JSON.stringify(ui.draft())).sheets[0].visuals[1];
  assert.deepEqual(revivedLimit.sliceLimit, { count: 8, includeOther: true });

  // Export writes CategoryItemsLimit merged with the sort; the compiler reads it back.
  const exportedSort = serializeVisual(ui.visual()).pieChartVisual.chartConfiguration.sortConfiguration;
  assert.deepEqual(exportedSort, {
    categorySort: [{ fieldSort: { fieldId: 'revenue', direction: 'DESC' } }],
    categoryItemsLimit: { itemsLimit: 8, otherCategories: 'INCLUDE' },
  });
  assert.deepEqual(ui.compile().model.sliceLimit, { count: 8, includeOther: true });

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


test('Data labels content, position, styling and overlap controls are live', async t => {
  const ui = await mount(t, DataLabelsOptions);
  await ui.change('Show data labels', true);
  await ui.change('Data label decimal places', '3');
  assert.equal(ui.compile().option.series[0].label.show, true);
  assert.equal(ui.compile().option.series[0].label.formatter({ name: 'A', percent: 12.3456 }), 'A: 12.346%');
  await ui.change('Data label decimal places', '-1');
  assert.equal(ui.visual().formatting.decimalPlaces, 3, 'invalid precision is rejected');
  // Content toggles choose the label parts; both off hides the labels.
  await ui.change('Category', false);
  assert.equal(ui.compile().option.series[0].label.formatter({ name: 'A', percent: 12.3456 }), '12.346%');
  await ui.change('Category', true);
  await ui.change('Metric', false);
  assert.equal(ui.compile().option.series[0].label.formatter({ name: 'A', percent: 12.3456 }), 'A');
  await ui.change('Category', false);
  assert.equal(ui.compile().option.series[0].label.show, false);
  await ui.change('Category', true);
  await ui.change('Metric', true);
  // Position and styling reach the series.
  await ui.change('Position', 'inside', 'select');
  assert.equal(ui.compile().option.series[0].label.position, 'inside');
  await act(() => ui.root.findByProps({ 'aria-label': 'Data label font size' }).props.onChange({ target: { value: '16' } }));
  assert.equal(ui.compile().option.series[0].label.textStyle.fontSize, 16);
  await act(() => ui.root.findByProps({ 'aria-label': 'Data label bold' }).props.onClick());
  assert.equal(ui.compile().option.series[0].label.textStyle.fontWeight, 700);
  // Defaults strip back out of the model so exports stay lean.
  await ui.change('Position', 'auto', 'select');
  await act(() => ui.root.findByProps({ 'aria-label': 'Data label font size' }).props.onChange({ target: { value: '' } }));
  await act(() => ui.root.findByProps({ 'aria-label': 'Data label bold' }).props.onClick());
  assert.equal(ui.visual().formatting?.dataLabels, undefined);
  await ui.change('Show data labels', false); assert.equal(ui.compile().option.series[0].label.show, false);
  await ui.change('Data label decimal places', ''); assert.equal(ui.visual().formatting.decimalPlaces, undefined);
  ui.verifySaved();
});
