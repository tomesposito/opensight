import { useEffect, useRef, useState, type Dispatch } from 'react';
import { activeSheet, dataFields, type AuthorAction, type AuthorDraft } from './authoring.js';
export function AuthorToolbar({ draft, dispatch, fit, onFit, onJson, onBundle, onImport, busy = false, jsonDisabled = false }: { busy?: boolean; jsonDisabled?: boolean; draft: AuthorDraft; dispatch: Dispatch<AuthorAction>; fit: boolean; onFit: () => void; onJson: () => void; onBundle: () => void; onImport: () => void }) {
  const [notice, setNotice] = useState(''), [search, setSearch] = useState('');
  const sheet = activeSheet(draft), selected = sheet.visuals.find(v => v.id === sheet.selectedId);
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (event: Event) => { if (event.target instanceof Node && !nav.current?.contains(event.target)) nav.current?.querySelectorAll('details[open]').forEach(d => d.removeAttribute('open')); };
    if (typeof document === 'undefined') return;
    document.addEventListener?.('pointerdown', close);
    return () => document.removeEventListener?.('pointerdown', close);
  }, []);
  const focus = (selector: string) => {
    const target = nav.current?.closest('.author-workspace')?.querySelector<HTMLElement>(selector);
    const panel = target?.closest('details'); if (panel) panel.open = true;
    target?.focus();
  };
  return <>
    <nav ref={nav} className="author-menu" aria-label="Analysis menu" onKeyDown={e => {
      if (e.key === 'Escape') { const menu = (e.target as HTMLElement).closest('details'); if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); } }
    }} onClick={e => { if ((e.target as HTMLElement).closest('button')) { const menu = (e.target as HTMLElement).closest('details'); if (menu) menu.open = false; } }}>
      <details name="analysis-menu"><summary>File</summary><div className="menu-popover"><button type="button" disabled={busy} onClick={onImport}>Import bundle…</button><button type="button" disabled={busy} onClick={onBundle}>Download .qs</button><button type="button" disabled={jsonDisabled} onClick={onJson}>Export JSON</button><p>Drafts save on this device. Hosted file storage is unavailable.</p></div></details>
      <details name="analysis-menu"><summary>Edit</summary><div className="menu-popover"><button type="button" onClick={() => focus('.analysis-title input')}>Rename analysis</button><p>Undo / redo is not available yet. Export a checkpoint to keep a copy.</p></div></details>
      <details name="analysis-menu"><summary>Data</summary><div className="menu-popover"><button type="button" onClick={() => nav.current?.closest('.author-workspace')?.querySelector<HTMLButtonElement>('.calculation-button')?.click()}>Calculated field…</button><p>Local synthetic sales is available. Adding remote data sources requires a configured backend.</p></div></details>
      <details name="analysis-menu"><summary>Insert</summary><div className="menu-popover"><button type="button" onClick={() => dispatch({ type: 'add', kind: 'bar' })}>Add bar visual</button><button type="button" onClick={() => focus('.visual-gallery button')}>Choose visual type</button><p>Text boxes and images are not available yet.</p></div></details>
      <details name="analysis-menu"><summary>Sheets</summary><div className="menu-popover">{draft.sheets.map(s => <button type="button" key={s.id} onClick={() => dispatch({ type: 'sheet-select', id: s.id })}>{s.name}</button>)}<button type="button" onClick={() => dispatch({ type: 'sheet-add' })}>Add sheet</button></div></details>
      <details name="analysis-menu"><summary>Objects</summary><div className="menu-popover">{sheet.visuals.map(v => <button key={v.id} type="button" onClick={() => dispatch({ type: 'select', id: v.id })}>{v.title || v.id} · {v.kind}</button>)}{selected && <button type="button" onClick={() => dispatch({ type: 'remove', id: selected.id })}>Remove selected visual</button>}{!sheet.visuals.length && <p>No visuals on this sheet.</p>}</div></details>
      <details name="analysis-menu"><summary>Search</summary><div className="menu-popover"><label>Search analysis<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>{draft.sheets.flatMap(s => s.visuals.filter(v => `${v.title} ${v.kind} ${v.id}`.toLowerCase().includes(search.toLowerCase())).map(v => <button key={v.id} type="button" onClick={() => { dispatch({ type: 'sheet-select', id: s.id }); dispatch({ type: 'select', id: v.id }); }}>{s.name} / {v.title || v.id}</button>))}<p>Fields: {dataFields(draft.calculatedFields).filter(f => f.name.toLowerCase().includes(search.toLowerCase())).map(f => f.name).join(', ') || 'No matches'}</p></div></details>
      <div className="menu-spacer" /><button type="button" aria-pressed={fit} title={fit ? 'Fit is on; switch to 1200 pixel canvas' : 'Fit canvas to available width'} onClick={onFit}>FIT TO WIDTH</button><button type="button" onClick={() => setNotice('PUBLISH is unavailable locally. Hosted publishing needs the AWS deployment; nothing has been published.')}>PUBLISH</button>
    </nav>
    {notice && <div className="toolbar-notice" role="status">{notice}<button type="button" onClick={() => setNotice('')}>Dismiss</button></div>}
  </>;
}
