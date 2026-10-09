import { useEffect, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { activeSheet, dataFields, type AuthorAction, type AuthorDraft } from './authoring.js';
import { useAccess, type Access } from './access.js';
import { useToast } from './Toasts.js';
import { AuthorMenuItem } from './AuthorMenuItem.js';
import { flushSync } from 'react-dom';
export function publishNotice(mode: Access['mode']): string {
  return mode === 'hosted'
    ? 'Publishing needs a hosted deployment with dashboard publication enabled. It is not available in this editor yet; nothing has been published.'
    : `${mode === 'local' ? 'This local workspace' : 'This static demo'} has no publication destination. Drafts are device-local, not synced or shared. Export .qs or JSON to share an analysis definition; data is not included. Nothing has been published.`;
}
/** Moves keyboard focus to an editor control: opens any collapsed ancestor
 *  panel, scrolls the control into view, then focuses it. Exported for tests.
 *  No-op when there is no real DOM (react-test-renderer refs are not elements). */
export function focusAuthorControl(nav: HTMLElement | null, selector: string, tab?: 'Visual' | 'Interaction') {
  if (typeof nav?.closest !== 'function') return;
  const workspace = nav.closest('.author-workspace');
  if (tab) flushSync(() => workspace?.querySelector<HTMLButtonElement>(`[data-properties-tab="${tab}"]`)?.click());
  const target = workspace?.querySelector<HTMLElement>(selector);
  // Sections can be nested inside a collapsed dock. Open every ancestor.
  for (let panel = target?.closest('details'); panel; panel = panel.parentElement?.closest('details')) panel.open = true;
  target?.scrollIntoView?.({ block: 'nearest' });
  target?.focus();
  return target;
}
export function AuthorToolbar({ onPrep, onSources, draft, dispatch, fit, onFit, onJson, onBundle, onImport, oEntry, dataAvailable = true, busy = false, jsonDisabled = false, autosaveError }: { autosaveError?: string; dataAvailable?: boolean; onSources?: () => void; onPrep?: () => void; oEntry?: ReactNode; busy?: boolean; jsonDisabled?: boolean; draft: AuthorDraft; dispatch: Dispatch<AuthorAction>; fit: boolean; onFit: () => void; onJson: () => void; onBundle: () => void; onImport: () => void }) {
  const access = useAccess();
  const notify = useToast();
  const [notice, setNotice] = useState(''), [search, setSearch] = useState('');
  const [exportsOpen, setExportsOpen] = useState(false);
  const sheet = activeSheet(draft), selected = sheet.visuals.find(v => v.id === sheet.selectedId);
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (event: Event) => { if (event.target instanceof Node && !nav.current?.contains(event.target)) nav.current?.querySelectorAll('details[open]').forEach(d => d.removeAttribute('open')); };
    if (typeof document === 'undefined') return;
    document.addEventListener?.('pointerdown', close);
    return () => document.removeEventListener?.('pointerdown', close);
  }, []);
  const focus = (selector: string, tab?: 'Visual' | 'Interaction') => { focusAuthorControl(nav.current, selector, tab); };
  const activate = (selector: string) => { focusAuthorControl(nav.current, selector)?.click(); };
  const needsData = !dataAvailable ? 'Add data to start building.' : undefined;
  const publish = () => { setNotice(publishNotice(access.mode)); notify('Publishing is unavailable in this editor. Nothing has been published.'); };
  return <>
    <nav ref={nav} className="author-menu" aria-label="Analysis menu" onKeyDown={e => {
      if (e.key === 'Escape') { const menu = (e.target as HTMLElement).closest('details'); if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); } }
    }} onClick={e => { const button = (e.target as HTMLElement).closest('button'); if (button && button.getAttribute('aria-disabled') !== 'true' && !button.hasAttribute('data-menu-keep-open')) { const menu = button.closest('details'); if (menu) menu.open = false; } }}>
      <details name="analysis-menu"><summary>File</summary><div className="menu-popover">
        <AuthorMenuItem label="Add to Favorites" reason="Analysis favorites are not supported yet." />
        <AuthorMenuItem label="Publish" run={publish} />
        <AuthorMenuItem label="Save as Analysis" reason="Saving a separate analysis copy is not supported yet. Save draft updates the draft on this device." />
        <hr />
        <AuthorMenuItem label="Share" reason="Sharing needs hosted API support. Device-local drafts are not synced or shared; Exports downloads definitions without data." />
        <AuthorMenuItem label="Rename" run={() => focus('.analysis-title input')} />
        <AuthorMenuItem label="Import" reason={busy ? 'Wait for the current import or export to finish.' : undefined} run={onImport} />
        <hr />
        <AuthorMenuItem label="Print" reason="Analysis print layout is not supported yet." />
        <AuthorMenuItem label="Exports" keepOpen run={() => setExportsOpen(value => !value)} />
        {exportsOpen && <div className="menu-exports" role="group" aria-label="Analysis definition exports">
          <AuthorMenuItem label="Download .qs" reason={busy ? 'Wait for the current import or export to finish.' : undefined} run={onBundle} />
          <AuthorMenuItem label="Export JSON" reason={jsonDisabled ? 'The analysis definition cannot be exported. Review the export status below the toolbar.' : undefined} run={onJson} />
          <p>Definitions only; data is not included.</p>
        </div>}
        <AuthorMenuItem label="Export to PDF" reason="PDF export is not supported in this editor yet." />
        <hr />
        <AuthorMenuItem label="Autosave On" checked reason={autosaveError ? `Autosave could not save: ${autosaveError}` : 'Autosave is always on for this device. Drafts are not synced or shared.'} />
      </div></details>
      <details name="analysis-menu"><summary>Edit</summary><div className="menu-popover">
        <AuthorMenuItem label="Undo" reason="Undo history is not supported yet. Export a checkpoint to keep a copy." />
        <AuthorMenuItem label="Redo" reason="Redo history is not supported yet." />
        <hr />
        <AuthorMenuItem label="Themes" reason={!dataAvailable ? 'Add data to open the analysis theme editor.' : undefined} run={() => focus('[data-author-control="theme"]', 'Visual')} />
        <AuthorMenuItem label="Analysis Settings" reason="Analysis-level settings are not supported in this editor yet." />
      </div></details>
      <details name="analysis-menu"><summary>Data</summary><div className="menu-popover">
        <AuthorMenuItem label="Data" run={() => focus('.fields-panel > summary')} />
        <AuthorMenuItem label="Add data" reason={!onSources && !onPrep ? 'Adding datasets needs a connected data workspace.' : undefined} run={onSources ?? onPrep} />
        <hr />
        <AuthorMenuItem label="Add Calculated Field" reason={needsData} run={() => activate('.calculation-button')} />
        <hr />
        <AuthorMenuItem label="Parameters" reason={needsData} run={() => focus('.parameter-editor > summary')} />
        <AuthorMenuItem label="Add Parameter" reason={needsData} run={() => activate('[data-author-control="add-parameter"]')} />
        {onPrep && <><hr /><AuthorMenuItem label="Prepare data…" run={onPrep} /></>}
      </div></details>
      <details name="analysis-menu"><summary>Insert</summary><div className="menu-popover">
        <AuthorMenuItem label="Add Sheet" run={() => dispatch({ type: 'sheet-add' })} />
        <AuthorMenuItem label="Add Visual" reason={needsData} run={() => dispatch({ type: 'add', kind: 'bar' })} />
        <AuthorMenuItem label="Add Text" reason="Text boxes are not supported yet." />
        <AuthorMenuItem label="Add Image" reason="Image objects are not supported yet." />
        <AuthorMenuItem label="Add Insight" reason={needsData} run={() => dispatch({ type: 'add', kind: 'insight' })} />
        <AuthorMenuItem label="Build visual with Q" reason={needsData ?? (!oEntry ? 'Q is unavailable for this session.' : undefined)} run={() => activate('.q-trigger')} />
        <hr />
        <AuthorMenuItem label="Add Calculated Field" reason={needsData} run={() => activate('.calculation-button')} />
        <AuthorMenuItem label="Add Filter" reason={needsData ?? (!selected ? 'Select a visual to add a filter.' : undefined)} run={() => focus('[data-author-control="filters"]', 'Interaction')} />
        <AuthorMenuItem label="Add Parameter" reason={needsData} run={() => activate('[data-author-control="add-parameter"]')} />
      </div></details>
      <details name="analysis-menu"><summary>Sheets</summary><div className="menu-popover">{draft.sheets.map(s => <button type="button" key={s.id} onClick={() => dispatch({ type: 'sheet-select', id: s.id })}>{s.name}</button>)}<button type="button" onClick={() => dispatch({ type: 'sheet-add' })}>Add sheet</button></div></details>
      <details name="analysis-menu"><summary>Objects</summary><div className="menu-popover">{sheet.visuals.map(v => <button key={v.id} type="button" onClick={() => dispatch({ type: 'select', id: v.id })}>{v.title || v.id} · {v.kind}</button>)}{selected && <button type="button" onClick={() => dispatch({ type: 'remove', id: selected.id })}>Remove selected visual</button>}{!sheet.visuals.length && <p>No visuals on this sheet.</p>}</div></details>
      <details name="analysis-menu"><summary>Search</summary><div className="menu-popover"><label>Search analysis<input className="analysis-search" aria-keyshortcuts="Meta+F Control+F" type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>{draft.sheets.flatMap(s => s.visuals.filter(v => `${v.title} ${v.kind} ${v.id}`.toLowerCase().includes(search.toLowerCase())).map(v => <button key={v.id} type="button" onClick={() => { dispatch({ type: 'sheet-select', id: s.id }); dispatch({ type: 'select', id: v.id }); }}>{s.name} / {v.title || v.id}</button>))}<p>Fields: {(dataAvailable ? dataFields(draft.calculatedFields, draft.dataset) : []).filter(f => f.name.toLowerCase().includes(search.toLowerCase())).map(f => f.name).join(', ') || 'No matches'}</p></div></details>
      {oEntry}<div className="menu-spacer" /><button type="button" disabled={!dataAvailable} onClick={() => focus('.visual-gallery button')}>Add visual</button><button type="button" aria-pressed={fit} title={fit ? 'Fit is on; switch to 1200 pixel canvas' : 'Fit canvas to available width'} onClick={onFit}>FIT TO WIDTH</button><button type="button" onClick={publish}>PUBLISH</button>
      <label className="chrome-switch">NEW LOOK<select aria-label="NEW LOOK" value={draft.chrome ?? 'light'} onChange={e => dispatch({ type: 'chrome', mode: e.target.value as 'light' | 'dark' })}><option value="light">Light</option><option value="dark">Dark</option></select></label>
    </nav>
    {notice && <div className="toolbar-notice" role="status">{notice}<button type="button" onClick={() => setNotice('')}>Dismiss</button></div>}
  </>;
}
