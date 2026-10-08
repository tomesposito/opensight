import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, StrictMode } from 'react';
import { create } from 'react-test-renderer';
import { BackToTop } from '../build/test/BackToTop.js';
import { Application } from '../build/test/Application.js';
import { AppNavigation } from '../build/test/AppNavigation.js';
import { AccessProvider, demoAccess } from '../build/test/access.js';
import { Dashboard } from '../build/test/Dashboard.js';
import { DataSources } from '../build/test/DataSources.js';

function mockWindow({ reducedMotion = false, scrollY = 0 } = {}) {
  const events = new EventTarget(), scrollListeners = new Set();
  const win = {
    scrollY,
    scrollToCalls: [],
    scrollListeners,
    scrollOptions: [],
    reducedMotion,
    location: { hash: '#/home' },
    addEventListener(type, handler, options) {
      if (type === 'scroll') { scrollListeners.add(handler); win.scrollOptions.push(options); }
      events.addEventListener(type, handler, options);
    },
    removeEventListener(type, handler) {
      if (type === 'scroll') scrollListeners.delete(handler);
      events.removeEventListener(type, handler);
    },
    matchMedia: query => ({ matches: query === '(prefers-reduced-motion: reduce)' && win.reducedMotion }),
    scrollTo: options => win.scrollToCalls.push(options),
    dispatchScroll: y => { win.scrollY = y; events.dispatchEvent(new Event('scroll')); },
  };
  return win;
}

async function mount(t, win, element = createElement(BackToTop)) {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = win; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  await act(() => { renderer = create(createElement(StrictMode, null, element)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  return {
    renderer,
    button: () => renderer.root.findAllByProps({ className: 'back-to-top' })[0],
    scroll: async y => { await act(() => win.dispatchScroll(y)); },
    click: () => act(() => renderer.root.findByProps({ className: 'back-to-top' }).props.onClick()),
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
  assert.equal(button.props.type, 'button');
  assert.notEqual(button.props.tabIndex, -1);
  assert.ok(!button.props.disabled);
  assert.equal(button.props['aria-label'], 'Back to top');
  assert.equal(button.props.children, '↑ Back to top', 'label is visible, not icon-only');
  await ui.scroll(600);
  assert.equal(ui.button(), undefined, 'hides when returning to the threshold');
  await ui.scroll(1200);
  await ui.scroll(0);
  assert.equal(ui.button(), undefined, 'hides again at the top');
});

test('a restored scroll position shows the button immediately on mount', async t => {
  const ui = await mount(t, mockWindow({ scrollY: 900 }));
  assert.ok(ui.button());
});

for (const reducedMotion of [false, true]) test(`clicking scrolls to the top with reduced motion ${reducedMotion}`, async t => {
  const win = mockWindow({ reducedMotion });
  const ui = await mount(t, win);
  await ui.scroll(1200);
  await ui.click();
  assert.deepEqual(win.scrollToCalls, [{ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' }]);
  assert.ok(ui.button(), 'visibility follows the actual scroll position');
  await ui.scroll(0);
  assert.equal(ui.button(), undefined);
});

test('motion preference is read again on every activation', async t => {
  const win = mockWindow({ scrollY: 900 });
  const ui = await mount(t, win);
  await ui.click();
  win.reducedMotion = true;
  await ui.click();
  assert.deepEqual(win.scrollToCalls, [{ top: 0, behavior: 'smooth' }, { top: 0, behavior: 'auto' }]);
});

test('the passive scroll listener survives StrictMode replay and is removed on unmount', async t => {
  const win = mockWindow();
  const ui = await mount(t, win);
  assert.equal(win.scrollListeners.size, 1);
  assert.ok(win.scrollOptions.every(options => options.passive));
  await act(() => ui.renderer.update(null));
  assert.equal(win.scrollListeners.size, 0);
  await ui.scroll(900);
  assert.equal(ui.renderer.toJSON(), null);
});

test('one shared control covers sample dashboards, definition previews and the connector gallery', async t => {
  const win = mockWindow();
  const fixtures = [{ id: 'renderable-sales', name: 'Sample', sheets: [], notice: 'Synthetic test fixture', provenance: 'test' }];
  const ui = await mount(t, win, createElement(AccessProvider, { access: demoAccess }, createElement(Application, { api: {}, fixtures })));
  const shared = ui.renderer.root.findByType(BackToTop);
  for (const [page, Component] of [['home', Dashboard], ['fixtures', Dashboard], ['data-sources', DataSources]]) {
    await act(() => ui.renderer.root.findByType(AppNavigation).props.navigate({ page }));
    assert.equal(ui.renderer.root.findAllByType(Component).length, 1);
    assert.equal(ui.renderer.root.findByType(BackToTop), shared);
    assert.equal(win.scrollListeners.size, 1);
    await ui.scroll(900); assert.ok(ui.button());
    await ui.scroll(0); assert.equal(ui.button(), undefined);
  }
});
