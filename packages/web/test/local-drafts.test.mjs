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
  assert.deepEqual(createDraftStore(storage, access).restore(), { id: first, draft: a, manualSavedAt: store.list().find(e => e.id === first).updatedAt, autoSavedAt: undefined });
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

const start = '2026-10-08T12:00:00.000Z';
test('auto-save metadata round trips one copy, preserves the manual checkpoint and lists pending work', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(start) });
  const { store, storage } = setup(), manual = draft('Manual');
  const id = store.save(manual);
  assert.equal(store.restore().manualSavedAt, start);
  assert.equal(store.list()[0].hasPendingAutosave, false);
  t.mock.timers.tick(2000);
  const autoSavedAt = new Date().toISOString(), edited = draft('Auto-saved');
  assert.equal(store.autosave(edited, id, start), id);
  assert.deepEqual(createDraftStore(storage, access).restore(), { id, draft: edited, manualSavedAt: start, autoSavedAt });
  assert.deepEqual(store.list(), [{ id, name: 'Auto-saved', updatedAt: autoSavedAt, hasPendingAutosave: true, sample: true }]);
  t.mock.timers.tick(2000);
  store.save(edited, id);
  assert.deepEqual(store.restore(), { id, draft: edited, manualSavedAt: new Date().toISOString(), autoSavedAt: undefined });
  assert.equal(store.list()[0].hasPendingAutosave, false);
});
test('id-less auto-save creates an entry without a manual checkpoint; dismiss keeps its content', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(start) });
  const { store, values } = setup(), content = draft('Recovered');
  const id = store.autosave(content);
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(store.restore(), { id, draft: content, manualSavedAt: undefined, autoSavedAt: start });
  assert.equal(store.list()[0].hasPendingAutosave, true);
  const updatedAt = store.list()[0].updatedAt;
  store.discardAutosave(id);
  assert.deepEqual(store.restore(), { id, draft: content, manualSavedAt: undefined, autoSavedAt: undefined });
  assert.equal(store.list()[0].updatedAt, updatedAt);
  assert.equal(store.list()[0].hasPendingAutosave, false);
  assert.equal('autoSavedAt' in JSON.parse(values.get(draftStorageKey(access))).entries[0], false);
});
test('another tab manual save rejects a stale auto-save without changing stored content', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(start) });
  const { store, storage, values } = setup(), id = store.save(draft('Original'));
  t.mock.timers.tick(2000);
  createDraftStore(storage, access).save(draft('Other tab checkpoint'), id);
  const before = new Map(values);
  for (const lastSyncedAt of [start, undefined]) {
    assert.throws(() => store.autosave(draft('Stale'), id, lastSyncedAt), { message: 'This draft was saved in another tab. Reload to keep editing.' });
    assert.deepEqual(values, before);
  }
  store.autosave(draft('Reloaded edits'), id, store.restore().manualSavedAt);
  assert.equal(store.restore().draft.title, 'Reloaded edits', 'An equal timestamp is synced');
  assert.equal(store.list()[0].hasPendingAutosave, false, 'Equal save-kind timestamps are not pending');
});
test('auto-save never resurrects deleted entries and observes existing collection limits', () => {
  const { store, values } = setup(), id = store.autosave(draft('Deleted'));
  store.delete(id);
  const before = new Map(values);
  assert.throws(() => store.autosave(draft('Stale'), id), /no longer exists/);
  assert.throws(() => store.discardAutosave(id), /no longer exists/);
  assert.deepEqual(values, before);
  for (let n = 0; n < MAX_DRAFTS; n++) store.autosave(draft(String(n)));
  const full = new Map(values);
  assert.throws(() => store.autosave(draft('Overflow')), /limit \(20\)/);
  assert.throws(() => store.autosave(draft('x'.repeat(MAX_DRAFT_CHARS)), store.list()[0].id), /4 MiB/);
  assert.deepEqual(values, full);
});
test('old entries without save-kind metadata validate, restore and accept auto-save', () => {
  const { store, values } = setup(), content = draft('Old entry'), id = 'old';
  values.set(draftStorageKey(access), JSON.stringify({ version: 1, activeId: id, entries: [{ id, updatedAt: start, draft: content }] }));
  assert.deepEqual(store.restore(), { id, draft: content, manualSavedAt: undefined, autoSavedAt: undefined });
  assert.equal(store.list()[0].hasPendingAutosave, false);
  store.autosave(content, id);
  assert.equal(store.list()[0].hasPendingAutosave, true);
});
test('save-kind metadata rejects non-ISO strings and unknown keys without overwriting', () => {
  const { store, values } = setup(), id = store.save(draft('Valid')), key = draftStorageKey(access), original = values.get(key);
  for (const field of ['manualSavedAt', 'autoSavedAt', 'shadowSnapshot']) {
    for (const value of [null, 123, '', 'yesterday', '2026-10-08', '2026-02-30T12:00:00.000Z', '9999-invalid']) {
      const collection = JSON.parse(original); collection.entries[0][field] = value;
      const corrupt = JSON.stringify(collection); values.set(key, corrupt);
      assert.throws(() => store.restore(), /could not be read/);
      assert.throws(() => store.autosave(draft('New'), id, start), /could not be read/);
      assert.equal(values.get(key), corrupt);
    }
  }
});

