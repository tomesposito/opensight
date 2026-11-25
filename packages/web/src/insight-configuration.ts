import type { Field } from './model.js';
import { forecastConfigValid, type ForecastConfig } from './forecast.js';

export class InsightError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); this.name = 'InsightError'; }
}
export const insightFail = (code: string, message: string): never => { throw new InsightError(code, message); };
type Obj = Record<string, unknown>;
export function insightObject(value: unknown): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return insightFail('INSIGHT_CONFIGURATION_INVALID', 'expected an object');
  return value as Obj;
}
const allowed = (value: Obj, names: string[]) => {
  for (const name of Object.keys(value)) if (!names.includes(name)) insightFail('INSIGHT_CONFIGURATION_UNSUPPORTED', `unsupported property ${name}`);
};
const variants = ['totalAggregation', 'maximumMinimum', 'topBottomRanked', 'growthRate', 'periodOverPeriod', 'metricComparison', 'forecast', 'periodToDate', 'uniqueValues', 'topBottomMovers', 'anomaly'] as const;
export type InsightKind = typeof variants[number];
type Kind = InsightKind;
/** The bounded public catalog is shared by structural validation and authoring. */
export const INSIGHT_OUTPUTS: Record<Kind, readonly string[]> = {
  totalAggregation: ['value', 'formattedValue'],
  maximumMinimum: ['value', 'formattedValue', 'category', 'percentOfTotal', 'percentOfTotal.value', 'percentOfTotal.formattedValue'],
  topBottomRanked: ['itemsCount', 'items[i].category', 'items[i].value', 'items[i].formattedValue'],
  metricComparison: ['value', 'formattedValue', 'targetValue', 'targetValue.formattedValue', 'difference', 'difference.formattedValue', 'percentDifference', 'percentDifference.value', 'percentDifference.formattedValue'],
  growthRate: ['value', 'formattedValue', 'previousValue', 'previousValue.formattedValue', 'change', 'change.formattedValue', 'percentChange', 'percentChange.value', 'percentChange.formattedValue', 'currentPeriod', 'previousPeriod'],
  periodOverPeriod: ['value', 'formattedValue', 'previousValue', 'previousValue.formattedValue', 'change', 'change.formattedValue', 'percentChange', 'percentChange.value', 'percentChange.formattedValue', 'currentPeriod', 'previousPeriod'],
  periodToDate: ['value', 'formattedValue', 'period'],
  forecast: ['value', 'formattedValue', 'lowerBound', 'lowerBound.formattedValue', 'upperBound', 'upperBound.formattedValue', 'period'],
  uniqueValues: ['itemsCount', 'items[i]'],
  topBottomMovers: ['itemsCount', 'items[i].category', 'items[i].previousValue', 'items[i].previousValue.formattedValue', 'items[i].value', 'items[i].formattedValue', 'items[i].change', 'items[i].change.formattedValue', 'items[i].percentChange', 'items[i].percentChange.value'],
  anomaly: ['itemsCount', 'items[i].period', 'items[i].value', 'items[i].formattedValue'],
};
export interface InsightPlaceholderFormat { decimals?: number; grouping?: boolean; percent?: true; date?: NonNullable<Field['dateGranularity']> }
export type InsightTemplatePart = { kind: 'text'; text: string } | {
  kind: 'placeholder'; format: InsightPlaceholderFormat;
  reference: { kind: 'field'; fieldId: string; output: string } | { kind: 'computation'; computationId: string; output: string; index?: number };
};
export const customNarrativeUnsupported = (detail: string): never => insightFail('INSIGHT_CUSTOM_NARRATIVE_UNSUPPORTED',
  `bounded subset supports only plain text, catalog computation/measure placeholders and number/date formats: ${detail}`);

