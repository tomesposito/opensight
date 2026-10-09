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
  assert.equal(zoomPrepView({ x: 0, y: 0, scale: 1 }, 0, 0, 0).scale, 0.1);
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
