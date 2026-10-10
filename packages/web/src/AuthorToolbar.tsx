import { readEmbeddedImage } from './sheet-objects.js';
import { objectLabel } from './SheetObjectCard.js';
import { useEffect, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { activeSheet, type AuthorAction, type AuthorDraft } from './authoring.js';
import { useAccess, type Access } from './access.js';
import { useToast } from './Toasts.js';
import { AnalysisSettings } from './AnalysisSettings.js';
import { AnalysisPdfDialog } from './AnalysisPdfDialog.js';
import { AuthorMenu, AuthorMenuItem } from './AuthorMenuItem.js';
import { flushSync } from 'react-dom';
import { useCommandPalette } from './CommandPalette.js';
import { hasDataLabels, hasLegend } from './formatting.js';
export function publishNotice(mode: Access['mode']): string {
  return mode === 'hosted'
    ? 'Publishing needs a hosted deployment with dashboard publication enabled. It is not available in this editor yet; nothing has been published.'
    : `${mode === 'local' ? 'This local workspace' : 'This static demo'} has no publication destination. Drafts are device-local, not synced or shared. Export .qs or JSON to share an analysis definition; data is not included. Nothing has been published.`;
}
/** Local draft IDs and imported resource IDs are never proof of a hosted asset. */
export function sharingUnavailableReason(access: Access): string {
  if (access.mode !== 'hosted') return `Sharing needs hosted API support. ${access.mode === 'local' ? 'This local workspace' : 'This static demo'} saves device-local drafts, not shared assets. Exports downloads definitions without data.`;
  if (!access.session?.namespaceId || !access.session.id) return 'Sharing needs a resolved hosted session and namespace. No sharing request can be made from this editor.';
  return `Sharing in namespace “${access.session.namespaceId}” needs a saved hosted analysis and share-management integration. This editor only saves device-local drafts, so Share is unavailable. Hosted grants must resolve users or groups in this namespace; namespace, folder, row and column permissions still apply.`;
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
export function AuthorToolbar({ canUndo = false, canRedo = false, onUndo, onRedo, onPrep, onSources, draft, dispatch, fit, onFit, onJson, onBundle, onImport, oEntry, dataAvailable = true, busy = false, jsonDisabled = false, autosaveError, favorite = false, onFavorite, onSaveCopy, onPrint }: { canUndo?: boolean; canRedo?: boolean; onUndo?: () => void; onRedo?: () => void; onPrint?: () => void; onSaveCopy?: () => void; favorite?: boolean; onFavorite?: () => void; autosaveError?: string; dataAvailable?: boolean; onSources?: () => void; onPrep?: () => void; oEntry?: ReactNode; busy?: boolean; jsonDisabled?: boolean; draft: AuthorDraft; dispatch: Dispatch<AuthorAction>; fit: boolean; onFit: () => void; onJson: () => void; onBundle: () => void; onImport: () => void }) {
  const access = useAccess();
  const notify = useToast();
  const [notice, setNotice] = useState('');
  const palette = useCommandPalette();
  const [exportsOpen, setExportsOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageSheetId = useRef<string | undefined>(undefined);
  const imageDraft = useRef<AuthorDraft | null>(null);
  const currentDraft = useRef(draft); currentDraft.current = draft;
  const [imageBusy, setImageBusy] = useState(false);
  const sheet = activeSheet(draft), selected = sheet.visuals.find(v => v.id === sheet.selectedId);
  const selectedObject = sheet.objects?.find(o => o.id === sheet.selectedId);
  const needsCanvas = !dataAvailable ? 'NO_SHEET_CANVAS: Add data or open an analysis to show a sheet canvas before inserting objects.' : undefined;
  const needsObject = needsCanvas ?? (!selected && !selectedObject ? 'Select an object first.' : undefined);
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
  const needsVisual = needsData ?? (!selected ? 'Select a visual first.' : undefined);
  const publish = () => { setNotice(publishNotice(access.mode)); notify('Publishing is unavailable in this editor. Nothing has been published.'); };
  return <>
    <input ref={imageInput} type="file" accept="image/*" hidden aria-label="Insert local image" onChange={async e => {
      const file = e.currentTarget.files?.[0], sheetId = imageSheetId.current, openedDraft = imageDraft.current; e.currentTarget.value = '';
      if (!file || !sheetId) return;
      setImageBusy(true);
      try {
        const dataUri = await readEmbeddedImage(file);
        // Reading/decoding is asynchronous: never insert into a switched document.
        if (currentDraft.current !== openedDraft) throw new Error('IMAGE_INSERT_CANCELLED: The analysis changed while choosing the image. Insert it again on the intended sheet.');
        dispatch({ type: 'object-add', kind: 'image', dataUri, alt: 'Embedded image', sheetId });
        setNotice('Image embedded on this device. No image was uploaded; exported definitions include its bytes.');
      } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
      finally { setImageBusy(false); }
    }} />
    {settingsOpen && <AnalysisSettings draft={draft} dispatch={dispatch} onClose={() => setSettingsOpen(false)} />}
    {pdfOpen && <AnalysisPdfDialog onClose={() => setPdfOpen(false)} onContinue={() => { flushSync(() => setPdfOpen(false)); onPrint?.(); }} />}
    <nav ref={nav} className="author-menu" aria-label="Analysis menu" onKeyDown={e => {
      if (e.key === 'Escape') { const menu = (e.target as HTMLElement).closest('details'); if (menu) { e.preventDefault(); e.stopPropagation(); menu.open = false; menu.querySelector('summary')?.focus(); } }
    }} onClick={e => { const button = (e.target as HTMLElement).closest('button'); if (button && button.getAttribute('aria-disabled') !== 'true' && !button.hasAttribute('data-menu-keep-open')) { const menu = button.closest('details'); if (menu) { if (menu.contains(menu.ownerDocument.activeElement)) menu.querySelector('summary')?.focus(); menu.open = false; } } }}>
      <AuthorMenu name="File">
        <AuthorMenuItem label={favorite ? "Remove from Favorites" : "Add to Favorites"} run={onFavorite} reason={!onFavorite ? "Favorites need an open analysis on this device." : undefined} />
        <AuthorMenuItem label="Publish" run={publish} />
        <AuthorMenuItem label="Save as Analysis" run={onSaveCopy} reason={busy ? "Wait for the current import or export to finish." : !onSaveCopy ? "Open an analysis to save a separate copy on this device." : undefined} />
        <hr />
        <AuthorMenuItem label="Share" reason={sharingUnavailableReason(access)} />
        <AuthorMenuItem label="Rename" run={() => focus('.analysis-title input')} />
        <AuthorMenuItem label="Import" reason={busy ? 'Wait for the current import or export to finish.' : undefined} run={onImport} />
        <hr />
        <AuthorMenuItem label="Print" run={onPrint} reason={busy ? "Wait for the current import or export to finish." : !onPrint ? "Open an analysis to print its current sheet." : undefined} />
        <AuthorMenuItem label="Exports" keepOpen run={() => { setExportsOpen(value => !value); focus('[data-author-menu="File"] > summary'); }} />
        <div hidden={!exportsOpen} className="menu-exports" role="group" aria-label="Analysis definition exports">
          <AuthorMenuItem label="Download .qs" descriptionId="export-help" reason={busy ? 'Wait for the current import or export to finish.' : undefined} run={onBundle} />
          <AuthorMenuItem label="Export JSON" descriptionId="export-help" reason={jsonDisabled ? 'The analysis definition cannot be exported. Review the export status below the toolbar.' : undefined} run={onJson} />
          <p>Definitions only; data is not included.</p>
        </div>
        <AuthorMenuItem label="Export to PDF" run={() => setPdfOpen(true)} reason={busy ? "Wait for the current import or export to finish." : !onPrint ? "Open an analysis in a browser with printing and Save as PDF support." : undefined} />
        <hr />
        <AuthorMenuItem label="Autosave On" checked reason={autosaveError ? `Autosave could not save: ${autosaveError}` : 'Autosave is always on for this device. Drafts are not synced or shared.'} />
      </AuthorMenu>
      <AuthorMenu name="Edit">
        <AuthorMenuItem label="Undo" run={onUndo} keyShortcuts="Control+Z Meta+Z" reason={!canUndo || !onUndo ? "Nothing to undo in this analysis session." : undefined} />
        <AuthorMenuItem label="Redo" run={onRedo} keyShortcuts="Control+Shift+Z Meta+Shift+Z Control+Y" reason={!canRedo || !onRedo ? "Nothing to redo. Undo an edit first; a new edit clears redo history." : undefined} />
        <hr />
        <AuthorMenuItem label="Themes" reason={!dataAvailable ? 'Add data to open the analysis theme editor.' : undefined} run={() => focus('[data-author-control="theme"]', 'Visual')} />
        <AuthorMenuItem label="Analysis Settings" run={() => setSettingsOpen(true)} />
      </AuthorMenu>
      <AuthorMenu name="Data">
        <AuthorMenuItem label="Data" run={() => focus('.fields-panel > summary')} />
        <AuthorMenuItem label="Add data" reason={!onSources && !onPrep ? 'Adding datasets needs a connected data workspace.' : undefined} run={onSources ?? onPrep} />
        <hr />
        <AuthorMenuItem label="Add Calculated Field" reason={needsData} run={() => activate('.calculation-button')} />
        <hr />
        <AuthorMenuItem label="Parameters" reason={needsData} run={() => focus('.parameter-editor > summary')} />
        <AuthorMenuItem label="Add Parameter" reason={needsData} run={() => activate('[data-author-control="add-parameter"]')} />
        {onPrep && <><hr /><AuthorMenuItem label="Prepare data…" run={onPrep} /></>}
      </AuthorMenu>
      <AuthorMenu name="Insert">
        <AuthorMenuItem label="Add Sheet" run={() => dispatch({ type: 'sheet-add' })} />
        <AuthorMenuItem label="Add Visual" reason={needsData} run={() => dispatch({ type: 'add', kind: 'bar' })} />
        <AuthorMenuItem label="Add Text" reason={needsCanvas} run={() => dispatch({ type: 'object-add', kind: 'text' })} />
        <AuthorMenuItem label="Add Image" reason={needsCanvas ?? (imageBusy ? 'Wait for this device to finish reading the image.' : undefined)} run={() => { imageSheetId.current = sheet.id; imageDraft.current = draft; imageInput.current?.click(); }} />
        <AuthorMenuItem label="Add Insight" reason={needsData} run={() => dispatch({ type: 'add', kind: 'insight' })} />
        <AuthorMenuItem label="Build visual with Q" reason={needsData ?? (!oEntry ? 'Q is unavailable for this session.' : undefined)} run={() => activate('.q-trigger')} />
        <hr />
        <AuthorMenuItem label="Add Calculated Field" reason={needsData} run={() => activate('.calculation-button')} />
        <AuthorMenuItem label="Add Filter" reason={needsData ?? (!selected ? 'Select a visual to add a filter.' : undefined)} run={() => focus('[data-author-control="filters"]', 'Interaction')} />
        <AuthorMenuItem label="Add Parameter" reason={needsData} run={() => activate('[data-author-control="add-parameter"]')} />
      </AuthorMenu>
      <AuthorMenu name="Sheets">
        <AuthorMenuItem label="Add Sheet" run={() => dispatch({ type: 'sheet-add' })} />
        <AuthorMenuItem label="Duplicate Sheet" reason="Sheet duplication is not supported yet." />
        <AuthorMenuItem label="Rename Sheet" run={() => activate('[data-author-control="rename-sheet"]')} />
        <hr />
        <AuthorMenuItem label="Add Title" reason="Sheet title objects are not supported yet. Rename Sheet changes the sheet name." />
        <AuthorMenuItem label="Add Description" reason="Sheet descriptions are not supported yet." />
        <hr />
        <AuthorMenuItem label="Layout Settings" reason="Sheet layout settings are not supported yet. Drag or resize visuals on the canvas; FIT TO WIDTH changes the preview width." />
        <hr />
        <div role="group" aria-label="Switch sheet">{draft.sheets.map(s => <AuthorMenuItem key={s.id} label={s.name} run={() => dispatch({ type: 'sheet-select', id: s.id })} />)}</div>
      </AuthorMenu>
      <AuthorMenu name="Objects">
        <AuthorMenuItem label="Format Object" reason={needsObject} run={() => focus('.properties-panel > summary', 'Visual')} />
        <AuthorMenuItem label="Field Wells" reason={needsVisual} run={() => focus('.visual-config h3')} />
        <hr />
        <AuthorMenuItem label="Title" reason={needsVisual} run={() => focus('input[aria-label="Title"]', 'Visual')} />
        <AuthorMenuItem label="Subtitle" reason={needsVisual} run={() => focus('input[aria-label="Subtitle"]', 'Visual')} />
        <AuthorMenuItem label="Data Labels" reason={needsVisual ?? (selected && !hasDataLabels(selected.kind) ? 'Data labels are not supported for this visual type.' : undefined)} run={() => focus('[data-author-control="data-labels"]', 'Visual')} />
        <AuthorMenuItem label="Legend" reason={needsVisual ?? (selected && !hasLegend(selected.kind) ? 'Legends are not supported for this visual type.' : undefined)} run={() => focus('[data-author-control="legend"]', 'Visual')} />
        <hr />
        <AuthorMenuItem label="Conditional Formatting" reason={needsVisual} run={() => focus('[data-author-control="conditional-formatting"]', 'Visual')} />
        <AuthorMenuItem label="Tooltips" reason={needsVisual ?? 'Tooltip customization is not supported yet. Charts use default tooltips.'} />
        <AuthorMenuItem label="Highlights" reason={needsVisual ?? 'Highlight settings are not supported yet.'} />
        <AuthorMenuItem label="Reference Lines" reason={needsVisual ?? 'Reference line authoring is not supported yet.'} />
        <AuthorMenuItem label="Actions" reason={needsVisual} run={() => focus('[data-author-control="actions"]', 'Interaction')} />
        <hr />
        <AuthorMenuItem label="Placement" run={() => focus('.object-placement input')} reason={selectedObject ? undefined : needsVisual ?? 'Numeric placement settings are not supported yet. Drag or resize the visual on the canvas.'} />
        <AuthorMenuItem label="Style" run={() => focus('.sheet-object-properties input')} reason={selectedObject ? undefined : needsVisual ?? 'Per-card style settings are not supported yet. Analysis themes and visual palettes are available in Properties.'} />
        <AuthorMenuItem label="Rules" reason={needsVisual ?? 'Object visibility rules are not supported yet.'} />
        <hr />
        <AuthorMenuItem label="Forecast" reason={needsVisual ?? 'Forecast authoring is not supported yet.'} />
        <AuthorMenuItem label="Anomaly" reason={needsVisual ?? 'Anomaly detection authoring is not supported yet.'} />
        <hr />
        <AuthorMenuItem label="Export Visual to CSV" reason={needsVisual ?? 'Visual query-result export to CSV is not supported in this editor yet.'} />
        <AuthorMenuItem label="Export Table to Excel" reason={needsVisual ?? 'Table query-result export to Excel is not supported in this editor yet.'} />
        {!!sheet.visuals.length && <><hr /><div role="group" aria-label="Select visual">{sheet.visuals.map(v => <AuthorMenuItem key={v.id} label={`${v.title || v.id} · ${v.kind}`} run={() => dispatch({ type: 'select', id: v.id })} />)}</div></>}
        {selected && <AuthorMenuItem label="Remove selected visual" run={() => dispatch({ type: 'remove', id: selected.id })} />}
        {!!sheet.objects?.length && <><hr /><div role="group" aria-label="Select object">{sheet.objects.map(o => <AuthorMenuItem key={o.id} label={objectLabel(o)} run={() => dispatch({ type: 'select', id: o.id })} />)}</div></>}
        {selectedObject && <AuthorMenuItem label="Remove selected object" run={() => dispatch({ type: 'remove', id: selectedObject.id })} />}
        {!sheet.visuals.length && !sheet.objects?.length && <p>No objects on this sheet.</p>}
      </AuthorMenu>
      <button type="button" className="analysis-search" aria-haspopup="dialog" aria-keyshortcuts="Meta+F Control+F" disabled={!palette} title={!palette ? 'Action search needs the application command palette.' : 'Search analysis actions'} onClick={() => {
        nav.current?.querySelectorAll('details[open]').forEach(menu => menu.removeAttribute('open'));
        palette?.open('Search analysis actions');
      }}>Search</button>
      {oEntry}<div className="menu-spacer" /><button type="button" disabled={!dataAvailable} onClick={() => focus('.visual-gallery button')}>Add visual</button><button type="button" aria-pressed={fit} title={fit ? 'Fit is on; switch to 1200 pixel canvas' : 'Fit canvas to available width'} onClick={onFit}>FIT TO WIDTH</button><button type="button" onClick={publish}>PUBLISH</button>
      <label className="chrome-switch">NEW LOOK<select aria-label="NEW LOOK" value={draft.chrome ?? 'light'} onChange={e => dispatch({ type: 'chrome', mode: e.target.value as 'light' | 'dark' })}><option value="light">Light</option><option value="dark">Dark</option></select></label>
    </nav>
    {notice && <div className="toolbar-notice" role="status">{notice}<button type="button" onClick={() => setNotice('')}>Dismiss</button></div>}
  </>;
}
