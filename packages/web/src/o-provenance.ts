import type { Interpretation } from '@opensight/o-interpreter';
export interface OProvenance { question: string; interpretation: Interpretation }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(n => typeof n === 'string');
/** Metadata is structurally validated, independent of the current dataset (remaps retain it). */
export function validOProvenance(value: unknown): value is OProvenance {
  if (!object(value) || !keys(value, ['question', 'interpretation']) || typeof value.question !== 'string' || !value.question.trim() || value.question.length > 2000) return false;
  const i = value.interpretation;
  if (!object(i) || !keys(i, ['measure', 'aggregation', 'dimensions', 'filters', 'granularity', 'topN', 'suggestedVisualType', 'confidence', 'explanation', 'grounding'])) return false;
  if (!(i.measure === null || typeof i.measure === 'string' && !!i.measure.trim()) || !['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'DISTINCT_COUNT'].includes(String(i.aggregation)) || !strings(i.dimensions) || !Array.isArray(i.filters)) return false;
  if (!i.filters.every(f => object(f) && keys(f, ['field', 'operator', 'value']) && typeof f.field === 'string' && ['equals', 'year'].includes(String(f.operator)) && (typeof f.value === 'string' || typeof f.value === 'number' && Number.isFinite(f.value)))) return false;
  if (!(i.granularity === null || ['YEAR', 'QUARTER', 'MONTH', 'DAY'].includes(String(i.granularity))) || !(i.topN === null || Number.isSafeInteger(i.topN) && Number(i.topN) > 0 && Number(i.topN) <= 10000) || !['bar', 'line', 'pie', 'table', 'kpi'].includes(String(i.suggestedVisualType)) || typeof i.confidence !== 'number' || !Number.isFinite(i.confidence) || i.confidence < 0 || i.confidence > 1 || typeof i.explanation !== 'string') return false;
  const g = i.grounding;
  return object(g) && keys(g, ['fieldsUsed', 'synonymsMatched', 'unmatchedTerms', 'metricsUsed']) && strings(g.fieldsUsed) && strings(g.unmatchedTerms) && Array.isArray(g.synonymsMatched) && g.synonymsMatched.every(s => object(s) && keys(s, ['term', 'field']) && typeof s.term === 'string' && typeof s.field === 'string') && (g.metricsUsed === undefined || Array.isArray(g.metricsUsed) && g.metricsUsed.every(m => object(m) && keys(m, ['id', 'name', 'version']) && typeof m.id === 'string' && typeof m.name === 'string' && Number.isSafeInteger(m.version) && Number(m.version) > 0));
}
export const oTitle = (i: Interpretation) => i.explanation.replace(/^Showing /, '').replace(/\.$/, '');
/** Canonical seed describes the final edited steps, so a later follow-up cannot revert them. */
export function oQuestion(i: Interpretation): string {
  const quote = (s: string) => s.includes('"') ? `'${s}'` : `"${s}"`;
  return `${i.aggregation === 'DISTINCT_COUNT' ? '' : i.aggregation.toLowerCase() + ' '}${i.measure === null ? 'rows' : quote(i.measure)}${i.dimensions.length ? ' by ' + i.dimensions.map(quote).join(' and ') : ''}${i.granularity ? ' per ' + i.granularity.toLowerCase() : ''}${i.filters.map(f => f.operator === 'year' ? ` in ${f.value}` : ` where ${quote(f.field)} is ${typeof f.value === 'number' ? f.value : quote(f.value)}`).join('')}${i.topN ? ' top ' + i.topN : ''}${i.suggestedVisualType === 'kpi' ? '' : ' ' + i.suggestedVisualType}`;
}
