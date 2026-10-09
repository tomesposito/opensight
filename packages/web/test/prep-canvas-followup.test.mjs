import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { PrepViewport, zoomPrepView, fitPrepView } from '../build/test/PrepViewport.js';

async function mount(t, component, props = {}, options = {}) {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  await act(async () => { renderer = create(createElement(component, props), options); });
  t.after(async () => { await act(async () => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  return renderer;
}
const click = async (ui, label) => act(async () => ui.root.findByProps({ 'aria-label': label }).props.onClick());
const transform = ui => ui.root.findByProps({ className: 'prep-viewport-content' }).props.style.transform;

test('canvas zoom is bounded and preserves the point under the cursor; fit includes a large graph', () => {
  assert.deepEqual(zoomPrepView({ x: 20, y: 10, scale: 1 }, 2, 100, 60), { x: -60, y: -40, scale: 2 });
  assert.equal(zoomPrepView({ x: 0, y: 0, scale: 1 }, 20, 0, 0).scale, 2);
  assert.equal(zoomPrepView({ x: 0, y: 0, scale: 1 }, 0, 0, 0).scale, 0.001);
  const huge = fitPrepView(800, 320, 54000, 400);
  assert.ok(huge.x + 54000 * huge.scale <= 800);
  const fit = fitPrepView(800, 320, 1800, 400);
  assert.ok(fit.x >= 0 && fit.y >= 0);
  assert.ok(fit.x + 1800 * fit.scale <= 800 && fit.y + 400 * fit.scale <= 320);
});

test('canvas buttons, wheel, drag/cancel and keyboard work without intercepting node selection', async t => {
  let wheel, focused = 0, captured, released;
  const box = { clientWidth: 800, clientHeight: 320, offsetWidth: 1800, offsetHeight: 400,
    getBoundingClientRect: () => ({ left: 0, top: 0 }), focus: () => focused++, setPointerCapture: id => { captured = id; }, releasePointerCapture: id => { released = id; },
    addEventListener: (name, fn, opts) => { if (name === 'wheel') { wheel = fn; assert.equal(opts.passive, false); } }, removeEventListener() {} };
  const ui = await mount(t, PrepViewport, { children: createElement('button', {}, 'Node') }, { createNodeMock: () => box });
  const region = () => ui.root.findByProps({ 'aria-label': 'Pipeline canvas' });
  const initial = transform(ui);
  await click(ui, 'Zoom in'); assert.match(transform(ui), /scale\(1.2\)/);
  await click(ui, 'Zoom out'); assert.equal(transform(ui), initial);
  let prevented = false;
  await act(async () => wheel({ preventDefault() { prevented = true; }, deltaY: -100, deltaMode: 0, clientX: 100, clientY: 80 }));
  assert.equal(prevented, true); assert.notEqual(transform(ui), initial);
  await click(ui, 'Reset canvas view'); assert.equal(transform(ui), initial);
  const event = { button: 0, pointerId: 1, clientX: 100, clientY: 100, target: { closest: () => null }, currentTarget: box, preventDefault() {} };
  await act(async () => region().props.onPointerDown(event));
  await act(async () => region().props.onPointerMove({ ...event, clientX: 180, clientY: 140 }));
  assert.match(transform(ui), /translate\(104px, 56px\)/); assert.equal(focused, 1); assert.equal(captured, 1);
  await act(async () => region().props.onPointerUp(event)); assert.equal(released, 1);
  const panned = transform(ui);
  await act(async () => region().props.onPointerDown({ ...event, target: { closest: () => ({ tagName: 'BUTTON' }) } }));
  await act(async () => region().props.onPointerMove({ ...event, clientX: 250 }));
  assert.equal(transform(ui), panned);
  await act(async () => region().props.onPointerDown(event));
  await act(async () => region().props.onPointerCancel());
  await act(async () => region().props.onPointerMove({ ...event, clientX: 250 })); assert.equal(transform(ui), panned);
  await act(async () => region().props.onKeyDown({ key: '0', target: box, currentTarget: box, preventDefault() {} })); assert.equal(transform(ui), initial);
  await click(ui, 'Fit pipeline to view'); assert.ok(!transform(ui).includes('scale(1)'));
  const fitted = transform(ui);
  await act(async () => ui.update(createElement(PrepViewport, {}, createElement('button', {}, 'Selected node'))));
  assert.equal(transform(ui), fitted, 'step rerenders preserve the view');
});

import { DataPrep } from '../build/test/DataPrep.js';
test('Steps search filters names live, preserves only matching groups, and Escape clears and focuses the dock', async t => {
  let focused = 0;
  const ui = await mount(t, DataPrep, {}, { createNodeMock: node => node.props['aria-label'] === 'Steps' ? { focus() { focused++; } } : null });
  const input = () => ui.root.findByProps({ placeholder: 'Search steps' });
  const groups = () => ui.root.findByProps({ 'aria-label': 'Steps' }).findAllByType('h3').map(n => n.props.children);
  for (const [query, expected] of [['JOIN', ['Combine transformations']], ['  column ', ['Column transformations']], ['pivot', ['Other']], ['add', ['Input', 'Column transformations']]]) {
    await act(async () => input().props.onChange({ target: { value: query } })); assert.deepEqual(groups(), expected);
  }
  await act(async () => input().props.onChange({ target: { value: 'does not exist' } }));
  assert.deepEqual(groups(), []); assert.match(JSON.stringify(ui.toJSON()), /No matching steps/);
  await act(async () => input().props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }));
  assert.equal(input().props.value, ''); assert.equal(focused, 1);
  assert.deepEqual(groups(), ['Input', 'Column transformations', 'Combine transformations', 'Other']);
  await act(async () => input().props.onChange({ target: { value: 'join' } }));
  await click(ui, '＋ Join');
  assert.ok(ui.root.findByProps({ className: 'prep-join-editor' }), 'filtered transformation remains usable');
});

import { useState } from 'react';
import { PrepJoinEditor } from '../build/test/PrepJoinEditor.js';
import { PrepStepEditor } from '../build/test/PrepStepEditor.js';
import { PrepPreviewTable } from '../build/test/PrepPreviewTable.js';
import { prepSchema } from '../build/test/data-prep.js';
import { assembleQsBundle, parseQsBundle } from '@opensight/bundle-parser/browser';
const leftColumns = [{ name: 'region', type: 'STRING' }, { name: 'category', type: 'STRING' }, { name: 'revenue', type: 'DECIMAL' }];
const rightColumns = [{ name: 'region', type: 'STRING' }, { name: 'manager', type: 'STRING' }, { name: 'amount', type: 'DECIMAL' }];
const joinConfig = { source: 'lookup', joinType: 'left', prefix: 'joined_', keys: [{ left: 'region', right: 'region' }] };
function JoinHarness({ report, config: initial = joinConfig }) {
  const [config, change] = useState(initial);
  report(config);
  return createElement(PrepJoinEditor, { config, leftColumns, rightColumns, leftInput: 'Left', rightInput: 'Right', outputs: null, change });
}
function transfer() {
  const data = new Map();
  return { types: [], setData(type, value) { data.set(type, value); this.types = [...data.keys()]; }, getData: type => data.get(type) ?? '' };
}
function dragEvent(dataTransfer, after = false) {
  return { dataTransfer, clientX: after ? 99 : 1, clientY: after ? 99 : 1, preventDefault() { this.prevented = true; }, stopPropagation() {}, currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), contains: () => false } };
}
async function dropColumn(source, target, { after = false, valid = true, tamper = false } = {}) {
  const data = transfer();
  await act(async () => source().props.onDragStart(dragEvent(data)));
  const over = dragEvent(data, after);
  await act(async () => target().props.onDragOver(over));
  assert.equal(!!over.prevented, valid);
  assert.equal(!!target().props['data-prep-drop'], valid, 'only valid targets show a drop indicator');
  if (tamper) data.setData(data.types[0], 'forged token');
  await act(async () => target().props.onDrop(dragEvent(data, after)));
  assert.equal(target().props['data-prep-drop'], undefined, 'indicator clears on drop');
}
const column = (ui, side, name) => () => ui.root.findByProps({ 'aria-label': `Use ${side} column ${name}` });
const keySlot = (ui, side, index) => () => ui.root.findByProps({ 'data-key-side': side, 'data-key-index': index });

