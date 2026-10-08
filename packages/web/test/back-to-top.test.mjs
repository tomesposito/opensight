import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, StrictMode } from 'react';
import { create } from 'react-test-renderer';
import { BackToTop } from '../build/test/BackToTop.js';

function mockWindow({ reducedMotion = false } = {}) {
  const listeners = new Map();
  const win = {
    scrollY: 0,
    scrollToCalls: [],
    reducedMotion,
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: type => listeners.delete(type),
    matchMedia: query => ({ matches: query === '(prefers-reduced-motion: reduce)' && win.reducedMotion }),
    scrollTo: options => win.scrollToCalls.push(options),
    dispatchScroll: y => { win.scrollY = y; const handler = listeners.get('scroll'); if (handler) handler(); },
  };
  return win;
}

async function mount(t, win) {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = win; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  await act(() => { renderer = create(createElement(StrictMode, null, createElement(BackToTop))); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  return {
    button: () => renderer.root.findAllByProps({ className: 'back-to-top' })[0],
    scroll: async y => { await act(() => win.dispatchScroll(y)); },
  };
}

test('the button stays hidden until scrolled past 600px and hides again at the top', async t => {
  const win = mockWindow();
  const ui = await mount(t, win);
  assert.equal(ui.button(), undefined, 'hidden at the top of the page');
  await ui.scroll(600);
  assert.equal(ui.button(), undefined, 'still hidden at exactly 600px');
  await ui.scroll(601);
  const button = ui.button();
  assert.ok(button, 'appears after scrolling past 600px');
  assert.equal(button.type, 'button');
  assert.equal(button.props['aria-label'], 'Back to top');
  assert.equal(button.props.children, '↑ Back to top', 'label is visible, not icon-only');
  await ui.scroll(0);
  assert.equal(ui.button(), undefined, 'hides again at the top');
});

test('clicking scrolls smoothly to the top, or instantly under prefers-reduced-motion', async t => {
  const win = mockWindow();
  const ui = await mount(t, win);
  await ui.scroll(1200);
  await act(() => ui.button().props.onClick());
  assert.deepEqual(win.scrollToCalls, [{ top: 0, behavior: 'smooth' }]);

  const reduced = mockWindow({ reducedMotion: true });
  const uiReduced = await mount(t, reduced);
  await uiReduced.scroll(1200);
  await act(() => uiReduced.button().props.onClick());
  assert.deepEqual(reduced.scrollToCalls, [{ top: 0, behavior: 'auto' }]);
});
