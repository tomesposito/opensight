import { useEffect, useMemo, useReducer, useState } from 'react';
import type { Dispatch } from 'react';
import { VisualCard } from './VisualCard.js';
import { buildAuthorPreview } from './author-preview.js';
import {
  SALES_FIELDS, VISUAL_TYPES, authorReducer, dimensionLabel, loadDraft, saveDraft, serializeDraft, singleMeasure,
} from './authoring.js';
import type { AuthorAction, AuthorDraft, AuthorVisual, VisualKind } from './authoring.js';

const browserStorage = () => window.localStorage;

export function Author() {
  const [restored] = useState(() => loadDraft(browserStorage));
  const [draft, dispatch] = useReducer(authorReducer, restored.draft);
  const [storageStatus, setStorageStatus] = useState(restored.warning ?? 'Draft saved on this device.');
  const [exportStatus, setExportStatus] = useState('');
  useEffect(() => {
    // Leave an unreadable/unknown-version draft untouched until the user edits.
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
      link.href = url;
      link.download = 'opensight-visuals.json';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStatus('Export downloaded: opensight-visuals.json');
    } catch {
      setExportStatus('Export could not be downloaded. Please try again.');
    }
  };
  return <>
    <div className="dashboard-heading"><div><p className="eyebrow">Synthetic sales · Author</p><h1>Build your analysis</h1></div><span className="phase-badge">Builder v0</span></div>
    <p className="fixture-notice">Preview uses fixed sample results: region = East, dates grouped by UTC month. Only revenue totals by region, category, month, or overall are available. Other selections show “Data unavailable”. No live queries run.</p>
    <div className="author-save">
      <p role="status">{storageStatus}</p>
      <button type="button" className="primary-button" onClick={download} disabled={!draft.visuals.length || !!exported.error} aria-describedby="export-help">Export JSON</button>
      <p id="export-help">{exported.error ?? 'Downloads visual definitions only; sample rows and the fixed East preview filter are not included.'}</p>
      {exportStatus && <p role="status">{exportStatus}</p>}
    </div>
    <AuthorCanvas draft={draft} dispatch={dispatch} />
  </>;
}

export function AuthorCanvas({ draft, dispatch }: { draft: AuthorDraft; dispatch: Dispatch<AuthorAction> }) {
  const [newKind, setNewKind] = useState<VisualKind>('bar');
  const selected = draft.visuals.find(v => v.id === draft.selectedId);
  return <div className="author-layout">
    <aside className="fields-panel" aria-label="Sales fields">
      <h2>Fields</h2><p className="eyebrow">Synthetic sales</p>
      <p>{selected ? `Select a field to assign it to ${selected.title || selected.id}.` : 'Add a visual to start assigning fields.'}</p>
      <p className="field-hint">Dimensions replace the category, x-axis or group-by field. Values use SUM; pie and KPI keep one measure.</p>
      {(['dimension', 'measure'] as const).map(role => <div key={role} className="field-group">
        <h3>{role === 'dimension' ? 'Dimensions' : 'Measures'}</h3>
        {SALES_FIELDS.filter(f => f.role === role).map(field => <button key={field.name} type="button"
          disabled={!selected || (role === 'dimension' && selected.kind === 'kpi')}
          aria-label={`Assign ${field.name}`} aria-pressed={selected?.dimension === field.name || !!selected?.measures.some(f => f === field.name)}
          onClick={() => dispatch({ type: 'assign', field: field.name })}>
          <span>{field.name}</span><span className="field-type">{field.type}</span>
        </button>)}
      </div>)}
    </aside>
    <div className="author-canvas">
      <form className="add-visual" onSubmit={event => { event.preventDefault(); dispatch({ type: 'add', kind: newKind }); }}>
        <label>Visual type<select value={newKind} onChange={event => setNewKind(event.target.value as VisualKind)}>
          {VISUAL_TYPES.map(type => <option value={type.kind} key={type.kind}>{type.label}</option>)}
        </select></label><button type="submit" className="primary-button">Add visual</button>
        <span>{draft.visuals.length} {draft.visuals.length === 1 ? 'visual' : 'visuals'}</span>
      </form>
      {!draft.visuals.length && <div className="canvas-empty"><h2>Your canvas is ready</h2><p>Choose a visual type and select Add visual. Then configure its fields below.</p></div>}
      <div className="author-stack" aria-label="Authoring canvas">
        {draft.visuals.map((visual, index) => <AuthorCard key={visual.id} visual={visual} index={index}
          count={draft.visuals.length} selected={visual.id === draft.selectedId} dispatch={dispatch} />)}
      </div>
    </div>
  </div>;
}

