import { useState, type Dispatch } from 'react';
import { detailedTooltipKinds, tooltipDetailKinds } from './compiler.js';
import { dataFields, visualDimensions, TOOLTIP_AGGREGATIONS, type AuthorAction, type AuthorDataset, type AuthorVisual, type CalculatedField, type TooltipExtraField } from './authoring.js';

/** Fields the detailed tooltip can show: the visual's own dimensions then measures. */
const tooltipFieldNames = (visual: AuthorVisual): string[] => [...visualDimensions(visual), ...visual.measures];

/** Drill-in "Add field to tooltip" panel (QuickSight parity). Staged edits: Save commits via the draft reducer, Cancel discards. */
function AddFieldPanel({ visual, dataset, calculations = [], dispatch, onClose }: { visual: AuthorVisual; dataset?: AuthorDataset; calculations?: readonly CalculatedField[]; dispatch: Dispatch<AuthorAction>; onClose: () => void }) {
  const used = new Set([...tooltipFieldNames(visual), ...visual.tooltipExtraFields.map(e => e.field)]);
  const options = dataFields(calculations, dataset).filter(f => f.role === 'measure' && !used.has(f.name));
  const [field, setField] = useState('');
  const [label, setLabel] = useState('');
  const [aggregation, setAggregation] = useState<TooltipExtraField['aggregation']>('SUM');
  const save = () => {
    if (!field) return;
    dispatch({ type: 'tooltip', patch: { tooltipExtraFields: [...visual.tooltipExtraFields, { field, ...(label.trim() ? { label: label.trim() } : {}), aggregation }] } });
    onClose();
  };
  return <div role="group" aria-label="Add field to tooltip">
    <p><button type="button" onClick={onClose} aria-label="Back to tooltip settings">‹</button> <strong>Add field to tooltip</strong></p>
    <label>Field<select value={field} onChange={e => setField(e.target.value)} aria-label="Field">
      <option value="">Select field</option>
      {options.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
    </select></label>
    <label>Label<input value={label} onChange={e => setLabel(e.target.value)} placeholder="Enter custom label" maxLength={128} aria-label="Custom label" /></label>
    <label>Aggregation<select value={aggregation} onChange={e => setAggregation(e.target.value as TooltipExtraField['aggregation'])} aria-label="Aggregation">
      {TOOLTIP_AGGREGATIONS.map(a => <option key={a} value={a}>{a}</option>)}
    </select></label>
    <p>
      <button type="button" disabled={!field} onClick={save}>Save</button>{' '}
      <button type="button" onClick={onClose}>Cancel</button>
    </p>
    <p className="field-hint">Only measure fields can be added; a dimension would change the visual's grouping.</p>
  </div>;
}

/**
 * Interaction-tab Tooltip section (QuickSight parity).
 * Basic keeps the current tooltip; Detailed shows a title plus one row per
 * visible field, plus any dataset measure fields added below. Added measures
 * aggregate at the visual's existing grain — no query-shape change.
 */
export function TooltipSection({ visual, dispatch, dataset, calculations = [] }: { visual: AuthorVisual; dispatch: Dispatch<AuthorAction>; dataset?: AuthorDataset; calculations?: readonly CalculatedField[] }) {
  const [adding, setAdding] = useState(false);
  if (!tooltipDetailKinds(visual.kind)) return null;
  const fields = tooltipFieldNames(visual);
  const detailed = visual.tooltipType === 'detailed';
  const rendersDetailed = detailedTooltipKinds(visual.kind);
  const patch = (p: Partial<Pick<AuthorVisual, 'tooltipType' | 'tooltipTitleType' | 'tooltipAggregations' | 'tooltipHiddenFields' | 'tooltipExtraFields'>>) =>
    dispatch({ type: 'tooltip', patch: p });
  const toggleField = (name: string) => patch({ tooltipHiddenFields: visual.tooltipHiddenFields.includes(name)
    ? visual.tooltipHiddenFields.filter(f => f !== name)
    : [...visual.tooltipHiddenFields, name] });
  const removeExtra = (name: string) => patch({ tooltipExtraFields: visual.tooltipExtraFields.filter(e => e.field !== name) });
  return <details className="property-section" open><summary data-author-control="tooltip-detail">Tooltip</summary>
    {adding ? <AddFieldPanel visual={visual} dataset={dataset} calculations={calculations} dispatch={dispatch} onClose={() => setAdding(false)} /> : <>
      <label>Tooltip type<select value={visual.tooltipType} onChange={e => patch({ tooltipType: e.target.value as 'basic' | 'detailed' })}>
        <option value="basic">Basic</option>
        <option value="detailed">Detailed</option>
      </select></label>
      {detailed && !rendersDetailed && <p className="field-hint">Detailed tooltips render for bar, line, pie, combo, area, 100% bar, scatter, funnel, gauge, heatmap and map visuals; other visual types use basic tooltips.</p>}
      {detailed && <>
        <label className="toggle"><input type="checkbox" checked={visual.tooltipTitleType === 'primaryValue'}
          onChange={e => patch({ tooltipTitleType: e.target.checked ? 'primaryValue' : 'fieldId' })} />Primary value as title</label>
        <label className="toggle"><input type="checkbox" checked={visual.tooltipAggregations}
          onChange={e => patch({ tooltipAggregations: e.target.checked })} />Show aggregation functions</label>
        <div className="filter-values" role="group" aria-label="Tooltip fields">
          <span className="field-hint">Fields</span>
          {fields.map(name => <label className="toggle" key={name}><input type="checkbox" checked={!visual.tooltipHiddenFields.includes(name)}
            onChange={() => toggleField(name)} />{name}</label>)}
          {visual.tooltipExtraFields.map(e => <div key={e.field} className="toggle"><span>{e.label ?? e.field} · {e.aggregation}</span>{' '}
            <button type="button" aria-label={`Remove ${e.field} from tooltip`} onClick={() => removeExtra(e.field)}>Remove</button></div>)}
        </div>
        <p><button type="button" onClick={() => setAdding(true)}>Add field</button></p>
        <p className="field-hint">Visual fields show by default. Added fields must be dataset measures; dimensions would change the visual's grouping.</p>
      </>}
    </>}
  </details>;
}