test('favorites start empty, persist through edits and reload, and disappear on deletion', () => {
  const { store, storage } = setup();
  assert.deepEqual(store.list(), []);
  const id = store.favorite(draft('Favorite'), undefined, true);
  assert.equal(createDraftStore(storage, access).list()[0].favorite, true);
  store.autosave(draft('Edited'), id, store.restore().manualSavedAt);
  store.save(draft('Saved'), id); store.rename(id, 'Renamed');
  assert.equal(store.list()[0].favorite, true);
  store.favorite(draft('Removed'), id, false);
  assert.equal(store.list()[0].favorite, undefined);
  store.favorite(draft('Again'), id, true); store.delete(id);
  assert.deepEqual(store.list(), []);
  assert.throws(() => store.favorite(draft('Deleted'), id, true), /no longer exists/);
});
test('favorites follow mode, namespace and principal isolation; corrupt metadata and failed writes are preserved', () => {
  const { storage, values, store } = setup();
  const hosted = { mode: 'hosted', session: { namespaceId: 'one', id: 'alice' } };
  createDraftStore(storage, hosted).favorite(draft('Private'), undefined, true);
  for (const scope of [access, { mode: 'demo' }, { ...hosted, session: { namespaceId: 'two', id: 'alice' } }, { ...hosted, session: { namespaceId: 'one', id: 'bob' } }]) assert.deepEqual(createDraftStore(storage, scope).list(), []);
  const id = store.save(draft('Original')), before = new Map(values);
  const failing = createDraftStore(() => ({ ...storage(), setItem() { throw new DOMException('', 'QuotaExceededError'); } }), access);
  assert.throws(() => failing.favorite(draft('Unsaved edit'), id, true), /QuotaExceededError/);
  assert.deepEqual(values, before);
  const key = draftStorageKey(access), collection = JSON.parse(values.get(key));
  collection.entries[0].favorite = 'true'; values.set(key, JSON.stringify(collection));
  assert.throws(() => store.favorite(draft('Overwrite'), id, true), /could not be read/);
  assert.equal(values.get(key), JSON.stringify(collection));
});

test('Save as Analysis has a new identity and name, retains all definition state, and never changes the original', () => {
  const { store, storage, values } = setup(), original = draft('Original'), first = store.favorite(original, undefined, true);
  const edited = structuredClone(original); edited.sheets[0].visuals[0].title = 'Unsaved edit';
  const second = store.copy(edited, '  Separate copy  ');
  assert.notEqual(first, second);
  assert.deepEqual(createDraftStore(storage, access).restore().draft, { ...edited, title: 'Separate copy' });
  assert.equal(store.list().find(e => e.id === second).favorite, undefined);
  assert.deepEqual(store.open(first), original);
  store.save({ ...store.open(second), title: 'Edited copy' }, second);
  assert.deepEqual(store.open(first), original);
  const before = new Map(values);
  for (const name of [' ', 'Original']) assert.throws(() => store.copy(original, name), /name/);
  assert.deepEqual(values, before);
  for (let n = store.list().length; n < MAX_DRAFTS; n++) store.save(draft(String(n)));
  const full = new Map(values);
  assert.throws(() => store.copy(original, 'Overflow'), /limit \(20\)/);
  assert.deepEqual(values, full);
});