function AuthorCard({ visual, index, count, selected, dispatch }: {
  visual: AuthorVisual; index: number; count: number; selected: boolean; dispatch: Dispatch<AuthorAction>;
}) {
  const preview = useMemo(() => buildAuthorPreview(visual), [visual]);
  const label = visual.title || `Visual ${index + 1}`;
  const configId = `configure-${visual.id}`;
  return <section className={`author-card${selected ? ' is-selected' : ''}`} aria-label={label}>
    <div className="author-card-toolbar">
      <strong>{index + 1}. {visual.title || VISUAL_TYPES.find(t => t.kind === visual.kind)?.label}</strong>
      <div className="author-card-actions">
        <button type="button" aria-expanded={selected} aria-controls={configId} onClick={() => dispatch({ type: 'select', id: visual.id })}>Configure<span className="sr-only"> {label}</span></button>
        <button type="button" disabled={index === 0} aria-label={`Move ${label} up`} onClick={() => dispatch({ type: 'move', id: visual.id, offset: -1 })}>↑<span className="sr-only"> Move up</span></button>
        <button type="button" disabled={index === count - 1} aria-label={`Move ${label} down`} onClick={() => dispatch({ type: 'move', id: visual.id, offset: 1 })}>↓<span className="sr-only"> Move down</span></button>
        <button type="button" aria-label={`Remove ${label}`} onClick={() => dispatch({ type: 'remove', id: visual.id })}>Remove</button>
      </div>
    </div>
    <div id={configId} hidden={!selected}>
      {selected && <div className="visual-config">
        <div className="config-inputs">
          <label>Title<input value={visual.title} placeholder="Generated from fields" onChange={event => dispatch({ type: 'title', title: event.target.value })} /></label>
          <label>Chart type<select value={visual.kind} onChange={event => dispatch({ type: 'kind', kind: event.target.value as VisualKind })}>
            {VISUAL_TYPES.map(type => <option value={type.kind} key={type.kind}>{type.label}</option>)}
          </select></label>
          {visual.kind === 'pie' && <label className="donut-toggle"><input type="checkbox" checked={visual.donut} onChange={event => dispatch({ type: 'donut', donut: event.target.checked })} />Donut</label>}
        </div>
        <div className="field-wells">
          {visual.kind !== 'kpi' && <fieldset><legend>{dimensionLabel(visual.kind)} · 1 field</legend>
            {visual.dimension ? <button className="field-chip" type="button" aria-label={`Remove ${visual.dimension} from ${dimensionLabel(visual.kind)}`} onClick={() => dispatch({ type: 'unassign', field: visual.dimension! })}>{visual.dimension}{visual.dimension === 'order_date' && ' · Month'} <span aria-hidden="true">×</span></button> : <p>Choose a dimension.</p>}
            <label className="well-picker">Assign dimension<select value="" onChange={event => {
              const field = SALES_FIELDS.find(f => f.name === event.target.value && f.role === 'dimension');
              if (field) dispatch({ type: 'assign', field: field.name });
            }}><option value="" disabled>Choose field…</option>{SALES_FIELDS.filter(f => f.role === 'dimension').map(f => <option key={f.name}>{f.name}</option>)}</select></label>
          </fieldset>}
          <fieldset><legend>Values · {singleMeasure(visual.kind) ? '1 measure' : '1–2 measures'}</legend>
            {visual.measures.map(field => <button className="field-chip" type="button" key={field} aria-label={`Remove ${field} from Values`} onClick={() => dispatch({ type: 'unassign', field })}>SUM({field}) <span aria-hidden="true">×</span></button>)}
            {!visual.measures.length && <p>Choose a measure.</p>}
            <label className="well-picker">Assign measure<select value="" onChange={event => {
              const field = SALES_FIELDS.find(f => f.name === event.target.value && f.role === 'measure');
              if (field) dispatch({ type: 'assign', field: field.name });
            }}><option value="" disabled>Choose field…</option>{SALES_FIELDS.filter(f => f.role === 'measure').map(f => <option key={f.name}>{f.name}</option>)}</select></label>
          </fieldset>
        </div>
        <p className="field-hint">Use the Fields panel or a well’s picker. Remove a field with ×. Dates use UTC months.</p>
      </div>}
    </div>
    <VisualCard visual={preview} />
  </section>;
}
