import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthorCanvas } from '../build/test/Author.js';
import { activeSheet, authorReducer, emptyDraft, VISUAL_TYPES } from '../build/test/authoring.js';
const selected = d => activeSheet(d).visuals.find(v => v.id === activeSheet(d).selectedId);
const add = kind => authorReducer(emptyDraft(), { type: 'add', kind });
async function mount(t, initial) {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, state, dispatch;
  function Harness() { [state, dispatch] = useReducer(authorReducer, initial); return createElement(AuthorCanvas, { draft: state, dispatch }); }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const tab = name => renderer.root.findAllByProps({ role: 'tab' }).find(n => n.props.children === name);
  const panel = () => renderer.root.findAllByProps({ role: 'tabpanel' }).find(n => !n.props.hidden);
  const click = async name => { const button = panel().findAllByType('button').find(n => n.props.children === name); assert.ok(button, name); await act(() => button.props.onClick()); };
  const change = async (label, value, kind = 'input') => { const n = panel().findAllByType('label').find(n => n.children.includes(label)); assert.ok(n, label); await act(() => n.findByType(kind).props.onChange({ target: { value, checked: value } })); };
  return { renderer, state: () => state, dispatch: async action => act(() => dispatch(action)), tab, panel, click, change, switch: async name => act(() => tab(name).props.onClick()) };
}
const visualSections = ['Display settings', 'Placement', 'Pivot options', 'Headers', 'Cells', 'Total', 'Subtotal', 'Row names', 'Column names', 'Value names', 'Conditional formatting', 'Visual palette', 'Analysis theme'];
const interactionSections = ['Filters', 'Custom actions', 'Drill-down hierarchy', 'Parameter bindings'];

test('every reference section uses uniform details; tabs expose the correct panel and keyboard navigation', async t => {
  const ui = await mount(t, add('pivot'));
  const sections = () => ui.panel().findAllByType('details').filter(n => n.props.className === 'property-section').map(n => n.findByType('summary').props.children);
  assert.deepEqual(sections(), visualSections);
  const verify = name => {
    assert.equal(ui.tab(name).props['aria-selected'], true);
    assert.equal(ui.tab(name).props.tabIndex, 0);
    assert.equal(ui.panel().props['aria-labelledby'], ui.tab(name).props.id);
    assert.equal(ui.panel().props.id, ui.tab(name).props['aria-controls']);
  };
  verify('Visual'); await ui.switch('Interaction'); verify('Interaction');
  assert.deepEqual(sections(), interactionSections);
  let focused = '', prevented = 0;
  const key = async (name, key) => act(() => ui.tab(name).props.onKeyDown({ key, preventDefault() { prevented++; }, currentTarget: { parentElement: { querySelector(selector) { focused = selector; return { focus() {} }; } } } }));
  await key('Interaction', 'ArrowRight'); verify('Visual'); assert.ok(focused.includes(ui.tab('Visual').props.id));
  await key('Visual', 'End'); verify('Interaction'); await key('Interaction', 'Home'); verify('Visual');
  await key('Visual', 'ArrowLeft'); verify('Interaction'); assert.equal(prevented, 4);
});

test('visual formatting and interaction edits survive tab switches and stay on the selected visual', async t => {
  let d = authorReducer(add('pivot'), { type: 'add', kind: 'pivot' });
  d = authorReducer(d, { type: 'parameter-add', parameter: { name: 'Region', type: 'string', multiple: false, defaultValues: ['East'], values: ['East'] } });
  const untouched = structuredClone(activeSheet(d).visuals[0]);
  const ui = await mount(t, d);
  await ui.change('Edit title', 'Selected pivot');
  await ui.change('region', 'Territory'); await ui.change('revenue', 'Sales');
  await ui.change('Metric placement', 'rows', 'select');
  await ui.switch('Interaction');
  await ui.click('Select none');
  assert.deepEqual(selected(ui.state()).filters, [{ columnName: 'region', values: [] }]);
  await ui.click('Apply parameter filter'); await ui.click('Add filter action');
  await ui.click('Year → Quarter → Month'); await ui.click('Save hierarchy');
  await ui.switch('Visual');
  assert.equal(selected(ui.state()).title, 'Selected pivot');
  assert.deepEqual(selected(ui.state()).formatting, { names: { region: 'Territory', revenue: 'Sales' }, pivot: { metricPlacement: 'rows' } });
  await ui.change('order_date', 'Order date');
  await ui.switch('Interaction');
  assert.equal(selected(ui.state()).filters[0].parameterName, 'Region');
  assert.equal(selected(ui.state()).filterActions.length, 1);
  assert.equal(selected(ui.state()).hierarchy.levels.length, 3);
  assert.deepEqual(activeSheet(ui.state()).visuals[0], untouched);
  await ui.dispatch({ type: 'select', id: untouched.id });
  assert.equal(ui.tab('Visual').props['aria-selected'], true);
  assert.deepEqual(selected(ui.state()), untouched);
  await ui.dispatch({ type: 'select', id: 'visual-2' });
  assert.equal(selected(ui.state()).formatting.names.order_date, 'Order date');
});

