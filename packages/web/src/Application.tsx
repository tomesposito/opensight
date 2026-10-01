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

export function Application({ api, fixtures }: { api: ReturnType<typeof createApiClient>; fixtures: Fixture[] }) {
  const access = useAccess();
  const connected = access.mode === 'hosted' || access.mode === 'local';
  const [uploadedSource, setUploadedSource] = useState<string>();
  const [authorDataset, setAuthorDataset] = useState<AuthorDataset>();
  const [mode, setMode] = useState<'sample' | 'data-prep' | 'data-sources' | 'fixtures' | 'api' | 'author' | 'automation' | 'security' | 'organization' | 'ai-settings' | 'users'>('sample');
  const [fixtureId, setFixtureId] = useState(access.mode === 'demo' ? fixtures.find(f => f.id === 'renderable-sales')?.id ?? fixtures[0]?.id : fixtures[0]?.id);
  const fixture = fixtures.find(f => f.id === fixtureId);
  const sample = fixtures.find(f => f.id === 'renderable-sales');
  const modePicker = <label className="source-picker">Mode<select value={mode} onChange={event => setMode(event.target.value === 'sample' ? 'sample' : event.target.value === 'data-prep' ? 'data-prep' : event.target.value === 'data-sources' ? 'data-sources' : event.target.value === 'users' ? 'users' : event.target.value === 'ai-settings' ? 'ai-settings' : event.target.value === 'organization' ? 'organization' : event.target.value === 'security' ? 'security' : event.target.value === 'automation' ? 'automation' : event.target.value === 'author' ? 'author' : event.target.value === 'api' ? 'api' : 'fixtures')}><option value="sample">Sample dashboard</option>{(access.mode === 'demo' || allowed(access, 'build')) && <option value="fixtures">Developer fixture preview</option>}<option value="api" disabled={access.mode === 'demo'}>{access.mode === 'demo' ? 'API · Needs hosted API' : 'API definition preview'}</option>{allowed(access, 'build') && <option value="data-prep">Data preparation</option>}{allowed(access, 'build') && <option value="data-sources">Data sources</option>}{allowed(access, 'build') && <option value="author">Author</option>}<option value="security">Security &amp; namespaces</option><option value="organization">Folders, sharing &amp; embedding</option><option value="automation">Schedules &amp; alerts</option>{access.mode === 'hosted' && allowed(access, 'admin') && <><option value="ai-settings">AI provider settings</option><option value="users">Users and invitations</option></>}</select></label>;
  return <div className="app-shell">
    {mode !== 'author' && <header className="app-header"><a className="brand" href="./"><span className="brand-mark" aria-hidden="true">◈</span>OpenSight</a><span className="header-caption">{mode === 'sample' ? 'Sample dashboard' : mode === 'fixtures' ? 'Developer tools' : mode === 'api' ? 'API definition preview' : 'Workspace'}</span>{modePicker}{(mode === 'fixtures' || mode === 'api') && <label className="fixture-picker">Definition example<select value={fixtureId} onChange={event => setFixtureId(event.target.value)}>{fixtures.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}</header>}
    {access.mode === 'local' && <aside className="fixture-demo-banner" aria-label="Local data workspace"><span><strong>Local workspace</strong> · Files stay in this API process · Uploads expire after 24 hours or restart</span></aside>}
    <main className={mode === 'author' ? 'author-main' : undefined}>{mode === 'sample' ? sample ? <Dashboard key="sample" fixture={sample} sample /> : <p role="status">The sample dashboard is not included in this build. Ask the operator to restore the pinned sales sample.</p> : mode === 'data-prep' ? <DataPrep initialSource={uploadedSource} onBuild={access.mode === 'local' ? dataset => { setAuthorDataset(dataset); setMode('author'); } : undefined} client={connected ? api : undefined} onSources={() => setMode('data-sources')} onAuthor={() => setMode('author')} /> : mode === 'data-sources' ? <DataSources local={access.mode === 'local'} onPrep={source => { setUploadedSource(source); setMode('data-prep'); }} client={connected ? api : undefined} /> : mode === 'users' ? access.mode === 'hosted' && allowed(access, 'admin') ? <UserManagement client={api} /> : <p>Needs hosted API</p> : mode === 'ai-settings' ? access.mode === 'hosted' && allowed(access, 'admin') ? <AISettings client={api} /> : <p>Needs hosted API</p> : mode === 'organization' ? <OrganizationNotice /> : mode === 'security' ? <SecurityNotice /> : mode === 'automation' ? <AutomationNotice /> : mode === 'author' ? <Author onDatasetChange={setAuthorDataset} dataset={authorDataset} onPrep={() => setMode('data-prep')} modePicker={modePicker} client={connected ? api : undefined} /> : mode === 'api' ? connected ? <ApiExplorer key={fixtureId} example={fixture} api={api} fixtures={fixtures} /> : <p>Needs hosted API · The fixture demo does not connect to the API.</p> : fixture ? <Dashboard key={fixture.id} fixture={fixture} /> : <p role="status">No definition examples are included in this build. Use API definition preview to load a definition from a hosted API.</p>}</main>;
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
