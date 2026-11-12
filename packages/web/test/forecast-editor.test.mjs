import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { AuthorCanvas } from '../build/test/Author.js';
import { activeSheet, authorReducer, emptyDraft } from '../build/test/authoring.js';

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
  const panel = () => renderer.root.findAllByProps({ role: 'tabpanel' }).find(n => !n.props.hidden);
  const sections = () => panel().findAllByType('details').filter(n => n.props.className === 'property-section').map(n => n.findByType('summary').props.children);
  return { renderer, panel, sections, state: () => state, dispatch: async action => act(() => dispatch(action)) };
}

test('Forecast section appears for a line chart with a date dimension, and its toggle stores the config', async t => {
  const ui = await mount(t, add('line'));
  assert.ok(ui.sections().includes('Forecast'), `sections: ${ui.sections().join(', ')}`);
  const section = ui.panel().findAllByType('details').find(n => n.props.className === 'property-section' && n.findByType('summary').props.children === 'Forecast');
  const toggle = section.findAllByType('input').find(n => n.props.type === 'checkbox');
  await act(() => toggle.props.onChange({ target: { checked: true } }));
  assert.deepEqual(selected(ui.state()).forecast, { enabled: true, periodsForward: 3, periodsBackward: 0, predictionInterval: 95, seasonality: 'auto' });
  // Controls render once enabled.
  const labels = section.findAllByType('label').map(n => n.children.find(c => typeof c === 'string')).filter(Boolean);
  assert.ok(labels.some(l => l.startsWith('Periods forward')), labels.join(','));
  assert.ok(labels.some(l => l.startsWith('Periods back')), labels.join(','));
  assert.match(section.findByType('p').props.children, /Statistical forecast \(exponential smoothing\)/);
});

test('Forecast section is absent for bar charts and for line charts without a date dimension', async t => {
  const bar = await mount(t, add('bar'));
  assert.ok(!bar.sections().includes('Forecast'));
  // Reassign the line chart's dimension to a text field: the section disappears.
  const line = await mount(t, add('line'));
  assert.ok(line.sections().includes('Forecast'));
  await line.dispatch({ type: 'assign', field: 'region', well: 'category' });
  assert.notEqual(selected(line.state()).dimension, 'order_date');
  assert.ok(!line.sections().includes('Forecast'), `sections: ${line.sections().join(', ')}`);
});

test('Forecast mounts for a dated area, stores its toggle, and disappears for a non-date area', async t => {
  const ui = await mount(t, add('area'));
  assert.ok(ui.sections().includes('Forecast'));
  const section = ui.panel().findAllByType('details').find(n => n.props.className === 'property-section' && n.findByType('summary').props.children === 'Forecast');
  const toggle = section.findAllByType('input').find(n => n.props.type === 'checkbox');
  await act(() => toggle.props.onChange({ target: { checked: true } }));
  const expected = { enabled: true, periodsForward: 3, periodsBackward: 0, predictionInterval: 95, seasonality: 'auto' };
  assert.deepEqual(selected(ui.state()).forecast, expected);
  await ui.dispatch({ type: 'assign', field: 'region', well: 'category' });
  assert.equal(selected(ui.state()).dimension, 'region');
  assert.ok(!ui.sections().includes('Forecast'));
  assert.deepEqual(selected(ui.state()).forecast, expected, 'the stored forecast is retained when the date dimension is removed');
  await ui.dispatch({ type: 'assign', field: 'order_date', well: 'category' });
  assert.ok(ui.sections().includes('Forecast'));
});
