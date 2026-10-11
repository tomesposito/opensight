import assert from 'node:assert/strict';
import { act, createElement, StrictMode } from 'react';
import { create } from 'react-test-renderer';
import { Application } from '../build/test/Application.js';
import { AppNavigation } from '../build/test/AppNavigation.js';
import { AccessProvider, demoAccess } from '../build/test/access.js';
import { createDraftStore } from '../build/test/local-drafts.js';

// These tests exercise an open editor; /analyses/new now starts at the dataset dialog.
export async function mountPalette(t, { route = '#/analyses/author', access = demoAccess, blocked = false, element } = {}) {
  const old = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const values = new Map(), dialogs = new Map(), listeners = new Set();
  const storage = { getItem: key => values.get(key) ?? null, setItem(key, value) {
    if (blocked) throw new DOMException('Denied', 'SecurityError');
    values.set(key, value);
  } };
  const document = new EventTarget();
  const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
  document.addEventListener = (type, handler) => { if (type === 'keydown') listeners.add(handler); add(type, handler); };
  document.removeEventListener = (type, handler) => { if (type === 'keydown') listeners.delete(handler); remove(type, handler); };
  document.defaultView = new EventTarget();
  const node = (typing = false) => ({ nodeType: 1, isConnected: true, closest: selector => typing && selector.includes('input') ? {} : null,
    focus() { document.activeElement = this; } });
  const trigger = node(), search = node(true), question = node(true), home = node(), close = node();
  document.activeElement = trigger;
  document.getElementById = () => ({ scrollIntoView() {} });
  document.querySelector = selector => selector === 'dialog[open]' ? [...dialogs.values()].find(d => d.open) ?? null : selector === '.product-header .brand' ? home : null;
  const location = new URL(`https://opensight.example/demo.html${route}`);
  globalThis.document = document;
  globalThis.window = { location, localStorage: storage,
    history: { replaceState(_s, _t, hash) { location.hash = hash; }, pushState(_s, _t, hash) { location.hash = hash; } },
    addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixtures = [{ id: 'renderable-sales', name: 'Sample', sheets: [], notice: 'Synthetic test fixture', provenance: 'test' }];
  let renderer;
  await act(() => { renderer = create(createElement(StrictMode, null, createElement(AccessProvider, { access }, element ?? createElement(Application, { api: {}, fixtures }))), {
    createNodeMock(element) {
      if (element.props.className === 'author-workspace') return { ownerDocument: document, closest: () => null };
      if (element.props.className === 'q-trigger') return trigger;
      if (element.props.className === 'q-side-panel') return { ownerDocument: document, querySelector: () => question };
      if (element.props.role === 'combobox') return search;
      if (element.props['aria-label'] === 'Close command palette') return close;
      if (element.type === 'dialog') {
        const dialog = { ownerDocument: document, open: false, showModal() { this.open = true; }, close() { this.open = false; } };
        dialogs.set(element.props.className, dialog); return dialog;
      }
      return null;
    },
  }); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = old.window; globalThis.document = old.document; globalThis.IS_REACT_ACT_ENVIRONMENT = old.act; });
  const input = () => renderer.root.findByProps({ role: 'combobox' });
  const options = () => renderer.root.findAllByProps({ role: 'option' });
  const key = async (key, flags = {}) => {
    const event = new Event('keydown', { cancelable: true });
    Object.defineProperties(event, Object.fromEntries(Object.entries({ key, target: document.activeElement, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...flags }).map(([name, value]) => [name, { value }])));
    await act(() => document.dispatchEvent(event)); return event;
  };
  return {
    renderer, document, listeners, trigger, search, question, home, close, input, options, key,
    labels: () => options().map(option => option.props.children),
    selected: () => options().find(option => option.props['aria-selected'])?.props.children,
    saved: () => createDraftStore(() => storage, access).restore(),
    messages: () => renderer.root.findByProps({ className: 'toast-host' }).findAllByType('span').map(n => n.props.children),
    open: async (modifier = 'ctrlKey') => { trigger.focus(); return key('k', { [modifier]: true }); },
    filter: value => act(() => input().props.onChange({ target: { value } })),
    press: (key, flags = {}) => act(() => input().props.onKeyDown({ key, nativeEvent: {}, preventDefault() {}, ...flags })),
    cancel: () => act(() => renderer.root.findByType('dialog').props.onCancel()),
    navigate: page => act(() => renderer.root.findByType(AppNavigation).props.navigate({ page })),
    click: label => act(() => {
      const button = renderer.root.findAllByType('button').find(b => b.props.children === label || b.props['aria-label'] === label);
      assert.ok(button, label); button.props.onClick();
    }),
    run: async label => { await act(async () => { const option = options().find(n => n.props.children === label); assert.ok(option, label); option.props.onClick(); }); },
  };
}
