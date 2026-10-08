import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, StrictMode } from 'react';
import { create } from 'react-test-renderer';
import { ToastProvider, useToast } from '../build/test/Toasts.js';

async function mount(t) {
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  function Actions() {
    const notify = useToast();
    return ['Draft saved', 'Link copied'].map(message => createElement('button', { key: message, onClick: () => notify(message) }, message));
  }
  let renderer;
  await act(() => { renderer = create(createElement(StrictMode, null, createElement(ToastProvider, null, createElement(Actions)))); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  return { renderer, toasts: () => renderer.root.findAll(n => n.type === 'div' && /^toast(?: |$)/.test(n.props.className ?? '')),
    click: label => act(() => renderer.root.findAllByType('button').find(b => b.props.children === label || b.props['aria-label'] === label).props.onClick()),
    tick: ms => act(() => t.mock.timers.tick(ms)),
  };
}

test('toasts use a persistent polite status region and stack distinct messages without moving focus', async t => {
  const ui = await mount(t);
  const status = ui.renderer.root.findByProps({ role: 'status' });
  assert.equal(status.props['aria-live'], 'polite');
  assert.equal(status.props['aria-atomic'], 'false');
  assert.equal(ui.toasts().length, 0);
  await ui.click('Draft saved'); await ui.click('Link copied');
  assert.equal(ui.renderer.root.findByProps({ role: 'status' }), status);
  assert.deepEqual(ui.toasts().map(n => n.findByType('span').props.children), ['Draft saved', 'Link copied']);
  for (const toast of ui.toasts()) {
    const button = toast.findByType('button');
    assert.equal(button.props.type, 'button');
    assert.match(button.props['aria-label'], /^Dismiss notification:/);
    assert.equal(button.props.autoFocus, undefined);
  }
});

test('identical messages collapse while visible, expire on time, and can be shown again', async t => {
  const ui = await mount(t);
  await ui.click('Draft saved'); await ui.tick(3000); await ui.click('Draft saved');
  assert.equal(ui.toasts().length, 1);
  await ui.tick(1999); assert.equal(ui.toasts()[0].props.className, 'toast');
  await ui.tick(1); assert.equal(ui.toasts()[0].props.className, 'toast toast-leaving');
  await ui.tick(180); assert.equal(ui.toasts().length, 0);
  await ui.click('Draft saved'); assert.equal(ui.toasts().length, 1);
});

test('a close button dismisses only its own toast and clears its timer', async t => {
  const ui = await mount(t);
  await ui.click('Draft saved'); await ui.tick(2000); await ui.click('Link copied');
  await ui.click('Dismiss notification: Draft saved');
  assert.deepEqual(ui.toasts().map(n => n.findByType('span').props.children), ['Link copied']);
  await ui.click('Draft saved'); await ui.tick(3180);
  assert.equal(ui.toasts().length, 2, 'The old timer must not remove a new copy of the message');
  await ui.tick(2000); assert.equal(ui.toasts().length, 0);
});

test('hover and keyboard focus pause expiry until both leave', async t => {
  const ui = await mount(t); await ui.click('Draft saved');
  await act(() => { ui.toasts()[0].props.onMouseEnter(); ui.toasts()[0].props.onFocus(); });
  await ui.tick(10000); assert.equal(ui.toasts().length, 1);
  await act(() => ui.toasts()[0].props.onMouseLeave());
  await ui.tick(10000); assert.equal(ui.toasts().length, 1);
  await act(() => ui.toasts()[0].props.onBlur());
  await ui.tick(5180); assert.equal(ui.toasts().length, 0);
});

test('unmounting the host clears pending notifications and timers', async t => {
  const ui = await mount(t); await ui.click('Draft saved');
  await act(() => ui.renderer.update(null));
  await ui.tick(10000);
  assert.equal(ui.renderer.toJSON(), null);
});
