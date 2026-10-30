/** Bounded, deterministic grammar. This package does not execute expressions or queries. */
export interface SchemaField { name: string; type: string; role?: 'dimension' | 'measure'; synonyms?: readonly string[] }
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
  grounding: { fieldsUsed: string[]; synonymsMatched: { term: string; field: string }[]; unmatchedTerms: string[] };
}
export type InterpretationStep =
  | { kind: 'aggregation'; value: Aggregation }
  | { kind: 'measure'; value: string | null }
  | { kind: 'group-by'; values: string[] }
  | { kind: 'filter'; value: QFilter }
  | { kind: 'top-n'; value: number | null }
  | { kind: 'granularity'; value: Granularity }
  | { kind: 'visual'; value: Interpretation['suggestedVisualType'] };

/** Pure, inspectable steps; editing belongs to the caller. */
export function interpretationSteps(i: Interpretation): InterpretationStep[] {
  return [
    { kind: 'aggregation', value: i.aggregation }, { kind: 'measure', value: i.measure },
    { kind: 'group-by', values: [...i.dimensions] },
    ...i.filters.map(value => ({ kind: 'filter' as const, value: { ...value } })),
    { kind: 'top-n', value: i.topN },
    ...(i.granularity ? [{ kind: 'granularity' as const, value: i.granularity }] : []),
    { kind: 'visual', value: i.suggestedVisualType },
  ];
}

