/** Stable dataset-bound references. Definitions are supplied by the trusted asset store. */
export const METRIC_PREFIX = '__metric_';
export const metricColumn = (id: string): string => `${METRIC_PREFIX}${id}`;
export const metricId = (column: string): string | undefined => column.startsWith(METRIC_PREFIX) ? column.slice(METRIC_PREFIX.length) : undefined;
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
export interface MetricResolution { metrics: readonly PublishedMetric[]; unsafeJoin?: boolean }
/** Apply the governed aggregation once, using the existing expression semantics. */
export function metricExpression(metric: PublishedMetric): string {
  const level = parseExpression(metric.expression, '$.metric.expression', { validationOnly: true }).level;
  return ['aggregate', 'table'].includes(level) ? metric.expression : `${metric.defaultAggregation.toLowerCase()}(${metric.expression})`;
}
function selectMetrics(names: readonly string[], resolution: MetricResolution): PublishedMetric[] {
  const ids = [...new Set(names.flatMap(n => metricId(n) === undefined ? [] : [metricId(n)!]))];
  if (ids.length && resolution.unsafeJoin) fail('METRIC_UNSAFE_FANOUT', '$.metrics', 'Governed metrics require a dataset without unproven join fan-out.');
  return ids.map(id => resolution.metrics.find(m => m.id === id) ?? fail('METRIC_NOT_PUBLISHED', '$.metrics', `Metric ${id} is not published on this dataset.`));
}
const dependencies = (expression: string) => parseExpression(expression, '$.calculatedFields.expression', { validationOnly: true }).dependencies;
export function queryUsesMetrics(query: InteractiveQuery): boolean {
  return [...query.dimensions, ...query.measures, ...query.filters].some(f => metricId(f.columnName) !== undefined) || (query.calculatedFields ?? []).some(c => metricId(c.name) !== undefined || dependencies(c.expression).some(n => metricId(n) !== undefined));
}
/** Call only at the trusted boundary, before normal planning and RLS/CLS admission. */
export function resolveMetricQuery(query: InteractiveQuery, resolution: MetricResolution): InteractiveQuery {
  if ((query.calculatedFields ?? []).some(c => metricId(c.name) !== undefined)) fail('METRIC_OVERRIDE_FORBIDDEN', '$.calculatedFields', 'Metric expressions come from the governed asset store.');
  const selected = selectMetrics([...query.dimensions, ...query.measures, ...query.filters].map(f => f.columnName).concat((query.calculatedFields ?? []).flatMap(c => dependencies(c.expression))), resolution);
  if (!selected.length) return query;
  if (query.dimensions.some(d => metricId(d.columnName) !== undefined)) fail('METRIC_ROLE_INVALID', '$.dimensions', 'A governed metric belongs in a measure well.');
  return { ...query, measures: query.measures.map(m => ({ ...m, aggregation: selected.find(s => metricColumn(s.id) === m.columnName)?.defaultAggregation ?? m.aggregation })),
    calculatedFields: [...query.calculatedFields ?? [], ...selected.map(m => ({ name: metricColumn(m.id), expression: metricExpression(m) }))] };
}
/** Wire definitions keep stable references; resolved expressions never overwrite saved assets. */
export function resolveMetricDefinition(raw: Record<string, unknown>, datasets: ReadonlyMap<string, MetricResolution>): Record<string, unknown> {
  const definition = structuredClone(raw);
  const calculations = (definition.CalculatedFields ?? []) as { Name: string; Expression: string; DataSetIdentifier: string }[];
  if (calculations.some(c => metricId(c.Name) !== undefined)) fail('METRIC_OVERRIDE_FORBIDDEN', '$.CalculatedFields', 'Metric expressions come from the governed asset store.');
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
  const injected = [...names].flatMap(([dataset, columns]) => selectMetrics(columns, datasets.get(dataset) ?? { metrics: [] }).map(m => ({ Name: metricColumn(m.id), Expression: metricExpression(m), DataSetIdentifier: dataset })));
  if (injected.length) definition.CalculatedFields = [...calculations, ...injected];
  return definition;
}
