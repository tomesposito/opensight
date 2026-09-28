import type { Dispatch } from 'react';
import type { AuthorAction, AuthorVisual } from './authoring.js';
import type { PivotOptions } from './formatting.js';

export function PivotOptionsEditor({ visual, dispatch }: { visual: AuthorVisual; dispatch: Dispatch<AuthorAction> }) {
  if (visual.kind !== 'pivot') return null;
  const options = visual.formatting?.pivot ?? {};
  const set = (patch: Partial<PivotOptions>) => dispatch({ type: 'formatting', formatting: { ...visual.formatting, pivot: { ...options, ...patch } } });
  return <details className="property-section"><summary>Pivot options</summary>
    <label>Metric placement<select value={options.metricPlacement ?? 'columns'} onChange={e => set({ metricPlacement: e.target.value as PivotOptions['metricPlacement'] })}><option value="columns">Columns</option><option value="rows">Rows</option></select></label>
    {([{ key: 'hideEmptyRows', label: 'Hide empty rows' }, { key: 'hideEmptyColumns', label: 'Hide empty columns' }, { key: 'wordWrap', label: 'Wrap cell text' }] as const).map(({ key, label }) => <label className="toggle" key={key}><input type="checkbox" checked={options[key] ?? false} onChange={e => set({ [key]: e.target.checked })} />{label}</label>)}
    <label>Column width (px)<input type="number" min="60" max="400" value={options.columnWidth ?? 140} onChange={e => set({ columnWidth: Number(e.target.value) })} /></label>
    <p>Empty means all values are null or missing; zero values stay visible. Width applies to every column when set or when wrapping is enabled.</p>
  </details>;
}