test('join table columns drag into paired keys; partial pairs remain invalid until both sides are assigned', async t => {
  let config;
  const ui = await mount(t, JoinHarness, { report: value => { config = value; } });
  await dropColumn(column(ui, 'left', 'category'), keySlot(ui, 'left', 1));
  assert.deepEqual(config.keys[1], { left: 'category', right: '' });
  await dropColumn(column(ui, 'right', 'manager'), keySlot(ui, 'right', 1));
  assert.deepEqual(config.keys, [{ left: 'region', right: 'region' }, { left: 'category', right: 'manager' }]);
  assert.equal(config.prefix, 'joined_');
  // Key handles move the complete pair so reordering preserves join semantics.
  await dropColumn(() => keySlot(ui, 'left', 1)().findByProps({ draggable: true }), keySlot(ui, 'left', 0));
  assert.deepEqual(config.keys, [{ left: 'category', right: 'manager' }, { left: 'region', right: 'region' }]);
});

test('wrong-side, mismatched-type, external, forged and cancelled join drops leave state unchanged', async t => {
  let config;
  const ui = await mount(t, JoinHarness, { report: value => { config = value; } });
  const before = structuredClone(config);
  await dropColumn(column(ui, 'left', 'category'), keySlot(ui, 'right', 0), { valid: false });
  await dropColumn(column(ui, 'left', 'revenue'), keySlot(ui, 'left', 0), { valid: false });
  await dropColumn(column(ui, 'left', 'category'), keySlot(ui, 'left', 0), { tamper: true });
  const external = transfer(); external.setData('text/plain', 'category');
  await act(async () => keySlot(ui, 'left', 0)().props.onDrop(dragEvent(external)));
  const data = transfer();
  await act(async () => column(ui, 'left', 'category')().props.onDragStart(dragEvent(data)));
  await act(async () => keySlot(ui, 'left', 0)().props.onDragOver(dragEvent(data)));
  await act(async () => column(ui, 'left', 'category')().props.onDragEnd());
  assert.equal(keySlot(ui, 'left', 0)().props['data-prep-drop'], undefined);
  await act(async () => keySlot(ui, 'left', 0)().props.onDrop(dragEvent(data)));
  assert.deepEqual(config, before);
});

