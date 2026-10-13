import { createContext, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useAccess, type Access } from './access.js';
import type { Navigate } from './AppNavigation.js';
import { browserDraftStorage, createDraftStore, draftStorageError } from './local-drafts.js';

export interface SearchAsset { id: string; name: string; kind: 'analysis'; updatedAt: string; favorite?: boolean }

type SearchContext = { open: () => void };
const Context = createContext<SearchContext | undefined>(undefined);
/** Global "find anything" search. Undefined when no provider is mounted (tests). */
export const useGlobalSearch = () => useContext(Context);

/** "1 month ago" style labels, matching the QuickSight search reference. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return 'date unknown';
  const diff = Math.max(0, now - time);
  const minute = 60_000, hour = 60 * minute, day = 24 * hour;
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (diff < minute) return 'just now';
  if (diff < hour) return plural(Math.floor(diff / minute), 'minute');
  if (diff < day) return plural(Math.floor(diff / hour), 'hour');
  if (diff < 30 * day) return plural(Math.floor(diff / day), 'day');
  if (diff < 365 * day) return plural(Math.floor(diff / (30 * day)), 'month');
  return plural(Math.floor(diff / (365 * day)), 'year');
}

export function searchAssets(assets: readonly SearchAsset[], query: string, filter: 'all' | 'favorites' | 'analysis'): SearchAsset[] {
  const q = query.trim().toLocaleLowerCase();
  return assets
    .filter(asset => (filter === 'all' || (filter === 'favorites' ? asset.favorite : asset.kind === 'analysis'))
      && (!q || asset.name.toLocaleLowerCase().includes(q)))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

export function GlobalSearchProvider({ navigate, children }: { navigate: Navigate; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const search = useMemo(() => ({ open: () => setOpen(true) }), []);
  return <Context.Provider value={search}>{children}
    {open && <GlobalSearchDialog navigate={navigate} onClose={() => setOpen(false)} />}</Context.Provider>;
}

function loadAssets(access: Access): { assets: SearchAsset[]; error: string } {
  try {
    return { assets: createDraftStore(browserDraftStorage, access).list()
      .map(entry => ({ id: entry.id, name: entry.name, kind: 'analysis' as const, updatedAt: entry.updatedAt, ...(entry.favorite ? { favorite: true } : {}) })), error: '' };
  } catch (error) { return { assets: [], error: draftStorageError(error) }; }
}

export function GlobalSearchDialog({ navigate, onClose }: { navigate: Navigate; onClose: () => void }) {
  const access = useAccess();
  const [loaded] = useState(() => loadAssets(access));
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<'all' | 'favorites' | 'analysis'>('all');
  const [selected, setSelected] = useState<string>();
  const dialogRef = useRef<HTMLDialogElement>(null), inputRef = useRef<HTMLInputElement>(null), closeRef = useRef<HTMLButtonElement>(null);
  const previous = useRef<HTMLElement | null>(null), composing = useRef(false), opened = useRef<string>();
  const id = useId();
  const results = searchAssets(loaded.assets, query, filter);
  const recents = !query.trim();
  const shown = results.slice(0, 8);
  const listId = `${id}-results`;
  const showList = !loaded.error && loaded.assets.length > 0 && shown.length > 0;
  const active = shown.find(asset => asset.id === selected) ?? shown[0];
  const optionId = (asset: SearchAsset) => `${id}-option-${encodeURIComponent(asset.id)}`;
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    previous.current = dialog?.ownerDocument.activeElement as HTMLElement | null;
    dialog?.showModal(); inputRef.current?.focus();
    return () => { dialog?.close(); if (previous.current?.isConnected) previous.current.focus(); };
  }, []);
  useLayoutEffect(() => {
    if (active && active.id !== opened.current) { opened.current = active.id; dialogRef.current?.ownerDocument.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' }); }
  }, [active?.id]);
  const open = (asset: SearchAsset) => {
    dialogRef.current?.close();
    flushSync(onClose);
    navigate({ page: 'author', draftId: asset.id });
    if (!previous.current?.isConnected) dialogRef.current?.ownerDocument.querySelector<HTMLElement>('.product-header .brand')?.focus();
  };
  const chip = (value: 'favorites' | 'analysis', label: string) => (
    <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(current => current === value ? 'all' : value)}>{label}</button>
  );
  return <dialog ref={dialogRef} className="global-search" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}
    onCancel={onClose} onKeyDown={event => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
      const focused = dialogRef.current?.ownerDocument.activeElement;
      if (event.shiftKey && focused === closeRef.current) { event.preventDefault(); inputRef.current?.focus(); }
      else if (!event.shiftKey && focused === inputRef.current) { event.preventDefault(); closeRef.current?.focus(); }
    }}>
    <header><h2 id={`${id}-title`}>Search</h2><button ref={closeRef} type="button" aria-label="Close search" aria-keyshortcuts="Escape" onClick={onClose}>Close <span aria-hidden="true">×</span></button></header>
    <label className="sr-only" htmlFor={`${id}-search`}>Find anything</label>
    <input ref={inputRef} id={`${id}-search`} type="text" role="combobox" autoComplete="off" spellCheck={false}
      aria-autocomplete="list" aria-expanded={showList} aria-controls={showList ? listId : undefined} aria-activedescendant={active ? optionId(active) : undefined}
      placeholder="Find anything" value={query}
      onChange={event => { setQuery(event.target.value); setSelected(undefined); }}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (shown.length) {
            const index = shown.findIndex(asset => asset.id === active?.id);
            setSelected(shown[(index + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length]!.id);
          }
        } else if (event.key === 'Enter') {
          event.preventDefault();
          if (active && !event.repeat) open(active);
        }
      }} />
    {loaded.error ? <p role="alert">{loaded.error}</p> : loaded.assets.length === 0 ? (
      <div className="search-empty"><p>No analyses yet.</p><p>Create your first analysis and find it here.</p>
        <button type="button" className="primary-button" onClick={() => { flushSync(onClose); navigate({ page: 'author', newAnalysis: true }); }}>Create analysis</button></div>
    ) : <>
      <div className="search-types" role="group" aria-label="Filter by type"><span aria-hidden="true">Type</span>
        {chip('favorites', '☆ Favorites')}{loaded.assets.some(asset => asset.kind === 'analysis') && chip('analysis', 'Analyses')}
      </div>
      <h3 id={`${id}-heading`}>{recents ? 'Recents' : `${results.length} ${results.length === 1 ? 'result' : 'results'}`}</h3>
      {shown.length ? <ul id={listId} role="listbox" aria-labelledby={`${id}-heading`}>
        {shown.map(asset => <li key={asset.id} id={optionId(asset)} role="option" aria-selected={asset.id === active?.id} className="search-row"
          onPointerDown={event => event.preventDefault()} onClick={() => open(asset)}>
          <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 20h18M5 16V9h3v7m4 0V4h3v12m4 0v-5h3v5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="search-name">{asset.name}{asset.favorite && <span aria-label="Favorite"> ☆</span>}</span>
          <time dateTime={asset.updatedAt}>{relativeTime(asset.updatedAt)}</time>
        </li>)}
      </ul> : <p role="status">No results for &ldquo;{query.trim()}&rdquo;.</p>}
    </>}
    <p className="search-help">↑↓ Navigate · Enter Open · Esc Close</p>
  </dialog>;
}
