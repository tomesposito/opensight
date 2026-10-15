import type { BundleDataSet } from '@opensight/bundle-parser';
import type { ExecutionSettings, ExecutionStatus } from './api-client.js';
import { prepSchema, type PrepSourceSummary } from './data-prep.js';

export interface HostedPrepDataset { resource: BundleDataSet; version: number; execution: ExecutionSettings }
export type PrepDatasetsResponse =
  | { datasets: BundleDataSet[]; persistence: 'file' | 'ephemeral' }
  | { datasets: HostedPrepDataset[]; persistence: 'durable' };
export type PrepSaveResponse = { resource: BundleDataSet; persistence: 'file' | 'ephemeral' } | HostedPrepDataset;

/** Hosted execution is configuration only. Missing cache telemetry is never zero/ready. */
export function hostedExecution(settings: ExecutionSettings, version?: number): ExecutionStatus {
  return { ...settings, ...(version === undefined ? {} : { version }), state: settings.mode === 'DIRECT_QUERY' ? 'direct' : 'unknown',
    lastRefreshedAt: null, rowCount: null, bytes: null, nextRefreshAt: null, error: null };
}
export function prepResources(saved: PrepDatasetsResponse): BundleDataSet[] {
  return saved.persistence === 'durable' ? saved.datasets.map(entry => entry.resource) : saved.datasets;
}
/** Compile schema only, from the same admitted graph the hosted list endpoint validated.
 * Query/refresh still re-authorize and check cache readiness on the server. */
export function prepSources(saved: PrepDatasetsResponse, sources: PrepSourceSummary[]): PrepSourceSummary[] {
  if (saved.persistence !== 'durable') return sources;
  const datasets = prepResources(saved);
  const raw = sources.filter(source => !source.ref || typeof source.ref === 'string');
  return [...raw, ...saved.datasets.map(({ resource, execution, version }): PrepSourceSummary => {
    const base = { id: resource.dataSetId, ref: { dataset: resource.dataSetId }, name: resource.name, connectorId: 'file', execution: hostedExecution(execution, version) };
    try {
      if (!resource.opensightPrep) throw new Error('INVALID_PREP_PIPELINE');
      // Hosted prep stages all admitted leaves into its shared execution engine.
      const columns = prepSchema(resource.opensightPrep, raw.map(source => ({ ...source, connectorId: 'file' })), undefined, { datasets, datasetId: resource.dataSetId });
      return { ...base, columns, available: true };
    } catch (error) {
      const errorCode = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'PREP_SCHEMA_UNAVAILABLE';
      return { ...base, columns: [], available: false, errorCode };
    }
  })];
}
