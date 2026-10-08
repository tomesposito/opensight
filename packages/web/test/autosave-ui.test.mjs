import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, StrictMode } from 'react';
import { create } from 'react-test-renderer';
import { Author } from '../build/test/Author.js';
import { AccessProvider } from '../build/test/access.js';
import { ToastProvider } from '../build/test/Toasts.js';
import { LocalDrafts } from '../build/test/LocalDrafts.js';
import { emptyDraft } from '../build/test/authoring.js';
import { createDraftStore, draftStorageKey } from '../build/test/local-drafts.js';

const access = { mode: 'local' }, start = '2026-10-08T12:04:00.000Z';
const time = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
async function mount(t, { seed = 'manual', error, strict = false, props = {} } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse(start) });
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const values = new Map(), writes = [], attempts = [];
  let renderer, fail = error;
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      attempts.push(value);
      if (fail === 'QuotaExceededError') throw new DOMException('Refused', fail);
      values.set(key, value); writes.push(renderer ? indicator() : null);
    },
  };
  const store = createDraftStore(() => storage, access);
  if (seed) {
    fail = undefined;
    const id = store.save({ ...emptyDraft(), title: 'Original analysis' });
    if (seed === 'auto') { t.mock.timers.tick(2000); store.autosave({ ...store.restore().draft, title: 'Recovered analysis' }, id, start); }
    fail = error;
  }
  writes.length = 0; attempts.length = 0;
  let reads = 0;
  globalThis.window = {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    get localStorage() { reads++; if (fail === 'SecurityError') throw new DOMException('Refused', fail); return storage; },
  };
  const element = createElement(strict ? StrictMode : 'div', null,
    createElement(AccessProvider, { access }, createElement(ToastProvider, null, createElement(Author, { inApp: true, ...props }))));
  const find = (type, predicate) => renderer.root.findAllByType(type).find(n => predicate(n.props));
  const button = label => find('button', p => p.children === label || p['aria-label'] === label);
  const indicator = () => find('span', p => p.className === 'save-indicator')?.props.children;
  const title = () => renderer.root.find(n => n.type === 'label' && n.props.className === 'analysis-title').findByType('input');
  await act(() => { renderer = create(element); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  return {
    store, values, writes, attempts, find, button, indicator, get renderer() { return renderer; }, get reads() { return reads; },
    text: () => JSON.stringify(renderer.toJSON()),
    messages: () => renderer.root.findAll(n => n.props.className === 'toast' || n.props.className === 'toast toast-leaving').map(n => n.findByType('span').props.children),
    edit: async value => { await act(() => title().props.onChange({ target: { value } })); },
    click: async label => { assert.ok(button(label), label); await act(() => button(label).props.onClick()); },
    tick: async ms => { await act(() => t.mock.timers.tick(ms)); },
    reload: async () => { await act(() => renderer.unmount()); renderer = undefined; await act(() => { renderer = create(element); }); },
    block: value => { fail = value; },
  };
}

test('auto-save commits Saving then Saved, keeps current edits on reload and enables draft links', async t => {
  const ui = await mount(t);
  await ui.edit('Edited analysis');
  assert.equal(ui.indicator(), 'Unsaved changes'); assert.equal(ui.button('Copy draft link').props.disabled, true);
  await ui.tick(1999); assert.equal(ui.writes.length, 0);
  await ui.tick(1);
  assert.deepEqual(ui.writes, ['Saving…'], 'The saving status commits before storage writes');
  assert.equal(ui.indicator(), `Saved · ${time(start)}`);
  assert.equal(ui.store.restore().draft.title, 'Edited analysis'); assert.equal(ui.button('Copy draft link').props.disabled, false);
  assert.deepEqual(ui.messages(), [], 'Auto-save success stays quiet');
  await ui.reload(); assert.match(ui.text(), /Edited analysis/);
  assert.equal(ui.indicator(), `Saved · ${time(start)}`); assert.doesNotMatch(ui.text(), /Unsaved changes|Save draft before leaving/);
  const writes = ui.writes.length; await ui.tick(6000); assert.equal(ui.writes.length, writes);
});
test('a never-saved draft adopts its first auto-save id without duplicate entries', async t => {
  const ui = await mount(t, { seed: false }); assert.equal(ui.indicator(), undefined);
  await ui.edit('First analysis'); await ui.tick(2000);
  assert.equal(ui.store.list().length, 1); assert.equal(ui.store.restore().manualSavedAt, undefined); assert.equal(ui.button('Copy draft link').props.disabled, false);
  await ui.edit('Next analysis'); await ui.tick(2000);
  assert.equal(ui.store.list().length, 1); assert.equal(ui.store.restore().draft.title, 'Next analysis');
});
test('pending auto-save recovery notice checkpoints through Save draft', async t => {
  const ui = await mount(t, { seed: 'auto' }); assert.match(ui.text(), /Recovered auto-saved work from/);
  const notice = ui.find('div', p => p.className === 'draft-recovery');
  assert.deepEqual(notice.findByType('span').props.children, ['Recovered auto-saved work from ', time(start), ' — it was never manually saved.']);
  await act(() => notice.findAllByType('button').find(b => b.props.children === 'Save draft').props.onClick());
  assert.equal(ui.store.restore().autoSavedAt, undefined); assert.equal(ui.store.restore().manualSavedAt, new Date().toISOString());
  assert.doesNotMatch(ui.text(), /Recovered auto-saved work from/);
  await ui.reload(); assert.doesNotMatch(ui.text(), /Recovered auto-saved work from/);
});
test('dismissing recovery clears its marker while retaining work across reload', async t => {
  const ui = await mount(t, { seed: 'auto' }); await ui.click('Dismiss');
  assert.equal(ui.store.restore().autoSavedAt, undefined); assert.equal(ui.store.restore().draft.title, 'Recovered analysis');
  assert.doesNotMatch(ui.text(), /Recovered auto-saved work from/);
  await ui.reload(); assert.doesNotMatch(ui.text(), /Recovered auto-saved work from/); assert.match(ui.text(), /Recovered analysis/);
});
test('manual save cancels a pending debounce without an extra auto-save', async t => {
  const ui = await mount(t); await ui.edit('Manual analysis'); await ui.tick(1000); await ui.click('Save draft');
  const count = ui.writes.length; assert.equal(count, 1); assert.equal(ui.store.restore().autoSavedAt, undefined);
  assert.equal(ui.indicator(), `Saved · ${time(start)}`); await ui.tick(10000); assert.equal(ui.writes.length, count);
  await ui.edit('Later analysis'); await ui.tick(2000); assert.equal(ui.store.restore().draft.title, 'Later analysis');
});
test('debounce uses the latest content and resets on edits; unmount cancels it in StrictMode', async t => {
  const ui = await mount(t, { strict: true }); await ui.edit('First analysis'); await ui.tick(1500);
  await ui.edit('Latest analysis'); await ui.tick(1999); assert.equal(ui.writes.length, 0);
  await ui.tick(1); assert.equal(ui.writes.length, 1); assert.equal(ui.store.restore().draft.title, 'Latest analysis');
  await ui.edit('Unmounted analysis'); await act(() => ui.renderer.unmount()); await ui.tick(10000); assert.equal(ui.writes.length, 1);
});
for (const error of ['SecurityError', 'QuotaExceededError']) test(`${error} toasts once without retry loops; the next edit can retry`, async t => {
  const ui = await mount(t, { seed: false, error }); await ui.edit('Unsaved analysis'); await ui.tick(2000);
  assert.equal(ui.indicator(), 'Unsaved changes'); assert.equal(ui.messages().length, 1);
  assert.match(ui.messages()[0], error === 'SecurityError' ? /storage is blocked/ : /storage is full/); assert.match(ui.messages()[0], /Export JSON to keep your work/);
  const reads = ui.reads, attempts = ui.attempts.length;
  await ui.tick(10000); assert.deepEqual(ui.messages(), []); assert.equal(ui.reads, reads); assert.equal(ui.attempts.length, attempts);
  await ui.edit('Retry analysis'); await ui.tick(2000); assert.equal(ui.messages().length, 1, 'The same error on a new attempt is announced again');
  ui.block(undefined); await ui.edit('Retained analysis'); await ui.tick(2000);
  assert.equal(ui.store.restore().draft.title, 'Retained analysis'); assert.match(ui.indicator(), /^Saved · /);
});
test('another tab manual save is preserved and stale auto-save errors stop until the next edit', async t => {
  const ui = await mount(t); await ui.edit('Stale analysis'); await ui.tick(1000);
  ui.store.save({ ...ui.store.restore().draft, title: 'Other tab analysis' }, ui.store.restore().id);
  const before = ui.values.get(draftStorageKey(access)); await ui.tick(1000);
  assert.equal(ui.indicator(), 'Unsaved changes'); assert.match(ui.messages()[0], /saved in another tab. Reload to keep editing/);
  assert.equal(ui.values.get(draftStorageKey(access)), before); await ui.tick(10000); assert.equal(ui.values.get(draftStorageKey(access)), before);
});
test('reopening another recovered draft resets sync metadata and cancels previous pending work', async t => {
  const ui = await mount(t), first = ui.store.restore().id; await ui.tick(1000);
  const second = ui.store.autosave({ ...emptyDraft(), title: 'Other analysis' }); await ui.edit('Checkpoint analysis');
  await act(() => ui.renderer.root.findByType(LocalDrafts).props.onOpen(second));
  assert.match(ui.text(), /Recovered auto-saved work from/); assert.equal(ui.store.list().find(e => e.id === first).name, 'Checkpoint analysis');
  await ui.edit('Reopened analysis'); await ui.tick(2000);
  assert.equal(ui.store.restore().id, second); assert.equal(ui.store.restore().draft.title, 'Reopened analysis'); assert.equal(ui.messages().length, 0);
});
test('an unavailable draft link never auto-saves an empty replacement', async t => {
  const ui = await mount(t, { props: { draftId: 'missing' } }); assert.match(ui.text(), /Unable to open analysis/);
  await ui.tick(10000); assert.equal(ui.writes.length, 0); assert.equal(ui.store.restore().draft.title, 'Original analysis');
});
