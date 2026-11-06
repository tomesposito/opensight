import { datetime, numeric, type Aggregation, type Granularity, type Interpretation } from '@opensight/o-interpreter';
import type { AuthorDraft } from './authoring.js';
import { oVocabulary } from './o-authoring.js';
export type OStepPatch = Partial<Pick<Interpretation, 'aggregation' | 'dimensions' | 'filters' | 'topN' | 'granularity' | 'suggestedVisualType'>>;
export function OSteps({ interpretation, draft, edit }: { interpretation: Interpretation; draft: AuthorDraft; edit: (patch: OStepPatch) => void }) {
  const stepFields = oVocabulary(draft.calculatedFields, draft.dataset);
  const measureField = interpretation ? stepFields.find(f => f.name === interpretation.measure) : undefined;
  const aggregationOptions: Aggregation[] = interpretation && (interpretation.measure === null || (measureField && !numeric(measureField))) ? ['COUNT'] : measureField?.metric ? [measureField.metric.defaultAggregation] : ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'];
  const hasDateDimension = interpretation ? interpretation.dimensions.some(name => { const f = stepFields.find(x => x.name === name); return !!f && datetime(f); }) : false;
  return <div className="o-steps" aria-label="Interpretation steps">
          <label>Aggregation <select aria-label="Aggregation step" value={interpretation.aggregation} onChange={e => edit({ aggregation: e.target.value as Aggregation })}>{aggregationOptions.map(a => <option key={a} value={a}>{a}</option>)}</select></label>
          <span className="o-step-measure">Measure: {interpretation.measure ?? 'rows'}</span>
          {interpretation.dimensions.map(name => <span key={name} className="o-step-chip">Group by {name} <button type="button" aria-label={`Remove group-by ${name}`} onClick={() => { const dimensions = interpretation.dimensions.filter(d => d !== name); const anyDate = dimensions.some(d => { const f = stepFields.find(x => x.name === d); return !!f && datetime(f); }); edit({ dimensions, topN: dimensions.length ? interpretation.topN : null, granularity: anyDate ? interpretation.granularity : null }); }}>×</button></span>)}
          {interpretation.filters.map((f, index) => <span key={`${f.field}-${index}`} className="o-step-chip">{f.field} {f.operator === 'year' ? 'in year' : 'is'} {String(f.value)} <button type="button" aria-label={`Remove filter ${f.field}`} onClick={() => edit({ filters: interpretation.filters.filter((_, i) => i !== index) })}>×</button></span>)}
          {hasDateDimension && <label>Granularity <select aria-label="Granularity step" value={interpretation.granularity ?? 'MONTH'} onChange={e => edit({ granularity: e.target.value as Granularity })}>{(['YEAR', 'QUARTER', 'MONTH', 'DAY'] as const).map(g => <option key={g} value={g}>{g}</option>)}</select></label>}
          {interpretation.topN !== null && <span className="o-step-chip"><label>Top <input aria-label="Top N step" type="number" min={1} max={10000} value={interpretation.topN} onChange={e => edit({ topN: e.target.value === '' ? null : Number(e.target.value) })} /></label> <button type="button" aria-label="Clear top N" onClick={() => edit({ topN: null })}>×</button></span>}
          <label>Visual <select aria-label="Visual step" value={interpretation.suggestedVisualType} onChange={e => edit({ suggestedVisualType: e.target.value as Interpretation['suggestedVisualType'] })}>{(['bar', 'line', 'pie', 'table', 'kpi'] as const).map(v => <option key={v} value={v}>{v}</option>)}</select></label>
        </div>;
}
