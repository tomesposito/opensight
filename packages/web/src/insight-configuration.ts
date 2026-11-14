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
const variants = ['totalAggregation', 'maximumMinimum', 'topBottomRanked', 'growthRate', 'periodOverPeriod', 'metricComparison', 'forecast', 'periodToDate', 'uniqueValues'] as const;
type Kind = typeof variants[number];
export type InsightRequest = { id: string; measure: number } & (
  { kind: Exclude<Kind, 'forecast' | 'periodToDate' | 'uniqueValues'>; target?: number; type?: string; size?: number }
  | { kind: 'forecast'; forecast: ForecastConfig }
  | { kind: 'periodToDate'; periodTimeGranularity: NonNullable<Field['dateGranularity']> }
  | { kind: 'uniqueValues' }
);

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

function computations(config: unknown): [Kind, Obj][] | undefined {
  const c = insightObject(config);
  if (Object.hasOwn(c, 'customNarrative')) insightFail('INSIGHT_CUSTOM_NARRATIVE_UNSUPPORTED', 'custom narrative templates and placeholders are not supported');
  allowed(c, ['computations']);
  if (c.computations === undefined) return;
  if (!Array.isArray(c.computations) || !c.computations.length || c.computations.length > 100) insightFail('INSIGHT_COMPUTATION_INVALID', 'expected 1–100 computations');
  return (c.computations as unknown[]).map(raw => {
    const entries = Object.entries(insightObject(raw));
    if (entries.length !== 1) return insightFail('INSIGHT_COMPUTATION_INVALID', 'expected exactly one computation variant');
    const [kind, value] = entries[0]!;
    if (/anomaly/i.test(kind)) insightFail('INSIGHT_ANOMALY_UNSUPPORTED', 'anomaly computations are not supported');
    if (!variants.includes(kind as Kind)) insightFail('INSIGHT_COMPUTATION_UNSUPPORTED', `unsupported computation ${kind}`);
    if (kind === 'forecast' && (!value || typeof value !== 'object' || Array.isArray(value))) insightFail('INSIGHT_COMPUTATION_INVALID', 'forecast must be an object');
    if (kind === 'periodToDate' && (!value || typeof value !== 'object' || Array.isArray(value))) insightFail('INSIGHT_COMPUTATION_INVALID', 'periodToDate must be an object');
    if (kind === 'uniqueValues' && (!value || typeof value !== 'object' || Array.isArray(value))) insightFail('INSIGHT_COMPUTATION_INVALID', 'uniqueValues must be an object');
    const body = insightObject(value);
    if (typeof body.computationId !== 'string' || !/^[\w-]{1,512}$/.test(body.computationId)) insightFail('INSIGHT_COMPUTATION_INVALID', 'a computationId is required');
    if (body.name !== undefined && typeof body.name !== 'string') insightFail('INSIGHT_COMPUTATION_INVALID', 'name must be a string');
    const specific = kind === 'totalAggregation' ? ['value'] : kind === 'maximumMinimum' ? ['time', 'value', 'type']
      : kind === 'topBottomRanked' ? ['category', 'value', 'type', 'resultSize'] : kind === 'metricComparison' ? ['time', 'fromValue', 'targetValue']
      : kind === 'growthRate' ? ['time', 'value', 'periodSize'] : kind === 'forecast' ? ['time', 'value', 'forecastProperties']
      : kind === 'periodToDate' ? ['time', 'value', 'periodTimeGranularity'] : kind === 'uniqueValues' ? ['category'] : ['time', 'value'];
    allowed(body, ['computationId', 'name', ...specific]);
    if (kind === 'forecast') forecastProperties(body.forecastProperties);
    if (kind === 'periodToDate') periodTimeGranularity(body.periodTimeGranularity);
    return [kind as Kind, body];
  });
}

/** Native API insight computations own their fields. OpenSight wells are a projection. */
export function insightWells(config: unknown): { category: unknown[]; values: unknown[] } {
  const entries = computations(config) ?? [];
  const collect = (keys: string[]): unknown[] => {
    const fields = entries.flatMap(([, c]) => keys.flatMap(k => c[k] === undefined ? [] : [c[k]]));
    return [...new Map(fields.map(f => [JSON.stringify(f), f])).values()];
  };
  return { category: collect(['category', 'time']), values: collect(['value', 'fromValue', 'targetValue']) };
}
export function projectInsightBody(body: Obj): Obj {
  if (body.insightConfiguration !== undefined) computations(body.insightConfiguration);
  if (body.chartConfiguration !== undefined) return body;
  return { ...body, chartConfiguration: { fieldWells: { insightAggregatedFieldWells: insightWells(body.insightConfiguration ?? {}) } } };
}

