import { useAccess, allowed } from './access.js';
import { LocalEmptyState } from './LocalEmptyState.js';
import { ThemeEditor } from './ThemeEditor.js';
import { DatasetHeader } from './DatasetHeader.js';
import { FieldIcon } from './FieldIcon.js';
import { AuthorToolbar } from './AuthorToolbar.js';
import { AuthorShortcuts } from './AuthorShortcuts.js';
import { usePaletteCommands } from './CommandPalette.js';
import { DraftSourceRecovery, useDraftSource } from './DraftSource.js';
import { LocalDrafts } from './LocalDrafts.js';
import { useLocalDrafts } from './use-local-drafts.js';
import { draftStorageKey } from './local-drafts.js';
import { routeHash } from './app-navigation.js';
import { useToast } from './Toasts.js';
import { QSidePanel } from './QSidePanel.js';
import { BuildForMe } from './BuildForMe.js';
import { FormattingEditor } from './FormattingEditor.js';
import { PivotOptionsEditor } from './PivotOptionsEditor.js';
import { CardTitle, CardStyle, CardLayout, MultiplesOptions, GroupColorOptions, LegendOptions } from './PropertiesSections.js';
import { hasDataLabels, type VisualFormatting } from './formatting.js';
import { LIGHT_THEME, themeValid, type AnalysisTheme } from './themes.js';
import { functionCatalog } from '@opensight/query-engine/browser';
import { expressionError } from './authoring.js';
import { HierarchyEditor } from './HierarchyEditor.js';
import { withDrill, drillDown, drillUp, drillBreadcrumbs, levelLabel, type DrillPath } from './drill.js';
import { ActionEditor } from './ActionEditor.js';
import { toggleSelection, withActionFilters, originProblem, hasVisualActions, resolveUrlAction, resolveNavigationAction, type ActionSelections } from './interactions.js';
import type { VisualInteraction } from './visual-selection.js';
import { ControlsStrip } from './ControlsStrip.js';
import type { AuthorParameter } from './parameters.js';
import { ParameterEditor } from './ParameterEditor.js';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Dispatch, ReactNode } from 'react';
import { GridLayout, noCompactor, useContainerWidth } from 'react-grid-layout';
import { downloadBundleBytes, exportBundle, importBundleFile, importedFilterProblem, withInheritedParameterFilters } from './bundle-authoring.js';
import { VisualCard, type RowGroupToggle } from './VisualCard.js';
import { buildAuthorPreview, fixtureCategoryValues } from './author-preview.js';
import { LiveAuthorVisual } from './LiveAuthorVisual.js';
import { buildDistinctQuery, loadAuthorRows } from './author-query.js';
import type { QueryClient } from './author-query.js';
import {
  authorVisualProblem, VISUAL_TYPES, GRID_COLUMNS, FIELD_GROUPS, fieldGroup, activeSheet, calculationError, dataFields, dimensionLabel,
  emptyDraft, serializeDraft, sheetParameters, tabular, visualDimensions, grouped, splitDimensions, noDimensions, capabilityNote, hasSmallMultiplesWell,
} from './authoring.js';
import type { AuthorAction, AuthorDataset, AuthorDraft, AuthorVisual, CalculatedField, FieldGroup, VisualKind, Well } from './authoring.js';

interface AuthorProps { sampleLoaded?: boolean; onTrySample?: () => void; onSources?: () => void; onDatasetChange?: (dataset?: AuthorDataset) => void; dataset?: AuthorDataset; client?: QueryClient; onPrep?: () => void; inApp?: boolean; draftId?: string; newAnalysis?: boolean; onDraftChange?: (id?: string) => void }
export function Author(props: AuthorProps) {
  const access = useAccess();
  return allowed(access, 'build') ? <AuthorWorkspace key={draftStorageKey(access)} {...props} /> : <p role="alert">SECURITY_BUILD_REQUIRED: Author access required.</p>;
}

