import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Dispatch, ReactNode } from 'react';
import { GridLayout, noCompactor, useContainerWidth } from 'react-grid-layout';
import { VisualCard } from './VisualCard.js';
import { buildAuthorPreview, fixtureCategoryValues } from './author-preview.js';
import { LiveAuthorVisual } from './LiveAuthorVisual.js';
import { buildDistinctQuery, loadAuthorRows } from './author-query.js';
import type { QueryClient } from './author-query.js';
import {
  VISUAL_TYPES, GRID_COLUMNS, activeSheet, authorReducer, calculationError, dataFields, dimensionLabel,
  loadDraft, saveDraft, serializeDraft, singleMeasure, tabular,
} from './authoring.js';
import type { AuthorAction, AuthorDraft, AuthorVisual, CalculatedField, VisualKind, Well } from './authoring.js';

const browserStorage = () => window.localStorage;
type EditorProps = { draft: AuthorDraft; dispatch: Dispatch<AuthorAction>; client?: QueryClient };
export function Author({ client }: { client?: QueryClient }) {
  const [restored] = useState(() => loadDraft(browserStorage));
  const [draft, dispatch] = useReducer(authorReducer, restored.draft);
  const [storageStatus, setStorageStatus] = useState(restored.warning ?? 'Draft saved on this device.');
  const [exportStatus, setExportStatus] = useState('');
  useEffect(() => {
    if (restored.warning && draft === restored.draft) return;
    setStorageStatus(saveDraft(draft, browserStorage));
  }, [draft, restored]);
  const exported = useMemo(() => {
    try { return { json: JSON.stringify(serializeDraft(draft), null, 2) + '\n' }; }
    catch { return { error: 'Complete the field wells in every visual to export.' }; }
  }, [draft]);
  const download = () => {
    if (!exported.json) return;
    try {
      const url = URL.createObjectURL(new Blob([exported.json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = 'opensight-analysis.json';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStatus('Export downloaded: opensight-analysis.json');
    } catch { setExportStatus('Export could not be downloaded. Please try again.'); }
  };
  return <div className="author-workspace">
    <div className="author-topbar">
      <label className="analysis-title">Analysis title<input value={draft.title} onChange={e => dispatch({ type: 'analysis-title', title: e.target.value })} /></label>
      <span className="mode-badge">{client ? 'API · Local sales' : 'Fixtures · Offline'}</span><span className="phase-badge">Builder v1</span>
      <button type="button" className="primary-button" onClick={download} disabled={!draft.sheets.some(s => s.visuals.length) || !!exported.error} aria-describedby="export-help">Export JSON</button>
    </div>
    <p className="fixture-notice">{client ? 'Live local sales data · All regions, dates grouped by UTC month. Field assignments query the API; unsupported queries show “Data unavailable”.' : 'Offline demo: preview uses fixed sample results: region = East, dates grouped by UTC month. Only revenue totals by region, category, month, or overall are available. Other selections show “Data unavailable”. No live queries run.'}</p>
    <div className="author-save"><p role="status">{storageStatus}</p>
      <p id="export-help">{exported.error ?? (client ? 'Downloads analysis definitions and sheet layouts; query results are not included.' : 'Downloads analysis definitions and sheet layouts; sample rows and the fixed East preview filter are not included.')}</p>
      {exportStatus && <p role="status">{exportStatus}</p>}
    </div>
    <AuthorCanvas draft={draft} dispatch={dispatch} client={client} />
  </div>;
}

function Panel({ title, className, children }: { title: string; className: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const change = () => setOpen(!query.matches);
    change(); query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return <details className={`builder-panel ${className}`} open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>{title}</summary><div className="panel-content">{children}</div>
  </details>;
}

export function AuthorCanvas({ draft, dispatch, client }: EditorProps) {
  const [newKind, setNewKind] = useState<VisualKind>('bar');
  const [search, setSearch] = useState('');
  const [well, setWell] = useState<Well>('rows');
  const [calculationOpen, setCalculationOpen] = useState(false);
  const sheet = activeSheet(draft), fields = dataFields(draft.calculatedFields);
  const selected = sheet.visuals.find(v => v.id === sheet.selectedId);
  const { width, containerRef } = useContainerWidth({ initialWidth: 900 });
  const mobile = width < 600;
  const layout = useMemo(() => mobile ? sheet.layout.map((p, i) => ({ ...p, x: 0, y: i * 8, w: GRID_COLUMNS, h: 8 })) : sheet.layout.map(p => ({ ...p, minW: 3, minH: 4 })), [mobile, sheet.layout]);
  return <>
    <SheetTabs draft={draft} dispatch={dispatch} />
    <div className="author-layout">
      <Panel title="Data" className="fields-panel">
        <label>Dataset<select aria-label="Dataset" value="sales" onChange={() => {}}><option value="sales">Synthetic sales</option></select></label>
        <label>Search fields<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a field…" /></label>
        <button type="button" className="calculation-button" onClick={() => setCalculationOpen(true)}>+ CALCULATED FIELD</button>
        <p className="field-hint">{selected ? 'Click a field to assign it. Select a well to choose its destination.' : 'Add a visual to start assigning fields.'}</p>
        {(['dimension', 'measure'] as const).map(role => <div key={role} className="field-group">
          <h3>{role === 'dimension' ? 'Dimensions' : 'Measures'}</h3>
          {fields.filter(f => f.role === role && f.name.toLowerCase().includes(search.toLowerCase())).map(field => <button key={field.name} type="button"
            disabled={!selected || (role === 'dimension' && selected.kind === 'kpi')}
            aria-label={`Assign ${field.name}`} aria-pressed={selected?.dimension === field.name || selected?.rows.includes(field.name) || selected?.columns.includes(field.name) || !!selected?.measures.includes(field.name)}
            onClick={() => dispatch({ type: 'assign', field: field.name, well: role === 'measure' ? 'values' : selected && tabular(selected.kind) ? (well === 'columns' && selected.kind === 'pivot' ? 'columns' : 'rows') : 'dimension' })}>
            <span className="field-icon" aria-hidden="true">{draft.calculatedFields.some(f => f.name === field.name) ? 'ƒ' : field.type === 'DATETIME' ? '▣' : field.type === 'STRING' ? 'Abc' : '#'}</span>
            <span className="field-name">{field.name}</span><span className="field-type">{field.type}</span>
          </button>)}
        </div>)}
        {!fields.some(f => f.name.toLowerCase().includes(search.toLowerCase())) && <p>No matching fields.</p>}
      </Panel>
      <div className="author-center">
        <Panel title="Visual build" className="build-panel">
          <form className="add-visual" onSubmit={e => { e.preventDefault(); dispatch({ type: 'add', kind: newKind }); }}>
            <div className="visual-gallery" role="group" aria-label="Visual type gallery">{VISUAL_TYPES.map(type => <button type="button" key={type.kind} value={type.kind} aria-label={type.label} aria-pressed={newKind === type.kind} onClick={() => setNewKind(type.kind)}>
              <span aria-hidden="true">{type.icon}</span>{type.label}
            </button>)}</div>
            <button type="submit" className="primary-button" aria-label="Add visual">ADD</button>
          </form>
          {selected ? <div className="visual-config" id={`configure-${selected.id}`}>
            <label className="change-type">Change visual type<select value={selected.kind} onChange={e => dispatch({ type: 'kind', kind: e.target.value as VisualKind })}>{VISUAL_TYPES.map(type => <option value={type.kind} key={type.kind}>{type.label}</option>)}</select></label>
            <FieldWells visual={selected} draft={draft} dispatch={dispatch} activeWell={well} onWell={setWell} />
          </div> : <p className="field-hint">Choose a visual type and select ADD.</p>}
        </Panel>
        <div className="author-canvas" ref={containerRef}>
          <div className="canvas-label"><strong>{sheet.name}</strong><span>{sheet.visuals.length} {sheet.visuals.length === 1 ? 'visual' : 'visuals'} · {mobile ? 'Mobile preview' : 'Drag the handle to move · Drag a corner to resize'}</span></div>
          {!sheet.visuals.length && <div className="canvas-empty"><h2>Your canvas is ready</h2><p>Add a visual, then choose fields from the Data panel.</p></div>}
          <div aria-label="Authoring canvas">
            <GridLayout key={sheet.id} width={width} layout={layout} compactor={noCompactor}
              gridConfig={{ cols: GRID_COLUMNS, rowHeight: 42, margin: [12, 12], containerPadding: [0, 0] }}
              dragConfig={{ enabled: !mobile, handle: '.drag-handle' }} resizeConfig={{ enabled: !mobile, handles: ['se', 'sw'] }}
              onDragStop={next => { if (!mobile) dispatch({ type: 'layout', sheetId: sheet.id, layout: next }); }}
              onResizeStop={next => { if (!mobile) dispatch({ type: 'layout', sheetId: sheet.id, layout: next }); }}>
              {sheet.visuals.map((visual, index) => <div key={visual.id}>
                <AuthorCard visual={visual} index={index} count={sheet.visuals.length} selected={visual.id === sheet.selectedId} dispatch={dispatch} client={client} calculations={draft.calculatedFields} />
              </div>)}
            </GridLayout>
          </div>
        </div>
      </div>
      <Panel title="Properties" className="properties-panel">
        {selected ? <Properties key={selected.id} visual={selected} draft={draft} dispatch={dispatch} client={client} /> : <p>Select a visual to edit its display settings.</p>}
      </Panel>
    </div>
    {calculationOpen && <CalculationDialog fields={draft.calculatedFields} onClose={() => setCalculationOpen(false)} onSave={field => { dispatch({ type: 'calculation-add', field }); setCalculationOpen(false); }} />}
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
    {rename && <form className="rename-sheet" onSubmit={e => { e.preventDefault(); if (rename.name.trim()) { dispatch({ type: 'sheet-rename', ...rename }); setRename(undefined); } }}>
      <label>Sheet name<input autoFocus value={rename.name} onChange={e => setRename({ ...rename, name: e.target.value })} /></label>
      <button type="submit" disabled={!rename.name.trim()}>Save name</button><button type="button" onClick={() => setRename(undefined)}>Cancel</button>
    </form>}
  </div>;
}

function FieldWells({ visual, draft, dispatch, activeWell, onWell }: { visual: AuthorVisual; draft: AuthorDraft; dispatch: Dispatch<AuthorAction>; activeWell: Well; onWell: (well: Well) => void }) {
  const fields = dataFields(draft.calculatedFields);
  const wells: { name: Well; label: string; values: string[] }[] = [
    ...(visual.kind === 'kpi' ? [] : tabular(visual.kind) ? [{ name: 'rows' as const, label: dimensionLabel(visual.kind), values: visual.rows }] : [{ name: 'dimension' as const, label: dimensionLabel(visual.kind), values: visual.dimension ? [visual.dimension] : [] }]),
    ...(visual.kind === 'pivot' ? [{ name: 'columns' as const, label: 'Columns', values: visual.columns }] : []),
    { name: 'values', label: 'Values', values: visual.measures },
  ];
  return <div className="field-wells">{wells.map(w => <fieldset key={w.name} className={activeWell === w.name ? 'active-well' : ''} onFocus={() => onWell(w.name)} onClick={() => onWell(w.name)}>
    <legend>{w.label}{w.name === 'values' && singleMeasure(visual.kind) ? ' · 1 measure' : ''}</legend>
    {w.values.map(field => <button className="field-chip" key={field} type="button" aria-label={`Remove ${field} from ${w.label}`} onClick={() => dispatch({ type: 'unassign', field, well: w.name })}>{w.name === 'values' ? `SUM(${field})` : `${field}${field === 'order_date' ? ' · Month' : ''}`} <span aria-hidden="true">×</span></button>)}
    {!w.values.length && <p>{w.name === 'columns' ? 'Optional column dimensions' : 'Choose a field'}</p>}
    <label className="well-picker">Assign {w.name === 'values' ? 'measure' : w.name === 'dimension' ? 'dimension' : w.name}<select aria-label={`Assign ${w.label}`} value="" onChange={e => dispatch({ type: 'assign', field: e.target.value, well: w.name })}><option value="" disabled>Choose field…</option>{fields.filter(f => f.role === (w.name === 'values' ? 'measure' : 'dimension')).map(f => <option key={f.name}>{f.name}</option>)}</select></label>
  </fieldset>)}</div>;
}

function Properties({ visual, draft, dispatch, client }: EditorProps & { visual: AuthorVisual }) {
  const toggles: { property: 'titleVisible' | 'legend' | 'labels' | 'horizontal' | 'stacked' | 'totals' | 'subtotals'; label: string }[] = [
    { property: 'titleVisible', label: 'Show title' },
    ...(tabular(visual.kind) ? [{ property: 'totals' as const, label: 'Show totals' }, { property: 'subtotals' as const, label: 'Show subtotals' }] : visual.kind === 'kpi' ? [] : [{ property: 'legend' as const, label: 'Show legend' }, { property: 'labels' as const, label: 'Show data labels' }]),
    ...(visual.kind === 'bar' ? [{ property: 'horizontal' as const, label: 'Horizontal bars' }, { property: 'stacked' as const, label: 'Stack values' }] : []),
  ];
  return <>
    <label>Title<input value={visual.title} placeholder="Generated from fields" onChange={e => dispatch({ type: 'title', title: e.target.value })} /></label>
    {toggles.map(({ property, label }) => <label className="toggle" key={property}><input type="checkbox" checked={visual[property]} onChange={e => dispatch({ type: 'display', property, value: e.target.checked })} />{label}</label>)}
    {visual.kind === 'pie' && <label className="toggle"><input type="checkbox" checked={visual.donut} onChange={e => dispatch({ type: 'donut', donut: e.target.checked })} />Donut</label>}
    {tabular(visual.kind) && <p className="field-hint">Subtotals summarize parent groups when multiple dimensions are assigned.</p>}
    <FilterEditor visual={visual} calculations={draft.calculatedFields} dispatch={dispatch} client={client} />
  </>;
}

function FilterEditor({ visual, calculations, dispatch, client }: { visual: AuthorVisual; calculations: CalculatedField[]; dispatch: Dispatch<AuthorAction>; client?: QueryClient }) {
  const [column, setColumn] = useState('region');
  const [result, setResult] = useState<{ key: string; values: string[]; error?: string }>();
  const key = JSON.stringify([column, calculations]);
  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    void loadAuthorRows(client, buildDistinctQuery(column, calculations), controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ key, values: [...new Set((data.rows ?? []).flatMap(row => typeof row[column] === 'string' ? [row[column]] : []))], error: data.message });
    }).catch(() => {});
    return () => controller.abort();
  }, [client, column, calculations, key]);
  const current: { values: string[]; error?: string } | undefined = client ? result?.key === key ? result : undefined : { values: fixtureCategoryValues(column) };
  const filter = visual.filters.find(f => f.columnName === column);
  const values = [...new Set([...(current?.values ?? []), ...(filter?.values ?? [])])];
  return <div className="filter-editor"><h3>Filters</h3>
    {visual.filters.map(f => <button className="field-chip filter-pill" type="button" key={f.columnName} aria-label={`Remove ${f.columnName} filter`} onClick={() => dispatch({ type: 'filter', columnName: f.columnName, values: null })}>{f.columnName}: {f.values.length ? f.values.join(', ') : 'None'} <span aria-hidden="true">×</span></button>)}
    <label>Category field<select value={column} onChange={e => setColumn(e.target.value)}>{dataFields(calculations).filter(f => f.type === 'STRING').map(f => <option key={f.name}>{f.name}</option>)}</select></label>
    {!current && <p role="status">Loading values…</p>}
    {current?.error && <p role="status">{current.error}</p>}
    <div className="filter-values" role="group" aria-label={`${column} values`}>{values.map(value => <label className="toggle" key={value}><input type="checkbox" checked={!filter || filter.values.includes(value)} onChange={e => {
      const selected = filter?.values ?? values;
      dispatch({ type: 'filter', columnName: column, values: e.target.checked ? [...selected, value] : selected.filter(v => v !== value) });
    }} />{value || '(empty string)'}</label>)}</div>
    <div className="filter-actions"><button type="button" disabled={!current || !!current.error} onClick={() => dispatch({ type: 'filter', columnName: column, values })}>Select all</button><button type="button" onClick={() => dispatch({ type: 'filter', columnName: column, values: [] })}>Select none</button></div>
    {!client && <p className="field-hint">Values come from fixed samples. Filtered previews require API mode.</p>}
  </div>;
}

