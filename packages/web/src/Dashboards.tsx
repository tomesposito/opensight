import { useEffect, useState } from 'react';
import { allowed, useAccess } from './access.js';
import type { createApiClient } from './api-client.js';
import type { DashboardSummary } from './published-dashboard.js';
import { AppLink, type Navigate } from './AppNavigation.js';
import { CollectionPage } from './CollectionPage.js';
import { EmptyPageState } from './LocalEmptyState.js';

export function Dashboards({ navigate, client }: { navigate: Navigate; client?: Pick<ReturnType<typeof createApiClient>, 'listDashboards'> }) {
  const access = useAccess();
  if (access.mode === 'hosted') return <HostedDashboards navigate={navigate} client={client} />;
  return <CollectionPage title="Dashboards" introduction="Bring your analysis together" description="Start with an analysis to explore your data. Publishing dashboards needs a hosted API.">
    <EmptyPageState guidance="Build an analysis to get started."><AppLink className="primary-button" to={{ page: 'analyses' }} navigate={navigate}>My analyses</AppLink></EmptyPageState>
    <p className="collection-note">Publishing dashboards needs a hosted API.</p>
  </CollectionPage>;
}

export function HostedDashboards({ navigate, client, home = false }: { navigate: Navigate; client?: Pick<ReturnType<typeof createApiClient>, 'listDashboards'>; home?: boolean }) {
  const access = useAccess(), [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ items?: DashboardSummary[]; error?: string }>();
  useEffect(() => {
    const abort = new AbortController(); setState(undefined);
    if (!client?.listDashboards) { setState({ error: 'HOSTED_API_REQUIRED: Dashboard collection is unavailable.' }); return; }
    void client.listDashboards(abort.signal).then(items => { if (!abort.signal.aborted) setState({ items }); })
      .catch((error: unknown) => { if (!abort.signal.aborted) setState({ error: error instanceof Error ? error.message : String(error) }); });
    return () => abort.abort();
  }, [client, attempt]);
  return <CollectionPage title={home ? 'Home' : 'Dashboards'} introduction="Published dashboards" description="Open a dashboard available to you in this workspace.">
    {!state && <p role="status">Loading dashboards…</p>}
    {state?.error && <p role="alert">{state.error}</p>}
    {state?.items?.length === 0 && <EmptyPageState guidance="No published dashboards are available to you yet.">{allowed(access, 'build') ? <AppLink className="primary-button" to={{ page: 'analyses' }} navigate={navigate}>Create an analysis</AppLink> : <p>Ask your workspace administrator for dashboard access.</p>}</EmptyPageState>}
    {!!state?.items?.length && <ul className="dashboard-collection">{state.items.map(item => <li key={item.id}><AppLink to={{ page: 'dashboards', dashboardId: item.id }} navigate={navigate}>{item.name}</AppLink><span> · Version {item.version}</span></li>)}</ul>}
    <button type="button" onClick={() => setAttempt(value => value + 1)}>Refresh dashboards</button>
  </CollectionPage>;
}
