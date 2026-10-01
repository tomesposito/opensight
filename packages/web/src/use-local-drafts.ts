import { useMemo, useReducer, useState } from 'react';
import { authorReducer, emptyDraft, type AuthorDataset, type AuthorDraft } from './authoring.js';
import { browserDraftStorage, createDraftStore, draftStorageError, draftStorageKey, type DraftSummary } from './local-drafts.js';
import type { Access } from './access.js';

export function useLocalDrafts(access: Access, dataset?: AuthorDataset, opening?: { draftId?: string; newAnalysis?: boolean }) {
  const key = draftStorageKey(access);
  const store = useMemo(() => createDraftStore(browserDraftStorage, access), [key]);
  const [initial] = useState<{ id?: string; draft: AuthorDraft; saved?: string; message: string; openingError?: string }>(() => {
    try {
      const restored = opening?.draftId ? { id: opening.draftId, draft: store.open(opening.draftId) } : opening?.newAnalysis ? undefined : store.restore();
      if (restored && (opening?.draftId || !dataset || JSON.stringify(restored.draft.dataset) === JSON.stringify(dataset))) return { ...restored, saved: JSON.stringify(restored.draft), message: 'Draft restored from this device.' };
      return { draft: { ...emptyDraft(), ...(dataset ? { dataset } : {}) }, message: 'Save this analysis on this device.' };
    } catch (error) { return { draft: { ...emptyDraft(), ...(dataset ? { dataset } : {}) }, message: draftStorageError(error), ...(opening?.draftId ? { openingError: draftStorageError(error) } : {}) }; }
  });
  const [draft, dispatch] = useReducer(authorReducer, initial.draft);
  const [id, setId] = useState(initial.id);
  const [saved, setSaved] = useState(initial.saved);
  const [message, setMessage] = useState(initial.message);
  const [entries, setEntries] = useState<DraftSummary[]>(() => { try { return store.list(); } catch { return []; } });
  const dirty = JSON.stringify(draft) !== saved;
  const refresh = () => { try { setEntries(store.list()); } catch (error) { setMessage(draftStorageError(error)); } };
  const save = () => {
    try {
      const next = store.save(draft, id); setId(next); setSaved(JSON.stringify(draft));
      setMessage('Draft saved on this device.'); refresh(); return true;
    } catch (error) { setMessage(draftStorageError(error)); return false; }
  };
  // Switching analyses checkpoints meaningful edits; failed saves keep the editor intact.
  const keepCurrent = () => !dirty || (!id && JSON.stringify({ ...draft, dataset: undefined }) === JSON.stringify(emptyDraft())) || save();
  const replace = (next: AuthorDraft) => {
    if (!keepCurrent()) return false;
    dispatch({ type: 'import', draft: next }); setId(undefined); setSaved(undefined);
    setMessage('Save this analysis on this device.'); return true;
  };
  const open = (nextId: string): AuthorDraft | undefined => {
    if (!keepCurrent()) return;
    try {
      const next = store.open(nextId); dispatch({ type: 'import', draft: next }); setId(nextId); setSaved(JSON.stringify(next));
      setMessage('Draft reopened from this device.'); refresh(); return next;
    } catch (error) { setMessage(draftStorageError(error)); }
  };
  const rename = (target: string, name: string) => {
    if (target === id && !keepCurrent()) return;
    try {
      const next = store.rename(target, name);
      if (target === id) { dispatch({ type: 'import', draft: next }); setSaved(JSON.stringify(next)); }
      setMessage('Draft renamed on this device.'); refresh();
    } catch (error) { setMessage(draftStorageError(error)); }
  };
  const remove = (target: string) => {
    try {
      store.delete(target);
      if (target === id) { dispatch({ type: 'import', draft: emptyDraft() }); setId(undefined); setSaved(undefined); }
      setMessage('Draft deleted from this device.'); refresh(); return true;
    } catch (error) { setMessage(draftStorageError(error)); return false; }
  };
  return { draft, dispatch, id, dirty, message, entries, refresh, save, keepCurrent, replace, open, rename, remove, openingError: initial.openingError };
}
