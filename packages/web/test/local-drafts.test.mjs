import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore, draftStorageKey, draftStorageError, MAX_DRAFTS, MAX_DRAFT_CHARS } from '../build/test/local-drafts.js';
import { emptyDraft, authorReducer, DRAFT_KEY } from '../build/test/authoring.js';
const access = { mode: 'local' };
const draft = name => ({ ...authorReducer(emptyDraft(), { type: 'add', kind: 'bar' }), title: name });
const setup = () => {
  const values = new Map();
  const storage = () => ({ getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) });
  return { values, storage, store: createDraftStore(storage, access) };
};
test('local drafts round trip edits, reopen independent analyses, rename, delete and reload', () => {
  const { store, storage } = setup(), a = draft('First'), b = draft('Second');
  const first = store.save(a), second = store.save(b);
  assert.notEqual(first, second);
  assert.deepEqual(store.open(first), a);
  assert.deepEqual(createDraftStore(storage, access).restore(), { id: first, draft: a });
  store.rename(second, 'Renamed');
  assert.equal(store.restore().id, first, 'Renaming another draft does not change the active analysis');
  assert.equal(store.open(second).title, 'Renamed');
  assert.equal(store.list().length, 2);
  assert.ok(store.list().every(e => Number.isFinite(Date.parse(e.updatedAt))));
  store.delete(second);
  assert.equal(store.restore(), undefined);
  assert.deepEqual(store.open(first), a);
  assert.throws(() => store.save(b, second), /no longer exists/);
  assert.throws(() => store.rename(first, '  '), /Enter an analysis name/);
});
test('legacy local and demo drafts migrate on write without destroying originals or leaking to hosted users', () => {
  const { values, storage, store } = setup();
  values.set(`local.${DRAFT_KEY}`, JSON.stringify(draft('Local legacy')));
  values.set(DRAFT_KEY, JSON.stringify(draft('Demo legacy')));
  assert.equal(store.restore().draft.title, 'Local legacy');
  store.save(store.restore().draft, 'legacy');
  assert.ok(values.has(`local.${DRAFT_KEY}`));
  store.delete('legacy');
  assert.deepEqual(store.list(), [], 'The retained legacy entry is not migrated again after deletion');
  assert.equal(createDraftStore(storage, { mode: 'demo' }).restore().draft.title, 'Demo legacy');
  const hosted = { mode: 'hosted', session: { id: 'alice', namespaceId: 'one' } };
  assert.equal(createDraftStore(storage, hosted).restore(), undefined);
  createDraftStore(storage, hosted).save(draft('Private definition'));
  assert.equal(createDraftStore(storage, { ...hosted, session: { id: 'bob', namespaceId: 'one' } }).restore(), undefined);
  assert.equal(createDraftStore(storage, { ...hosted, session: { id: 'alice', namespaceId: 'two' } }).restore(), undefined);
});
test('storage blocked and full errors explain the reason and retain export fallback', () => {
  for (const name of ['SecurityError', 'QuotaExceededError']) {
    const error = new DOMException('Browser refused', name);
    const store = createDraftStore(() => { throw error; }, access);
    assert.throws(() => store.save(draft('Work')), e => e === error);
    assert.match(draftStorageError(error), name === 'SecurityError' ? /storage is blocked/ : /storage is full/);
    assert.match(draftStorageError(error), /Export JSON/);
  }
  assert.match(draftStorageError(new Error('Storage unavailable')), /Storage unavailable/);
});
test('corrupt definitions and attempted executable content never become editor state; corrupt entries remain deletable', () => {
  const { store, values } = setup(), id = store.save(draft('Valid')), key = draftStorageKey(access);
  const original = values.get(key);
  for (const bad of [null, { ...draft('Bad'), dataset: { id: '../escape', columns: [] } }, { ...draft('Bad'), __proto__: null, execute: 'globalThis.compromised = true' }, { ...draft('Bad'), theme: { callback: 'alert(1)' } }]) {
    const collection = JSON.parse(original); collection.entries[0].draft = bad; values.set(key, JSON.stringify(collection));
    assert.match(store.list()[0].problem, /unreadable/);
    assert.throws(() => store.open(id), /unreadable/);
    assert.throws(() => store.restore(), /unreadable/);
    assert.equal(values.get(key), JSON.stringify(collection));
  }
  store.delete(id); assert.deepEqual(store.list(), []); assert.equal(globalThis.compromised, undefined);
  const literal = draft('<img src=x onerror=alert(1)>');
  assert.deepEqual(store.open(store.save(literal)), literal, 'Names remain literal strings');
});
test('malformed collection metadata is rejected without overwrite', () => {
  const { store, values } = setup(), key = draftStorageKey(access);
  for (const saved of ['{', 'null', JSON.stringify({ version: 99, entries: [] }), JSON.stringify({ version: 1, activeId: 'missing', entries: [] }), JSON.stringify({ version: 1, activeId: null, entries: [{ id: '__proto__', updatedAt: 'yesterday' }] })]) {
    values.set(key, saved);
    assert.throws(() => store.list(), /Reload to retry, or import an exported/); assert.throws(() => store.save(draft('New')), /Existing saved data has not been changed/);
    assert.equal(values.get(key), saved);
  }
});
test('storage limits never evict old drafts and write failures preserve saved versions', () => {
  const { store, values, storage } = setup();
  for (let n = 0; n < MAX_DRAFTS; n++) store.save(draft(String(n)));
  const before = new Map(values);
  assert.throws(() => store.save(draft('Overflow')), /limit \(20\)/); assert.deepEqual(values, before);
  const id = store.list()[0].id;
  assert.throws(() => store.save(draft('x'.repeat(MAX_DRAFT_CHARS)), id), /4 MiB/); assert.deepEqual(values, before);
  const failing = createDraftStore(() => ({ ...storage(), setItem() { throw new DOMException('', 'QuotaExceededError'); } }), access);
  assert.throws(() => failing.rename(id, 'Lost'), /QuotaExceededError/); assert.deepEqual(values, before);
});
