/** Stable dataset-bound references. Definitions are supplied by the trusted asset store. */
export const METRIC_PREFIX = '__metric_';
export const metricColumn = (id: string): string => `${METRIC_PREFIX}${id}`;
export function parseMetricReference(column: string): { id: string; version?: number } | undefined {
  if (!column.startsWith(METRIC_PREFIX)) return undefined;
  const reference = column.slice(METRIC_PREFIX.length), pin = /^(.*)@v([0-9]+)$/.exec(reference);
  return pin ? { id: pin[1]!, version: Number(pin[2]) } : { id: reference };
}
export const metricId = (column: string): string | undefined => parseMetricReference(column)?.id;
export type MetricAggregation = 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX' | 'DISTINCT_COUNT';
export interface MetricFormat { style: 'number' | 'percent' | 'currency'; decimalPlaces: number; currency?: string }
export interface MetricDefinition {
  name: string; expression: string; defaultAggregation: MetricAggregation;
  format: MetricFormat; description: string; synonyms: string[];
}
export interface PublishedMetric extends MetricDefinition { id: string; version: number }
export interface MetricDataset { kind: 'dataset' | 'prepared-dataset'; id: string; ownerId?: string }

import { parseExpression } from './expressions.js';
import type { InteractiveQuery } from './interactive.js';
import { fail } from './validation.js';
export interface MetricResolution {
  metrics: readonly PublishedMetric[];
  /** Only published-state records, including historical publications. Never drafts. */
  versions?: readonly PublishedMetric[];
  unsafeJoin?: boolean;
}
type ResolvedMetrics = (metrics: readonly PublishedMetric[]) => void;
/** Apply the governed aggregation once, using the existing expression semantics. */
export function metricExpression(metric: PublishedMetric): string {
  const level = parseExpression(metric.expression, '$.metric.expression', { validationOnly: true }).level;
  return ['aggregate', 'table'].includes(level) ? metric.expression : `${metric.defaultAggregation.toLowerCase()}(${metric.expression})`;
}
/** Proven operation for combining already-grouped results at a coarser grain. */
export function metricCombination(metric: PublishedMetric): 'SUM' | 'MIN' | 'MAX' | 'NONE' {
  try {
    const expression = parseExpression(metric.expression, '$.metric.expression', { validationOnly: true });
    if (expression.level === 'aggregate' || expression.level === 'table') {
      // A wrapper, nested aggregate or window calculation needs source data to
      // establish its coarser-grain value, regardless of the binding's enum.
      if (expression.kind !== 'call' || !expression.args.every(arg => arg.level === 'row')) return 'NONE';
      switch (expression.name) {
        case 'sum': case 'count': return 'SUM';
        case 'min': return 'MIN';
        case 'max': return 'MAX';
        default: return 'NONE';
      }
    }
    switch (metric.defaultAggregation) {
      case 'SUM': case 'COUNT': return 'SUM';
      case 'MIN': return 'MIN';
      case 'MAX': return 'MAX';
      default: return 'NONE';
    }
  } catch {
    return 'NONE';
  }
}
function selectMetrics(names: readonly string[], resolution: MetricResolution): { columnName: string; metric: PublishedMetric }[] {
  const references = [...new Set(names)].flatMap(columnName => {
    const reference = parseMetricReference(columnName);
    return reference ? [{ columnName, ...reference }] : [];
  });
  if (references.length && resolution.unsafeJoin) fail('METRIC_UNSAFE_FANOUT', '$.metrics', 'Governed metrics require a dataset without unproven join fan-out.');
  return references.map(({ columnName, id, version }) => {
    const current = resolution.metrics.find(m => m.id === id) ?? fail('METRIC_NOT_PUBLISHED', '$.metrics', `Metric ${id} is not published on this dataset.`);
    const metric = version === undefined ? current : Number.isSafeInteger(version) && version > 0
      ? (resolution.versions ?? resolution.metrics).find(m => m.id === id && m.version === version) : undefined;
    return { columnName, metric: metric ?? fail('METRIC_VERSION_NOT_PUBLISHED', '$.metrics', `Metric ${id} version ${version} is not published on this dataset.`) };
  });
}
const dependencies = (expression: string) => parseExpression(expression, '$.calculatedFields.expression', { validationOnly: true }).dependencies;
export function queryUsesMetrics(query: InteractiveQuery): boolean {
  return [...query.dimensions, ...query.measures, ...query.filters].some(f => parseMetricReference(f.columnName) !== undefined) || (query.calculatedFields ?? []).some(c => parseMetricReference(c.name) !== undefined || dependencies(c.expression).some(n => parseMetricReference(n) !== undefined));
}
/** Call only at the trusted boundary, before normal planning and RLS/CLS admission. */
export function resolveMetricQuery(query: InteractiveQuery, resolution: MetricResolution, resolved?: ResolvedMetrics): InteractiveQuery {
  if ((query.calculatedFields ?? []).some(c => parseMetricReference(c.name) !== undefined)) fail('METRIC_OVERRIDE_FORBIDDEN', '$.calculatedFields', 'Metric expressions come from the governed asset store.');
  const selected = selectMetrics([...query.dimensions, ...query.measures, ...query.filters].map(f => f.columnName).concat((query.calculatedFields ?? []).flatMap(c => dependencies(c.expression))), resolution);
  if (query.dimensions.some(d => parseMetricReference(d.columnName) !== undefined)) fail('METRIC_ROLE_INVALID', '$.dimensions', 'A governed metric belongs in a measure well.');
  resolved?.(selected.map(s => s.metric));
  if (!selected.length) return query;
  return { ...query, measures: query.measures.map(m => ({ ...m, aggregation: selected.find(s => s.columnName === m.columnName)?.metric.defaultAggregation ?? m.aggregation })),
    calculatedFields: [...query.calculatedFields ?? [], ...selected.map(({ columnName, metric }) => ({ name: columnName, expression: metricExpression(metric) }))] };
}
/** Wire definitions keep stable references; resolved expressions never overwrite saved assets. */
export function resolveMetricDefinition(raw: Record<string, unknown>, datasets: ReadonlyMap<string, MetricResolution>, resolved?: ResolvedMetrics): Record<string, unknown> {
  const definition = structuredClone(raw);
  const calculations = (definition.CalculatedFields ?? []) as { Name: string; Expression: string; DataSetIdentifier: string }[];
  if (calculations.some(c => parseMetricReference(c.Name) !== undefined)) fail('METRIC_OVERRIDE_FORBIDDEN', '$.CalculatedFields', 'Metric expressions come from the governed asset store.');
  const names = new Map<string, string[]>();
  const add = (dataset: string, column: string) => names.set(dataset, [...names.get(dataset) ?? [], column]);
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const obj = value as Record<string, unknown>;
    if (typeof obj.ColumnName === 'string' && typeof obj.DataSetIdentifier === 'string') add(obj.DataSetIdentifier, obj.ColumnName);
    for (const child of Object.values(obj)) walk(child);
  };
  walk(definition.Sheets); walk(definition.FilterGroups);
  for (const c of calculations) for (const name of dependencies(c.Expression)) add(c.DataSetIdentifier, name);
  const selected = [...names].flatMap(([dataset, columns]) => selectMetrics(columns, datasets.get(dataset) ?? { metrics: [] }).map(s => ({ ...s, dataset })));
  const injected = selected.map(({ columnName, metric, dataset }) => ({ Name: columnName, Expression: metricExpression(metric), DataSetIdentifier: dataset }));
  if (injected.length) definition.CalculatedFields = [...calculations, ...injected];
  resolved?.(selected.map(s => s.metric));
  return definition;
}