test('join source changes invalidate an active drag even when both sources share column names', async t => {
  const initial = { config: joinConfig, leftColumns, rightColumns, leftInput: 'Left', rightInput: 'Right', outputs: null, change() { assert.fail('stale drag must not apply'); } };
  const ui = await mount(t, PrepJoinEditor, initial);
  const data = transfer();
  await act(async () => column(ui, 'right', 'manager')().props.onDragStart(dragEvent(data)));
  await act(async () => ui.update(createElement(PrepJoinEditor, { ...initial, config: { ...joinConfig, source: 'different-lookup' } })));
  await act(async () => keySlot(ui, 'right', 0)().props.onDrop(dragEvent(data)));
});

test('join table ordering works while filtered, keeps hidden columns, and cannot move columns across sources', async t => {
  let config;
  const ui = await mount(t, JoinHarness, { report: value => { config = value; } });
  const list = () => ui.root.findByProps({ 'aria-label': 'Left table columns' });
  await act(async () => ui.root.findAllByProps({ placeholder: 'Search columns' })[0].props.onChange({ target: { value: 're' } }));
  await dropColumn(column(ui, 'left', 'revenue'), () => column(ui, 'left', 'region')().parent);
  await act(async () => ui.root.findAllByProps({ placeholder: 'Search columns' })[0].props.onChange({ target: { value: '' } }));
  assert.deepEqual(list().findAllByType('button').map(n => n.props['aria-label']), ['Use left column revenue', 'Use left column region', 'Use left column category']);
  await dropColumn(column(ui, 'right', 'region'), () => column(ui, 'left', 'region')().parent, { valid: false });
  assert.deepEqual(config, joinConfig);
});

test('Select columns drag order is applied to the schema and exported bundle; keyboard reorder and deselection agree', async t => {
  let applied;
  const ui = await mount(t, PrepStepEditor, { step: { id: 'select', kind: 'select', config: { columns: leftColumns.map(c => c.name) } }, columns: leftColumns, sources: [], apply(value) { applied = value; }, cancel() {} });
  const row = name => () => ui.root.findByProps({ 'data-column': name });
  await dropColumn(row('revenue'), row('region'));
  await act(async () => ui.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(applied.config.columns, ['revenue', 'region', 'category']);
  const resource = { resourceType: 'dataset', dataSetId: 'ordered', name: 'Ordered', physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: { version: 1, input: 'sales', steps: [applied] } };
  const bundle = await parseQsBundle(await assembleQsBundle({ members: [{ path: 'dataset/ordered.json', resource }] }));
  assert.deepEqual(prepSchema(bundle.members[0].resource.opensightPrep, [{ id: 'sales', connectorId: 'file', available: true, columns: leftColumns }]).map(c => c.name), ['revenue', 'region', 'category']);
  await act(async () => row('revenue')().props.onKeyDown({ key: 'ArrowDown', altKey: true, preventDefault() {} }));
  await act(async () => row('category')().findByType('input').props.onChange({ target: { checked: false } }));
  await dropColumn(row('region'), row('category'), { valid: false });
  await act(async () => ui.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(applied.config.columns, ['region', 'revenue']);
});

test('preview header reordering moves the matching cells and preserves values, nulls and source schema', async t => {
  const columns = structuredClone(leftColumns), rows = [{ region: 'East', category: null, revenue: 17 }];
  const ui = await mount(t, PrepPreviewTable, { columns, rows });
  const header = name => () => ui.root.findAllByType('th').find(n => n.props.children[0] === name);
  await dropColumn(header('revenue'), header('region'));
  assert.deepEqual(ui.root.findAllByType('th').map(n => n.props.children[0]), ['revenue', 'region', 'category']);
  assert.equal(ui.root.findAllByType('td')[0].props.children, '17');
  assert.equal(ui.root.findAllByType('td')[1].props.children, 'East');
  assert.equal(ui.root.findByType('em').props.children, 'null');
  await act(async () => header('revenue')().props.onKeyDown({ key: 'ArrowRight', altKey: true, preventDefault() {} }));
  assert.deepEqual(ui.root.findAllByType('th').map(n => n.props.children[0]), ['region', 'revenue', 'category']);
  assert.deepEqual(columns, leftColumns); assert.deepEqual(rows, [{ region: 'East', category: null, revenue: 17 }]);
});