function CalculationDialog({ fields, onSave, onClose }: { fields: CalculatedField[]; onSave: (field: CalculatedField) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [field, setField] = useState<CalculatedField>({ name: '', expression: '', role: 'measure' });
  const [error, setError] = useState('');
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} className="calculation-dialog" aria-labelledby="calculation-heading" onCancel={onClose}>
    <form onSubmit={e => { e.preventDefault(); const problem = calculationError(field, dataFields(fields)); if (problem) setError(problem); else onSave({ ...field, name: field.name.trim() }); }}>
      <h2 id="calculation-heading">Calculated field</h2>
      <label>Name<input autoFocus value={field.name} onChange={e => setField({ ...field, name: e.target.value })} /></label>
      <label>Use as<select value={field.role} onChange={e => setField({ ...field, role: e.target.value as CalculatedField['role'] })}><option value="measure">Measure (number)</option><option value="dimension">Dimension (text)</option></select></label>
      <label>Expression<textarea rows={5} value={field.expression} placeholder="{revenue} - {profit}" onChange={e => setField({ ...field, expression: e.target.value })} /></label>
      <p className="field-hint">Use braces to reference fields. Live queries support row arithmetic (+, −, *) and field references. Other expressions are saved but may show Data unavailable.</p>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">Create field</button></div>
    </form>
  </dialog>;
}

