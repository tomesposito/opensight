import { useEffect, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { activeSheet, dataFields, type AuthorAction, type AuthorDraft } from './authoring.js';
import { useAccess, type Access } from './access.js';
import { useToast } from './Toasts.js';
export function publishNotice(mode: Access['mode']): string {
  return mode === 'hosted'
    ? 'Publishing needs a hosted deployment with dashboard publication enabled. It is not available in this editor yet; nothing has been published.'
    : `${mode === 'local' ? 'This local workspace' : 'This static demo'} has no publication destination. Drafts are device-local, not synced or shared. Export .qs or JSON to share an analysis definition; data is not included. Nothing has been published.`;
}
/** Moves keyboard focus to an editor control: opens any collapsed ancestor
 *  panel, scrolls the control into view, then focuses it. Exported for tests.
 *  No-op when there is no real DOM (react-test-renderer refs are not elements). */
export function focusAuthorControl(nav: HTMLElement | null, selector: string) {
  if (typeof nav?.closest !== 'function') return;
  const target = nav.closest('.author-workspace')?.querySelector<HTMLElement>(selector);
  const panel = target?.closest('details'); if (panel) panel.open = true;
  target?.scrollIntoView?.({ block: 'nearest' });
  target?.focus();
}
export function AuthorToolbar({ onPrep, draft, dispatch, fit, onFit, onJson, onBundle, onImport, oEntry, busy = false, jsonDisabled = false }: { onPrep?: () => void; oEntry?: ReactNode; busy?: boolean; jsonDisabled?: boolean; draft: AuthorDraft; dispatch: Dispatch<AuthorAction>; fit: boolean; onFit: () => void; onJson: () => void; onBundle: () => void; onImport: () => void }) {
  const access = useAccess();
  const notify = useToast();
  const [notice, setNotice] = useState(''), [search, setSearch] = useState('');
  const sheet = activeSheet(draft), selected = sheet.visuals.find(v => v.id === sheet.selectedId);
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (event: Event) => { if (event.target instanceof Node && !nav.current?.contains(event.target)) nav.current?.querySelectorAll('details[open]').forEach(d => d.removeAttribute('open')); };
    if (typeof document === 'undefined') return;
    document.addEventListener?.('pointerdown', close);
    return () => document.removeEventListener?.('pointerdown', close);
  }, []);
  const focus = (selector: string) => focusAuthorControl(nav.current, selector);
  return <>
    <nav ref={nav} className="author-menu" aria-label="Analysis menu" onKeyDown={e => {
      if (e.key === 'Escape') { const menu = (e.target as HTMLElement).closest('details'); if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); } }
    }} onClick={e => { if ((e.target as HTMLElement).closest('button')) { const menu = (e.target as HTMLElement).closest('details'); if (menu) menu.open = false; } }}>
      <details name="analysis-menu"><summary>File</summary><div className="menu-popover"><button type="button" disabled={busy} onClick={onImport}>Import bundle…</button><button type="button" disabled={busy} onClick={onBundle} aria-describedby="export-help">Download .qs</button><button type="button" disabled={jsonDisabled} onClick={onJson} aria-describedby="export-help">Export JSON</button><p>Use Save draft to keep changes on this device. Drafts are not synced or shared.</p></div></details>
      <details name="analysis-menu"><summary>Edit</summary><div className="menu-popover"><button type="button" onClick={() => focus('.analysis-title input')}>Rename analysis</button><p>Undo / redo is not available yet. Export a checkpoint to keep a copy.</p></div></details>
      <details name="analysis-menu"><summary>Data</summary><div className="menu-popover">{onPrep && <button type="button" onClick={onPrep}>Prepare data…</button>}<button type="button" onClick={() => nav.current?.closest('.author-workspace')?.querySelector<HTMLButtonElement>('.calculation-button')?.click()}>Calculated field…</button><p>{draft.dataset ? `Using ${draft.dataset.name}. Prepare data to transform its columns.` : 'Local synthetic sales is available. Adding remote data sources requires a configured backend.'}</p></div></details>
      <details name="analysis-menu"><summary>Insert</summary><div className="menu-popover"><button type="button" onClick={() => dispatch({ type: 'add', kind: 'bar' })}>Add bar visual</button><button type="button" onClick={() => focus('.visual-gallery button')}>Choose visual type</button><p>Text boxes and images are not available yet.</p></div></details>
      <details name="analysis-menu"><summary>Sheets</summary><div className="menu-popover">{draft.sheets.map(s => <button type="button" key={s.id} onClick={() => dispatch({ type: 'sheet-select', id: s.id })}>{s.name}</button>)}<button type="button" onClick={() => dispatch({ type: 'sheet-add' })}>Add sheet</button></div></details>
      <details name="analysis-menu"><summary>Objects</summary><div className="menu-popover">{sheet.visuals.map(v => <button key={v.id} type="button" onClick={() => dispatch({ type: 'select', id: v.id })}>{v.title || v.id} · {v.kind}</button>)}{selected && <button type="button" onClick={() => dispatch({ type: 'remove', id: selected.id })}>Remove selected visual</button>}{!sheet.visuals.length && <p>No visuals on this sheet.</p>}</div></details>
      <details name="analysis-menu"><summary>Search</summary><div className="menu-popover"><label>Search analysis<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>{draft.sheets.flatMap(s => s.visuals.filter(v => `${v.title} ${v.kind} ${v.id}`.toLowerCase().includes(search.toLowerCase())).map(v => <button key={v.id} type="button" onClick={() => { dispatch({ type: 'sheet-select', id: s.id }); dispatch({ type: 'select', id: v.id }); }}>{s.name} / {v.title || v.id}</button>))}<p>Fields: {dataFields(draft.calculatedFields, draft.dataset).filter(f => f.name.toLowerCase().includes(search.toLowerCase())).map(f => f.name).join(', ') || 'No matches'}</p></div></details>
      {oEntry}<div className="menu-spacer" /><button type="button" onClick={() => focus('.visual-gallery button')}>Add visual</button><button type="button" aria-pressed={fit} title={fit ? 'Fit is on; switch to 1200 pixel canvas' : 'Fit canvas to available width'} onClick={onFit}>FIT TO WIDTH</button><button type="button" onClick={() => { setNotice(publishNotice(access.mode)); notify('Publishing is unavailable in this editor. Nothing has been published.'); }}>PUBLISH</button>
      <label className="chrome-switch">NEW LOOK<select aria-label="NEW LOOK" value={draft.chrome ?? 'light'} onChange={e => dispatch({ type: 'chrome', mode: e.target.value as 'light' | 'dark' })}><option value="light">Light</option><option value="dark">Dark</option></select></label>
    </nav>
    {notice && <div className="toolbar-notice" role="status">{notice}<button type="button" onClick={() => setNotice('')}>Dismiss</button></div>}
  </>;
}