function parseCustomNarrative(raw: unknown, entries: readonly [Kind, Obj][]): InsightTemplatePart[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return customNarrativeUnsupported('expected an object with only narrative');
  const object = raw as Obj;
  if (Object.keys(object).some(key => key !== 'narrative') || typeof object.narrative !== 'string') return customNarrativeUnsupported('expected only a narrative string');
  const template = object.narrative;
  if (template.includes('$')) return customNarrativeUnsupported('parameters ($) are unsupported');
  const parts: InsightTemplatePart[] = [];
  let cursor = 0;
  const pattern = /\{([^{}]*)\}/g;
  for (const match of template.matchAll(pattern)) {
    const literal = template.slice(cursor, match.index);
    if (/[{}]/.test(literal)) return customNarrativeUnsupported('nested or unbalanced braces');
    if (literal) parts.push({ kind: 'text', text: literal });
    const [ref, formats, extra] = match[1]!.split('|');
    if (extra !== undefined || !ref || !/^[\w-]+(?:\.[\w-]+(?:\[\d+\])?)*$/.test(ref)) return customNarrativeUnsupported('invalid placeholder reference');
    const format: InsightPlaceholderFormat = {};
    if (formats !== undefined) for (const pair of formats.split(',')) {
      const [key, value, extra] = pair.split(':');
      if (!key || extra !== undefined || Object.hasOwn(format, key)) return customNarrativeUnsupported('invalid or repeated format');
      if (key === 'decimals' && /^[0-6]$/.test(value ?? '')) format.decimals = Number(value);
      else if (key === 'grouping' && (value === 'true' || value === 'false')) format.grouping = value === 'true';
      else if (key === 'percent' && value === 'true') format.percent = true;
      else if (key === 'date' && (value === 'DAY' || value === 'MONTH' || value === 'QUARTER' || value === 'YEAR')) format.date = value;
      else return customNarrativeUnsupported(`unknown format ${pair}`);
    }
    const [name, ...segments] = ref.split('.');
    let reference: Extract<InsightTemplatePart, { kind: 'placeholder' }>['reference'];
    if (name === 'field') {
      const [fieldId, output = 'value', ...rest] = segments;
      if (!fieldId || !/^[\w-]+$/.test(fieldId) || rest.length || !['value', 'formattedValue'].includes(output)) return customNarrativeUnsupported('invalid field reference');
      reference = { kind: 'field', fieldId, output };
    } else {
      const found = entries.filter(([, body]) => (body.name ?? body.computationId) === name);
      if (found.length !== 1) return insightFail('INSIGHT_CUSTOM_NARRATIVE_REFERENCE', `computation ${name} is ${found.length ? 'ambiguous' : 'not on this Insight'}`);
      const [kind, body] = found[0]!, output = segments.join('.');
      if (!INSIGHT_OUTPUTS[kind].includes(output.replace(/\[\d+\]/g, '[i]'))) return customNarrativeUnsupported(`unknown ${kind} output ${output}`);
      const index = /^items\[(\d+)\]/.exec(output);
      reference = { kind: 'computation', computationId: body.computationId as string, output, ...(index ? { index: Number(index[1]) } : {}) };
    }
    parts.push({ kind: 'placeholder', reference, format });
    cursor = match.index + match[0].length;
  }
  const tail = template.slice(cursor);
  if (/[{}]/.test(tail)) return customNarrativeUnsupported('nested or unbalanced braces');
  if (tail) parts.push({ kind: 'text', text: tail });
  return parts;
}

/** Parse with the same structural checks used by import, drafts and querying. */
export function insightTemplate(config: unknown): InsightTemplatePart[] | undefined {
  const entries = computations(config);
  const c = insightObject(config);
  return Object.hasOwn(c, 'customNarrative') ? parseCustomNarrative(c.customNarrative, entries ?? []) : undefined;
}
interface AnomalyDetection { direction: 'HIGHER' | 'LOWER' | 'BOTH'; minSensitivityPercentage?: number }
export type InsightRequest = { id: string; measure: number } & (
  { kind: Exclude<Kind, 'forecast' | 'periodToDate' | 'uniqueValues' | 'topBottomMovers' | 'anomaly'>; target?: number; type?: string; size?: number }
  | { kind: 'forecast'; forecast: ForecastConfig }
  | { kind: 'anomaly'; anomalyDetection: AnomalyDetection }
  | { kind: 'periodToDate'; periodTimeGranularity: NonNullable<Field['dateGranularity']> }
  | { kind: 'uniqueValues' }
  | { kind: 'topBottomMovers'; type: 'TOP' | 'BOTTOM'; size: number; sortOrder: 'PERCENT_DIFFERENCE' | 'ABSOLUTE_DIFFERENCE' }
);

