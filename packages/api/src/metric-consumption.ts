import { resolveMetricDefinition, resolveMetricQuery, queryUsesMetrics, type MetricDataset, type InteractiveQuery, type PublishedMetric, type MetricResolution } from '@opensight/query-engine';
import type { AssetBackend } from './asset-model.js';
import { MetricCatalog } from './metric-model.js';
export type MetricLookup = (ref: MetricDataset) => Promise<MetricResolution>;
export const lookupMetrics = (backend: AssetBackend): MetricLookup => ref => backend.transaction(false, c => new MetricCatalog(c).execution(ref));
export async function metricQuery(query: InteractiveQuery, ref: MetricDataset, lookup: MetricLookup, resolved?: (metrics: readonly PublishedMetric[]) => void) {
  if (!queryUsesMetrics(query)) return query;
  const resolution = await lookup(ref); const result = resolveMetricQuery(query, resolution); resolved?.(resolution.metrics); return result;
}
export async function metricDefinition(definition: Record<string, unknown>, bindings: Record<string, MetricDataset>, lookup: MetricLookup, resolved?: (metrics: readonly PublishedMetric[]) => void) {
  // Resolve only definitions that contain a reserved reference. No extra data admission for ordinary visuals.
  if (!JSON.stringify(definition).includes('__metric_')) return definition;
  const resolutions = await Promise.all(Object.entries(bindings).map(async ([id, ref]) => [id, await lookup(ref)] as const));
  const result = resolveMetricDefinition(definition, new Map(resolutions)); resolved?.(resolutions.flatMap(([, r]) => [...r.metrics])); return result;
}

/** Compile Ask O's closed-vocabulary query against the dashboard's one durable binding. */
export function dashboardQuestion(query: InteractiveQuery, version: import('./dashboard-model.js').DashboardVersion): Record<string, unknown> {
  const declarations = version.definition.dataSetIdentifierDeclarations;
  if (declarations.length !== 1) throw new Error('DASHBOARD_DATASET_UNSUPPORTED');
  const d = declarations[0]!;
  const definition = (interactiveRequest(query, { dataSet: { DataSet: { Arn: d.dataSetArn } }, dataSource: {}, localData: {} }).analysis as { Definition: Record<string, unknown> }).Definition;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const o = value as Record<string, unknown>;
    if (o.DataSetIdentifier === 'sales_data') o.DataSetIdentifier = d.identifier;
    if (o.Identifier === 'sales_data') o.Identifier = d.identifier;
    Object.values(o).forEach(visit);
  };
  visit(definition); return definition;
}
import { interactiveRequest } from '@opensight/query-engine';
