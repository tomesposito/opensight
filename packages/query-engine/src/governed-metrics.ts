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