function anomalyDetection(value: unknown): AnomalyDetection {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) insightFail('INSIGHT_COMPUTATION_INVALID', 'anomalyDetection must be an object');
  const raw = (value ?? {}) as Obj;
  allowed(raw, ['direction', 'minSensitivityPercentage']);
  const direction = raw.direction === undefined ? 'BOTH' : raw.direction;
  if (direction !== 'HIGHER' && direction !== 'LOWER' && direction !== 'BOTH') return insightFail('INSIGHT_COMPUTATION_INVALID', 'direction must be HIGHER, LOWER or BOTH');
  const percentage = raw.minSensitivityPercentage;
  if (percentage !== undefined && (typeof percentage !== 'number' || !Number.isFinite(percentage) || percentage < 0 || percentage > 100)) return insightFail('INSIGHT_COMPUTATION_INVALID', 'minSensitivityPercentage must be a finite number between 0 and 100');
  return { direction, ...(percentage !== undefined ? { minSensitivityPercentage: percentage } : {}) };
}

function periodTimeGranularity(value: unknown): NonNullable<Field['dateGranularity']> | undefined {
  if (value === undefined) return;
  if (value === 'DAY' || value === 'MONTH' || value === 'QUARTER' || value === 'YEAR') return value;
  return insightFail('INSIGHT_COMPUTATION_INVALID', 'periodTimeGranularity must be DAY, MONTH, QUARTER or YEAR');
}

/** Native ForecastProperties follows the chart forecast configuration contract. */
function forecastProperties(value: unknown): ForecastConfig {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) insightFail('INSIGHT_COMPUTATION_INVALID', 'forecastProperties must be an object');
  const raw = (value ?? {}) as Obj;
  allowed(raw, ['periodsForward', 'periodsBackward', 'predictionInterval', 'seasonality', 'customSeasonalityValue', 'lowerBoundary', 'upperBoundary']);
  const seasonality = raw.seasonality === undefined ? 'AUTOMATIC' : raw.seasonality;
  if (!['AUTOMATIC', 'NONE', 'CUSTOM'].includes(seasonality as string)) insightFail('INSIGHT_COMPUTATION_INVALID', 'invalid forecast seasonality');
  const custom = raw.customSeasonalityValue;
  if (seasonality === 'CUSTOM' && (typeof custom !== 'number' || !Number.isInteger(custom) || custom < 2 || custom > 366)) insightFail('INSIGHT_COMPUTATION_INVALID', 'a custom seasonality period between 2 and 366 is required');
  const candidate = {
    enabled: true,
    periodsForward: raw.periodsForward === undefined ? 3 : raw.periodsForward,
    periodsBackward: raw.periodsBackward === undefined ? 0 : raw.periodsBackward,
    predictionInterval: raw.predictionInterval === undefined ? 95 : raw.predictionInterval,
    seasonality: seasonality === 'AUTOMATIC' ? 'auto' : seasonality === 'NONE' ? 'none' : custom,
    ...(raw.lowerBoundary !== undefined ? { lowerBoundary: raw.lowerBoundary } : {}),
    ...(raw.upperBoundary !== undefined ? { upperBoundary: raw.upperBoundary } : {}),
  };
  if (!forecastConfigValid(candidate)) return insightFail('INSIGHT_COMPUTATION_INVALID', 'invalid forecast properties');
  return candidate;
}