/** True when every configured computation is uniqueValues — the only variant that binds no measure. */
export function uniqueValuesOnly(config: unknown): boolean {
  const entries = computations(config);
  return !!entries?.length && entries.every(([kind]) => kind === 'uniqueValues');
}

export function normalizeInsight(config: unknown, dimensions: Field[], measures: Field[]): InsightRequest[] {
  const entries = computations(config);
  if (dimensions.length !== 1) insightFail('INSIGHT_CATEGORY_REQUIRED', 'expected exactly one Category dimension');
  if (measures.length > 2 || (measures.length < 1 && !(entries?.length && entries.every(([kind]) => kind === 'uniqueValues')))) insightFail('INSIGHT_VALUES_REQUIRED', 'expected one Values measure, or two for comparison');
  if (!entries) return [
    { kind: 'totalAggregation', id: 'total', measure: 0 },
    { kind: 'maximumMinimum', id: 'maximum', type: 'MAXIMUM', measure: 0 },
    { kind: 'maximumMinimum', id: 'minimum', type: 'MINIMUM', measure: 0 },
    ...(dimensions[0]!.dateGranularity ? [{ kind: 'periodOverPeriod' as const, id: 'period', measure: 0 }] : []),
    ...(measures.length === 2 ? [{ kind: 'metricComparison' as const, id: 'comparison', measure: 0, target: 1 }] : []),
  ];
  const ids = new Set<string>();
  const binding = (raw: unknown, fields: Field[], fallback: number): number => {
    if (raw === undefined) return fallback;
    const wrapper = insightObject(raw), pairs = Object.entries(wrapper);
    if (pairs.length !== 1) return insightFail('INSIGHT_FIELD_UNBOUND', 'expected one field variant');
    const [variant, value] = pairs[0]!, f = insightObject(value), column = insightObject(f.column);
    const measure = fields === measures;
    const expected = measure ? ['numericalMeasureField'] : ['categoricalDimensionField', 'numericalDimensionField', 'dateDimensionField'];
    if (!expected.includes(variant)) insightFail('INSIGHT_FIELD_UNBOUND', `unsupported field ${variant}`);
    allowed(f, ['fieldId', 'column', ...(measure ? ['aggregationFunction'] : variant === 'dateDimensionField' ? ['dateGranularity'] : [])]);
    allowed(column, ['columnName', 'dataSetIdentifier']);
    if (measure) {
      const agg = insightObject(f.aggregationFunction); allowed(agg, ['simpleNumericalAggregation']);
      if (agg.simpleNumericalAggregation !== 'SUM') insightFail('INSIGHT_FIELD_UNBOUND', 'only explicit SUM bindings are supported');
    }
    const index = fields.findIndex(field => (variant === 'dateDimensionField') === !!field.dateGranularity && field.id === f.fieldId && field.column === column.columnName && field.dataSet === column.dataSetIdentifier
      && (variant !== 'dateDimensionField' || field.dateGranularity === (f.dateGranularity ?? 'DAY')));
    if (index < 0) insightFail('INSIGHT_FIELD_UNBOUND', 'computation references an unbound or conflicting field');
    return index;
  };
  return entries.map(([kind, c]) => {
    const id = c.computationId as string;
    if (ids.has(id)) insightFail('INSIGHT_COMPUTATION_INVALID', 'duplicate computation IDs'); ids.add(id);
    binding(c.category ?? c.time, dimensions, 0);
    if (kind === 'uniqueValues') return { kind, id, measure: 0 };
    const measure = binding(kind === 'metricComparison' ? c.fromValue : c.value, measures, 0);
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

/** Rebind imported computation fields when the author changes wells; preserve other options. */
export function rebindInsight(config: Obj, category: unknown[], values: unknown[]): Obj {
  try {
  const original = insightWells(config);
  const name = (raw: unknown) => Object.values(insightObject(raw))[0];
  const column = (raw: unknown) => insightObject(insightObject(name(raw)).column).columnName;
  return { ...config, ...(Array.isArray(config.computations) ? { computations: config.computations.map(raw => Object.fromEntries(Object.entries(insightObject(raw)).map(([kind, body]) => [kind, Object.fromEntries(Object.entries(insightObject(body)).map(([k, v]) => {
    if (k === 'time' || k === 'category') return [k, category[0] ?? v];
    if (['value', 'fromValue', 'targetValue'].includes(k)) return [k, values[original.values.findIndex(f => column(f) === column(v))] ?? v];
    return [k, v];
  }))]))) } : {}) };
  } catch (error) { if (error instanceof InsightError) return config; throw error; }
}
