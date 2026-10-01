import { DRAFT_KEY, parseDraft, validateDraft, type AuthorDraft } from './authoring.js';
import type { Access } from './access.js';

export const DRAFTS_KEY = 'opensight.author.drafts.v1';
export const MAX_DRAFTS = 20;
// UTF-16 strings: at most 4 MiB, leaving room under typical 5 MiB quotas.
export const MAX_DRAFT_CHARS = 2 * 1024 * 1024;
export type DraftStorage = () => Pick<Storage, 'getItem' | 'setItem'>;
interface Entry { id: string; updatedAt: string; draft: unknown }
interface Collection { version: 1; activeId: string | null; entries: Entry[] }
export interface DraftSummary { id: string; name: string; updatedAt: string; problem?: string }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const invalid = () => new Error('Saved drafts are corrupt or unsupported. Stored data was left unchanged.');

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
      const draft = parseDraft(legacy);
      return { version: 1, activeId: 'legacy', entries: [{ id: 'legacy', updatedAt: new Date(0).toISOString(), draft }] };
    }
    if (saved.length > MAX_DRAFT_CHARS) throw invalid();
    let value: unknown;
    try { value = JSON.parse(saved); } catch { throw invalid(); }
    if (!object(value) || !keys(value, ['version', 'activeId', 'entries']) || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > MAX_DRAFTS) throw invalid();
    const ids = new Set<string>();
    for (const e of value.entries) {
      if (!object(e) || !keys(e, ['id', 'updatedAt', 'draft']) || typeof e.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(e.id) || ids.has(e.id) || typeof e.updatedAt !== 'string' || !Number.isFinite(Date.parse(e.updatedAt)) || new Date(e.updatedAt).toISOString() !== e.updatedAt) throw invalid();
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
    catch { throw new Error('This saved draft is corrupt or unsupported and cannot be opened. You can delete it from Local drafts.'); }
  };
  const list = (): DraftSummary[] => read().entries.map(e => {
    try { return { id: e.id, name: checked(e).title.trim() || 'Untitled analysis', updatedAt: e.updatedAt }; }
    catch (error) { return { id: e.id, name: 'Unreadable draft', updatedAt: e.updatedAt, problem: (error as Error).message }; }
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const restore = () => {
    const collection = read();
    if (!collection.activeId) return undefined;
    const e = entry(collection, collection.activeId);
    return { id: e.id, draft: checked(e) };
  };
  const save = (draft: AuthorDraft, id?: string) => {
    validateDraft(draft);
    const collection = read();
    if (id) entry(collection, id); // Deleted in another tab: never silently resurrect it.
    else if (collection.entries.length >= MAX_DRAFTS) throw new Error(`Local draft limit (${MAX_DRAFTS}) reached. Delete a draft before saving a new analysis.`);
    const saved: Entry = { id: id ?? crypto.randomUUID(), updatedAt: new Date().toISOString(), draft };
    write({ version: 1, activeId: saved.id, entries: [...collection.entries.filter(e => e.id !== saved.id), saved] });
    return saved.id;
  };
  return { list, restore, save,
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