function moversProperties(body: Obj): void {
  if (body.type !== 'TOP' && body.type !== 'BOTTOM') insightFail('INSIGHT_COMPUTATION_INVALID', 'type must be TOP or BOTTOM');
  if (body.moverSize !== undefined && (!Number.isInteger(body.moverSize) || Number(body.moverSize) < 1 || Number(body.moverSize) > 20)) insightFail('INSIGHT_COMPUTATION_INVALID', 'MoverSize must be 1–20');
  if (body.sortOrder !== undefined && body.sortOrder !== 'PERCENT_DIFFERENCE' && body.sortOrder !== 'ABSOLUTE_DIFFERENCE') insightFail('INSIGHT_COMPUTATION_INVALID', 'sortOrder must be PERCENT_DIFFERENCE or ABSOLUTE_DIFFERENCE');
}

/** Validate explicit binding syntax and semantics without resolving it against wells. */
function bindingShape(raw: unknown, measure: boolean): { variant: string; field: Obj; column: Obj } {
  const pairs = Object.entries(insightObject(raw));
  if (pairs.length !== 1) return insightFail('INSIGHT_FIELD_UNBOUND', 'expected one field variant');
  const [variant, value] = pairs[0]!;
  const expected = measure ? ['numericalMeasureField'] : ['categoricalDimensionField', 'numericalDimensionField', 'dateDimensionField'];
  if (!expected.includes(variant)) insightFail('INSIGHT_FIELD_UNBOUND', `unsupported field ${variant}`);
  const field = insightObject(value), column = insightObject(field.column);
  allowed(field, ['fieldId', 'column', ...(measure ? ['aggregationFunction'] : variant === 'dateDimensionField' ? ['dateGranularity'] : [])]);
  allowed(column, ['columnName', 'dataSetIdentifier']);
  if (typeof field.fieldId !== 'string' || typeof column.columnName !== 'string') insightFail('INSIGHT_FIELD_UNBOUND', 'fieldId and columnName must be strings');
  if (column.dataSetIdentifier !== undefined && typeof column.dataSetIdentifier !== 'string') insightFail('INSIGHT_FIELD_UNBOUND', 'dataSetIdentifier must be a string');
  if (variant === 'dateDimensionField' && field.dateGranularity !== undefined && !['DAY', 'MONTH', 'QUARTER', 'YEAR'].includes(field.dateGranularity as string))
    insightFail('INSIGHT_FIELD_UNBOUND', 'dateGranularity must be DAY, MONTH, QUARTER or YEAR');
  if (measure) {
    const agg = insightObject(field.aggregationFunction); allowed(agg, ['simpleNumericalAggregation']);
    if (agg.simpleNumericalAggregation !== 'SUM') insightFail('INSIGHT_FIELD_UNBOUND', 'only explicit SUM bindings are supported');
  }
  return { variant, field, column };
}

