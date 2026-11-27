import { useEffect, useState } from 'react';
import { OEntry } from './OEntry.js';
import { emptyDraft, type AuthorDataset } from './authoring.js';
import type { createApiClient } from './api-client.js';
import { allowed, useAccess } from './access.js';
import type { DashboardSummary, PublishedDashboard } from './published-dashboard.js';
import { publishedQuestionDraft } from './published-question.js';

/** The app's existing Ask O surface, with an explicit hosted dataset selection. */
export function AskOPage({ client }: { client: ReturnType<typeof createApiClient> }) {
  const canBuild = allowed(useAccess(), 'build');
  const [datasets, setDatasets] = useState<AuthorDataset[]>([]), [selected, setSelected] = useState(''), [error, setError] = useState<string>();
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]), [dashboardId, setDashboardId] = useState('');
  const [dashboard, setDashboard] = useState<PublishedDashboard>();
  useEffect(() => {
    let active = true;
    if (canBuild) void client.listPrepSources().then(sources => {
      if (active) setDatasets(sources.flatMap(source => typeof source.ref === 'object' && 'dataset' in source.ref && source.available
        ? [{ id: source.ref.dataset, name: source.name ?? source.id, columns: source.columns }] : []));
    }).catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : 'DATASET_UNAVAILABLE'); });
    void client.listDashboards().then(value => { if (active) setDashboards(value); })
      .catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : 'RESOURCE_NOT_FOUND'); });
    return () => { active = false; };
  }, [client, canBuild]);
  useEffect(() => {
    const abort = new AbortController(); setDashboard(undefined);
    if (dashboardId) void client.getPublishedDashboard(dashboardId, abort.signal).then(value => { if (!abort.signal.aborted) setDashboard(value); })
      .catch((error: unknown) => { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : 'RESOURCE_NOT_FOUND'); });
    return () => abort.abort();
  }, [client, dashboardId]);
  const dataset = datasets.find(d => d.id === selected);
  const question = dashboard && dashboard.id === dashboardId ? publishedQuestionDraft(dashboard) : undefined;
  return <section className="data-page"><h1>Ask O</h1>{error && <p role="alert">{error}</p>}
    <label>Dashboard<select value={dashboardId} onChange={e => { setDashboardId(e.target.value); setSelected(''); setError(undefined); }}><option value="">Select a dashboard</option>{dashboards.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    {canBuild && <label>Dataset<select value={selected} onChange={e => { setSelected(e.target.value); setDashboardId(''); setError(undefined); }}><option value="">Select a dataset</option>{datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
    {dataset && <OEntry key={dataset.id} draft={{ ...emptyDraft(), dataset }} client={{ ...client, dataset }} />}
    {question && <OEntry key={dashboardId} draft={question} dashboardId={dashboardId} client={{ dataset: question.dataset, queryO: client.queryO,
      queryDataset: () => Promise.reject(new Error('DASHBOARD_QUERY_REQUIRED: Reader questions must use the dashboard-scoped O endpoint.')) }} />}
  </section>;
}
