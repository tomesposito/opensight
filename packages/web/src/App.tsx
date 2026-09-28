import { UserManagement, AcceptInvitation } from './UserManagement.js';
import { AISettings } from './AISettings.js';
import { Dashboard } from './Dashboard.js';
import { AccessProvider, useAccess, allowed, type Access } from './access.js';
import { OrganizationNotice } from './OrganizationNotice.js';
import { useEffect, useState } from 'react';
import type { Fixture } from './model.js';
import { Author } from './Author.js';
import { SecurityNotice } from './SecurityNotice.js';
import { AutomationNotice } from './AutomationNotice.js';
import generated from './fixtures.generated.json';
import { createApiClient } from './api-client.js';
import type { ResourceKind } from './api-client.js';
import { buildApiPreview } from './api-preview.js';

// Generated exclusively from the pinned repository fixtures; never external JSON.
const fixtures = generated as Fixture[];
const api = createApiClient(import.meta.env.VITE_OPENSIGHT_API_URL);


export default function App() {
  const offline = import.meta.env.VITE_OPENSIGHT_OFFLINE_DEMO === 'true';
  const [access, setAccess] = useState<Access>({ mode: 'hosted' });
  const [error, setError] = useState('');
  const [invite, setInvite] = useState(() => /^#invite=([a-f0-9]{64})$/.exec(window.location.hash)?.[1]);
  useEffect(() => {
    const changed = () => setInvite(/^#invite=([a-f0-9]{64})$/.exec(window.location.hash)?.[1]);
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => {
    if (offline) return;
    const controller = new AbortController();
    let loading = false;
    const refresh = async () => {
      if (loading) return; loading = true;
      try { const session = await api.getSession(controller.signal); if (!controller.signal.aborted) { setAccess({ mode: 'hosted', session, aiClient: api }); setError(''); } }
      catch { if (!controller.signal.aborted) { setAccess({ mode: 'hosted' }); setError('Hosted session unavailable. Sign in through your configured authentication service.'); } }
      finally { loading = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener('focus', refresh);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [offline, invite]);
  if (offline) return <Application />;
  if (invite) return <AcceptInvitation token={invite} client={api} onAccepted={() => { window.history.replaceState(null, '', window.location.pathname + window.location.search); setInvite(undefined); }} />;
  if (!access.session) return <p role={error ? 'alert' : 'status'}>{error || 'Resolving hosted session…'}</p>;
  return <AccessProvider access={access}>{error && <p role="alert">{error}</p>}<Application /></AccessProvider>;
}
function Application() {
  const access = useAccess();
  const [mode, setMode] = useState<'fixtures' | 'api' | 'author' | 'automation' | 'security' | 'organization' | 'ai-settings' | 'users'>(access.mode === 'hosted' && !allowed(access, 'build') ? 'api' : 'fixtures');
  const [fixtureId, setFixtureId] = useState(fixtures[0]?.id);
  const fixture = fixtures.find(f => f.id === fixtureId);
  const modePicker = <label className="source-picker">Mode<select value={mode} onChange={event => setMode(event.target.value === 'users' ? 'users' : event.target.value === 'ai-settings' ? 'ai-settings' : event.target.value === 'organization' ? 'organization' : event.target.value === 'security' ? 'security' : event.target.value === 'automation' ? 'automation' : event.target.value === 'author' ? 'author' : event.target.value === 'api' ? 'api' : 'fixtures')}>{(access.mode === 'demo' || allowed(access, 'build')) && <option value="fixtures">fixtures</option>}<option value="api">api</option>{allowed(access, 'build') && <option value="author">Author</option>}<option value="security">Security &amp; namespaces</option><option value="organization">Folders, sharing &amp; embedding</option><option value="automation">Schedules &amp; alerts</option>{access.mode === 'hosted' && allowed(access, 'admin') && <><option value="ai-settings">AI provider settings</option><option value="users">Users and invitations</option></>}</select></label>;
  return <div className="app-shell">
    {mode !== 'author' && <header className="app-header"><a className="brand" href="./"><span className="brand-mark" aria-hidden="true">◈</span>OpenSight</a><span className="header-caption">Definition explorer</span>{modePicker}{mode !== 'automation' && mode !== 'security' && mode !== 'organization' && mode !== 'ai-settings' && mode !== 'users' && <label className="fixture-picker">Example<select value={fixtureId} onChange={event => setFixtureId(event.target.value)}>{fixtures.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}</header>}
    <main className={mode === 'author' ? 'author-main' : undefined}>{mode === 'users' ? <UserManagement client={api} /> : mode === 'ai-settings' ? <AISettings client={api} /> : mode === 'organization' ? <OrganizationNotice /> : mode === 'security' ? <SecurityNotice /> : mode === 'automation' ? <AutomationNotice /> : mode === 'author' ? <Author modePicker={modePicker} client={import.meta.env.VITE_OPENSIGHT_OFFLINE_DEMO === 'true' ? undefined : api} /> : mode === 'api' ? <ApiExplorer key={fixtureId} example={fixture} /> : fixture ? <Dashboard key={fixture.id} fixture={fixture} /> : <p>No fixtures available.</p>}</main>
    <footer className="app-footer">OpenSight · Local rendering preview · QuickSight fidelity has not been measured</footer>
  </div>;
}

function ApiExplorer({ example }: { example?: Fixture }) {
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
  }, [request]);
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