function computations(config: unknown): [Kind, Obj][] | undefined {
  const c = insightObject(config);
  allowed(c, ['computations', 'customNarrative']);
  const custom = Object.hasOwn(c, 'customNarrative');
  if (c.computations === undefined && !custom) return;
  const rawComputations = c.computations === undefined ? [] : c.computations;
  if (!Array.isArray(rawComputations) || (!rawComputations.length && !custom) || rawComputations.length > 100) insightFail('INSIGHT_COMPUTATION_INVALID', 'expected 1–100 computations (or zero with customNarrative)');
  const entries = (rawComputations as unknown[]).map((raw): [Kind, Obj] => {
    const entries = Object.entries(insightObject(raw));
    if (entries.length !== 1) return insightFail('INSIGHT_COMPUTATION_INVALID', 'expected exactly one computation variant');
    const [kind, value] = entries[0]!;
    if (!variants.includes(kind as Kind)) insightFail('INSIGHT_COMPUTATION_UNSUPPORTED', `unsupported computation ${kind}`);
    if (kind === 'anomaly' && (!value || typeof value !== 'object' || Array.isArray(value))) insightFail('INSIGHT_COMPUTATION_INVALID', 'anomaly must be an object');
    if (kind === 'forecast' && (!value || typeof value !== 'object' || Array.isArray(value))) insightFail('INSIGHT_COMPUTATION_INVALID', 'forecast must be an object');
    if (kind === 'periodToDate' && (!value || typeof value !== 'object' || Array.isArray(value))) insightFail('INSIGHT_COMPUTATION_INVALID', 'periodToDate must be an object');
    if (kind === 'uniqueValues' && (!value || typeof value !== 'object' || Array.isArray(value))) insightFail('INSIGHT_COMPUTATION_INVALID', 'uniqueValues must be an object');
    if (kind === 'topBottomMovers' && (!value || typeof value !== 'object' || Array.isArray(value))) insightFail('INSIGHT_COMPUTATION_INVALID', 'topBottomMovers must be an object');
    const body = insightObject(value);
    if (typeof body.computationId !== 'string' || !/^[\w-]{1,512}$/.test(body.computationId)) insightFail('INSIGHT_COMPUTATION_INVALID', 'a computationId is required');
    if (body.name !== undefined && typeof body.name !== 'string') insightFail('INSIGHT_COMPUTATION_INVALID', 'name must be a string');
    const specific = kind === 'totalAggregation' ? ['value'] : kind === 'maximumMinimum' ? ['time', 'value', 'type']
      : kind === 'topBottomRanked' ? ['category', 'value', 'type', 'resultSize'] : kind === 'metricComparison' ? ['time', 'fromValue', 'targetValue']
      : kind === 'growthRate' ? ['time', 'value', 'periodSize'] : kind === 'forecast' ? ['time', 'value', 'forecastProperties']
      : kind === 'anomaly' ? ['time', 'value', 'anomalyDetection']
      : kind === 'periodToDate' ? ['time', 'value', 'periodTimeGranularity'] : kind === 'uniqueValues' ? ['category']
      : kind === 'topBottomMovers' ? ['time', 'category', 'value', 'type', 'moverSize', 'sortOrder'] : ['time', 'value'];
    allowed(body, ['computationId', 'name', ...specific]);
    for (const slot of ['category', 'time', 'value', 'fromValue', 'targetValue']) {
      if (body[slot] !== undefined) bindingShape(body[slot], slot !== 'category' && slot !== 'time');
    }
    if (kind === 'forecast') forecastProperties(body.forecastProperties);
    if (kind === 'anomaly') anomalyDetection(body.anomalyDetection);
    if (kind === 'periodToDate') periodTimeGranularity(body.periodTimeGranularity);
    if (kind === 'topBottomMovers') moversProperties(body);
    return [kind as Kind, body];
  });
  if (custom) parseCustomNarrative(c.customNarrative, entries);
  return entries;
}

/**
 * Canonical descriptor of one computation field binding (issue #322): the
 * normalized semantics the native planner deduplicates by — variant, field
 * identity, column, dataset, date grain with an omitted grain defaulting to
 * DAY (the planner's rule), and the measure aggregation. Two raw bindings
 * with the same descriptor are one field even when their JSON members are
 * ordered differently or one spells out a default the other omits.
 */
function canonicalBinding(raw: unknown, measure: boolean): { key: string; fieldId: string } {
  const { variant, field, column } = bindingShape(raw, measure);
  const descriptor = [
    variant, field.fieldId, column.columnName, column.dataSetIdentifier ?? null,
    variant === 'dateDimensionField' ? (field.dateGranularity ?? 'DAY') : null,
    measure ? insightObject(field.aggregationFunction).simpleNumericalAggregation : null,
  ];
  return { key: JSON.stringify(descriptor), fieldId: field.fieldId as string };
}

