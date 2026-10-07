import type { Field } from './model.js';

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
const variants = ['totalAggregation', 'maximumMinimum', 'topBottomRanked', 'growthRate', 'periodOverPeriod', 'metricComparison'] as const;
type Kind = typeof variants[number];
export interface InsightRequest { kind: Kind; id: string; measure: number; target?: number; type?: string; size?: number }

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
    if (/^forecast(?:Computation)?$/i.test(kind)) insightFail('INSIGHT_FORECAST_UNSUPPORTED', 'forecast computations are not supported');
    if (/anomaly/i.test(kind)) insightFail('INSIGHT_ANOMALY_UNSUPPORTED', 'anomaly computations are not supported');
    if (!variants.includes(kind as Kind)) insightFail('INSIGHT_COMPUTATION_UNSUPPORTED', `unsupported computation ${kind}`);
    const body = insightObject(value);
    if (typeof body.computationId !== 'string' || !/^[\w-]{1,512}$/.test(body.computationId)) insightFail('INSIGHT_COMPUTATION_INVALID', 'a computationId is required');
    if (body.name !== undefined && typeof body.name !== 'string') insightFail('INSIGHT_COMPUTATION_INVALID', 'name must be a string');
    const specific = kind === 'totalAggregation' ? ['value'] : kind === 'maximumMinimum' ? ['time', 'value', 'type']
      : kind === 'topBottomRanked' ? ['category', 'value', 'type', 'resultSize'] : kind === 'metricComparison' ? ['time', 'fromValue', 'targetValue']
      : kind === 'growthRate' ? ['time', 'value', 'periodSize'] : ['time', 'value'];
    allowed(body, ['computationId', 'name', ...specific]);
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

export function normalizeInsight(config: unknown, dimensions: Field[], measures: Field[]): InsightRequest[] {
  const entries = computations(config);
  if (dimensions.length !== 1) insightFail('INSIGHT_CATEGORY_REQUIRED', 'expected exactly one Category dimension');
  if (measures.length < 1 || measures.length > 2) insightFail('INSIGHT_VALUES_REQUIRED', 'expected one Values measure, or two for comparison');
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
    const index = fields.findIndex(field => field.id === f.fieldId && field.column === column.columnName && field.dataSet === column.dataSetIdentifier
      && (variant !== 'dateDimensionField' || field.dateGranularity === (f.dateGranularity ?? 'DAY')));
    if (index < 0) insightFail('INSIGHT_FIELD_UNBOUND', 'computation references an unbound or conflicting field');
    return index;
  };
  return entries.map(([kind, c]) => {
    const id = c.computationId as string;
    if (ids.has(id)) insightFail('INSIGHT_COMPUTATION_INVALID', 'duplicate computation IDs'); ids.add(id);
    binding(c.category ?? c.time, dimensions, 0);
    const measure = binding(kind === 'metricComparison' ? c.fromValue : c.value, measures, 0);
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
  const original = insightWells(config);
  const name = (raw: unknown) => Object.values(insightObject(raw))[0];
  const column = (raw: unknown) => insightObject(insightObject(name(raw)).column).columnName;
  return { ...config, ...(Array.isArray(config.computations) ? { computations: config.computations.map(raw => Object.fromEntries(Object.entries(insightObject(raw)).map(([kind, body]) => [kind, Object.fromEntries(Object.entries(insightObject(body)).map(([k, v]) => {
    if (k === 'time' || k === 'category') return [k, category[0] ?? v];
    if (['value', 'fromValue', 'targetValue'].includes(k)) return [k, values[original.values.findIndex(f => column(f) === column(v))] ?? v];
    return [k, v];
  }))]))) } : {}) };
}
