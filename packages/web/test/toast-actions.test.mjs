import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { assembleQsBundle } from '@opensight/bundle-parser/browser';
import { Application } from '../build/test/Application.js';
import { AppNavigation } from '../build/test/AppNavigation.js';
import { AuthorToolbar } from '../build/test/AuthorToolbar.js';
import { AuthorCanvas } from '../build/test/Author.js';
import { AccessProvider, demoAccess } from '../build/test/access.js';
import { emptyDraft, serializeDraft } from '../build/test/authoring.js';
import { createDraftStore } from '../build/test/local-drafts.js';
import { ToastProvider } from '../build/test/Toasts.js';

async function mount(t, { blocked = false, clipboard } = {}) {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const values = new Map(), copied = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem(key, value) { if (blocked) throw new DOMException('Denied', 'SecurityError'); values.set(key, value); } };
  const location = new URL('https://opensight.example/demo.html?unused=value#/analyses/new');
  globalThis.window = { location, localStorage: storage,
    history: { replaceState(_s, _t, hash) { location.hash = hash; }, pushState(_s, _t, hash) { location.hash = hash; } },
    addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: clipboard === null ? undefined : clipboard ?? { async writeText(text) { copied.push(text); } } } });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const element = access => createElement(AccessProvider, { access }, createElement(Application, { api: {}, fixtures: [] }));
  let renderer;
  await act(() => { renderer = create(element(demoAccess)); });
  t.after(async () => {
    await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else delete globalThis.navigator;
  });
  const button = label => renderer.root.findAllByType('button').find(b => b.props.children === label || b.props['aria-label'] === label);
  return { renderer, copied, location, button, store: createDraftStore(() => storage, demoAccess),
    messages: () => renderer.root.findByProps({ className: 'toast-host' }).findAllByType('span').map(n => n.props.children),
    click: label => act(() => { assert.ok(button(label)); button(label).props.onClick(); }),
    title: value => act(() => renderer.root.findByProps({ className: 'analysis-title' }).findByType('input').props.onChange({ target: { value } })),
    tick: ms => act(() => t.mock.timers.tick(ms)),
    changeAccess: access => act(() => renderer.update(element(access))),
  };
}