/** Native API insight computations own their fields. OpenSight wells are a projection. */
export function insightWells(config: unknown): { category: unknown[]; values: unknown[] } {
  const entries = computations(config) ?? [];
  const collect = (slots: [string, boolean][]): unknown[] => {
    const byKey = new Map<string, unknown>();
    const keyByFieldId = new Map<string, string>();
    for (const [, c] of entries) for (const [slot, measure] of slots) {
      if (c[slot] === undefined) continue;
      const { key, fieldId } = canonicalBinding(c[slot], measure);
      // The planner fails closed when one fieldId is bound inconsistently
      // across computations; the projection holds the same line instead of
      // emitting two wells for a field whose semantics conflict.
      const prior = keyByFieldId.get(fieldId);
      if (prior !== undefined && prior !== key) insightFail('INSIGHT_FIELD_UNBOUND', `field ${fieldId} is bound inconsistently across computations`);
      keyByFieldId.set(fieldId, key);
      // Preserve the first original definition unchanged for export.
      if (!byKey.has(key)) byKey.set(key, c[slot]);
    }
    return [...byKey.values()];
  };
  return {
    category: collect([['category', false], ['time', false]]),
    values: collect([['value', true], ['fromValue', true], ['targetValue', true]]),
  };
}
export function projectInsightBody(body: Obj): Obj {
  if (body.insightConfiguration !== undefined) computations(body.insightConfiguration);
  if (body.chartConfiguration !== undefined) return body;
  return { ...body, chartConfiguration: { fieldWells: { insightAggregatedFieldWells: insightWells(body.insightConfiguration ?? {}) } } };
}

/**
 * Complete structural validation of an insight configuration, shared by draft
 * admission, author query construction and the compiler (via normalizeInsight):
 * every computation is a known, well-formed variant with only supported
 * properties, computation IDs are unique, and topBottomMovers computations
 * never mix with other computations. Present field bindings must have supported
 * shapes and semantics before rebinding can replace them. Field existence in
 * the wells and dimension/measure requirements remain normalizeInsight's layer,
 * enforced before querying and at compile time, so an in-progress draft stays
 * saveable even when its fields are not yet assigned.
 */
export function validateInsightConfiguration(config: unknown): void {
  const entries = computations(config);
  if (!entries) return;
  const ids = new Set<string>();
  for (const [, body] of entries) {
    const id = body.computationId as string;
    if (ids.has(id)) insightFail('INSIGHT_COMPUTATION_INVALID', 'duplicate computation IDs');
    ids.add(id);
  }
  if (entries.some(([kind]) => kind === 'topBottomMovers') && !entries.every(([kind]) => kind === 'topBottomMovers'))
    insightFail('INSIGHT_COMPUTATION_INVALID', 'topBottomMovers computations cannot be combined with other computations');
}

/** True when every configured computation is uniqueValues — the only variant that binds no measure. */
export function uniqueValuesOnly(config: unknown): boolean {
  const entries = computations(config);
  return !!entries?.length && entries.every(([kind]) => kind === 'uniqueValues');
}

/** True when every configured computation is topBottomMovers — the only variant that binds two dimensions (category + time). */
export function topBottomMoversOnly(config: unknown): boolean {
  const entries = computations(config);
  return !!entries?.length && entries.every(([kind]) => kind === 'topBottomMovers');
}

/** Column name of the movers time field, when a topBottomMovers computation binds one. */
export function topBottomMoversTimeColumn(config: unknown): string | undefined {
  const entry = computations(config)?.find(([kind]) => kind === 'topBottomMovers');
  if (!entry || entry[1].time === undefined) return undefined;
  const field = insightObject(Object.values(insightObject(entry[1].time))[0]);
  const column = insightObject(field.column);
  return typeof column.columnName === 'string' ? column.columnName : undefined;
}

