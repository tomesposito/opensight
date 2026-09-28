/** Bounded, deterministic grammar. This package does not execute expressions or queries. */
export interface SchemaField { name: string; type: string; role?: 'dimension' | 'measure' }
export type Aggregation = 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX';
export type Granularity = 'YEAR' | 'QUARTER' | 'MONTH' | 'DAY';
export interface QFilter { field: string; operator: 'equals' | 'year'; value: string | number }
export interface Interpretation {
  measure: string | null;
  aggregation: Aggregation;
  dimensions: string[];
  filters: QFilter[];
  granularity: Granularity | null;
  topN: number | null;
  suggestedVisualType: 'bar' | 'line' | 'pie' | 'table' | 'kpi';
  confidence: number;
  explanation: string;
}
export interface QDiagnostic { code: string; message: string }
export interface InterpretationResult { interpretations: Interpretation[]; errors: QDiagnostic[] }
export const numeric = (field: SchemaField): boolean => ['NUMBER', 'INTEGER', 'DECIMAL', 'INT', 'FLOAT', 'DOUBLE'].includes(field.type.toUpperCase());
export const datetime = (field: SchemaField): boolean => ['DATE', 'DATETIME', 'TIMESTAMP'].includes(field.type.toUpperCase());
export const words = (name: string): string[] => name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s_]+/).filter(Boolean);
interface Token { raw: string; word: string; quoted: boolean }
interface Match { fields: SchemaField[]; length: number; alias: boolean }
function matchField(tokens: Token[], index: number, schema: readonly SchemaField[]): Match | undefined {
  const candidates = schema.flatMap(field => {
    const exact = words(field.name), aliases = [exact];
    // Explicit, documented business synonym; exact names always win.
    if (words(field.name).join(' ') === 'revenue') aliases.push(['sales']);
    if (exact.length > 1) aliases.push([exact[exact.length - 1]!]);
    return aliases.flatMap((parts, a) => {
      const single = words(tokens[index]?.raw ?? '').join(' ') === exact.join(' ');
      const length = a === 0 && single ? 1 : parts.every((part, j) => tokens[index + j]?.word === part) ? parts.length : 0;
      return length ? [{ field, length, alias: a !== 0 }] : [];
    });
  }).sort((a, b) => b.length - a.length || Number(a.alias) - Number(b.alias));
  const first = candidates[0];
  return first && { fields: candidates.filter(c => c.length === first.length && c.alias === first.alias).map(c => c.field), length: first.length, alias: first.alias };
}
const aggregates: Record<string, Aggregation> = { sum: 'SUM', total: 'SUM', avg: 'AVG', average: 'AVG', mean: 'AVG', count: 'COUNT', min: 'MIN', minimum: 'MIN', max: 'MAX', maximum: 'MAX' };
const grains: Record<string, Granularity> = { year: 'YEAR', yearly: 'YEAR', annually: 'YEAR', quarter: 'QUARTER', quarterly: 'QUARTER', month: 'MONTH', monthly: 'MONTH', day: 'DAY', daily: 'DAY' };
const charts = new Set(['pie', 'bar', 'line', 'table', 'trend']);
const fillers = new Set(['show', 'me', 'the', 'a', 'an', 'of', 'and', 'or', 'please', 'chart', 'graph', 'as', 'what', 'is', 'are', '?', ',', '.']);
const clause = new Set(['by', 'per', 'where', 'for', 'in', 'over', 'top', ...charts]);

