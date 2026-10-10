import { DRAFT_KEY, parseDraft, validateDraft, type AuthorDraft } from './authoring.js';
import type { Access } from './access.js';

export const DRAFTS_KEY = 'opensight.author.drafts.v1';
export const MAX_DRAFTS = 20;
// UTF-16 strings: at most 4 MiB, leaving room under typical 5 MiB quotas.
export const MAX_DRAFT_CHARS = 2 * 1024 * 1024;
export type DraftStorage = () => Pick<Storage, 'getItem' | 'setItem'>;
interface Entry { id: string; updatedAt: string; draft: unknown; manualSavedAt?: string; autoSavedAt?: string; favorite?: boolean }
interface Collection { version: 1; activeId: string | null; entries: Entry[] }
export interface DraftSummary { id: string; name: string; updatedAt: string; hasPendingAutosave: boolean; sample?: boolean; favorite?: boolean; problem?: string }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const isoDate = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const pendingAutosave = (e: Entry) => !!e.autoSavedAt && (!e.manualSavedAt || e.autoSavedAt > e.manualSavedAt);
const invalid = () => new Error('Saved analyses on this device could not be read. Reload to retry, or import an exported .qs or JSON copy. Existing saved data has not been changed.');

export const browserDraftStorage: DraftStorage = () => {
  if (typeof window === 'undefined') throw new Error('Browser storage is unavailable outside a browser.');
  const storage = window.localStorage;
  if (!storage) throw new Error('Browser storage is unavailable in this environment.');
  return storage;
};

export function draftStorageKey(access: Access): string {
  if (access.mode === 'hosted') return `${DRAFTS_KEY}.hosted.${encodeURIComponent(access.session?.namespaceId ?? '')}.${encodeURIComponent(access.session?.id ?? '')}`;
  return `${DRAFTS_KEY}.${access.mode}`;
}
export function draftStorageError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const reason = name === 'SecurityError' ? 'Browser storage is blocked by this browser or its privacy settings.'
    : name === 'QuotaExceededError' ? 'Browser storage is full. Delete a local draft or free site storage, then retry.'
    : error instanceof Error ? error.message : 'Browser storage is unavailable.';
  return `${reason} Export JSON to keep your work.`;
}