type EditorProps = { draft: AuthorDraft; dispatch: Dispatch<AuthorAction>; client?: QueryClient };
const saveTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function AuthorWorkspace({ sampleLoaded = false, onTrySample, client: apiClient, dataset, onDatasetChange, onPrep, onSources, inApp, draftId, newAnalysis, onDraftChange }: AuthorProps) {
  const access = useAccess();
  const notify = useToast();
  const drafts = useLocalDrafts(access, dataset, { draftId, newAnalysis });
  const { draft, dispatch } = drafts;
  const noData = access.mode === 'local' && !draft.dataset && !sampleLoaded;
  const workspace = useRef<HTMLDivElement>(null);
  const saveDraft = () => { const saved = !!drafts.save(); if (saved) notify('Draft saved'); return saved; };
  const notifiedError = useRef<string | null>(null);
  useEffect(() => {
    if (drafts.autoState !== 'error') { notifiedError.current = null; return; }
    if (drafts.autoError && notifiedError.current !== drafts.autoError) {
      notifiedError.current = drafts.autoError; notify(drafts.autoError);
    }
  }, [drafts.autoState, drafts.autoError, notify]);
  const changed = useRef(onDraftChange);
  changed.current = onDraftChange;
  useEffect(() => { if (!drafts.openingError) changed.current?.(drafts.id); }, [drafts.id, drafts.openingError]);
  // Storage reads create fresh objects. Renaming a draft must not cancel and
  // restart an identical data query while the server is still executing it.
  const datasetKey = JSON.stringify(draft.dataset);
  const queryDataset = useMemo(() => draft.dataset, [datasetKey]);
  const client = useMemo(() => apiClient ? { ...apiClient, dataset: queryDataset } : undefined, [apiClient, queryDataset]);
  const source = useDraftSource(queryDataset, client, access.mode === 'local');
  const [exportStatus, setExportStatus] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false), [copyError, setCopyError] = useState('');
  const copyHelpId = useId();
  const [reportOpen, setReportOpen] = useState(false);
  const importConfirmation = useRef(false);
  const [fit, setFit] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const importFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true); setImportStatus(`Importing ${file.name}…`);
    try {
      const imported = await importBundleFile(file);
      if (!drafts.replace(imported)) { setImportStatus('Import paused. Save or export your current work first.'); return; }
      onDatasetChange?.(undefined); setReportOpen(true);
      setImportStatus(`Imported ${file.name}. Review the import report for unsupported features.`);
      // The modal makes the app shell inert. Announce success after it closes
      // so the toast is visible and its dismiss button is keyboard accessible.
      importConfirmation.current = true;
    } catch (error) { setImportStatus(`Import failed: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  const copyDraftLink = async () => {
    if (!drafts.id || drafts.dirty || copying) return;
    setCopying(true); setCopyError('');
    try {
      const url = new URL(window.location.href);
      url.search = '';
      url.hash = routeHash({ page: 'author', draftId: drafts.id });
      await navigator.clipboard.writeText(url.href);
      notify('Link copied');
    } catch { setCopyError('Could not copy the link. Copy the saved draft URL from your browser’s address bar.'); }
    finally { setCopying(false); }
  };
  const downloadQs = async () => {
    setBusy(true);
    try {
      const bytes = await downloadBundleBytes(draft);
      downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }), 'opensight-analysis.qs');
      setExportStatus('Export downloaded: opensight-analysis.qs');
    } catch (error) { setExportStatus(`Export blocked: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  const exported = useMemo(() => {
    try {
      const members = draft.bundle ? exportBundle(draft).members : undefined;
      const resource = members ? (members.find(m => m.path === draft.bundle?.primaryPath) ?? members[0])?.resource : serializeDraft(draft);
      return { json: JSON.stringify(resource, null, 2) + '\n' };
    }
    catch (error) { return { error: `Export blocked: ${error instanceof Error ? error.message : String(error)}` }; }
  }, [draft]);
  const download = () => {
    if (!exported.json) return;
    try {
      downloadBlob(new Blob([exported.json], { type: 'application/json' }), 'opensight-analysis.json');
      setExportStatus('Export downloaded: opensight-analysis.json');
    } catch { setExportStatus('Export could not be downloaded. Please try again.'); }
  };
  const renderToolbar = (trigger?: ReactNode) => <AuthorToolbar
    onPrep={onPrep ? () => { if (drafts.keepCurrent()) onPrep(); } : undefined}
    draft={draft} dispatch={dispatch} oEntry={trigger} dataAvailable={!noData} fit={fit}
    onFit={() => setFit(value => !value)} onJson={download}
    onBundle={() => { if (!busy) void downloadQs(); }} onImport={() => fileInput.current?.click()}
    busy={busy} jsonDisabled={!!exported.error} />;
  if (drafts.openingError) return <section><h1>Unable to open analysis</h1><p role="alert">{drafts.openingError}</p><p>Return to My analyses to refresh the list or choose another draft.</p></section>;
  return <div ref={workspace} className="author-workspace" data-chrome={draft.chrome ?? 'light'}>
    <AuthorShortcuts workspace={workspace} onSave={saveDraft} />
    <AuthorCommands draft={draft} dispatch={dispatch} onSave={saveDraft} />
    <header className="author-topbar app-header">
      {!inApp && <a className="brand" href="./"><span className="brand-mark" aria-hidden="true">◈</span>OpenSight</a>}
      <label className="analysis-title"><span className="sr-only">Analysis title</span><input value={draft.title} onChange={e => dispatch({ type: 'analysis-title', title: e.target.value })} /></label>
    </header>
    {noData ? renderToolbar() : <QSidePanel draft={draft} dispatch={dispatch} client={client} renderTrigger={renderToolbar} />}
    <div className="author-tools">
      <div className="author-utilities">
        <button type="button" aria-keyshortcuts="Meta+S Control+S" onClick={saveDraft}>Save draft</button>
        {(drafts.id || drafts.savedAt || drafts.autoState === 'saving' || drafts.autoState === 'error') && <span className="save-indicator" role="status">{drafts.autoState === 'saving' ? 'Saving…' : drafts.autoState === 'unsaved' || drafts.autoState === 'error' ? 'Unsaved changes' : drafts.savedAt ? `Saved · ${saveTime(drafts.savedAt)}` : null}</span>}
        {inApp && <button type="button" disabled={!drafts.id || drafts.dirty || copying} aria-describedby={copyHelpId} onClick={() => { void copyDraftLink(); }}>Copy draft link</button>}
        <button type="button" onClick={() => { if (drafts.replace({ ...emptyDraft(), ...(draft.dataset ? { dataset: draft.dataset } : {}) })) onDatasetChange?.(draft.dataset); }}>New analysis</button>
      </div>
      {drafts.recoveredAt && <div className="draft-recovery">
        <span role="status">Recovered auto-saved work from {saveTime(drafts.recoveredAt)} — it was never manually saved.</span>
        <button type="button" onClick={saveDraft}>Save draft</button>
        <button type="button" onClick={drafts.dismissRecovery}>Dismiss</button>
      </div>}
      {inApp && <p id={copyHelpId} className="draft-link-help">Draft links open only in this browser on this device; they do not share the analysis. Save changes before copying.</p>}
      {copyError && <p role="alert">{copyError}</p>}
      <LocalDrafts entries={drafts.entries} activeId={drafts.id} onRefresh={drafts.refresh} onOpen={id => { const opened = drafts.open(id); if (opened) { source.retry(); onDatasetChange?.(opened.dataset); } }} onRename={drafts.rename} onDelete={id => { if (drafts.remove(id) && id === drafts.id) onDatasetChange?.(undefined); }} />
      <div className="bundle-import" onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length !== 1) setImportStatus('Drop one .qs ZIP or one bundle .json member.'); else void importFile(e.dataTransfer.files[0]); }} aria-label="Bundle drop zone">
        <details><summary>Import bundle</summary>
        <label>Import .qs or bundle JSON<input ref={fileInput} type="file" accept=".qs,.json,application/zip,application/json" disabled={busy} onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; void importFile(file); }} /></label>
        <p>Drop one .qs ZIP or JSON member here. Import opens a new draft and saves existing edits first.</p>
        </details>
        {importStatus && <p role={importStatus.startsWith('Import failed') ? 'alert' : 'status'}>{importStatus}</p>}
        {draft.bundle && <button type="button" onClick={() => setReportOpen(true)}>View import report</button>}
      </div>
    </div>
    {access.mode === 'local' && <LocalDatasetPicker sampleLoaded={sampleLoaded} client={client} dataset={draft.dataset} onSelect={dataset => { if (drafts.replace({ ...emptyDraft(), ...(dataset ? { dataset } : {}) })) onDatasetChange?.(dataset); }} />}
    <p className="fixture-notice">{noData ? 'No dataset selected. Add data to start building.' : draft.dataset ? (access.mode === 'local' ? 'Live prepared data · Field assignments query the local API. Uploads survive API restarts and expire after 24 hours.' : 'Live prepared data · Field assignments query the local API. Uploads expire after 24 hours or API restart.') : access.mode === 'local' ? 'Sample sales data · 8 synthetic rows. Field assignments query the local sample dataset.' : client ? 'Live local sales data · All regions, dates grouped in UTC (month by default). Field assignments query the API; unsupported queries show their error details and guidance.' : draft.sheets.some(s => s.visuals.some(v => v.kind === 'pivot')) ? 'Offline demo: pivot previews recompute pinned synthetic sales rows locally across all regions. Row groups expand and collapse locally. No live queries run.' : draft.sheets.some(s => s.visuals.some(v => v.kind === 'insight')) ? 'Offline demo: insight narratives recompute pinned synthetic sales rows locally across all regions. Rule-based computations; no ML or live queries.' : draft.sheets.some(s => s.visuals.some(v => v.kind === 'waterfall')) ? 'Offline demo: waterfall previews recompute pinned synthetic sales rows locally across all regions. No live queries run.' : draft.sheets.some(s => s.visuals.some(v => v.kind === 'sankey')) ? 'Offline demo: sankey previews recompute pinned synthetic sales rows locally across all regions. No live queries run.' : draft.sheets.some(s => s.visuals.some(v => v.kind === 'radar')) ? 'Offline demo: radar previews recompute pinned synthetic sales rows locally across all regions. No live queries run.' : draft.calculatedFields.length || draft.parameters.length || draft.sheets.some(s => s.visuals.some(v => hasVisualActions(v) || v.hierarchy)) ? 'Offline demo: controls, calculated fields and interactions recompute pinned synthetic sales rows locally across all regions. No live queries run.' : 'Offline demo: manual visual previews use fixed sample results: region = East, dates grouped by UTC month. Only revenue totals by region, category, month, or overall are available. Other manual selections need a supported sample or a hosted API. O recomputes synthetic sales rows locally across all regions. No live queries run.'}</p>
    <div className="author-save"><p role="status">{drafts.message}</p>
      <p id="export-help">{exported.error ?? (client ? 'Downloads analysis definitions and sheet layouts; query results are not included.' : 'Downloads analysis definitions and sheet layouts; sample rows and the fixed East preview filter are not included.')}</p>
      {exportStatus && <p role="status">{exportStatus}</p>}
    </div>
    {source.problem && <DraftSourceRecovery draft={draft} sources={source.sources} problem={source.problem} onRetry={source.retry} onSources={onSources ? () => { if (drafts.keepCurrent()) onSources(); } : undefined} onReconnect={next => { dispatch({ type: 'import', draft: next }); onDatasetChange?.(next.dataset); }} />}
    {noData ? <div className="author-layout author-layout-empty">
      <Panel title="Data" className="fields-panel"><p>No dataset selected.</p>{onSources && <button type="button" onClick={() => { if (drafts.keepCurrent()) onSources(); }}>Add data</button>}</Panel>
      <Panel title="Visuals" className="build-panel"><p>Add data to see fields and create visuals.</p></Panel>
      <div className="author-center" role="region" aria-label="Analysis sheet"><div className="author-canvas"><LocalEmptyState title="Add data to your analysis" onSources={onSources ? () => { if (drafts.keepCurrent()) onSources(); } : undefined} onSample={onTrySample} /></div></div>
    </div> : <AuthorCanvas draft={draft} dispatch={dispatch} client={client} fit={fit} sourceProblem={source.problem} />}
    {reportOpen && draft.bundle && <ImportReport draft={draft} onClose={() => {
      setReportOpen(false);
      if (importConfirmation.current) { importConfirmation.current = false; notify('Bundle imported'); }
    }} />}
  </div>;
}

