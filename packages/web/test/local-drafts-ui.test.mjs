import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { Author, AuthorCanvas } from '../build/test/Author.js';
import { AuthorToolbar } from '../build/test/AuthorToolbar.js';
import { LocalDrafts } from '../build/test/LocalDrafts.js';
import { AccessProvider } from '../build/test/access.js';
import { authorReducer, emptyDraft } from '../build/test/authoring.js';
import { createDraftStore } from '../build/test/local-drafts.js';
import { draftSourceProblem, reconnectDraft } from '../build/test/draft-source.js';
const dataset = { id: 'prepared-old', name: 'Uploaded data', columns: [{ name: 'team', type: 'STRING' }, { name: 'amount', type: 'INTEGER' }] };
const authored = () => authorReducer({ ...emptyDraft(), dataset }, { type: 'add', kind: 'bar' });
const source = { id: 'prepared-new', ref: { dataset: 'prepared-new' }, name: 'Re-uploaded data', available: true, columns: dataset.columns, connectorId: 'file' };
async function mount(t, props = {}, access = { mode: 'local' }, blocked = false) {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const values = new Map(), storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const store = createDraftStore(() => storage, access);
  const id = store.save(authored());
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), get localStorage() { if (blocked) throw new DOMException('Denied', 'SecurityError'); return storage; } };
  const element = createElement(AccessProvider, { access }, createElement(Author, props));
  let renderer; await act(() => { renderer = create(element); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const find = (type, predicate) => renderer.root.findAllByType(type).find(n => predicate(n.props));
  const button = label => find('button', p => p.children === label || p['aria-label'] === label);
  return { store, id, values, find, get renderer() { return renderer; }, text: () => JSON.stringify(renderer.toJSON()), button,
    click: async label => { const b = button(label); assert.ok(b, label); await act(() => b.props.onClick()); },
    reload: async () => { await act(() => renderer.unmount()); await act(() => { renderer = create(element); }); },
  };
}
test('Save, reload, reopen, rename and delete work through the author UI', async t => {
  const ui = await mount(t);
  await act(() => ui.find('input', p => p.value === 'Untitled analysis').props.onChange({ target: { value: 'Saved chart' } }));
  await ui.click('Save draft'); assert.equal(ui.store.restore().draft.title, 'Saved chart');
  await ui.reload(); assert.match(ui.text(), /Saved chart/);
  await ui.click('New analysis');
  await act(() => ui.find('input', p => p.value === 'Untitled analysis').props.onChange({ target: { value: 'Second chart' } }));
  await ui.click('Save draft'); assert.equal(ui.store.list().length, 2);
  const row = name => ui.renderer.root.findByType(LocalDrafts).findAllByType('li').find(n => n.findByType('strong').props.children === name);
  const clickRow = async (name, action) => { await act(() => row(name).findAllByType('button').find(b => b.props.children === action).props.onClick()); };
  await clickRow('Saved chart', 'Reopen');
  assert.equal(ui.store.restore().draft.title, 'Saved chart');
  await clickRow('Saved chart', 'Rename');
  await act(() => ui.find('input', p => p.autoFocus).props.onChange({ target: { value: 'Renamed chart' } }));
  await act(() => ui.renderer.root.findByType(LocalDrafts).findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(ui.store.restore().draft.title, 'Renamed chart');
  await clickRow('Renamed chart', 'Delete');
  assert.equal(ui.store.list().length, 1); assert.equal(ui.store.restore(), undefined);
  assert.match(ui.text(), /Draft deleted/);
});
test('blocked storage keeps the editor usable and Export JSON available with a specific reason', async t => {
  const ui = await mount(t, {}, { mode: 'local' }, true);
  await ui.click('Save draft');
  assert.match(ui.text(), /Browser storage is blocked/); assert.match(ui.text(), /Export JSON to keep your work/);
  assert.equal(ui.button('Export JSON').props.disabled, false);
  await act(() => ui.find('form', p => p.className === 'add-visual').props.onSubmit({ preventDefault() {} }));
  await ui.click('New analysis');
  assert.equal(ui.renderer.root.findByType(AuthorCanvas).props.draft.sheets[0].visuals.length, 1, 'Failed checkpoint keeps unsaved work in the editor');
  assert.match(ui.text(), /Browser storage is blocked/);
});
test('expired upload blocks live charts, preserves definitions and reconnects compatible prepared data', async t => {
  const calls = [];
  const client = { async listPrepSources() { return [{ ...source, id: dataset.id, ref: { dataset: dataset.id }, available: false, errorCode: 'PREP_SOURCE_NOT_FOUND', columns: [] }, source]; }, async queryDataset(id) { calls.push(id); return { rows: [{ team: 'North', amount: 6 }] }; } };
  const ui = await mount(t, { client });
  assert.match(ui.text(), /Source data expired/); assert.deepEqual(calls, []);
  const before = ui.store.restore().draft;
  await act(() => ui.find('select', p => p.children?.[0]?.props?.children === 'Choose a compatible dataset…').props.onChange({ target: { value: source.id } }));
  await ui.click('Reconnect draft'); await ui.click('Save draft');
  assert.equal(ui.store.restore().draft.dataset.id, source.id);
  assert.deepEqual(ui.store.restore().draft.sheets, before.sheets);
  assert.ok(calls.includes(source.id)); assert.equal(calls.includes('sales'), false);
  assert.doesNotMatch(ui.text(), /Source data expired/);
});
test('renaming preserves active queries, and reopening rechecks expired source data', async t => {
  let expired = false;
  const calls = [];
  const client = { async listPrepSources() { return [{ ...source, id: dataset.id, ref: { dataset: dataset.id }, available: !expired, ...(expired ? { errorCode: 'PREP_SOURCE_NOT_FOUND' } : {}) }]; }, async queryDataset(id) { calls.push(id); return { rows: [{ team: 'North', amount: 6 }] }; } };
  const ui = await mount(t, { client });
  const before = calls.length;
  await act(() => ui.renderer.root.findByType(LocalDrafts).props.onRename(ui.id, 'Renamed live chart'));
  assert.equal(calls.length, before, 'Renaming must not restart identical requests');
  expired = true;
  await act(() => ui.renderer.root.findByType(LocalDrafts).props.onOpen(ui.id));
  assert.match(ui.text(), /Source data expired/);
  assert.equal(calls.length, before, 'Reopening validates the source before querying');
});
test('recovery rejects schema mismatch, unavailable sources and non-prepared references', () => {
  const d = authored();
  for (const invalid of [{ ...source, available: false }, { ...source, ref: 'upload-1' }, { ...source, columns: [{ name: 'team', type: 'INTEGER' }] }]) assert.throws(() => reconnectDraft(d, invalid), /original column names and types/);
  assert.match(draftSourceProblem(dataset, []), /Source data expired/);
  assert.match(draftSourceProblem(dataset, [{ ...source, ref: { dataset: dataset.id }, columns: [] }]), /schema has changed/);
  assert.match(draftSourceProblem(dataset, [{ ...source, ref: { dataset: dataset.id }, available: false, errorCode: 'PREP_SECURITY_REJECTED' }]), /PREP_SECURITY_REJECTED/);
  assert.equal(draftSourceProblem(dataset, [{ ...source, ref: { dataset: dataset.id } }]), undefined);
});
for (const mode of ['local', 'demo', 'hosted']) test(`Publish copy is accurate in ${mode} mode`, async t => {
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer; await act(() => { renderer = create(createElement(AccessProvider, { access: { mode } }, createElement(AuthorToolbar, { draft: emptyDraft(), dispatch() {}, onFit() {}, onJson() {}, onBundle() {}, onImport() {}, fit: true }))); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  await act(() => renderer.root.findAllByType('button').find(b => b.props.children === 'PUBLISH').props.onClick());
  const text = JSON.stringify(renderer.toJSON());
  assert.doesNotMatch(text, /AWS/);
  assert.match(text, mode === 'hosted' ? /hosted deployment with dashboard publication enabled/ : /device-local, not synced or shared/);
  assert.match(text, mode === 'local' ? /This local workspace/ : mode === 'demo' ? /This static demo/ : /nothing has been published/);
});
test('draft names render as escaped text, never executable HTML', () => {
  const html = renderToStaticMarkup(createElement(LocalDrafts, { entries: [{ id: 'draft', name: '<img src=x onerror=alert(1)>', updatedAt: new Date().toISOString() }], onRefresh() {}, onOpen() {}, onDelete() {}, onRename() {} }));
  assert.doesNotMatch(html, /<img/); assert.match(html, /&lt;img/);
});
