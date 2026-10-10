import { useEffect, useState } from 'react';
import type { BundleDataSet } from '@opensight/bundle-parser';
import type { createApiClient } from './api-client.js';
import { prepMessage, type PrepSourceSummary } from './data-prep.js';

export type DataCatalogClient = Pick<ReturnType<typeof createApiClient>, 'listPrepDatasets' | 'listPrepSources'>;
export interface DataCatalog { datasets: BundleDataSet[]; sources: PrepSourceSummary[] }
/** Discard old catalogs immediately when the client or revision changes. */
export function useDataCatalog(client?: DataCatalogClient) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ client: DataCatalogClient; revision: number; data?: DataCatalog; error?: string }>();
  useEffect(() => {
    if (!client) return;
    let active = true;
    void Promise.all([client.listPrepDatasets(), client.listPrepSources()]).then(([saved, sources]) => {
      if (active) setResult({ client, revision, data: { datasets: saved.datasets, sources } });
    }).catch((error: unknown) => { if (active) setResult({ client, revision, error: prepMessage(error) }); });
    return () => { active = false; };
  }, [client, revision]);
  const current = result?.client === client && result?.revision === revision ? result : undefined;
  return { data: current?.data, error: current?.error, loading: !!client && !current, reload: () => setRevision(value => value + 1) };
}
export function datasetSource(dataset: BundleDataSet, sources: readonly PrepSourceSummary[]) {
  return sources.find(source => typeof source.ref === 'object' && 'dataset' in source.ref && source.ref.dataset === dataset.dataSetId);
}
export function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
export function datasetBadges(dataset: BundleDataSet, source?: PrepSourceSummary): string[] {
  const rls = objectValue(dataset.rowLevelPermissionDataSet);
  return [
    ...(source?.execution?.mode === 'BLAZE' ? ['BLAZE · Cached'] : []),
    ...(rls && rls.status !== 'DISABLED' ? ['RLS enabled'] : []),
    ...(dataset.useAs === 'RLS_RULES' ? ['Rules dataset'] : []),
  ];
}
export const rawSources = (sources: readonly PrepSourceSummary[]) => sources.filter(source => !source.ref || typeof source.ref === 'string');
export type DatasetFilter = 'all' | 'mine' | 'cached' | 'direct' | 'rls' | 'rules';
export function filterDatasets(data: DataCatalog, search: string, filter: DatasetFilter, owned: boolean) {
  return data.datasets.filter(dataset => {
    if (!dataset.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    const source = datasetSource(dataset, data.sources), badges = datasetBadges(dataset, source);
    return filter === 'all' || (filter === 'mine' && owned) || (filter === 'cached' && source?.execution?.mode === 'BLAZE')
      || (filter === 'direct' && source?.execution?.mode === 'DIRECT_QUERY') || (filter === 'rls' && badges.includes('RLS enabled')) || (filter === 'rules' && badges.includes('Rules dataset'));
  });
}