function AuthorCommands({ draft, dispatch, onSave }: EditorProps & { onSave: () => boolean }) {
  const notify = useToast();
  usePaletteCommands(useMemo(() => ({
    chrome: draft.chrome ?? 'light',
    commands: [
      { id: 'save-draft', label: 'Save draft', run: () => { onSave(); } },
      { id: 'toggle-theme', label: 'Toggle theme', keywords: 'new look light dark', run: () => {
        const mode = draft.chrome === 'dark' ? 'light' : 'dark';
        dispatch({ type: 'chrome', mode }); notify(`Editor theme changed to ${mode}`);
      } },
      ...draft.sheets.map(sheet => ({ id: `sheet-${sheet.id}`, label: `Go to sheet: ${sheet.name}`, run: () => dispatch({ type: 'sheet-select', id: sheet.id }) })),
    ],
  }), [draft, dispatch, onSave, notify]));
  return null;
}

function LocalDatasetPicker({ sampleLoaded, client, dataset, onSelect }: { sampleLoaded: boolean; client?: QueryClient; dataset?: AuthorDataset; onSelect: (dataset?: AuthorDataset) => void }) {
  const [sources, setSources] = useState<Awaited<ReturnType<NonNullable<QueryClient['listPrepSources']>>>>([]);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const list = client?.listPrepSources;
  useEffect(() => {
    let active = true;
    if (list) void list().then(value => { if (active) { setSources(value.filter(s => typeof s.ref === 'object' && 'dataset' in s.ref)); setError(''); } }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [list, reload]);
  return <div className="api-picker"><label>Analysis dataset<select value={dataset?.id ?? (sampleLoaded ? 'sales' : '')} onChange={e => {
    const selected = sources.find(s => s.id === e.target.value);
    if (e.target.value === 'sales' && sampleLoaded) onSelect();
    else if (selected?.available) onSelect({ id: selected.id, name: selected.name ?? selected.id, columns: selected.columns });
  }}><option value="" disabled>Choose prepared data…</option>{sampleLoaded && <option value="sales">Sample sales data</option>}{dataset && !sources.some(s => s.id === dataset.id) && <option value={dataset.id}>{dataset.name} (unavailable)</option>}{sources.map(s => <option key={s.id} value={s.id} disabled={!s.available}>{s.name ?? s.id}{!s.available ? ` · ${s.errorCode ?? 'Unavailable'}` : ''}</option>)}</select></label><button onClick={() => setReload(n => n + 1)}>Refresh datasets</button><span>Choosing a dataset starts a new analysis draft.</span>{error && <p role="alert">{error}</p>}</div>;
}

function Panel({ title, className, children }: { title: string; className: string; children: ReactNode }) {
  // Keep the sheet usable on laptops; Properties remains available in its rail.
  const collapseQuery = className === 'properties-panel' ? '(max-width: 1399px)' : '(max-width: 1100px)';
  // Start at the viewport's default: an initial native toggle event from an
  // open disclosure can otherwise race the effect that collapses narrow rails.
  const [open, setOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia(collapseQuery).matches);
  useEffect(() => {
    const query = window.matchMedia(collapseQuery);
    const change = () => setOpen(!query.matches);
    change(); query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, [collapseQuery]);
  return <details className={`builder-panel ${className}`} open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>{title}</summary><div className="panel-content">{children}</div>
  </details>;
}

const dimensionWellLabel = (kind: VisualKind, well: Well): string => well === 'columns'
  ? kind === 'sankey' ? 'Destination' : kind === 'pointMap' ? 'Longitude' : kind === 'radar' ? 'Color' : 'Columns'
  : well === 'smallMultiples' ? 'Small multiples' : kind === 'pointMap' ? 'Latitude' : kind === 'box' ? 'Group / sample dimensions' : ['bar', 'bar100', 'pie'].includes(kind) ? 'Group/Color' : dimensionLabel(kind);
const FIELD_DRAG_TYPE = 'application/x-opensight-field';

export function AuthorCanvas({ draft, dispatch, client, fit = true, sourceProblem }: EditorProps & { fit?: boolean; sourceProblem?: string }) {
  const [newKind, setNewKind] = useState<VisualKind>('bar');
  const [search, setSearch] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Partial<Record<FieldGroup, boolean>>>({});
  const [searchCollapsedGroups, setSearchCollapsedGroups] = useState<Partial<Record<FieldGroup, boolean>>>({});
  const fieldIconId = useId();
  const [well, setWell] = useState<Well>('rows');
  const [calculationOpen, setCalculationOpen] = useState(false);
  const sheet = activeSheet(draft), fields = dataFields(draft.calculatedFields, draft.dataset);
  const query = search.trim().toLowerCase();
  const matchingFields = fields.filter(f => f.name.toLowerCase().includes(query));
  const interactionKey = JSON.stringify([draft.dataset?.id, sheet.id, sheet.visuals.map(v => [v.id, v.kind, v.dimension, v.rows, v.columns, v.measures, v.smallMultiples, v.filters, v.filterActions, v.urlActions, v.navigationActions, v.hierarchy, v.imported]), draft.sheets.map(s => [s.id, s.imported?.memberPath]), draft.parameters, draft.calculatedFields, !!client]);
  const [interactionState, setInteractionState] = useState<{ key: string; selections: ActionSelections }>({ key: interactionKey, selections: {} });
  const [actionProblems, setActionProblems] = useState<{ key: string; visuals: Record<string, Record<string, string>> }>({ key: interactionKey, visuals: {} });
  const runtimeProblems = actionProblems.key === interactionKey ? actionProblems.visuals : {};
  const selections = interactionState.key === interactionKey ? interactionState.selections : {};
  const [drillState, setDrillState] = useState<{ key: string; paths: Record<string, DrillPath>; armed?: string }>({ key: interactionKey, paths: {} });
  const paths = drillState.key === interactionKey ? drillState.paths : {};
  const armed = drillState.key === interactionKey ? drillState.armed : undefined;
  const interactive = sheet.visuals.some(v => hasVisualActions(v) || v.hierarchy);
  const clearSource = (id: string) => setInteractionState({ key: interactionKey, selections: Object.fromEntries(Object.entries(selections).filter(([key]) => key !== id)) });
  const setPath = (id: string, path: DrillPath) => { setDrillState({ key: interactionKey, paths: { ...paths, [id]: path } }); clearSource(id); };
  const clearActions = () => setInteractionState({ key: interactionKey, selections: {} });
  const selected = sheet.visuals.find(v => v.id === sheet.selectedId);
  const dimensionWell: Well = well === 'smallMultiples' && (!selected || hasSmallMultiplesWell(selected.kind)) ? 'smallMultiples' : selected ? grouped(selected.kind) ? (well === 'columns' && splitDimensions(selected.kind) ? 'columns' : 'rows') : 'dimension' : 'dimension';
  const dimensionDestination = selected ? noDimensions(selected.kind) ? 'unavailable for this visual' : dimensionWellLabel(selected.kind, dimensionWell) : dimensionWellLabel('bar', dimensionWell);
  const { width, containerRef } = useContainerWidth({ initialWidth: 900 });
  const original = draft.bundle?.original.members.find(m => m.path === sheet.imported?.memberPath)?.resource;
  const originalTheme = original && (original.resourceType === 'analysis' || original.resourceType === 'dashboard') ? original.definition.opensightTheme : undefined;
  const theme = sheet.imported && sheet.imported.memberPath !== draft.bundle?.primaryPath ? themeValid(originalTheme) ? originalTheme : LIGHT_THEME : draft.theme ?? LIGHT_THEME;
  const mobile = width < 600;
  const layout = useMemo(() => mobile ? sheet.layout.map((p, i) => ({ ...p, x: 0, y: i * 8, w: GRID_COLUMNS, h: 8 })) : sheet.layout.map(p => ({ ...p, minW: 3, minH: 4 })), [mobile, sheet.layout]);
  return <>
    <div className="author-layout">
      <Panel title="Data" className="fields-panel">
        <DatasetHeader datasetId={draft.dataset?.id} datasetName={draft.dataset?.name} client={client} />
        <label>Search fields<input type="search" value={search} onChange={e => { setSearch(e.target.value); setSearchCollapsedGroups({}); }} placeholder="Search fields" /></label>
        <button type="button" className="calculation-button" onClick={() => setCalculationOpen(true)}>+ Calculated field</button>
        <p className="field-hint">{selected ? 'Click a field to assign it.' : 'Click a field to create a bar.'} Dimensions: {dimensionDestination}. Measures: VALUE.</p>
        {FIELD_GROUPS.filter(group => matchingFields.some(f => fieldGroup(f) === group)).map(group => <details key={group} className="field-group" open={!(query ? searchCollapsedGroups : collapsedGroups)[group]} onToggle={e => {
          const collapsed = !e.currentTarget.open;
          (query ? setSearchCollapsedGroups : setCollapsedGroups)(previous => previous[group] === collapsed ? previous : { ...previous, [group]: collapsed });
        }}>
          <summary><svg className="field-folder" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4V2.5h5l2 2h6V13h-13V4Z" /></svg>{group}</summary>
          {matchingFields.filter(f => fieldGroup(f) === group).map(field => <button key={field.name} type="button"
            title={field.type === 'BOOLEAN' ? 'Boolean fields are supported in preparation; convert to text or number before charting.' : undefined}
            disabled={field.type === 'BOOLEAN' || (field.role === 'dimension' && !!selected && noDimensions(selected.kind))}
            aria-label={`Assign ${field.name}`} aria-pressed={selected?.dimension === field.name || selected?.rows.includes(field.name) || selected?.columns.includes(field.name) || !!selected?.measures.includes(field.name) || !!selected?.smallMultiples?.includes(field.name)}
            draggable={field.type !== 'BOOLEAN'} onDragStart={e => { e.dataTransfer.setData(FIELD_DRAG_TYPE, field.name); e.dataTransfer.effectAllowed = 'copy'; }}
            aria-describedby={`${fieldIconId}-${encodeURIComponent(field.name)}`}
            onClick={() => dispatch({ type: selected ? 'assign' : 'assign-with-no-selection', field: field.name, well: field.role === 'measure' ? 'values' : dimensionWell })}>
            <FieldIcon field={field} id={`${fieldIconId}-${encodeURIComponent(field.name)}`} />
            <span className="field-name">{field.name}</span><span className="field-type">{field.type}</span>
          </button>)}
        </details>)}
        {!matchingFields.length && <p role="status">No matching fields.</p>}
        <ParameterEditor draft={draft} dispatch={dispatch} />
        <ImportedPanels draft={draft} />
      </Panel>
      <Panel title="Visuals" className="build-panel">
          <form className="add-visual" onSubmit={e => { e.preventDefault(); dispatch({ type: 'add', kind: newKind, empty: true }); }}>
            <div className="visual-gallery" role="group" aria-label="Visual type gallery">{VISUAL_TYPES.map(type => <button type="button" key={type.kind} value={type.kind} aria-label={type.label} aria-pressed={newKind === type.kind} onClick={() => setNewKind(type.kind)}>
              <span aria-hidden="true">{type.icon}</span>{type.label}
            </button>)}</div>
            <button type="submit" className="primary-button" aria-label="Add visual">ADD</button>
          </form>
          <div className="visual-config" id={selected ? `configure-${selected.id}` : undefined}>
            <h3>Field wells</h3>
            {selected && <><p className="selected-visual">{selected.title || `Visual ${sheet.visuals.indexOf(selected) + 1}`}</p>
            <label className="change-type">Change visual type<select value={selected.imported?.issues.some(i => i.startsWith('Unsupported visual type:')) && !selected.imported.replaced ? '' : selected.kind} onChange={e => dispatch({ type: 'kind', kind: e.target.value as VisualKind })}>{selected.imported?.issues.some(i => i.startsWith('Unsupported visual type:')) && !selected.imported.replaced && <option value="" disabled>{selected.imported.variant} (unsupported)</option>}{VISUAL_TYPES.map(type => <option value={type.kind} key={type.kind}>{type.label}</option>)}</select></label>
            </>}
            <FieldWells visual={selected} draft={draft} dispatch={dispatch} activeWell={well === 'values' ? 'values' : dimensionWell} onWell={setWell} />
            {selected && <p className="capability-note" role="note">{capabilityNote(selected.kind)}</p>}
          </div>
      </Panel>
      <div className="author-center" role="region" aria-label="Analysis sheet">
        <SheetTabs draft={draft} dispatch={dispatch} />
        {interactive && <div className="action-status"><button type="button" disabled={!Object.keys(selections).length} onClick={clearActions}>Reset actions</button><span role="status">{Object.keys(selections).length} active selection(s) {Object.entries(selections).map(([id, selection]) => `${id}: ${selection.range?.join(' – ') ?? Object.entries(selection.values).map(([field, value]) => `${field} = ${value}`).join(', ')}`).join('; ')} · {client ? 'Live queries' : 'Recomputed synthetic sales across all regions'}</span></div>}
        <ControlsStrip key={sheet.id} draft={draft} dispatch={dispatch} client={client} />
        <div className="canvas-viewport" data-fit={fit ? 'width' : 'actual'} aria-label={fit ? 'Canvas fits available width' : 'Canvas at 1200 pixel width'}>
        <div className="author-canvas" style={{ width: fit ? '100%' : 1200, backgroundColor: theme.background, color: theme.textColor, fontFamily: theme.fontFamily }} ref={containerRef}>
          <div className="canvas-label"><strong>{sheet.name}</strong><span>{sheet.visuals.length} {sheet.visuals.length === 1 ? 'visual' : 'visuals'} · {mobile ? 'Mobile preview' : 'Drag the handle to move · Drag a corner to resize'}</span></div>
          {!sheet.visuals.length && <div className="canvas-empty"><h2>Your canvas is ready</h2><p>Choose a field from the Data panel to create a visual, or select a type and ADD.</p></div>}
          <div aria-label="Authoring canvas">
            <GridLayout key={sheet.id} width={width} layout={layout} compactor={noCompactor}
              gridConfig={{ cols: GRID_COLUMNS, rowHeight: 42, margin: [12, 12], containerPadding: [0, 0] }}
              dragConfig={{ enabled: !mobile, handle: '.drag-handle' }} resizeConfig={{ enabled: !mobile, handles: ['se', 'sw'] }}
              onDragStop={next => { if (!mobile) dispatch({ type: 'layout', sheetId: sheet.id, layout: next }); }}
              onResizeStop={next => { if (!mobile) dispatch({ type: 'layout', sheetId: sheet.id, layout: next }); }}>
              {sheet.visuals.map((visual, index) => {
                const path = paths[visual.id] ?? [], projected = withDrill(withInheritedParameterFilters(draft, sheet, visual), path, draft.calculatedFields, draft.dataset);
                const hierarchy = visual.kind !== 'kpi' ? visual.hierarchy : undefined;
                const interaction: VisualInteraction | undefined = (hasVisualActions(visual) || hierarchy) && (hierarchy ? !authorVisualProblem(projected) && projected.measures.length > 0 : !originProblem(projected)) ? {
                  brush: visual.kind === 'line' && !!visual.filterActions?.length && armed !== visual.id,
                  onClear: () => clearSource(visual.id),
                  onSelect: selection => {
                    if (armed === visual.id && hierarchy) setPath(visual.id, drillDown(visual, path, selection));
                    else {
                      const clicked = { ...selection, values: Object.fromEntries([...path.flatMap(p => Object.entries(p.values)), ...Object.entries(selection.values)]) };
                      if (visual.filterActions?.length) setInteractionState({ key: interactionKey, selections: toggleSelection(selections, visual.id, clicked) });
                      if (!selection.range) {
                        const problems: Record<string, string> = Object.create(null);
                        for (const action of visual.urlActions ?? []) {
                          const result = resolveUrlAction(visual, action, clicked);
                          if (result.problem !== undefined) problems[action.id] = result.problem;
                          else window.open(result.value, action.target ?? '_blank', 'noopener,noreferrer');
                        }
                        for (const action of visual.navigationActions ?? []) {
                          const result = resolveNavigationAction(draft, visual, action, clicked);
                          if (result.problem !== undefined) problems[action.id] = result.problem;
                          else { dispatch({ type: 'navigate', sourceId: visual.id, actionId: action.id, selection: clicked }); break; }
                        }
                        setActionProblems({ key: interactionKey, visuals: { ...runtimeProblems, [visual.id]: problems } });
                      }
                    }
                  },
                } : undefined;
                return <div key={visual.id}><AuthorCard theme={theme} interactive={interactive} interaction={interaction}
                  drillNavigation={hierarchy && <nav className="drill-navigation" aria-label={`Drill breadcrumb for ${visual.id}`}>
                    {drillBreadcrumbs(visual, path).map((crumb, i) => <button type="button" key={i} onClick={() => setPath(visual.id, drillUp(path, crumb.depth))}>{crumb.label}</button>)}
                    <span>Current: {levelLabel(hierarchy.levels[path.length]!)}</span>
                    <button type="button" disabled={!path.length} onClick={() => setPath(visual.id, drillUp(path))}>Drill up</button>
                    <button type="button" disabled={path.length >= hierarchy.levels.length - 1} aria-pressed={armed === visual.id} onClick={() => setDrillState({ key: interactionKey, paths, armed: armed === visual.id ? undefined : visual.id })}>Drill down</button>
                    {armed === visual.id && <span role="status">Select a category or data row to drill.</span>}
                  </nav>}
                  visual={withActionFilters(sheet, projected, selections, draft.calculatedFields, draft.dataset)} index={index} count={sheet.visuals.length} selected={visual.id === sheet.selectedId} filterProblem={sourceProblem ?? (draft.dataset && !client ? 'Local dataset needs its local API; no sample data is substituted.' : importedFilterProblem(draft, sheet, visual))} dispatch={dispatch} client={client} calculations={draft.calculatedFields} parameters={sheetParameters(draft)} />
                </div>;
              })}
            </GridLayout>
          </div>
        </div>
      </div></div>
      <Panel title="Properties" className="properties-panel">
        {selected ? <Properties key={selected.id} runtimeProblems={runtimeProblems[selected.id]} visual={selected} draft={draft} dispatch={dispatch} client={client} /> : <><p>Select a visual to edit its display settings.</p><ThemeEditor draft={draft} dispatch={dispatch} /></>}
      </Panel>
    </div>
    {calculationOpen && <CalculationDialog dataset={draft.dataset} fields={draft.calculatedFields} onClose={() => setCalculationOpen(false)} onSave={field => { dispatch({ type: 'calculation-add', field }); setCalculationOpen(false); }} />}
  </>;
}

function SheetTabs({ draft, dispatch }: Omit<EditorProps, 'client'>) {
  const sheet = activeSheet(draft);
  const [rename, setRename] = useState<{ id: string; name: string }>();
  return <div className="sheet-toolbar">
    <div className="sheet-tabs" role="tablist" aria-label="Analysis sheets">{draft.sheets.map(s => <button key={s.id} type="button" role="tab" aria-selected={s.id === sheet.id} onClick={() => { dispatch({ type: 'sheet-select', id: s.id }); setRename(undefined); }}>{s.name}</button>)}</div>
    <button type="button" onClick={() => dispatch({ type: 'sheet-add' })}>+ Add sheet</button>
    <button type="button" onClick={() => setRename({ id: sheet.id, name: sheet.name })}>Rename sheet</button>
    <button type="button" disabled={draft.sheets.length === 1} onClick={() => { dispatch({ type: 'sheet-delete', id: sheet.id }); setRename(undefined); }}>Delete sheet</button>
    {sheet.visuals.some(v => v.imported && !v.imported.local) && <button type="button" onClick={() => dispatch({ type: 'sheet-remap', id: sheet.id })}>Remap sheet to local dataset</button>}
    {rename && <form className="rename-sheet" onSubmit={e => { e.preventDefault(); if (rename.name.trim()) { dispatch({ type: 'sheet-rename', ...rename }); setRename(undefined); } }}>
      <label>Sheet name<input autoFocus value={rename.name} onChange={e => setRename({ ...rename, name: e.target.value })} /></label>
      <button type="submit" disabled={!rename.name.trim()}>Save name</button><button type="button" onClick={() => setRename(undefined)}>Cancel</button>
    </form>}
  </div>;
}

function FieldWells({ visual, draft, dispatch, activeWell, onWell }: { visual?: AuthorVisual; draft: AuthorDraft; dispatch: Dispatch<AuthorAction>; activeWell: Well; onWell: (well: Well) => void }) {
  const fields = dataFields(draft.calculatedFields, draft.dataset);
  const wells: { name: Well; label: string; values: string[] }[] = !visual ? [
    { name: 'dimension', label: 'Group/Color', values: [] }, { name: 'values', label: 'Value', values: [] }, { name: 'smallMultiples', label: 'Small multiples', values: [] },
  ] : [
    ...(noDimensions(visual.kind) ? [] : grouped(visual.kind) ? [{ name: 'rows' as const, label: dimensionWellLabel(visual.kind, 'rows'), values: visual.rows }] : [{ name: 'dimension' as const, label: dimensionWellLabel(visual.kind, 'dimension'), values: visual.dimension ? [visual.dimension] : [] }]),
    ...(splitDimensions(visual.kind) ? [{ name: 'columns' as const, label: dimensionWellLabel(visual.kind, 'columns'), values: visual.columns }] : []),
    { name: 'values', label: visual.kind === 'sankey' ? 'Weight' : visual.kind === 'scatter' ? 'Values · X, Y, size (in order)' : visual.kind === 'combo' ? 'Values · bar, then lines' : hasSmallMultiplesWell(visual.kind) ? 'Value' : 'Values', values: visual.measures },
    ...(hasSmallMultiplesWell(visual.kind) || visual.smallMultiples?.length ? [{ name: 'smallMultiples' as const, label: 'Small multiples', values: visual.smallMultiples ?? [] }] : []),
  ];
  const assign = (field: string, well: Well) => dispatch({ type: visual ? 'assign' : 'assign-with-no-selection', field, well });
  return <div className="field-wells">{wells.map(w => <fieldset key={w.name} className={activeWell === w.name ? 'active-well' : ''} onFocus={() => onWell(w.name)} onClick={() => onWell(w.name)}
    onDragOver={e => { if (e.dataTransfer.types.includes(FIELD_DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
    onDrop={e => { if (e.dataTransfer.types.includes(FIELD_DRAG_TYPE)) { e.preventDefault(); e.stopPropagation(); onWell(w.name); assign(e.dataTransfer.getData(FIELD_DRAG_TYPE), w.name); } }}>
    <legend>{w.label.toUpperCase()}</legend>
    {w.values.map(field => <button className="field-chip" key={field} type="button" aria-label={`Remove ${field} from ${w.label}`} onClick={() => dispatch({ type: 'unassign', field, well: w.name })}><FieldIcon pill field={fields.find(f => f.name === field) ?? { name: field, type: 'UNKNOWN', role: w.name === 'values' ? 'measure' : 'dimension' }} /><span className="field-chip-name">{w.name === 'values' ? `SUM(${field})` : `${field}${fields.find(f => f.name === field)?.type === 'DATETIME' ? ` · ${(w.name !== 'smallMultiples' && visual?.hierarchy?.levels[0]?.granularity) || visual?.dateGrain || 'MONTH'}` : ''}`}</span><span aria-hidden="true">×</span></button>)}
    {w.name === 'values' && visual?.kind === 'insight' && <p>One measure; optional second measure for comparison (first minus second).</p>}
    {w.name === 'values' && visual && visual.measures.length > 1 && <div className="measure-order">{visual.measures.map((name, index) => <button type="button" key={name} disabled={!index} aria-label={`Move ${name} measure earlier`} onClick={() => dispatch({ type: 'measure-move', index, offset: -1 })}>↑ {name}</button>)}</div>}
    {!w.values.length && <button type="button" className="well-placeholder" aria-label={`Select ${w.label.toUpperCase()} well`} aria-pressed={activeWell === w.name} onClick={() => onWell(w.name)}>{w.name === 'columns' && visual?.kind === 'radar' ? 'Optional color dimension' : w.name === 'values' ? 'Add a measure' : 'Add a dimension'}</button>}
    {visual && <label className="well-picker"><span className="sr-only">Assign {w.name === 'values' ? 'measure' : w.name === 'smallMultiples' ? 'small multiples' : ['radar', 'sankey'].includes(visual.kind) ? w.label.toLowerCase() : w.name === 'dimension' ? 'dimension' : w.name}</span><select aria-label={`Assign ${w.label}`} title={`Assign ${w.label}`} disabled={w.name === 'smallMultiples' && !hasSmallMultiplesWell(visual.kind)} value="" onChange={e => assign(e.target.value, w.name)}><option value="" disabled>Choose field…</option>{fields.filter(f => f.type !== 'BOOLEAN' && f.role === (w.name === 'values' ? 'measure' : 'dimension')).map(f => <option key={f.name}>{f.name}</option>)}</select></label>}
    {w.name === 'smallMultiples' && !!w.values.length && <p className="field-hint">Faceted preview is not supported yet.</p>}
  </fieldset>)}</div>;
}

function Properties({ visual, draft, dispatch, client, runtimeProblems }: EditorProps & { visual: AuthorVisual; runtimeProblems?: Record<string, string> }) {
  const [tab, setTab] = useState<'Visual' | 'Interaction'>('Visual');
  const tabId = useId();
  const formatting = visual.formatting ?? {};
  const setFormatting = (patch: Partial<VisualFormatting>) => dispatch({ type: 'formatting', formatting: { ...formatting, ...patch } });
  const toggles: { property: 'titleVisible' | 'legend' | 'labels' | 'horizontal' | 'stacked' | 'totals' | 'subtotals'; label: string }[] = [
    ...(hasDataLabels(visual.kind) ? [{ property: 'labels' as const, label: 'Show data labels' }] : []),
    ...(['bar', 'bar100'].includes(visual.kind) ? [{ property: 'horizontal' as const, label: 'Horizontal bars' }] : []),
    ...(visual.kind === 'bar' ? [{ property: 'stacked' as const, label: 'Stack values' }] : []),
  ];
  return <>
    <div className="properties-tabs" role="tablist" aria-label="Properties tabs">
      {(['Visual', 'Interaction'] as const).map(name => <button type="button" key={name} role="tab" id={`${tabId}-${name}`} aria-controls={`${tabId}-panel-${name}`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const next = e.key === 'Home' ? 'Visual' : e.key === 'End' ? 'Interaction' : name === 'Visual' ? 'Interaction' : 'Visual';
        setTab(next);
        e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[id="${tabId}-${next}"]`)?.focus();
      }}>{name}</button>)}
    </div>
    <div role="tabpanel" id={`${tabId}-panel-Visual`} aria-labelledby={`${tabId}-Visual`} hidden={tab !== 'Visual'}>
    <details className="property-section" open><summary>Display settings</summary>
    <CardTitle visual={visual} dispatch={dispatch} />
    <CardStyle />
    <CardLayout />
    {toggles.map(({ property, label }) => <label className="toggle" key={property}><input type="checkbox" checked={visual[property]} onChange={e => dispatch({ type: 'display', property, value: e.target.checked })} />{label}</label>)}
    {visual.kind === 'insight' && <InsightOptions visual={visual} dispatch={dispatch} />}
    {(hasDataLabels(visual.kind) || visual.kind === 'insight') && <label>{visual.kind === 'insight' ? 'Narrative decimal places' : 'Data label decimal places'}<input type="number" min="0" max="12" placeholder="Automatic" value={formatting.decimalPlaces ?? ''} onChange={e => {
      if (e.target.value === '') { const { decimalPlaces: _old, ...rest } = formatting; dispatch({ type: 'formatting', formatting: rest }); }
      else setFormatting({ decimalPlaces: Number(e.target.value) });
    }} /></label>}
    {['bar', 'bar100', 'combo'].includes(visual.kind) && <label>Category spacing (%)<input type="number" min="0" max="80" placeholder="Automatic" value={formatting.barCategoryGap ?? ''} onChange={e => {
      if (e.target.value === '') { const { barCategoryGap: _old, ...rest } = formatting; dispatch({ type: 'formatting', formatting: rest }); }
      else setFormatting({ barCategoryGap: Number(e.target.value) });
    }} /></label>}
    {visual.kind === 'pie' && <label className="toggle"><input type="checkbox" checked={visual.donut} onChange={e => dispatch({ type: 'donut', donut: e.target.checked })} />Donut</label>}
    {tabular(visual.kind) && <p className="field-hint">Subtotals summarize parent groups when multiple dimensions are assigned.</p>}
    {visual.kind === 'gauge' && <>{(['min', 'max'] as const).map(bound => <label key={bound}>Gauge {bound === 'min' ? 'minimum' : 'maximum'}<input type="number" step="any" value={visual.gauge?.[bound] ?? (bound === 'min' ? 0 : 100)} onChange={e => { if (e.target.value.trim()) dispatch({ type: 'gauge', min: visual.gauge?.min ?? 0, max: visual.gauge?.max ?? 100, [bound]: Number(e.target.value) }); }} /></label>)}<p>Minimum must be smaller than maximum.</p></>}
    {visual.kind === 'histogram' && <label>Histogram bins<input type="number" min="1" max="100" value={visual.bins ?? 10} onChange={e => dispatch({ type: 'bins', bins: Number(e.target.value) })} /></label>}
    </details>
    <MultiplesOptions visual={visual} />
    <GroupColorOptions visual={visual} dispatch={dispatch} />
    <LegendOptions visual={visual} dispatch={dispatch} />
    <PivotOptionsEditor visual={visual} dispatch={dispatch} />
    <FormattingEditor visual={visual} dispatch={dispatch} />
    {visual.imported && <div className="dataset-binding"><h3>Dataset binding</h3><p>{visual.imported.local ? 'Local sales dataset' : authorVisualProblem(visual)}</p>
      {!visual.imported.local && <button type="button" onClick={() => dispatch({ type: 'remap', id: visual.id })}>Remap to local dataset</button>}
      {visual.imported.unmappedFields.length > 0 && <p>Fields requiring manual assignment: {visual.imported.unmappedFields.join(', ')}</p>}
      {visual.imported.issues.length > 0 && <details><summary>Unsupported features (retained)</summary><ul>{visual.imported.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul></details>}
    </div>}
    <ThemeEditor visual={visual} draft={draft} dispatch={dispatch} />
    </div>
    <div role="tabpanel" id={`${tabId}-panel-Interaction`} aria-labelledby={`${tabId}-Interaction`} hidden={tab !== 'Interaction'}>
      {tab === 'Interaction' && <>
        <FilterEditor dataset={draft.dataset} visual={visual} parameters={sheetParameters(draft)} calculations={draft.calculatedFields} dispatch={dispatch} client={visual.imported && !visual.imported.local ? undefined : client} />
        <ActionEditor runtimeProblems={runtimeProblems} draft={draft} visual={visual} dispatch={dispatch} />
        <HierarchyEditor draft={draft} visual={visual} dispatch={dispatch} />
        <ParameterFilterEditor dataset={draft.dataset} parameters={sheetParameters(draft)} calculations={draft.calculatedFields} dispatch={dispatch} />
      </>}
    </div>
  </>;
}

function FilterEditor({ dataset, visual, calculations, dispatch, client, parameters }: { dataset?: AuthorDataset; parameters: AuthorParameter[]; visual: AuthorVisual; calculations: CalculatedField[]; dispatch: Dispatch<AuthorAction>; client?: QueryClient }) {
  const [column, setColumn] = useState(() => dataFields(calculations, dataset).find(f => f.type === 'STRING')?.name ?? '');
  const [result, setResult] = useState<{ key: string; values: string[]; error?: string }>();
  const key = JSON.stringify([dataset?.id, buildDistinctQuery(column, calculations, parameters, dataset)]);
  const request = useMemo(() => (JSON.parse(key) as [unknown, ReturnType<typeof buildDistinctQuery>])[1], [key]);
  useEffect(() => {
    if (!client || !column) return;
    const controller = new AbortController();
    void loadAuthorRows(client, request, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ key, values: [...new Set((data.rows ?? []).flatMap(row => typeof row[column] === 'string' ? [row[column]] : []))], error: data.message });
    }).catch(() => {});
    return () => controller.abort();
  }, [client, column, request, key]);
  const current: { values: string[]; error?: string } | undefined = client ? result?.key === key ? result : undefined : { values: fixtureCategoryValues(column) };
  const filter = visual.filters.find(f => f.columnName === column);
  const filterValues = filter?.parameterName ? parameters.find(p => p.name === filter.parameterName)?.values.map(String) ?? [] : filter?.values;
  const values = [...new Set([...(current?.values ?? []), ...(filterValues ?? [])])];
  return <details className="property-section" open><summary>Filters</summary>
    {visual.filters.map(f => <button className="field-chip filter-pill" type="button" key={f.columnName} aria-label={`Remove ${f.columnName} filter`} onClick={() => dispatch({ type: 'filter', columnName: f.columnName, values: null })}>{f.columnName}: {f.parameterName ? `$${f.parameterName}` : f.values.length ? f.values.join(', ') : 'None'} <span aria-hidden="true">×</span></button>)}
    <label>Category field<select value={column} onChange={e => setColumn(e.target.value)}>{dataFields(calculations, dataset).filter(f => f.type === 'STRING').map(f => <option key={f.name}>{f.name}</option>)}</select></label>
    {!current && <p role="status">Loading values…</p>}
    {current?.error && <p role="status">{current.error}</p>}
    <div className="filter-values" role="group" aria-label={`${column} values`}>{values.map(value => <label className="toggle" key={value}><input type="checkbox" checked={!filter || (filterValues ?? []).includes(value)} onChange={e => {
      const selected = filterValues ?? values;
      dispatch({ type: 'filter', columnName: column, values: e.target.checked ? [...selected, value] : selected.filter(v => v !== value) });
    }} />{value || '(empty string)'}</label>)}</div>
    <div className="filter-actions"><button type="button" disabled={!current || !!current.error} onClick={() => dispatch({ type: 'filter', columnName: column, values })}>Select all</button><button type="button" onClick={() => dispatch({ type: 'filter', columnName: column, values: [] })}>Select none</button></div>
    {!client && <p className="field-hint">Values come from fixed samples. Filtered previews require API mode or a sheet with parameters, actions, or drill hierarchies.</p>}
  </details>;
}

export function CalculationDialog({ dataset, fields, onSave, onClose }: { dataset?: AuthorDataset; fields: CalculatedField[]; onSave: (field: CalculatedField) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [field, setField] = useState<CalculatedField>({ name: '', expression: '', role: 'measure' });
  const [error, setError] = useState('');
  const [functionName, setFunctionName] = useState('concat');
  const reference = functionCatalog.find(f => f.name === functionName)!;
  const syntaxError = field.expression.trim() ? expressionError(field.expression, dataFields(fields, dataset)) : undefined;
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} className="calculation-dialog" aria-labelledby="calculation-heading" onCancel={onClose}>
    <form onSubmit={e => { e.preventDefault(); const problem = calculationError(field, dataFields(fields, dataset)); if (problem) setError(problem); else onSave({ ...field, name: field.name.trim() }); }}>
      <h2 id="calculation-heading">Calculated field</h2>
      <BuildForMe dataset={dataset} fields={fields} onInsert={suggestion => { setField({ ...suggestion, name: field.name.trim() ? field.name : suggestion.name }); setError(''); }} />
      <label>Name<input autoFocus value={field.name} onChange={e => setField({ ...field, name: e.target.value })} /></label>
      <label>Use as<select value={field.role} onChange={e => setField({ ...field, role: e.target.value as CalculatedField['role'] })}><option value="measure">Measure (number)</option><option value="dimension">Dimension (text)</option></select></label>
      <label>Expression<textarea rows={5} value={field.expression} placeholder="{revenue} - {profit}" onChange={e => setField({ ...field, expression: e.target.value })} /></label>
      <label>Function reference<select value={functionName} onChange={e => setFunctionName(e.target.value)}>{[...new Set(functionCatalog.map(f => f.category))].map(category => <optgroup key={category} label={category}>{functionCatalog.filter(f => f.category === category).map(f => <option key={f.name} value={f.name}>{f.name}</option>)}</optgroup>)}</select></label>
      <div className="function-reference"><code>{reference.signature}</code><p>Example: <code>{reference.example}</code></p><button type="button" onClick={() => { setField({ ...field, expression: reference.example }); setError(''); }}>Use example</button></div>
      <p className="field-hint">Use braces to reference fields and {'${Name}'} to reference a single-value parameter. Choose a function to see its signature and example. Table calculations use the grouping and sort fields in the visual.</p>
      {(syntaxError || error) && <p role="alert">{syntaxError || error}</p>}
      <div className="dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">Create field</button></div>
    </form>
  </dialog>;
}

function AuthorCard({ visual, theme, index, count, selected, dispatch, client, calculations, filterProblem, parameters, interaction, interactive, drillNavigation }: {
  theme?: AnalysisTheme; drillNavigation?: ReactNode; interaction?: VisualInteraction; interactive?: boolean; visual: AuthorVisual; index: number; count: number; selected: boolean; filterProblem?: string; dispatch: Dispatch<AuthorAction>; client?: QueryClient; calculations: CalculatedField[]; parameters: AuthorParameter[];
}) {
  const problem = authorVisualProblem(visual) ?? filterProblem;
  const noFields = !visualDimensions(visual).length && !visual.measures.length;
  const typeName = VISUAL_TYPES.find(type => type.kind === visual.kind)?.label ?? 'Visual';
  const emptyTitle = visual.kind === 'pie' ? visual.donut ? 'Donut chart' : 'Pie chart' : visual.kind === 'pivot' ? 'Pivot table' : ['bar', 'line'].includes(visual.kind) ? `${typeName} chart` : typeName;
  const hasCalculation = [...visualDimensions(visual), ...visual.measures].some(name => calculations.some(c => c.name === name));
  const extended = !['bar', 'line', 'pie', 'kpi', 'table'].includes(visual.kind);
  const onRowGroupToggle: RowGroupToggle = (path, collapsed) => dispatch({ type: 'pivot-row-group', id: visual.id, path, collapsed });
  const preview = useMemo(() => noFields || extended || client || interactive || parameters.length || hasCalculation || problem ? undefined : buildAuthorPreview(visual), [visual, client, interactive, problem, parameters.length, hasCalculation, extended, noFields]);
  const label = visual.title || `Visual ${index + 1}`;
  return <section className={`author-card${selected ? ' is-selected' : ''}`} aria-label={label} onClick={() => { if (!selected) dispatch({ type: 'select', id: visual.id }); }}>
    <div className="author-card-toolbar">
      <span className="drag-handle" aria-hidden="true" title="Drag visual">⠿</span><strong>{index + 1}. {visual.title || (visual.imported?.issues.some(i => i.startsWith('Unsupported visual type:')) && !visual.imported.replaced ? visual.imported.variant : VISUAL_TYPES.find(t => t.kind === visual.kind)?.label)}</strong>
      <div className="author-card-actions">
        <button type="button" aria-expanded={selected} aria-controls={selected ? `configure-${visual.id}` : undefined} onClick={() => dispatch({ type: 'select', id: visual.id })}>Configure<span className="sr-only"> {label}</span></button>
        <button type="button" disabled={index === 0} aria-label={`Move ${label} up`} onClick={e => { e.stopPropagation(); dispatch({ type: 'move', id: visual.id, offset: -1 }); }}>↑</button>
        <button type="button" disabled={index === count - 1} aria-label={`Move ${label} down`} onClick={e => { e.stopPropagation(); dispatch({ type: 'move', id: visual.id, offset: 1 }); }}>↓</button>
        <button type="button" aria-label={`Remove ${label}`} onClick={e => { e.stopPropagation(); dispatch({ type: 'remove', id: visual.id }); }}>×</button>
      </div>
    </div>
    {drillNavigation}
    {problem ? <div className="bundle-placeholder" role="status"><p>{problem}</p>
      {visual.imported && !visual.imported.local && <button type="button" onClick={e => { e.stopPropagation(); dispatch({ type: 'remap', id: visual.id }); }}>Remap to local dataset</button>}
    </div> : noFields ? <div className="author-visual-empty" role="status"><h3>{emptyTitle}</h3><p>Add 1 or more fields to build a visual.</p></div> : extended || client || interactive || parameters.length || hasCalculation ? <LiveAuthorVisual theme={theme} interactive={interactive} interaction={interaction} onRowGroupToggle={onRowGroupToggle} visual={visual} client={client} calculations={calculations} parameters={parameters} /> : preview && <VisualCard visual={{ ...preview, theme }} onRowGroupToggle={onRowGroupToggle} />}
  </section>;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function ImportReport({ draft, onClose }: { draft: AuthorDraft; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} className="import-report" aria-labelledby="import-report-title" onCancel={onClose}>
    <h2 id="import-report-title">Bundle import report</h2>
    <p>Unknown and unsupported JSON is retained verbatim in the draft and .qs export. Unsupported features are displayed here and are not executed. JSON export downloads one resource; Download .qs keeps all resources.</p>
    {draft.bundle?.report.map(r => <section key={r.path}><h3>{r.name}</h3><code>{r.path}</code><ul>{r.messages.map((m, i) => <li key={i}>{m}</li>)}</ul></section>)}
    <button type="button" autoFocus onClick={onClose}>Close import report</button>
  </dialog>;
}
function ImportedPanels({ draft }: { draft: AuthorDraft }) {
  if (!draft.bundle) return null;
  const path = activeSheet(draft).imported?.memberPath ?? draft.bundle.primaryPath;
  const resource = draft.bundle.original.members.find(m => m.path === path)?.resource;
  if (!resource || (resource.resourceType !== 'analysis' && resource.resourceType !== 'dashboard')) return null;
  const definition = resource.definition;
  const groups = [
    { name: 'Imported calculated fields', values: definition.calculatedFields ?? [] },
    { name: 'Imported filter groups', values: definition.filterGroups ?? [] },
  ];
  return <>{groups.map(group => <details className="imported-panel" key={group.name} open><summary>{group.name}</summary>
    <p className="field-hint">Original definitions · display only. Compatible category filters can be edited in Properties.</p>
    {!group.values.length && <p>None</p>}
    {group.values.map((value, i) => {
      const raw = value as Record<string, unknown>, variant = Object.keys(raw)[0] ?? '', body = raw[variant] as Record<string, unknown> | undefined;
      const name = String(raw.name ?? raw.filterGroupId ?? body?.name ?? variant);
      return <details key={i}><summary className={group.name.includes('filter') ? 'filter-pill' : ''}>{name}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
    })}
  </details>)}</>;
}

function ParameterFilterEditor({ dataset, parameters, calculations, dispatch }: { dataset?: AuthorDataset; parameters: AuthorParameter[]; calculations: CalculatedField[]; dispatch: Dispatch<AuthorAction> }) {
  const [name, setName] = useState(''), [column, setColumn] = useState('region'), [operator, setOperator] = useState<'EQUALS' | 'GREATER_THAN_OR_EQUAL_TO' | 'LESS_THAN_OR_EQUAL_TO'>('EQUALS');
  const parameter = parameters.find(p => p.name === name) ?? parameters[0];
  const fields = dataFields(calculations, dataset).filter(f => parameter?.type === (f.type === 'STRING' ? 'string' : f.type === 'DATETIME' ? 'datetime' : 'number'));
  const field = fields.find(f => f.name === column) ?? fields[0];
  if (!parameters.length) return <details className="property-section"><summary>Parameter bindings</summary><p>Create an analysis parameter to bind a filter to this visual.</p></details>;
  return <details className="property-section"><summary>Parameter bindings</summary>
    <label>Filter parameter<select aria-label="Filter parameter" value={parameter?.name ?? ''} onChange={e => { setName(e.target.value); setOperator('EQUALS'); }}>{parameters.map(p => <option key={p.id}>{p.name}</option>)}</select></label>
    <label>Filter column<select aria-label="Parameter filter column" value={field?.name ?? ''} onChange={e => setColumn(e.target.value)}>{fields.map(f => <option key={f.name}>{f.name}</option>)}</select></label>
    <label>Comparison<select value={operator} onChange={e => setOperator(e.target.value as typeof operator)}><option value="EQUALS">Equals</option>{parameter?.type !== 'string' && !parameter?.multiple && <><option value="GREATER_THAN_OR_EQUAL_TO">At least / on or after</option><option value="LESS_THAN_OR_EQUAL_TO">At most / on or before</option></>}</select></label>
    <button type="button" disabled={!field || !parameter} onClick={() => { if (parameter && field) dispatch({ type: 'filter-parameter', columnName: field.name, parameterName: parameter.name, operator }); }}>Apply parameter filter</button>
  </details>;
}

function InsightOptions({ visual, dispatch }: { visual: AuthorVisual; dispatch: Dispatch<AuthorAction> }) {
  const raw = visual.insightConfiguration?.computations;
  const computations = Array.isArray(raw) ? raw as Record<string, Record<string, unknown>>[] : [];
  const first = computations[0];
  const kind = first ? Object.keys(first)[0] : 'summary';
  const size = Number(first?.topBottomRanked?.resultSize ?? 3);
  const preset = (kind: string, n = size): Record<string, unknown> => kind === 'summary' ? {} : { computations: kind === 'topBottomRanked'
    ? ['TOP', 'BOTTOM'].map(type => ({ topBottomRanked: { computationId: type.toLowerCase(), type, resultSize: n } }))
    : [{ [kind]: { computationId: kind } }] };
  const selected = JSON.stringify(visual.insightConfiguration ?? {}) === JSON.stringify(preset(kind ?? 'summary')) ? kind : 'imported';
  return <>
    <label>Narrative computation<select aria-label="Narrative computation" value={selected} onChange={e => dispatch({ type: 'insight', configuration: preset(e.target.value) })}>
      <option value="summary">Summary (total, contributors, available comparisons)</option>
      <option value="totalAggregation">Total aggregation</option><option value="topBottomRanked">Top and bottom ranked</option>
      <option value="growthRate">Growth rate (date required)</option><option value="periodOverPeriod">Period over period (date required)</option>
      <option value="metricComparison">Metric comparison (two measures)</option>
      {selected === 'imported' && <option value="imported" disabled>Imported computations (choose to replace)</option>}
    </select></label>
    {selected === 'topBottomRanked' && <label>Ranked categories<input type="number" min="1" max="20" value={size} onChange={e => {
      const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 20) dispatch({ type: 'insight', configuration: preset('topBottomRanked', n) });
    }} /></label>}
  </>;
}
