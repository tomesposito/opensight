import { useState, type Dispatch } from 'react';
import { dataFields, type AuthorDraft, type AuthorVisual, type AuthorAction } from './authoring.js';
import { hierarchyError, levelLabel, type HierarchyLevel } from './drill.js';
export function HierarchyEditor({ draft, visual, dispatch }: { draft: AuthorDraft; visual: AuthorVisual; dispatch: Dispatch<AuthorAction> }) {
  const [name, setName] = useState(visual.hierarchy?.name ?? 'Dimension hierarchy');
  const [levels, setLevels] = useState<HierarchyLevel[]>(visual.hierarchy?.levels ?? []);
  const [column, setColumn] = useState(visual.dimension ?? 'region');
  const [grain, setGrain] = useState<'YEAR' | 'QUARTER' | 'MONTH' | 'DAY'>('YEAR');
  const hierarchy = { id: visual.hierarchy?.id ?? `hierarchy-${visual.id}`, name, levels }, error = hierarchyError(hierarchy, draft.calculatedFields);
  return <details className="interaction-editor"><summary>Drill hierarchy</summary>
    {visual.kind === 'kpi' ? <p>KPI has no dimension to drill.</p> : <>
      <label>Hierarchy name<input value={name} onChange={e => setName(e.target.value)} /></label>
      <ol>{levels.map((level, i) => <li key={i}>{levelLabel(level)} <button type="button" aria-label={`Remove hierarchy level ${i + 1}`} onClick={() => setLevels(levels.filter((_, j) => i !== j))}>×</button></li>)}</ol>
      <label>Level dimension<select value={column} onChange={e => setColumn(e.target.value)}>{dataFields(draft.calculatedFields).filter(f => f.role === 'dimension').map(f => <option key={f.name}>{f.name}</option>)}</select></label>
      {column === 'order_date' && <label>Date level<select value={grain} onChange={e => setGrain(e.target.value as typeof grain)}>{['YEAR','QUARTER','MONTH','DAY'].map(g => <option key={g}>{g}</option>)}</select></label>}
      <button type="button" onClick={() => setLevels([...levels, { columnName: column, ...(column === 'order_date' ? { granularity: grain } : {}) }])}>Add hierarchy level</button>
      <button type="button" onClick={() => { setName('Order date'); setLevels(['YEAR','QUARTER','MONTH'].map(g => ({ columnName: 'order_date', granularity: g as typeof grain }))); }}>Year → Quarter → Month</button>
      {error && <p role="status">{error}</p>}
      <button type="button" disabled={!!error} onClick={() => dispatch({ type: 'hierarchy', hierarchy })}>Save hierarchy</button>
      {visual.hierarchy && <button type="button" onClick={() => { dispatch({ type: 'hierarchy', hierarchy: null }); setLevels([]); }}>Remove hierarchy</button>}
    </>}
  </details>;
}
