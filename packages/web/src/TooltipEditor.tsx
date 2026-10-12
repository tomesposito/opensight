import type { Dispatch } from 'react';
import { detailedTooltipKinds, tooltipDetailKinds } from './compiler.js';
import { visualDimensions, type AuthorAction, type AuthorVisual } from './authoring.js';

/** Fields the detailed tooltip can show: the visual's own dimensions then measures. */
const tooltipFieldNames = (visual: AuthorVisual): string[] => [...visualDimensions(visual), ...visual.measures];

/**
 * Interaction-tab Tooltip section (QuickSight parity).
 * Basic keeps the current tooltip; Detailed shows a title plus one row per
 * visible field. Only fields already in the visual can appear — no query change.
 */
export function TooltipSection({ visual, dispatch }: { visual: AuthorVisual; dispatch: Dispatch<AuthorAction> }) {
  if (!tooltipDetailKinds(visual.kind)) return null;
  const fields = tooltipFieldNames(visual);
  const detailed = visual.tooltipType === 'detailed';
  const rendersDetailed = detailedTooltipKinds(visual.kind);
  const patch = (p: Partial<Pick<AuthorVisual, 'tooltipType' | 'tooltipTitleType' | 'tooltipAggregations' | 'tooltipHiddenFields'>>) =>
    dispatch({ type: 'tooltip', patch: p });
  const toggleField = (name: string) => patch({ tooltipHiddenFields: visual.tooltipHiddenFields.includes(name)
    ? visual.tooltipHiddenFields.filter(f => f !== name)
    : [...visual.tooltipHiddenFields, name] });
  return <details className="property-section" open><summary data-author-control="tooltip-detail">Tooltip</summary>
    <label>Tooltip type<select value={visual.tooltipType} onChange={e => patch({ tooltipType: e.target.value as 'basic' | 'detailed' })}>
      <option value="basic">Basic</option>
      <option value="detailed">Detailed</option>
    </select></label>
    {detailed && !rendersDetailed && <p className="field-hint">Detailed tooltips render for bar, line, pie, combo and area visuals; this visual type uses basic tooltips.</p>}
    {detailed && <>
      <label className="toggle"><input type="checkbox" checked={visual.tooltipTitleType === 'primaryValue'}
        onChange={e => patch({ tooltipTitleType: e.target.checked ? 'primaryValue' : 'fieldId' })} />Primary value as title</label>
      <label className="toggle"><input type="checkbox" checked={visual.tooltipAggregations}
        onChange={e => patch({ tooltipAggregations: e.target.checked })} />Show aggregation functions</label>
      <div className="filter-values" role="group" aria-label="Tooltip fields">
        <span className="field-hint">Fields</span>
        {fields.map(name => <label className="toggle" key={name}><input type="checkbox" checked={!visual.tooltipHiddenFields.includes(name)}
          onChange={() => toggleField(name)} />{name}</label>)}
      </div>
      <p className="field-hint">Only fields already in the visual can appear in tooltips.</p>
    </>}
  </details>;
}