export function normalizeInsight(config: unknown, dimensions: Field[], measures: Field[]): InsightRequest[] {
  validateInsightConfiguration(config);
  const entries = computations(config);
  for (const part of insightTemplate(config) ?? []) if (part.kind === 'placeholder' && part.reference.kind === 'field') {
    const { fieldId } = part.reference;
    if (!measures.some(field => field.id === fieldId) || dimensions.some(field => field.id === fieldId))
      insightFail('INSIGHT_CUSTOM_NARRATIVE_REFERENCE', `field ${fieldId} must be a measure bound in this Insight's wells`);
  }
  const moversOnly = !!entries?.length && entries.every(([kind]) => kind === 'topBottomMovers');
  if (moversOnly ? dimensions.length !== 2 : dimensions.length !== 1) insightFail('INSIGHT_CATEGORY_REQUIRED', moversOnly ? 'expected a Category dimension and a Time dimension' : 'expected exactly one Category dimension');
  if (measures.length > 2 || (measures.length < 1 && !(entries?.length && entries.every(([kind]) => kind === 'uniqueValues')))) insightFail('INSIGHT_VALUES_REQUIRED', 'expected one Values measure, or two for comparison');
  if (!entries) return [
    { kind: 'totalAggregation', id: 'total', measure: 0 },
    { kind: 'maximumMinimum', id: 'maximum', type: 'MAXIMUM', measure: 0 },
    { kind: 'maximumMinimum', id: 'minimum', type: 'MINIMUM', measure: 0 },
    ...(dimensions[0]!.dateGranularity ? [{ kind: 'periodOverPeriod' as const, id: 'period', measure: 0 }] : []),
    ...(measures.length === 2 ? [{ kind: 'metricComparison' as const, id: 'comparison', measure: 0, target: 1 }] : []),
  ];
  const binding = (raw: unknown, fields: Field[], fallback: number): number => {
    if (raw === undefined) return fallback;
    const { variant, field: f, column } = bindingShape(raw, fields === measures);
    const index = fields.findIndex(field => (variant === 'dateDimensionField') === !!field.dateGranularity && field.id === f.fieldId && field.column === column.columnName && field.dataSet === column.dataSetIdentifier
      && (variant !== 'dateDimensionField' || field.dateGranularity === (f.dateGranularity ?? 'DAY')));
    if (index < 0) insightFail('INSIGHT_FIELD_UNBOUND', 'computation references an unbound or conflicting field');
    return index;
  };
  return entries.map(([kind, c]) => {
    const id = c.computationId as string;
    binding(c.category ?? c.time, dimensions, 0);
    if (kind === 'uniqueValues') return { kind, id, measure: 0 };
    const measure = binding(kind === 'metricComparison' ? c.fromValue : c.value, measures, 0);
    if (kind === 'topBottomMovers') {
      const categoryIndex = binding(c.category, dimensions, 0);
      const timeIndex = binding(c.time, dimensions, 1);
      if (categoryIndex === timeIndex) insightFail('INSIGHT_FIELD_UNBOUND', 'movers category and time must bind distinct fields');
      // Execution honors the wells in category/time order by construction —
      // the compiler reads dimension 0 as category and dimension 1 as time,
      // and the narrative receives its fields in that same order — so a
      // computation whose resolved bindings point at the wells in the
      // opposite order must fail closed here instead of executing with the
      // fields swapped (issue #268). Checking every computation also rejects
      // multiple movers computations that bind inconsistent category/time
      // roles against the same two wells.
      if (categoryIndex !== 0 || timeIndex !== 1) insightFail('INSIGHT_FIELD_UNBOUND', 'movers category and time must bind the category dimension first and the time dimension second, in wells order');
      if (!dimensions[timeIndex]!.dateGranularity) insightFail('INSIGHT_TIME_REQUIRED', 'movers computations require a date/time dimension');
      return { kind, id, measure, type: c.type as 'TOP' | 'BOTTOM', size: Number(c.moverSize ?? 3), sortOrder: (c.sortOrder as 'PERCENT_DIFFERENCE' | 'ABSOLUTE_DIFFERENCE' | undefined) ?? 'PERCENT_DIFFERENCE' };
    }
    if (kind === 'anomaly') {
      if (!dimensions[0]!.dateGranularity) insightFail('INSIGHT_TIME_REQUIRED', 'anomaly computations require a date/time dimension');
      return { kind, id, measure, anomalyDetection: anomalyDetection(c.anomalyDetection) };
    }
    if (kind === 'forecast') {
      if (!dimensions[0]!.dateGranularity) insightFail('INSIGHT_TIME_REQUIRED', 'forecast computations require a date/time dimension');
      return { kind, id, measure, forecast: forecastProperties(c.forecastProperties) };
    }
    if (kind === 'periodToDate') {
      const grain = dimensions[0]!.dateGranularity;
      if (!grain) return insightFail('INSIGHT_TIME_REQUIRED', 'period computations require a date/time dimension');
      return { kind, id, measure, periodTimeGranularity: periodTimeGranularity(c.periodTimeGranularity) ?? grain };
    }
    if (kind === 'growthRate' || kind === 'periodOverPeriod') {
      if (!dimensions[0]!.dateGranularity) insightFail('INSIGHT_TIME_REQUIRED', 'period computations require a date/time dimension');
      if (c.periodSize !== undefined && c.periodSize !== 2) insightFail('INSIGHT_PERIOD_UNSUPPORTED', 'only the latest period versus previous period is supported (PeriodSize 2)');
    }
    if (kind === 'maximumMinimum' && c.type !== 'MAXIMUM' && c.type !== 'MINIMUM' || kind === 'topBottomRanked' && c.type !== 'TOP' && c.type !== 'BOTTOM') insightFail('INSIGHT_COMPUTATION_INVALID', 'invalid computation type');
    if (kind === 'topBottomRanked' && c.resultSize !== undefined && (!Number.isInteger(c.resultSize) || Number(c.resultSize) < 1 || Number(c.resultSize) > 20)) insightFail('INSIGHT_COMPUTATION_INVALID', 'ResultSize must be 1–20');
    const target = kind === 'metricComparison' ? binding(c.targetValue, measures, 1) : undefined;
    if (kind === 'metricComparison' && (measures.length !== 2 || target === measure)) insightFail('INSIGHT_VALUES_REQUIRED', 'metric comparison requires two distinct bound measures');
    return { kind, id, measure, ...(target !== undefined ? { target } : {}), ...(typeof c.type === 'string' ? { type: c.type } : {}), ...(kind === 'topBottomRanked' ? { size: Number(c.resultSize ?? 3) } : {}) };
  });
}