/** One atomic write, no silent eviction, no data rows or remote I/O. */
export function createDraftStore(storage: DraftStorage, access: Access) {
  const key = draftStorageKey(access);
  const read = (): Collection => {
    const saved = storage().getItem(key);
    if (saved === null) {
      // Do not assign the formerly shared legacy draft to a hosted principal.
      const legacy = access.mode === 'hosted' ? null : storage().getItem(access.mode === 'local' ? `local.${DRAFT_KEY}` : DRAFT_KEY);
      if (legacy === null) return { version: 1, activeId: null, entries: [] };
      if (legacy.length > MAX_DRAFT_CHARS) throw invalid();
      let draft: AuthorDraft;
      try { draft = parseDraft(legacy); } catch { throw invalid(); }
      return { version: 1, activeId: 'legacy', entries: [{ id: 'legacy', updatedAt: new Date(0).toISOString(), draft }] };
    }
    if (saved.length > MAX_DRAFT_CHARS) throw invalid();
    let value: unknown;
    try { value = JSON.parse(saved); } catch { throw invalid(); }
    if (!object(value) || !keys(value, ['version', 'activeId', 'entries']) || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > MAX_DRAFTS) throw invalid();
    const ids = new Set<string>();
    for (const e of value.entries) {
      if (!object(e) || !keys(e, ['id', 'updatedAt', 'draft', 'manualSavedAt', 'autoSavedAt', 'favorite']) || typeof e.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(e.id) || ids.has(e.id) || !isoDate(e.updatedAt)
        || ('manualSavedAt' in e && !isoDate(e.manualSavedAt)) || ('autoSavedAt' in e && !isoDate(e.autoSavedAt)) || ('favorite' in e && typeof e.favorite !== 'boolean')) throw invalid();
      ids.add(e.id);
    }
    if (value.activeId !== null && (typeof value.activeId !== 'string' || !ids.has(value.activeId))) throw invalid();
    return value as unknown as Collection;
  };
  const write = (collection: Collection) => {
    const text = JSON.stringify(collection);
    if (text.length > MAX_DRAFT_CHARS) throw new Error('Local draft storage limit (4 MiB) reached. Delete a draft or export this analysis.');
    storage().setItem(key, text);
  };
  const entry = (collection: Collection, id: string) => {
    const found = collection.entries.find(e => e.id === id);
    if (!found) throw new Error('This local draft no longer exists. Refresh the drafts list.');
    return found;
  };
  const checked = (e: Entry): AuthorDraft => {
    try { validateDraft(e.draft); return e.draft; }
    catch { throw new Error('This saved analysis is unreadable in this version of OpenSight. Import an exported .qs or JSON copy, or choose another analysis. You can delete this entry from Local drafts.'); }
  };
  const list = (): DraftSummary[] => read().entries.map(e => {
    const summary = { id: e.id, updatedAt: e.updatedAt, hasPendingAutosave: pendingAutosave(e), ...(e.favorite ? { favorite: true } : {}) };
    try { const draft = checked(e); return { ...summary, name: draft.title.trim() || 'Untitled analysis', ...(access.mode === 'local' && !draft.dataset && !draft.bundle && draft.sheets.some(s => s.visuals.length) ? { sample: true } : {}) }; }
    catch (error) { return { ...summary, name: 'Unreadable draft', problem: (error as Error).message }; }
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const restore = () => {
    const collection = read();
    if (!collection.activeId) return undefined;
    const e = entry(collection, collection.activeId);
    return { id: e.id, draft: checked(e), manualSavedAt: e.manualSavedAt, autoSavedAt: e.autoSavedAt };
  };
  const save = (draft: AuthorDraft, id?: string, favorite?: boolean) => {
    validateDraft(draft);
    const collection = read();
    const previous = id ? entry(collection, id) : undefined;
    if (id) entry(collection, id); // Deleted in another tab: never silently resurrect it.
    else if (collection.entries.length >= MAX_DRAFTS) throw new Error(`Local draft limit (${MAX_DRAFTS}) reached. Delete a draft before saving a new analysis.`);
    const now = new Date().toISOString();
    const saved: Entry = { id: id ?? crypto.randomUUID(), updatedAt: now, manualSavedAt: now, draft, ...((favorite ?? previous?.favorite) ? { favorite: true } : {}) };
    write({ version: 1, activeId: saved.id, entries: [...collection.entries.filter(e => e.id !== saved.id), saved] });
    return saved.id;
  };
  const autosave = (draft: AuthorDraft, id?: string, lastSyncedAt?: string) => {
    validateDraft(draft);
    const collection = read();
    const previous = id ? entry(collection, id) : undefined;
    if (previous?.manualSavedAt && (!lastSyncedAt || previous.manualSavedAt > lastSyncedAt)) throw new Error('This draft was saved in another tab. Reload to keep editing.');
    if (!id && collection.entries.length >= MAX_DRAFTS) throw new Error(`Local draft limit (${MAX_DRAFTS}) reached. Delete a draft before saving a new analysis.`);
    const now = new Date().toISOString();
    const saved: Entry = { id: id ?? crypto.randomUUID(), updatedAt: now, autoSavedAt: now, ...(previous?.manualSavedAt ? { manualSavedAt: previous.manualSavedAt } : {}), ...(previous?.favorite ? { favorite: true } : {}), draft };
    write({ version: 1, activeId: saved.id, entries: [...collection.entries.filter(e => e.id !== saved.id), saved] });
    return saved.id;
  };
  return { list, restore, save, autosave,
    peek(id: string) { return checked(entry(read(), id)); },
    copy(draft: AuthorDraft, name: string) {
      if (!name.trim()) throw new Error('Enter an analysis name.');
      if (name.trim() === draft.title.trim()) throw new Error('Choose a different name for the separate copy.');
      return save({ ...structuredClone(draft), title: name.trim() });
    },
    favorite(draft: AuthorDraft, id: string | undefined, value: boolean) { return save(draft, id, value); },
    discardAutosave(id: string) {
      const collection = read(), e = entry(collection, id);
      const { autoSavedAt: _autoSavedAt, ...saved } = e;
      write({ ...collection, entries: collection.entries.map(item => item.id === id ? saved : item) });
    },
    open(id: string) {
      const collection = read(), draft = checked(entry(collection, id));
      write({ ...collection, activeId: id });
      return draft;
    },
    rename(id: string, name: string) {
      if (!name.trim()) throw new Error('Enter an analysis name.');
      const collection = read(), e = entry(collection, id), draft = { ...checked(e), title: name.trim() };
      validateDraft(draft);
      write({ ...collection, entries: collection.entries.map(item => item.id === id ? { ...e, draft, updatedAt: new Date().toISOString() } : item) });
      return draft;
    },
    delete(id: string) {
      const collection = read(); entry(collection, id);
      write({ ...collection, activeId: collection.activeId === id ? null : collection.activeId, entries: collection.entries.filter(e => e.id !== id) });
    },
  };
}