/** The optional original hint explains the parser's grouping-driven visual choice. */
export function describeInterpretation(i: Pick<Interpretation, 'aggregation' | 'measure' | 'dimensions' | 'granularity' | 'filters' | 'topN' | 'suggestedVisualType'>, hint?: Interpretation['suggestedVisualType']): string {
  return `Showing ${i.aggregation.toLowerCase()} of ${i.measure ?? 'rows'}${i.dimensions.length ? ` by ${i.dimensions.join(' and ')}` : ''}${i.granularity ? ` (${i.granularity.toLowerCase()})` : ''}${i.filters.length ? `; ${i.filters.map(f => `${f.field} ${f.operator === 'year' ? 'in year' : 'is'} ${f.value}`).join(' and ')}` : ''}${i.topN ? `; top ${i.topN}` : ''}${hint && hint !== i.suggestedVisualType ? `; ${i.suggestedVisualType} used for this grouping` : ''}.`;
}
export interface QDiagnostic { code: string; message: string }
export interface CalculationSuggestion { name: string; expression: string; role: 'measure' | 'dimension'; explanation: string }
export type CalculationResult = { suggestion: CalculationSuggestion; error?: never } | { suggestion?: never; error: QDiagnostic };
export interface InterpretationResult { interpretations: Interpretation[]; errors: QDiagnostic[] }
export const numeric = (field: SchemaField): boolean => ['NUMBER', 'INTEGER', 'DECIMAL', 'INT', 'FLOAT', 'DOUBLE'].includes(field.type.toUpperCase());
export const datetime = (field: SchemaField): boolean => ['DATE', 'DATETIME', 'TIMESTAMP'].includes(field.type.toUpperCase());
export const words = (name: string): string[] => name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s_]+/).filter(Boolean);
interface Token { raw: string; word: string; quoted: boolean }
interface Match { fields: SchemaField[]; length: number; alias: boolean; synonyms: string[] }
function matchField(tokens: Token[], index: number, schema: readonly SchemaField[]): Match | undefined {
  const candidates = schema.flatMap(field => {
    const exact = words(field.name);
    const aliases = [{ parts: exact, alias: false, synonym: false },
      ...(field.synonyms ?? []).map(term => ({ parts: words(term), alias: true, synonym: true })),
      ...(exact.length > 1 ? [{ parts: [exact[exact.length - 1]!], alias: true, synonym: false }] : []),
    ];
    return aliases.flatMap(({ parts, alias, synonym }) => {
      if (!parts.length) return [];
      const single = words(tokens[index]?.raw ?? '').join(' ') === parts.join(' ');
      const length = single ? 1 : parts.every((part, j) => tokens[index + j]?.word === part) ? parts.length : 0;
      return length ? [{ field, length, alias, synonym }] : [];
    });
  }).sort((a, b) => Number(a.alias) - Number(b.alias) || b.length - a.length);
  const first = candidates[0];
  if (!first) return;
  const matches = candidates.filter(c => c.length === first.length && c.alias === first.alias)
    .filter((c, i, all) => all.findIndex(other => other.field.name === c.field.name) === i);
  return { fields: matches.map(c => c.field), length: first.length, alias: first.alias, synonyms: matches.filter(c => c.synonym).map(c => c.field.name) };
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
  const tokens: Token[] = [...question.matchAll(/"[^"]*"|'[^']*'|-\d+(?:\.\d+)?|[\p{L}\p{N}_]+(?:[.-][\p{L}\p{N}_]+)*|[^\s]/gu)].map(m => ({ raw: /^['"]/.test(m[0]) && m[0].length > 1 ? m[0].slice(1, -1) : m[0], word: m[0].toLowerCase(), quoted: /^['"]/.test(m[0]) }));
  if (tokens.some(t => [';', '`', '\0', "'", '"'].includes(t.raw))) return stop('UNSUPPORTED_SYNTAX', 'Use a question with balanced quotes, without statement separators.');
  const measures: SchemaField[] = [], dimensions: SchemaField[][] = [], filterOptions: QFilter[][] = [];
  const aggregations: Aggregation[] = [], unknown: string[] = [];
  const synonymsMatched: Interpretation['grounding']['synonymsMatched'] = [];
  let granularity: Granularity | null = null, topN: number | null = null;
  let hint: Interpretation['suggestedVisualType'] | undefined, countRows = false, time = false, aliases = 0, blocked = false;
  const fieldAt = (i: number) => {
    const m = matchField(tokens, i, schema);
    if (m?.alias) aliases++;
    if (m) for (const field of m.synonyms) {
      const term = tokens.slice(i, i + m.length).map(t => t.raw).join(' ');
      if (!synonymsMatched.some(s => s.term === term && s.field === field)) synonymsMatched.push({ term, field });
    }
    return m;
  };
  const bad = (code: string, message: string) => { error(code, message); blocked = true; };
  for (let i = 0; i < tokens.length;) {
    const token = tokens[i]!, word = token.word;
    if (word === 'where' || word === 'for') {
      const m = fieldAt(i + 1);
      if (!m) { bad('UNKNOWN_FILTER_FIELD', `Unknown filter field after ${word}.`); break; }
      i += 1 + m.length;
      if (tokens[i]?.word === 'is' || tokens[i]?.word === 'equals' || tokens[i]?.word === '=') i++;
      const value: string[] = [];
      while (i < tokens.length && (tokens[i]!.quoted || !clause.has(tokens[i]!.word) && !['and', '?', ','].includes(tokens[i]!.word))) {
        if (!tokens[i]!.quoted && ['not', 'or', '>', '<', '!='].includes(tokens[i]!.word)) bad('UNSUPPORTED_FILTER', 'Only equality is supported. Quote literal values containing grammar words.');
        value.push(tokens[i++]!.raw);
      }
      if (tokens[i]?.word === 'and' && !clause.has(tokens[i + 1]?.word ?? '')) bad('UNSUPPORTED_FILTER', 'Repeat “where” or “for” for each additional equality filter.');
      if (!value.length) { bad('MISSING_FILTER_VALUE', `Supply a value for ${m.fields.map(f => f.name).join(' / ')}.`); continue; }
      const raw = value.join(' ');
      const filters = m.fields.flatMap(f => {
        if (numeric(f) && (!/^-?\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw)))) return [];
        if (datetime(f) && (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(raw) || !Number.isFinite(Date.parse(raw)) || raw.length === 10 && new Date(raw).toISOString().slice(0, 10) !== raw)) return [];
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
      if (!Number.isSafeInteger(n) || n < 1 || n > 10000 || topN !== null) bad('INVALID_TOP_N', 'Use one Top N integer from 1 to 10,000.');
      else topN = n;
      i += 2; continue;
    }
    if (word === 'by' || word === 'per') {
      if (Object.hasOwn(grains, tokens[i + 1]?.word ?? '')) { granularity = grains[tokens[i + 1]!.word]!; time = true; i += 2; continue; }
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
    if (Object.hasOwn(grains, word)) { granularity = grains[word]!; time = true; i++; continue; }
    if (Object.hasOwn(aggregates, word)) { aggregations.push(aggregates[word]!); i++; continue; }
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
      const type = names.length > 1 ? 'table' : !names.length ? 'kpi' : hint ?? (dims.some(datetime) ? 'line' : 'bar');
      const grain = dims.some(datetime) ? granularity ?? 'MONTH' : null;
      const assumptions = (!aggregations.length ? 0.10 : 0) + (time && schema.filter(datetime).length > 1 ? 0.10 : 0) + aliases * 0.05;
      const confidence = Math.max(0.15, Math.min(0.99, 0.98 - assumptions - Math.min(0.60, unknown.length * 0.15) - (aggregation === 'AVG' && !aggregations.length ? 0.12 : 0)));
      const fieldsUsed = [...new Set([...(measure ? [measure.name] : []), ...names, ...filters.map(f => f.field)])];
      const interpretation: Interpretation = {
        measure: measure?.name ?? null, aggregation, dimensions: names, filters, granularity: grain, topN,
        suggestedVisualType: type, confidence: Math.round(confidence * 100) / 100, explanation: '',
        grounding: { fieldsUsed, synonymsMatched: synonymsMatched.filter(s => fieldsUsed.includes(s.field)), unmatchedTerms: [...unknown] },
      };
      interpretation.explanation = describeInterpretation(interpretation, hint);
      results.push(interpretation);
    }
  }
  const interpretations = [...new Map(results.map(r => [JSON.stringify({ ...r, confidence: 0 }), r])).values()].sort((a, b) => b.confidence - a.confidence || a.explanation.localeCompare(b.explanation, 'en')).slice(0, 12);
  if (!interpretations.length) error('UNSUPPORTED_INTERPRETATION', 'No compatible measure, aggregation and filters were found.');
  if (interpretations.length > 1) error('AMBIGUOUS_QUESTION', 'Multiple interpretations fit. Choose the intended fields or aggregation.');
  return { interpretations, errors };
}

/** Small, auditable templates using the existing Phase 2c function library. */
export function suggestCalculation(question: string, schema: readonly SchemaField[]): CalculationResult {
  const fail = (code: string, message: string): CalculationResult => ({ error: { code, message } });
  if (!question.trim()) return fail('EMPTY_QUESTION', 'Describe a calculated field.');
  if (question.length > 2000 || schema.length > 500) return fail('INPUT_LIMIT', 'Use at most 2,000 characters and 500 fields.');
  if (schema.some(f => !f.name.trim() || /[{}\0]/.test(f.name))) return fail('INVALID_SCHEMA', 'Field names must be nonempty and cannot contain braces or NUL.');
  const normalized = words(question.replace(/-/g, ' ')).join(' ');
  const find = (names: string[], predicate: (f: SchemaField) => boolean) => {
    for (const name of names) {
      const fields = schema.filter(f => words(f.name).join(' ') === name && predicate(f));
      if (fields.length) return fields.length === 1 ? fields[0] : undefined;
    }
  };
  if (/^(?:build |create )?(?:a )?profit margin$/.test(normalized)) {
    const profit = find(['profit'], numeric), sales = find(['sales', 'revenue'], numeric);
    if (!profit || !sales) return fail('MISSING_CALCULATION_FIELDS', 'Profit margin needs numeric profit and sales (or revenue) fields.');
    return { suggestion: { name: 'Profit margin', role: 'measure', expression: `sum({${profit.name}}) / nullIf(sum({${sales.name}}), 0)`, explanation: 'Ratio of total profit to total sales. Zero sales returns null; format the result as a percentage.' } };
  }
  if (/^(?:build |create )?(?:a )?full name$/.test(normalized)) {
    const string = (f: SchemaField) => f.type.toUpperCase() === 'STRING';
    const first = find(['first name', 'firstname', 'given name'], string), last = find(['last name', 'lastname', 'surname'], string);
    if (!first || !last) return fail('MISSING_CALCULATION_FIELDS', 'Full name needs string first_name and last_name (or given name and surname) fields.');
    return { suggestion: { name: 'Full name', role: 'dimension', expression: `trim(concat(coalesce({${first.name}}, ''), ' ', coalesce({${last.name}}, '')))`, explanation: 'Join first and last name with a space, treating missing names as empty strings.' } };
  }
  const growth = /^(year over year|yoy|month over month|mom) (.+?) (?:growth|percent change|percentage change)(?: by (.+))?$/.exec(normalized);
  if (growth) {
    const measureName = growth[2]!, dateName = growth[3];
    const measure = find(measureName === 'sales' ? ['sales', 'revenue'] : [measureName], numeric);
    const dates = schema.filter(f => datetime(f) && (!dateName || words(f.name).join(' ') === dateName));
    if (!measure) return fail('MISSING_CALCULATION_FIELDS', `Growth needs a numeric ${measureName} field.`);
    if (dates.length !== 1) return fail(dates.length ? 'AMBIGUOUS_DATE_FIELD' : 'MISSING_DATE_FIELD', dates.length ? 'Name the date field with “by <date field>”.' : 'Growth needs a date field.');
    const period = growth[1] === 'yoy' || growth[1] === 'year over year' ? 'YEAR' : 'MONTH';
    return { suggestion: { name: `${period === 'YEAR' ? 'YoY' : 'MoM'} ${measure.name} growth`, role: 'measure', expression: `periodOverPeriodPercentDifference(sum({${measure.name}}), {${dates[0]!.name}}, ${period}, 1)`, explanation: `Group the visual by ${dates[0]!.name}. Compare with the previous calendar ${period.toLowerCase()}; missing or zero prior values return null. The result is a fractional percentage.` } };
  }
  const fn = /\b([A-Za-z_]\w*)\s*\(/.exec(question)?.[1];
  return fail('UNSUPPORTED_CALCULATION_TEMPLATE', `${fn ? `Function request ${fn}` : `Request “${question.trim()}”`} is not supported by the local templates. Try year over year sales growth, profit margin, or full name. No generative service is configured.`);
}