test('section visibility remains specific to each kind; no selected visual retains its empty state', () => {
  for (const { kind } of VISUAL_TYPES) {
    const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft: add(kind), dispatch() {} }));
    assert.equal(html.includes('<summary>Pivot options</summary>'), kind === 'pivot', kind);
    for (const title of ['Headers', 'Cells', 'Total', 'Subtotal']) assert.equal(html.includes(`<summary>${title}</summary>`), ['pivot', 'table'].includes(kind), `${kind}: ${title}`);
    assert.ok(html.includes('aria-label="Properties tabs"'));
  }
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft: emptyDraft(), dispatch() {} }));
  assert.ok(html.includes('Select a visual or object to edit its display settings.'));
  assert.match(html, /<summary[^>]*>Analysis theme<\/summary>/);
  assert.ok(!html.includes('aria-label="Properties tabs"'));
});

test('display controls update rendered settings and retain independent interaction state', async t => {
  const ui = await mount(t, add('bar'));
  await ui.change('Edit subtitle', 'Regional sales');
  await ui.change('Title font size', '24');
  await ui.change('Legend position', 'RIGHT', 'select');
  await ui.change('Data label decimal places', '3');
  await ui.change('Category spacing (%)', '35');
  await ui.change('Show subtitle', false);
  await ui.switch('Interaction'); await ui.click('Add filter action'); await ui.switch('Visual');
  assert.equal(selected(ui.state()).subtitle, 'Regional sales');
  assert.equal(selected(ui.state()).subtitleVisible, false);
  assert.deepEqual(selected(ui.state()).formatting, { titleFontSize: 24, legendPosition: 'RIGHT', decimalPlaces: 3, barCategoryGap: 35 });
  assert.equal(selected(ui.state()).filterActions.length, 1);
  await ui.change('Data label decimal places', ''); await ui.change('Category spacing (%)', '');
  assert.deepEqual(selected(ui.state()).formatting, { titleFontSize: 24, legendPosition: 'RIGHT' });
});

test('display audit shows only controls implemented for each visual kind', () => {
  for (const { kind } of VISUAL_TYPES) {
    const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft: add(kind), dispatch() {} }));
    for (const text of ['Subtitle', 'Show subtitle', 'Title font size']) assert.ok(html.includes(text), `${kind}: ${text}`);
    assert.equal(html.includes('Legend position'), ['bar', 'line', 'pie', 'combo', 'area', 'bar100', 'radar', 'sankey', 'waterfall'].includes(kind), kind);
    assert.equal(html.includes('Category spacing (%)'), ['bar', 'bar100', 'combo'].includes(kind), kind);
    assert.equal(html.includes('Data label decimal places'), !['insight', 'table', 'pivot', 'kpi', 'gauge', 'box', 'wordCloud', 'pointMap'].includes(kind), kind);
    assert.equal(html.includes('Narrative decimal places'), kind === 'insight', kind);
    assert.equal(html.includes('Stack values'), kind === 'bar', kind);
  }
});

test('issue 57 section order and control names remain specific to each visual kind', () => {
  for (const { kind } of VISUAL_TYPES) {
    const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft: add(kind), dispatch() {} }));
    for (const heading of ['CARD TITLE', 'CARD STYLE', 'CARD LAYOUT']) assert.ok(html.includes(`<h4>${heading}</h4>`), `${kind}: ${heading}`);
    assert.equal(html.includes('<summary>Multiples Options</summary>'), ['bar', 'bar100', 'line', 'area', 'combo', 'pie'].includes(kind), kind);
    assert.equal(html.includes('<summary>Group/Color</summary>'), ['bar', 'bar100', 'pie'].includes(kind), kind);
    assert.equal(html.includes('Number of slices displayed'), kind === 'pie', kind);
    assert.equal((html.match(/aria-label="Title"/g) ?? []).length, 1, `${kind}: card title has a unique accessible name`);
    if (kind === 'pie') {
      const sections = [...html.matchAll(/<summary[^>]*>([^<]+)<\/summary>/g)].map(match => match[1]);
      const start = sections.indexOf('Display settings');
      assert.deepEqual(sections.slice(start, start + 5), ['Display settings', 'Multiples Options', 'Group/Color', 'Legend', 'Data labels']);
      assert.ok(html.includes('aria-label="Show Group/Color title"'));
    }
  }
});