test('real Save draft control confirms persisted data, dedupes clicks and fades in the app shell', async t => {
  const ui = await mount(t);
  assert.deepEqual(ui.messages(), []);
  await ui.title('Toast test analysis'); await ui.click('Save draft');
  assert.equal(ui.store.restore().draft.title, 'Toast test analysis');
  assert.deepEqual(ui.messages(), ['Draft saved']);
  assert.match(ui.location.hash, /^#\/analyses\/drafts\//);
  await ui.click('Save draft'); assert.deepEqual(ui.messages(), ['Draft saved']);
  await ui.tick(5000); assert.equal(ui.renderer.root.findAllByProps({ className: 'toast toast-leaving' }).length, 1);
  await ui.tick(180); assert.deepEqual(ui.messages(), []);
});

test('failed draft storage never shows a success toast', async t => {
  const ui = await mount(t, { blocked: true });
  await ui.click('Save draft');
  assert.equal(ui.messages().length, 1); assert.match(ui.messages()[0], /Browser storage is blocked.*Export JSON/);
  assert.match(JSON.stringify(ui.renderer.toJSON()), /Browser storage is blocked/);
  assert.equal(ui.button('Copy draft link').props.disabled, true);
});

test('Copy draft link copies the exact saved route, explains device scope and requires saved changes', async t => {
  const ui = await mount(t);
  assert.equal(ui.button('Copy draft link').props.disabled, true);
  await ui.click('Copy draft link'); assert.deepEqual(ui.copied, []);
  await ui.click('Save draft');
  assert.equal(ui.button('Copy draft link').props.disabled, false);
  const help = ui.renderer.root.findByProps({ id: ui.button('Copy draft link').props['aria-describedby'] });
  assert.match(help.props.children, /only in this browser on this device; they do not share/);
  await ui.click('Copy draft link');
  assert.deepEqual(ui.copied, [`https://opensight.example/demo.html#/analyses/drafts/${ui.store.restore().id}`]);
  assert.deepEqual(ui.messages(), ['Draft saved', 'Link copied']);
  await ui.click('Copy draft link'); assert.equal(ui.messages().filter(m => m === 'Link copied').length, 1);
  await ui.title('Unsaved edits'); assert.equal(ui.button('Copy draft link').props.disabled, true);
  await ui.click('Copy draft link'); assert.equal(ui.copied.length, 2);
});

test('clipboard confirmation waits for the browser to finish writing', async t => {
  let complete;
  const ui = await mount(t, { clipboard: { writeText: () => new Promise(resolve => { complete = resolve; }) } });
  await ui.click('Save draft'); await ui.tick(5180); await ui.click('Copy draft link');
  assert.equal(ui.button('Copy draft link').props.disabled, true);
  assert.deepEqual(ui.messages(), []);
  await act(() => complete());
  assert.deepEqual(ui.messages(), ['Link copied']);
  assert.equal(ui.button('Copy draft link').props.disabled, false);
});

for (const [name, clipboard] of [['unavailable', null], ['denied', { async writeText() { throw new DOMException('Denied', 'NotAllowedError'); } }]]) {
  test(`${name} clipboard preserves a useful error and never claims a link was copied`, async t => {
    const ui = await mount(t, { clipboard }); await ui.click('Save draft'); await ui.tick(5180);
    await ui.click('Copy draft link');
    assert.deepEqual(ui.messages(), []);
    assert.match(ui.renderer.root.findByProps({ role: 'alert' }).props.children, /Could not copy.*browser’s address bar/);
    assert.equal(ui.button('Copy draft link').props.disabled, false);
  });
}

const resource = () => serializeDraft({ ...emptyDraft(), title: 'Imported analysis' });
const file = (name, bytes) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
async function importFile(ui, name, bytes, drop = false) {
  await act(async () => {
    if (drop) ui.renderer.root.findByProps({ 'aria-label': 'Bundle drop zone' }).props.onDrop({ preventDefault() {}, dataTransfer: { files: [file(name, bytes)] } });
    else ui.renderer.root.findAllByType('input').find(n => n.props.type === 'file').props.onChange({ currentTarget: { files: [file(name, bytes)], value: name } });
  });
}

for (const drop of [false, true]) test(`successful ${drop ? 'JSON drop' : 'ZIP file selection'} confirms import after the modal report closes`, async t => {
  const ui = await mount(t);
  const bytes = drop ? new TextEncoder().encode(JSON.stringify(resource())) : await assembleQsBundle({ members: [{ path: 'analysis/authored-analysis.json', resource: resource() }] });
  await importFile(ui, drop ? 'imported.json' : 'imported.qs', bytes, drop);
  assert.deepEqual(ui.messages(), [], 'Do not show a toast behind an inert modal backdrop');
  assert.equal(ui.renderer.root.findByType(AuthorCanvas).props.draft.title, 'Imported analysis');
  assert.equal(ui.renderer.root.findAllByType('dialog').length, 1);
  if (drop) await act(() => ui.renderer.root.findByType('dialog').props.onCancel());
  else await ui.click('Close import report');
  assert.deepEqual(ui.messages(), ['Bundle imported']);
  await ui.tick(5180);
  await ui.click('View import report'); await ui.click('Close import report');
  assert.deepEqual(ui.messages(), [], 'Reviewing an old report is not another import');
});

test('invalid and paused imports never claim success or replace the current draft', async t => {
  const ui = await mount(t, { blocked: true }); await ui.title('Keep these edits');
  await importFile(ui, 'bad.qs', new TextEncoder().encode('invalid zip'));
  assert.deepEqual(ui.messages(), []);
  assert.match(JSON.stringify(ui.renderer.toJSON()), /Import failed/);
  await importFile(ui, 'good.json', new TextEncoder().encode(JSON.stringify(resource())));
  assert.equal(ui.messages().length, 1); assert.match(ui.messages()[0], /Browser storage is blocked.*Export JSON/);
  assert.match(JSON.stringify(ui.renderer.toJSON()), /Import paused/);
  assert.equal(ui.renderer.root.findByType(AuthorCanvas).props.draft.title, 'Keep these edits');
});

for (const mode of ['demo', 'local', 'hosted']) test(`Publish in ${mode} mode gives an honest toast and keeps the detailed notice`, async t => {
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  await act(() => { renderer = create(createElement(ToastProvider, null, createElement(AccessProvider, { access: { mode } }, createElement(AuthorToolbar, { draft: emptyDraft(), dispatch() {}, onFit() {}, onJson() {}, onBundle() {}, onImport() {}, fit: true })))); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  for (let i = 0; i < 2; i++) await act(() => renderer.root.findAllByType('button').find(b => b.props.children === 'PUBLISH').props.onClick());
  assert.deepEqual(renderer.root.findByProps({ className: 'toast-host' }).findAllByType('span').map(n => n.props.children), ['Publishing is unavailable in this editor. Nothing has been published.']);
  assert.match(renderer.root.findByProps({ className: 'toolbar-notice' }).props.children[0], mode === 'hosted' ? /hosted deployment/ : /device-local, not synced or shared/);
});

test('one toast host survives page navigation but clears when the workspace identity changes', async t => {
  const ui = await mount(t); await ui.click('Save draft');
  await act(() => ui.renderer.root.findByType(AppNavigation).props.navigate({ page: 'analyses' }));
  assert.deepEqual(ui.messages(), ['Draft saved']);
  assert.equal(ui.renderer.root.findAllByProps({ className: 'toast-host' }).length, 1);
  await ui.changeAccess({ mode: 'hosted', session: { id: 'another-user', namespaceId: 'test-workspace', role: 'reader', name: 'Reader' } });
  assert.deepEqual(ui.messages(), []);
  await ui.tick(10000); assert.deepEqual(ui.messages(), []);
});
