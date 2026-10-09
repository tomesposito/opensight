import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { Application } from '../build/test/Application.js';
import { AppNavigation } from '../build/test/AppNavigation.js';
import { AccessProvider, demoAccess } from '../build/test/access.js';
import { createDraftStore } from '../build/test/local-drafts.js';
import { emptyDraft, serializeDraft } from '../build/test/authoring.js';
import { AUTHOR_SHORTCUTS } from '../build/test/keyboard-shortcuts.js';

async function mount(t, { blocked = false } = {}) {
  const previous = { window: globalThis.window, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem(key, value) {
    if (blocked) throw new DOMException('Denied', 'SecurityError');
    values.set(key, value);
  } };
  const document = new EventTarget(), dialogs = new Map();
  document.defaultView = new EventTarget();
  document.getElementById = () => null;
  document.querySelector = selector => selector === 'dialog[open]' ? [...dialogs.values()].find(d => d.open) ?? null : null;
  const node = extra => ({ nodeType: 1, isConnected: true, closest: () => null,
    focus() { document.activeElement = this; }, ...extra });
  const canvas = node({}), searchMenu = { open: false };
  const search = node({ closest: selector => selector === 'details' ? searchMenu : selector.includes('input') ? search : null });
  const question = node({ closest: selector => selector.includes('input') ? question : null });
  const trigger = node({});
  const workspace = { ownerDocument: document, closest: () => workspace, querySelector: selector => selector === '.analysis-search' ? search : null };
  document.activeElement = canvas;
  const location = new URL('https://opensight.example/demo.html#/analyses/author');
  globalThis.window = { location, localStorage: storage,
    history: { replaceState(_s, _t, hash) { location.hash = hash; }, pushState(_s, _t, hash) { location.hash = hash; } },
    addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let renderer;
  await act(() => { renderer = create(createElement(AccessProvider, { access: demoAccess }, createElement(Application, { api: {}, fixtures: [] })), {
    createNodeMock(element) {
      if (element.props.className === 'author-workspace') return workspace;
      if (element.props.className === 'q-trigger') return trigger;
      if (element.props.className === 'q-side-panel') return { ownerDocument: document, querySelector: () => question };
      if (element.type === 'dialog') {
        const dialog = { ownerDocument: document, open: false, showModal() { this.open = true; }, close() { this.open = false; } };
        dialogs.set(element.props.className, dialog); return dialog;
      }
      return null;
    },
  }); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = previous.window; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act; });
  return {
    renderer, document, canvas, search, searchMenu, question, trigger,
    saved: () => createDraftStore(() => storage, demoAccess).restore(),
    messages: () => renderer.root.findByProps({ className: 'toast-host' }).findAllByType('span').map(n => n.props.children),
    title: value => act(() => renderer.root.findByProps({ className: 'analysis-title' }).findByType('input').props.onChange({ target: { value } })),
    async click(label) {
      const button = renderer.root.findAllByType('button').find(b => b.props.children === label || b.props['aria-label'] === label);
      assert.ok(button, label); await act(() => button.props.onClick());
    },
    async key(options) {
      const event = new Event('keydown', { cancelable: true });
      Object.defineProperties(event, Object.fromEntries(Object.entries({ key: '', target: document.activeElement, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...options }).map(([name, value]) => [name, { value }])));
      await act(() => document.dispatchEvent(event)); return event;
    },
    // Node has no native dialog default action. Simulate the cancel event which
    // a browser sends after an unconsumed Escape; test key pass-through separately.
    async cancel() {
      const dialog = document.querySelector('dialog[open]');
      await act(() => renderer.root.findByType('dialog').props.onCancel());
      dialog?.close();
    },
  };
}

for (const modifier of ['metaKey', 'ctrlKey']) test(`${modifier}+S saves the latest draft through the real store and toast host`, async t => {
  const ui = await mount(t);
  await ui.title('First edit');
  assert.equal(ui.saved(), undefined, 'typing does not auto-save');
  assert.equal((await ui.key({ key: 's', [modifier]: true })).defaultPrevented, true);
  assert.equal(ui.saved().draft.title, 'First edit');
  assert.deepEqual(ui.messages(), ['Draft saved']);
  const id = ui.saved().id;
  await ui.title('Latest edit'); await ui.key({ key: 'S', [modifier]: true });
  assert.equal(ui.saved().draft.title, 'Latest edit');
  assert.equal(ui.saved().id, id, 'update the current draft, do not create another');
  assert.deepEqual(ui.messages(), ['Draft saved'], 'existing toast deduplication is used');
});

test('shortcut storage failure preserves the error and never announces a save', async t => {
  const ui = await mount(t, { blocked: true });
  assert.equal((await ui.key({ key: 's', ctrlKey: true })).defaultPrevented, true);
  assert.equal(ui.saved(), undefined); assert.equal(ui.messages().length, 1);
  assert.match(ui.messages()[0], /Browser storage is blocked.*Export JSON/);
  assert.match(JSON.stringify(ui.renderer.toJSON()), /Browser storage is blocked/);
});

test('Cmd/Ctrl+F opens the existing palette for analysis actions', async t => {
  const ui = await mount(t);
  for (const modifier of ['metaKey', 'ctrlKey']) {
    ui.canvas.focus();
    assert.equal((await ui.key({ key: 'f', [modifier]: true })).defaultPrevented, true);
    assert.equal(ui.renderer.root.findByType('dialog').props.className, 'command-palette');
    const input = ui.renderer.root.findByProps({ role: 'combobox' });
    assert.equal(input.props.placeholder, 'Search analysis actions…');
    assert.equal((await ui.key({ key: 'f', [modifier]: true, target: ui.search })).defaultPrevented, false);
    await ui.cancel();
  }
});

test('? opens grouped help for the whole registry; Escape cancels and restores focus', async t => {
  const ui = await mount(t);
  for (const keys of [{ key: '?' }, { key: '/', shiftKey: true }]) {
    assert.equal((await ui.key(keys)).defaultPrevented, true);
    const dialog = ui.renderer.root.findByType('dialog');
    assert.equal(ui.document.querySelector('dialog[open]').open, true);
    assert.equal(dialog.findByProps({ id: dialog.props['aria-labelledby'] }).props.children, 'Keyboard shortcuts');
    assert.deepEqual(dialog.findAllByType('h3').map(n => n.props.children), ['Analysis', 'Navigation', 'Help']);
    assert.equal(dialog.findAllByType('dt').length, AUTHOR_SHORTCUTS.length);
    const content = node => typeof node === 'string' ? node : node.children.map(content).join(' ');
    const text = dialog.findAllByType('dt').map(content).join(' ');
    for (const shortcut of AUTHOR_SHORTCUTS) assert.ok(text.includes(shortcut.label), shortcut.id);
    assert.doesNotMatch(text, /coming in #53/);
    assert.deepEqual(dialog.findAllByType('kbd').map(n => n.props.children), ['Cmd/Ctrl', 'S', 'Cmd/Ctrl', 'F', 'Cmd/Ctrl', 'K', 'Shift', '/', 'Esc']);
    for (const options of [{ key: 's', ctrlKey: true }, { key: 'f', metaKey: true }, { key: '?' }]) {
      assert.equal((await ui.key(options)).defaultPrevented, false, 'modal owns keyboard input');
    }
    assert.equal(ui.saved(), undefined); assert.equal(ui.searchMenu.open, false);
    assert.equal((await ui.key({ key: 'Escape', target: ui.search })).defaultPrevented, false);
    await ui.cancel();
    assert.equal(ui.renderer.root.findAllByType('dialog').length, 0);
    assert.equal(ui.document.activeElement, ui.canvas);
  }
  await ui.key({ key: '?' }); await ui.click('Close keyboard shortcuts');
  assert.equal(ui.renderer.root.findAllByType('dialog').length, 0);
  assert.equal(ui.document.activeElement, ui.canvas);
});

test('Cmd/Ctrl+K opens the real palette without saving or announcing a toggle', async t => {
  const ui = await mount(t);
  for (const modifier of ['metaKey', 'ctrlKey']) {
    assert.equal((await ui.key({ key: 'k', [modifier]: true })).defaultPrevented, true);
    assert.equal(ui.renderer.root.findByType('dialog').props.className, 'command-palette');
    assert.equal(ui.saved(), undefined); assert.deepEqual(ui.messages(), []);
    await ui.cancel(); assert.equal(ui.document.activeElement, ui.canvas);
  }
});

test('Author leaves typing and composition alone, retaining composition state across draft updates', async t => {
  const ui = await mount(t);
  for (const target of ['input', 'textarea', 'select', 'contenteditable'].map(tag => ({ nodeType: 1, closest: selector => selector.includes(tag) ? {} : null }))) {
    for (const options of [{ key: '?', shiftKey: true }, ...['s', 'f', 'k'].map(key => ({ key, ctrlKey: true }))]) {
      assert.equal((await ui.key({ ...options, target })).defaultPrevented, false);
    }
  }
  ui.document.dispatchEvent(new Event('compositionstart'));
  await ui.title('Composing');
  assert.equal((await ui.key({ key: 's', ctrlKey: true })).defaultPrevented, false);
  ui.document.dispatchEvent(new Event('compositionend'));
  for (const flags of [{ isComposing: true }, { keyCode: 229 }]) assert.equal((await ui.key({ key: '?', ...flags })).defaultPrevented, false);
  assert.equal(ui.saved(), undefined); assert.deepEqual(ui.messages(), []);
  assert.equal(ui.searchMenu.open, false); assert.equal(ui.renderer.root.findAllByType('dialog').length, 0);
  await ui.key({ key: 's', ctrlKey: true }); assert.equal(ui.saved().draft.title, 'Composing');
});

test('Escape closes existing calculation/import dialogs through cancel and closes Ask Q from its input', async t => {
  const ui = await mount(t);
  await ui.click('+ Calculated field');
  assert.equal(ui.renderer.root.findByType('dialog').props.className, 'calculation-dialog');
  assert.equal((await ui.key({ key: 'Escape', target: ui.search })).defaultPrevented, false);
  await ui.cancel(); assert.equal(ui.renderer.root.findAllByType('dialog').length, 0);
  const bytes = new TextEncoder().encode(JSON.stringify(serializeDraft(emptyDraft())));
  await act(async () => ui.renderer.root.findAllByType('input').find(n => n.props.type === 'file').props.onChange({ currentTarget: { value: 'analysis.json', files: [{ name: 'analysis.json', size: bytes.length, arrayBuffer: async () => bytes.buffer }] } }));
  assert.equal(ui.renderer.root.findByType('dialog').props.className, 'import-report');
  assert.equal((await ui.key({ key: 'Escape' })).defaultPrevented, false);
  await ui.cancel(); assert.equal(ui.renderer.root.findAllByType('dialog').length, 0);
  assert.deepEqual(ui.messages(), ['Bundle imported']);
  await act(() => ui.renderer.root.findByProps({ className: 'q-trigger' }).props.onClick());
  assert.equal(ui.document.activeElement, ui.question);
  for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
    assert.equal((await ui.key({ key: 'Escape', ...flags })).defaultPrevented, false);
    assert.equal(ui.renderer.root.findAllByProps({ className: 'q-side-panel' }).length, 1);
  }
  assert.equal((await ui.key({ key: 'Escape' })).defaultPrevented, true);
  assert.equal(ui.renderer.root.findAllByProps({ className: 'q-side-panel' }).length, 0);
  assert.equal(ui.document.activeElement, ui.trigger);
});

test('help above Ask Q owns Escape; a second Escape closes Q', async t => {
  const ui = await mount(t);
  await act(() => ui.renderer.root.findByProps({ className: 'q-trigger' }).props.onClick());
  ui.canvas.focus(); await ui.key({ key: '?' });
  assert.equal((await ui.key({ key: 'Escape' })).defaultPrevented, false);
  await ui.cancel();
  assert.equal(ui.renderer.root.findAllByProps({ className: 'q-side-panel' }).length, 1);
  assert.equal(ui.document.activeElement, ui.canvas);
  assert.equal((await ui.key({ key: 'Escape' })).defaultPrevented, true);
  assert.equal(ui.renderer.root.findAllByProps({ className: 'q-side-panel' }).length, 0);
});

test('leaving Author removes the listener so browser shortcuts work on other pages', async t => {
  const ui = await mount(t);
  await act(() => ui.renderer.root.findByType(AppNavigation).props.navigate({ page: 'analyses' }));
  for (const options of [{ key: '?' }, ...['s', 'f', 'k'].map(key => ({ key, metaKey: true }))]) {
    assert.equal((await ui.key(options)).defaultPrevented, false);
  }
  assert.equal(ui.saved(), undefined); assert.deepEqual(ui.messages(), []);
});