export function interpretQuestion(question: string, schema: readonly SchemaField[]): InterpretationResult {
  const errors: QDiagnostic[] = [];
  const error = (code: string, message: string) => { errors.push({ code, message }); };
  const stop = (code: string, message: string): InterpretationResult => { error(code, message); return { interpretations: [], errors }; };
  if (!question.trim()) return stop('EMPTY_QUESTION', 'Enter a question.');
  if (question.length > 2000 || schema.length > 500) return stop('INPUT_LIMIT', 'Use at most 2,000 characters and 500 fields.');
  if (!schema.length || schema.some(f => !f.name.trim() || /[{}\0]/.test(f.name)) || new Set(schema.map(f => f.name.toLowerCase())).size !== schema.length) return stop('INVALID_SCHEMA', 'Use a nonempty schema with unique, safe field names.');
  const tokens: Token[] = [...question.matchAll(/"[^"]*"|'[^']*'|[\p{L}\p{N}_]+(?:[.-][\p{L}\p{N}_]+)*|[^\s]/gu)].map(m => ({ raw: /^['"]/.test(m[0]) && m[0].length > 1 ? m[0].slice(1, -1) : m[0], word: m[0].toLowerCase(), quoted: /^['"]/.test(m[0]) }));
  if (tokens.some(t => [';', '`', '\0', "'", '"'].includes(t.raw))) return stop('UNSUPPORTED_SYNTAX', 'Use a question with balanced quotes, without statement separators.');
  const measures: SchemaField[] = [], dimensions: SchemaField[][] = [], filterOptions: QFilter[][] = [];
  const aggregations: Aggregation[] = [], unknown: string[] = [];
  let granularity: Granularity | null = null, topN: number | null = null;
  let hint: Interpretation['suggestedVisualType'] | undefined, countRows = false, time = false, aliases = 0, blocked = false;
  const fieldAt = (i: number) => { const m = matchField(tokens, i, schema); if (m?.alias) aliases++; return m; };
  const bad = (code: string, message: string) => { error(code, message); blocked = true; };
  for (let i = 0; i < tokens.length;) {
    const token = tokens[i]!, word = token.word;
    if (word === 'where' || word === 'for') {
      const m = fieldAt(i + 1);
      if (!m) { bad('UNKNOWN_FILTER_FIELD', `Unknown filter field after ${word}.`); break; }
      i += 1 + m.length;
      if (tokens[i]?.word === 'is' || tokens[i]?.word === 'equals' || tokens[i]?.word === '=') i++;
      const value: string[] = [];
      while (i < tokens.length && (tokens[i]!.quoted || !clause.has(tokens[i]!.word) && !['and', '?', ','].includes(tokens[i]!.word))) value.push(tokens[i++]!.raw);
      if (!value.length) { bad('MISSING_FILTER_VALUE', `Supply a value for ${m.fields.map(f => f.name).join(' / ')}.`); continue; }
      const raw = value.join(' ');
      const filters = m.fields.flatMap(f => {
        if (numeric(f) && !/^-?\d+(?:\.\d+)?$/.test(raw)) return [];
        if (datetime(f) && !/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(raw)) return [];
        return [{ field: f.name, operator: 'equals' as const, value: numeric(f) ? Number(raw) : raw }];
      });
      if (!filters.length) bad('INVALID_FILTER_VALUE', `Invalid value for ${m.fields.map(f => f.name).join(' / ')}.`);
      else filterOptions.push(filters);
      continue;
    }
    if (word === 'in') {
      const year = tokens[i + 1]?.word;
      if (!year || !/^\d{4}$/.test(year)) { bad('UNSUPPORTED_FILTER', 'After “in”, use a four-digit year.'); break; }
      const dates = schema.filter(datetime);
      if (!dates.length) bad('MISSING_DATE_FIELD', 'A year filter needs a date field.');
      else filterOptions.push(dates.map(f => ({ field: f.name, operator: 'year', value: Number(year) })));
      i += 2; continue;
    }
    if (word === 'top') {
      const n = Number(tokens[i + 1]?.raw);
      if (!Number.isSafeInteger(n) || n < 1 || n > 10000) bad('INVALID_TOP_N', 'Top N must be an integer from 1 to 10,000.');
      else topN = n;
      i += 2; continue;
    }
    if (word === 'by' || word === 'per') {
      if (grains[tokens[i + 1]?.word ?? '']) { granularity = grains[tokens[i + 1]!.word]!; time = true; i += 2; continue; }
      const m = fieldAt(i + 1);
      if (!m) { bad('UNKNOWN_DIMENSION', `Unknown field after ${word}.`); break; }
      dimensions.push(m.fields); i += 1 + m.length;
      while (tokens[i]?.word === 'and' || tokens[i]?.word === ',') {
        const next = fieldAt(i + 1); if (!next) break;
        dimensions.push(next.fields); i += 1 + next.length;
      }
      continue;
    }
    if (word === 'over' && tokens[i + 1]?.word === 'time') { time = true; granularity ??= 'MONTH'; i += 2; continue; }
    if (grains[word]) { granularity = grains[word]!; time = true; i++; continue; }
    if (aggregates[word]) { aggregations.push(aggregates[word]!); i++; continue; }
    if (['rows', 'records'].includes(word) && aggregations.includes('COUNT')) { countRows = true; i++; continue; }
    if (charts.has(word)) { hint = word === 'trend' ? 'line' : word as typeof hint; if (word === 'trend') { time = true; granularity ??= 'MONTH'; } i++; continue; }
    const m = fieldAt(i);
    if (m) {
      const candidates = m.fields.filter(f => numeric(f) || aggregations.includes('COUNT'));
      if (candidates.length) measures.push(...candidates); else dimensions.push(m.fields);
      i += m.length; continue;
    }
    if (!fillers.has(word)) unknown.push(token.raw);
    i++;
  }
  if (unknown.length) error('UNRECOGNIZED_WORDS', `Not understood: ${unknown.join(' ')}.`);
  if (blocked) return { interpretations: [], errors };
  if (time && !dimensions.some(fs => fs.some(datetime))) {
    const dates = schema.filter(datetime);
    if (!dates.length) return stop('MISSING_DATE_FIELD', 'Time grouping needs a date field.');
    dimensions.push(dates);
  }
  const uniqueMeasures = [...new Map(measures.map(f => [f.name, f])).values()];
  if (!uniqueMeasures.length && !countRows) return stop('MISSING_MEASURE', 'Name a measure, or ask to count rows.');
  if (topN && !dimensions.length) return stop('MISSING_DIMENSION', 'Top N needs a grouping field (by region, for example).');
  const aggs = [...new Set(aggregations.length ? aggregations : ['SUM' as const, 'AVG' as const])];
  const cross = <T>(sets: T[][]): T[][] => sets.reduce<T[][]>((rows, set) => rows.flatMap(row => set.map(v => [...row, v])).slice(0, 24), [[]]);
  const results: Interpretation[] = [];
  for (const measure of countRows ? [null] : uniqueMeasures) for (const aggregation of countRows ? ['COUNT' as const] : aggs) {
    if (measure && !numeric(measure) && aggregation !== 'COUNT') continue;
    for (const dims of cross(dimensions)) for (const filters of cross(filterOptions)) {
      const names = [...new Set(dims.map(f => f.name))];
      if (filters.some((f, i) => filters.findIndex(g => g.field === f.field) !== i)) continue;
      const type = names.length > 1 ? 'table' : !names.length ? (hint === 'table' ? 'table' : 'kpi') : hint ?? (dims.some(datetime) ? 'line' : 'bar');
      const grain = dims.some(datetime) ? granularity ?? 'MONTH' : null;
      const assumptions = (!aggregations.length ? 0.10 : 0) + (time && schema.filter(datetime).length > 1 ? 0.10 : 0) + aliases * 0.05;
      const confidence = Math.max(0.15, Math.min(0.99, 0.98 - assumptions - Math.min(0.60, unknown.length * 0.15) - (aggregation === 'AVG' && !aggregations.length ? 0.12 : 0)));
      const explanation = `Showing ${aggregation.toLowerCase()} of ${measure?.name ?? 'rows'}${names.length ? ` by ${names.join(' and ')}` : ''}${grain ? ` (${grain.toLowerCase()})` : ''}${filters.length ? `; ${filters.map(f => `${f.field} ${f.operator === 'year' ? 'in year' : 'is'} ${f.value}`).join(' and ')}` : ''}${topN ? `; top ${topN}` : ''}${hint && hint !== type ? `; ${type} used for this grouping` : ''}.`;
      results.push({ measure: measure?.name ?? null, aggregation, dimensions: names, filters, granularity: grain, topN, suggestedVisualType: type, confidence: Math.round(confidence * 100) / 100, explanation });
    }
  }
  const interpretations = [...new Map(results.map(r => [JSON.stringify({ ...r, confidence: 0 }), r])).values()].sort((a, b) => b.confidence - a.confidence || a.explanation.localeCompare(b.explanation, 'en')).slice(0, 12);
  if (!interpretations.length) error('UNSUPPORTED_INTERPRETATION', 'No compatible measure, aggregation and filters were found.');
  if (interpretations.length > 1) error('AMBIGUOUS_QUESTION', 'Multiple interpretations fit. Choose the intended fields or aggregation.');
  return { interpretations, errors };
}
