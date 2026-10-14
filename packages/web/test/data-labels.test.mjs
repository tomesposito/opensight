import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { DataLabelsOptions } from '../build/test/PropertiesSections.js';
import { activeSheet, authorReducer, emptyDraft, parseDraft, serializeVisual } from '../build/test/authoring.js';
import { compileVisual } from '../build/test/compiler.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { dataLabelsValid, dataLabelContentValid, formattingValid } from '../build/test/formatting.js';

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

test('dataLabelsValid accepts well-formed options and rejects garbage', () => {
  assert.equal(dataLabelsValid({}), true);
  assert.equal(dataLabelsValid({ content: { category: true, metric: false }, position: 'outside', style: { fontSize: 14, bold: true }, allowOverlap: false }), true);
  assert.equal(dataLabelsValid({ content: { category: false } }), true);
  assert.equal(dataLabelsValid([]), false);
  assert.equal(dataLabelsValid({ position: 'sideways' }), false);
  assert.equal(dataLabelsValid({ position: 3 }), false);
  assert.equal(dataLabelsValid({ style: { fontSize: 200 } }), false);
  assert.equal(dataLabelsValid({ style: { color: 'not-a-color' } }), false);
  assert.equal(dataLabelsValid({ allowOverlap: 'yes' }), false);
  assert.equal(dataLabelsValid({ content: { category: 'yes' } }), false);
  assert.equal(dataLabelsValid({ content: { unknown: true } }), false);
  assert.equal(dataLabelsValid({ bogus: 1 }), false);
  assert.equal(dataLabelContentValid({ category: true }), true);
  assert.equal(dataLabelContentValid('x'), false);
});

test('formattingValid gates dataLabels on import', () => {
  assert.equal(formattingValid({ dataLabels: { position: 'inside' } }), true);
  assert.equal(formattingValid({ dataLabels: { position: 'sideways' } }), false);
  assert.equal(formattingValid({ dataLabels: { style: { underline: true } } }), true, 'underline is preserved even though it never renders');
});

test('data-labels authoring action is fail-closed and strips defaults', () => {
  const initial = authorReducer(authorReducer(emptyDraft(), { type: 'add', kind: 'pie' }), { type: 'add', kind: 'pie' });
  const visual = () => activeSheet(initial).visuals[1];
  const apply = action => activeSheet(authorReducer(initial, action)).visuals[1];
  assert.deepEqual(apply({ type: 'data-labels', labels: { position: 'sideways' } }), visual(), 'bad position rejected');
  assert.deepEqual(apply({ type: 'data-labels', labels: { content: { category: 'yes' } } }), visual(), 'bad content rejected');
  assert.deepEqual(apply({ type: 'data-labels', labels: { style: { fontSize: 99 } } }), visual(), 'bad style rejected');
  const withLabels = apply({ type: 'data-labels', labels: { content: { category: false }, position: 'outside', style: { fontSize: 16 }, allowOverlap: false } });
  assert.deepEqual(withLabels.formatting.dataLabels, { content: { category: false }, position: 'outside', style: { fontSize: 16 }, allowOverlap: false });
  const draftWith = authorReducer(initial, { type: 'data-labels', labels: { content: { category: false } } });
  const stripped = activeSheet(authorReducer(draftWith, { type: 'data-labels', labels: undefined })).visuals[1];
  assert.equal(stripped.formatting, undefined, 'removing the options drops the empty formatting object');
});

test('data label content toggles choose the label parts on a pie', async t => {
  const ui = await mount(t, DataLabelsOptions);
  await ui.change('Show data labels', true);
  // Untouched: today's default formatter is preserved byte-identical.
  assert.equal(ui.compile().option.series[0].label.formatter, '{b}: {d}%');
  await ui.change('Category', false);
  assert.equal(ui.compile().option.series[0].label.formatter({ name: 'A', percent: 12.5 }), '12.5%');
  await ui.change('Category', true);
  await ui.change('Metric', false);
  assert.equal(ui.compile().option.series[0].label.formatter({ name: 'A', percent: 12.5 }), 'A');
  await ui.change('Category', false);
  assert.equal(ui.compile().option.series[0].label.show, false, 'nothing to show hides the labels');
  await ui.change('Category', true);
  await ui.change('Metric', true);
  assert.deepEqual(ui.visual().formatting?.dataLabels, undefined, 'all-default content strips back out');
  ui.verifySaved();
});

test('data label position, styling and overlap reach the series', async t => {
  const ui = await mount(t, DataLabelsOptions);
  await ui.change('Show data labels', true);
  await ui.change('Position', 'inside', 'select');
  assert.equal(ui.compile().option.series[0].label.position, 'inside');
  await ui.change('Position', 'outside', 'select');
  assert.equal(ui.compile().option.series[0].label.position, 'outside');
  await act(() => ui.root.findByProps({ 'aria-label': 'Data label font size' }).props.onChange({ target: { value: '16' } }));
  assert.equal(ui.compile().option.series[0].label.textStyle.fontSize, 16);
  await act(() => ui.root.findByProps({ 'aria-label': 'Data label bold' }).props.onClick());
  assert.equal(ui.compile().option.series[0].label.textStyle.fontWeight, 700);
  await act(() => ui.root.findByProps({ 'aria-label': 'Data label color' }).props.onChange({ target: { value: '#b03a2e' } }));
  assert.equal(ui.compile().option.series[0].label.color, '#b03a2e', 'explicit color survives the theme pass');
  // Explicit overlap choice flips the pie default (avoid overlap).
  assert.equal(ui.compile().option.series[0].avoidLabelOverlap, true);
  await ui.change('Allow labels to overlap', true);
  assert.equal(ui.compile().option.series[0].avoidLabelOverlap, false);
  ui.verifySaved();
});

test('bar labels map outside to top and hide overlaps when disallowed', async t => {
  const ui = await mount(t, DataLabelsOptions, 'bar');
  await ui.change('Show data labels', true);
  await ui.change('Position', 'outside', 'select');
  assert.equal(ui.compile().option.series[0].label.position, 'top');
  await ui.change('Allow labels to overlap', true);
  assert.deepEqual(ui.compile().option.series[0].labelLayout, { hideOverlap: false });
  await ui.change('Allow labels to overlap', false);
  assert.deepEqual(ui.compile().option.series[0].labelLayout, { hideOverlap: true });
  await ui.change('Metric', false);
  assert.equal(ui.compile().option.series[0].label.formatter({ name: 'East', value: 12.345 }), 'East');
  ui.verifySaved();
});

test('dataLabels round-trips through export and stays valid on import', async t => {
  const ui = await mount(t, DataLabelsOptions);
  await ui.change('Category', false);
  await ui.change('Position', 'outside', 'select');
  const body = Object.values(serializeVisual(ui.visual()))[0];
  assert.deepEqual(body.opensightFormatting.dataLabels, { content: { category: false }, position: 'outside' });
  assert.equal(formattingValid(body.opensightFormatting), true);
  ui.verifySaved();
});
