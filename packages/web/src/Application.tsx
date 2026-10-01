import { DataPrep } from './DataPrep.js';
import { DataSources } from './DataSources.js';
import { UserManagement } from './UserManagement.js';
import { AISettings } from './AISettings.js';
import { Dashboard } from './Dashboard.js';
import { useAccess, allowed } from './access.js';
import { OrganizationNotice } from './OrganizationNotice.js';
import { useEffect, useState } from 'react';
import type { Fixture } from './model.js';
import type { AuthorDataset } from './authoring.js';
import { Author } from './Author.js';
import { SecurityNotice } from './SecurityNotice.js';
import { AutomationNotice } from './AutomationNotice.js';
import type { createApiClient } from './api-client.js';
import type { ResourceKind } from './api-client.js';
import { buildApiPreview } from './api-preview.js';
import { Analyses } from './Analyses.js';
import { AppLink, AppNavigation, useAppRoute } from './AppNavigation.js';
import { pages, routeProblem } from './app-navigation.js';
import { draftStorageKey } from './local-drafts.js';

export function Application(props: { api: ReturnType<typeof createApiClient>; fixtures: Fixture[] }) {
  const access = useAccess();
  return <ApplicationWorkspace key={draftStorageKey(access)} {...props} />;
}

function ApplicationWorkspace({ api, fixtures }: { api: ReturnType<typeof createApiClient>; fixtures: Fixture[] }) {
  const access = useAccess();
  const connected = access.mode === 'hosted' || access.mode === 'local';
  const { route, navigate, entry } = useAppRoute();
  const [uploadedSource, setUploadedSource] = useState<string>();
  const [authorDataset, setAuthorDataset] = useState<AuthorDataset>();
  const [fixtureId, setFixtureId] = useState(access.mode === 'demo' ? fixtures.find(f => f.id === 'renderable-sales')?.id ?? fixtures[0]?.id : fixtures[0]?.id);
  const fixture = fixtures.find(f => f.id === fixtureId);
  const sample = fixtures.find(f => f.id === 'renderable-sales');
  const mode = route?.page;
  const problem = mode && routeProblem(access, mode);
  useEffect(() => { if (typeof document !== 'undefined') document.title = `${route ? pages[route.page].title : 'Page not found'} · OpenSight`; }, [mode]);
  const content = () => {
    if (!route) return <section><h1>Page not found</h1><p>Choose a section above to continue.</p><AppLink to={{ page: 'home' }} navigate={navigate}>Go to Home</AppLink></section>;
    if (problem) return <p role="alert">{problem}</p>;
    switch (route.page) {
      case 'home': return sample ? <Dashboard key="sample" fixture={sample} sample /> : <p role="status">The sample dashboard is not included in this build. Ask the operator to restore the pinned sales sample.</p>;
      case 'analyses': return <Analyses navigate={navigate} />;
      case 'author': return <Author key={entry} inApp draftId={route.draftId} newAnalysis={route.newAnalysis} onDraftChange={draftId => navigate({ page: 'author', draftId }, true)} onSources={() => navigate({ page: 'data-sources' })} onDatasetChange={setAuthorDataset} dataset={route.draftId || route.newAnalysis ? undefined : authorDataset} onPrep={() => navigate({ page: 'data-prep' })} client={connected ? api : undefined} />;
      case 'data-prep': return <DataPrep initialSource={uploadedSource} onBuild={access.mode === 'local' ? dataset => { setAuthorDataset(dataset); navigate({ page: 'author' }); } : undefined} client={connected ? api : undefined} onSources={() => navigate({ page: 'data-sources' })} onAuthor={() => navigate({ page: 'author' })} />;
      case 'data-sources': return <DataSources local={access.mode === 'local'} onPrep={source => { setUploadedSource(source); navigate({ page: 'data-prep' }); }} client={connected ? api : undefined} />;
      case 'users': return <UserManagement client={api} />;
      case 'ai-settings': return <AISettings client={api} />;
      case 'organization': return <OrganizationNotice />;
      case 'security': return <SecurityNotice />;
      case 'automation': return <AutomationNotice />;
      case 'api': return <ApiExplorer key={fixtureId} example={fixture} api={api} fixtures={fixtures} />;
      case 'fixtures': return fixture ? <Dashboard key={fixture.id} fixture={fixture} /> : <p role="status">No definition examples are included in this build. Use API definition preview to load a definition from a hosted API.</p>;
    }
  };
  return <div className="app-shell">
    <AppNavigation route={route} navigate={navigate}>{!problem && (mode === 'fixtures' || mode === 'api') && <label className="fixture-picker">Definition example<select value={fixtureId} onChange={event => setFixtureId(event.target.value)}>{fixtures.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}</AppNavigation>
    {access.mode === 'local' && <aside className="fixture-demo-banner" aria-label="Local data workspace"><span><strong>Local workspace</strong> · Files stay in this API process · Uploads expire after 24 hours or restart</span></aside>}
    <main className={mode === 'author' ? 'author-main' : undefined}>{content()}</main>
    <footer className="app-footer">OpenSight · Local rendering preview · visual fidelity not measured</footer>
  </div>;
}

function ApiExplorer({ example, api, fixtures }: { example?: Fixture; api: ReturnType<typeof createApiClient>; fixtures: Fixture[] }) {
  const access = useAccess();
  const [kind, setKind] = useState<ResourceKind>(allowed(access, 'build') ? example?.apiResource?.kind ?? 'analysis' : 'dashboard');
  const [id, setId] = useState(example?.id ?? 'renderable-sales');
  const [request, setRequest] = useState({ kind, id });
  const [state, setState] = useState<{ request: typeof request; fixture?: Fixture; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const load = request.kind === 'analysis' ? api.getAnalysisDefinition : api.getDashboardDefinition;
    void load(request.id, controller.signal)
      .then(response => buildApiPreview(response, request.kind, fixtures))
      .then(fixture => { if (active) setState({ request, fixture }); })
      .catch((error: unknown) => { if (active) setState({ request, error: error instanceof Error ? error.message : String(error) }); });
    return () => { active = false; controller.abort(); };
  }, [request, api, fixtures]);
  const current = state?.request === request ? state : undefined;
  return <>
    <form className="api-picker" onSubmit={event => { event.preventDefault(); setRequest({ kind, id: id.trim() }); }}>
      <label>Resource<select value={kind} onChange={event => setKind(event.target.value === 'dashboard' ? 'dashboard' : 'analysis')}>{allowed(access, 'build') && <option value="analysis">Analysis</option>}<option value="dashboard">Dashboard</option></select></label>
      <label className="resource-id">Resource ID<input value={id} onChange={event => setId(event.target.value)} required pattern={'[A-Za-z0-9_\\-]{1,512}'} /></label>
      <button type="submit">Load definition</button>
    </form>
    <p className="fixture-notice">Dashboard charts use fixed, precomputed fixture results. O answer previews query the hosted API with your data permissions.</p>
    {!current && <p role="status">Loading definition…</p>}
    {current?.error && <div className="visual-error" role="alert"><strong>Unable to load definition</strong><p>{current.error}</p><p>Check that the API is running, then use Load definition to retry.</p></div>}
    {current?.fixture && <Dashboard key={`${request.kind}/${request.id}`} fixture={current.fixture} hosted client={api} dashboardId={request.kind === 'dashboard' ? request.id : undefined} />}
  </>;
}