/**
 * Rebind imported computation fields when the author changes wells; preserve
 * other options. Invalid configurations are returned unchanged so callers such
 * as serializeVisual cannot hide their errors from downstream compilation.
 */
export function rebindInsight(config: Obj, category: unknown[], values: unknown[]): Obj {
  try {
  validateInsightConfiguration(config);
  const original = insightWells(config);
  const name = (raw: unknown) => Object.values(insightObject(raw))[0];
  const column = (raw: unknown) => insightObject(insightObject(name(raw)).column).columnName;
  return { ...config, ...(Array.isArray(config.computations) ? { computations: config.computations.map(raw => Object.fromEntries(Object.entries(insightObject(raw)).map(([kind, body]) => [kind, Object.fromEntries(Object.entries(insightObject(body)).map(([k, v]) => {
    if (k === 'category') return [k, category[0] ?? v];
    if (k === 'time') {
      // Movers bind a distinct time field inside the same wells list: keep it
      // matched by column (like values below), never collapsed to category[0].
      const idx = original.category.findIndex(f => column(f) === column(v));
      return [k, (idx > 0 ? category[idx] : category[0]) ?? v];
    }
    if (['value', 'fromValue', 'targetValue'].includes(k)) return [k, values[original.values.findIndex(f => column(f) === column(v))] ?? v];
    return [k, v];
  }))]))) } : {}) };
  } catch (error) { if (error instanceof InsightError) return config; throw error; }
}
