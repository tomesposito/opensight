import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { authorReducer, emptyDraft, type AuthorDataset, type AuthorDraft } from './authoring.js';
import { browserDraftStorage, createDraftStore, draftStorageError, draftStorageKey, type DraftSummary } from './local-drafts.js';
import type { Access } from './access.js';

type SaveMetadata = { manualSavedAt?: string; autoSavedAt?: string };
type AutoState = 'clean' | 'unsaved' | 'saving' | 'error';
const newestSave = (entry?: SaveMetadata) => [entry?.manualSavedAt, entry?.autoSavedAt].filter((date): date is string => !!date).sort().at(-1) ?? null;
const recoveryTime = (entry?: SaveMetadata) => entry?.autoSavedAt && (!entry.manualSavedAt || entry.autoSavedAt > entry.manualSavedAt) ? entry.autoSavedAt : null;

export function useLocalDrafts(access: Access, dataset?: AuthorDataset, opening?: { draftId?: string; newAnalysis?: boolean }) {
  const key = draftStorageKey(access);
  const store = useMemo(() => createDraftStore(browserDraftStorage, access), [key]);
  const [initial] = useState<SaveMetadata & { id?: string; draft: AuthorDraft; saved?: string; message: string; openingError?: string }>(() => {
    try {
      if (opening?.draftId) store.open(opening.draftId);
      const restored = opening?.newAnalysis && !opening.draftId ? undefined : store.restore();
      if (restored && (opening?.draftId || !dataset || JSON.stringify(restored.draft.dataset) === JSON.stringify(dataset))) return { ...restored, saved: JSON.stringify(restored.draft), message: 'Draft restored from this device.' };
      return { draft: { ...emptyDraft(), ...(dataset ? { dataset } : {}) }, message: 'Save this analysis on this device.' };
    } catch (error) { return { draft: { ...emptyDraft(), ...(dataset ? { dataset } : {}) }, message: draftStorageError(error), ...(opening?.draftId ? { openingError: draftStorageError(error) } : {}) }; }
  });
  const [draft, dispatch] = useReducer(authorReducer, initial.draft);
  const [id, setId] = useState(initial.id);
  const [saved, setSaved] = useState(initial.saved);
  const [message, setMessage] = useState(initial.message);
  const [entries, setEntries] = useState<DraftSummary[]>(() => { try { return store.list(); } catch { return []; } });
  const [autoState, setAutoState] = useState<AutoState>(initial.saved ? 'clean' : 'unsaved');
  const [savedAt, setSavedAt] = useState<string | null>(newestSave(initial));
  const [autoError, setAutoError] = useState<string | null>(null);
  const [recoveredAt, setRecoveredAt] = useState<string | null>(recoveryTime(initial));
  const lastSyncedAt = useRef<string | undefined>(newestSave(initial) ?? undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draftRef = useRef(draft), savedRef = useRef(saved), idRef = useRef(id);
  draftRef.current = draft; savedRef.current = saved; idRef.current = id;
  const snapshot = JSON.stringify(draft);
  const dirty = snapshot !== saved;
  const clearTimer = () => { clearTimeout(timer.current); timer.current = undefined; };
  const refresh = () => { try { setEntries(store.list()); } catch (error) { setMessage(draftStorageError(error)); } };
  const failed = (error: unknown) => {
    const reason = draftStorageError(error);
    setAutoState('error'); setAutoError(reason); setMessage(reason);
  };
  const synced = (nextId: string, nextSnapshot: string, metadata: SaveMetadata | undefined) => {
    const now = newestSave(metadata);
    idRef.current = nextId; savedRef.current = nextSnapshot;
    setId(nextId); setSaved(nextSnapshot); setSavedAt(now); lastSyncedAt.current = now ?? undefined;
    setAutoState('clean'); setAutoError(null);
  };
  useEffect(() => {
    clearTimer();
    if (initial.openingError) return;
    // Visiting a fresh local canvas must not create a phantom analysis.
    if (access.mode === 'local' && !id && snapshot === JSON.stringify(emptyDraft())) return;
    if (snapshot === saved) { setAutoState('clean'); return; }
    setAutoState('unsaved'); setAutoError(null);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      if (JSON.stringify(draftRef.current) !== savedRef.current) setAutoState('saving');
    }, 2000);
    return clearTimer;
  }, [snapshot, saved, store, initial.openingError, access.mode, id]);
  // Commit the Saving… status before the synchronous storage write. This effect
  // reads current refs, so manual saves and edits never leave a stale payload.
  useEffect(() => {
    if (autoState !== 'saving') return;
    const current = draftRef.current, currentSnapshot = JSON.stringify(current);
    if (currentSnapshot === savedRef.current) { setAutoState('clean'); return; }
    try {
      const next = store.autosave(current, idRef.current, lastSyncedAt.current);
      synced(next, currentSnapshot, store.restore());
      setMessage('Draft auto-saved on this device.'); refresh();
    } catch (error) { failed(error); }
  }, [autoState, store]);
  const save = () => {
    clearTimer();
    try {
      const current = draftRef.current, next = store.save(current, idRef.current);
      synced(next, JSON.stringify(current), store.restore()); setRecoveredAt(null);
      setMessage('Draft saved on this device.'); refresh(); return true;
    } catch (error) { failed(error); return false; }
  };
  // Switching analyses checkpoints meaningful edits; failed saves keep the editor intact.
  const keepCurrent = () => !dirty || (!id && JSON.stringify({ ...draft, dataset: undefined }) === JSON.stringify(emptyDraft())) || save();
  const replace = (next: AuthorDraft) => {
    if (!keepCurrent()) return false;
    clearTimer(); dispatch({ type: 'import', draft: next }); setId(undefined); setSaved(undefined);
    setSavedAt(null); lastSyncedAt.current = undefined; setRecoveredAt(null); setAutoError(null); setAutoState('unsaved');
    setMessage('Save this analysis on this device.'); return true;
  };
  const open = (nextId: string): AuthorDraft | undefined => {
    if (!keepCurrent()) return;
    try {
      const next = store.open(nextId), metadata = store.restore();
      clearTimer(); dispatch({ type: 'import', draft: next }); synced(nextId, JSON.stringify(next), metadata); setRecoveredAt(recoveryTime(metadata));
      setMessage('Draft opened from this device.'); refresh(); return next;
    } catch (error) { setMessage(draftStorageError(error)); }
  };
  const rename = (target: string, name: string) => {
    if (target === id && !keepCurrent()) return;
    try {
      const next = store.rename(target, name);
      if (target === id) { clearTimer(); dispatch({ type: 'import', draft: next }); synced(target, JSON.stringify(next), store.restore()); }
      setMessage('Draft renamed on this device.'); refresh();
    } catch (error) { setMessage(draftStorageError(error)); }
  };
  const remove = (target: string) => {
    try {
      store.delete(target);
      if (target === id) {
        clearTimer(); dispatch({ type: 'import', draft: emptyDraft() }); setId(undefined); setSaved(undefined);
        setSavedAt(null); lastSyncedAt.current = undefined; setRecoveredAt(null); setAutoError(null); setAutoState('unsaved');
      }
      setMessage('Draft deleted from this device.'); refresh(); return true;
    } catch (error) { setMessage(draftStorageError(error)); return false; }
  };
  const dismissRecovery = () => {
    if (!id) return;
    try { store.discardAutosave(id); setRecoveredAt(null); refresh(); }
    catch (error) { failed(error); }
  };
  return { draft, dispatch, id, dirty, message, entries, refresh, save, keepCurrent, replace, open, rename, remove, autoState, savedAt, autoError, recoveredAt, dismissRecovery, openingError: initial.openingError };
}