function AuthorCard({ visual, index, count, selected, dispatch, client, calculations }: {
  visual: AuthorVisual; index: number; count: number; selected: boolean; dispatch: Dispatch<AuthorAction>; client?: QueryClient; calculations: CalculatedField[];
}) {
  const preview = useMemo(() => client ? undefined : buildAuthorPreview(visual), [visual, client]);
  const label = visual.title || `Visual ${index + 1}`;
  return <section className={`author-card${selected ? ' is-selected' : ''}`} aria-label={label} onClick={() => { if (!selected) dispatch({ type: 'select', id: visual.id }); }}>
    <div className="author-card-toolbar">
      <span className="drag-handle" aria-hidden="true" title="Drag visual">⠿</span><strong>{index + 1}. {visual.title || VISUAL_TYPES.find(t => t.kind === visual.kind)?.label}</strong>
      <div className="author-card-actions">
        <button type="button" aria-expanded={selected} aria-controls={selected ? `configure-${visual.id}` : undefined} onClick={() => dispatch({ type: 'select', id: visual.id })}>Configure<span className="sr-only"> {label}</span></button>
        <button type="button" disabled={index === 0} aria-label={`Move ${label} up`} onClick={e => { e.stopPropagation(); dispatch({ type: 'move', id: visual.id, offset: -1 }); }}>↑</button>
        <button type="button" disabled={index === count - 1} aria-label={`Move ${label} down`} onClick={e => { e.stopPropagation(); dispatch({ type: 'move', id: visual.id, offset: 1 }); }}>↓</button>
        <button type="button" aria-label={`Remove ${label}`} onClick={e => { e.stopPropagation(); dispatch({ type: 'remove', id: visual.id }); }}>×</button>
      </div>
    </div>
    {client ? <LiveAuthorVisual visual={visual} client={client} calculations={calculations} /> : preview && <VisualCard visual={preview} />}
  </section>;
}
