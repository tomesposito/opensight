import { AccessProvider, useAccess, allowed, type Access } from './access.js';
import { OrganizationNotice } from './OrganizationNotice.js';
import { useEffect, useState } from 'react';
import type { Fixture } from './model.js';
import { VisualCard } from './VisualCard.js';
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

function Dashboard({ fixture }: { fixture: Fixture }) {
  const [sheetId, setSheetId] = useState(fixture.sheets[0]?.id);
  const sheet = fixture.sheets.find(s => s.id === sheetId);
  return <>
    <div className="dashboard-heading"><div><p className="eyebrow">{fixture.description}</p><h1>{fixture.name}</h1></div><span className="phase-badge">Phase 0 preview</span></div>
    <p className="fixture-notice">{fixture.notice}</p>
    <nav className="sheet-tabs" aria-label="Sheets">{fixture.sheets.map(s => <button key={s.id} aria-current={s.id === sheetId ? 'page' : undefined} onClick={() => setSheetId(s.id)}>{s.name}<span>{s.visuals.length} {s.visuals.length === 1 ? 'visual' : 'visuals'}</span></button>)}</nav>
    {sheet ? <div className="dashboard-grid" aria-label={sheet.name}>{sheet.visuals.map(v => <VisualCard key={v.path} visual={v} />)}</div> : <p>No sheets in this fixture.</p>}
    <p className="provenance">Source: <code>{fixture.provenance}</code></p>
  </>;
}

export default function App() {
  const offline = import.meta.env.VITE_OPENSIGHT_OFFLINE_DEMO === 'true';
  const [access, setAccess] = useState<Access>({ mode: 'hosted' });
  const [error, setError] = useState('');
  useEffect(() => {
    if (offline) return;
    const controller = new AbortController();
    void api.getSession(controller.signal).then(session => setAccess({ mode: 'hosted', session })).catch(() => { if (!controller.signal.aborted) setError('Hosted session unavailable. Sign in through your configured authentication service.'); });
    return () => controller.abort();
  }, [offline]);
  if (offline) return <Application />;
  return <AccessProvider access={access}>{error && <p role="alert">{error}</p>}<Application /></AccessProvider>;
}
function Application() {
  const access = useAccess();
  const [mode, setMode] = useState<'fixtures' | 'api' | 'author' | 'automation' | 'security' | 'organization'>('fixtures');
  const [fixtureId, setFixtureId] = useState(fixtures[0]?.id);
  const fixture = fixtures.find(f => f.id === fixtureId);
  const modePicker = <label className="source-picker">Mode<select value={mode} onChange={event => setMode(event.target.value === 'organization' ? 'organization' : event.target.value === 'security' ? 'security' : event.target.value === 'automation' ? 'automation' : event.target.value === 'author' ? 'author' : event.target.value === 'api' ? 'api' : 'fixtures')}><option value="fixtures">fixtures</option><option value="api">api</option>{allowed(access, 'build') && <option value="author">Author</option>}<option value="security">Security &amp; namespaces</option><option value="organization">Folders, sharing &amp; embedding</option><option value="automation">Schedules &amp; alerts</option></select></label>;
  return <div className="app-shell">
    {mode !== 'author' && <header className="app-header"><a className="brand" href="./"><span className="brand-mark" aria-hidden="true">◈</span>OpenSight</a><span className="header-caption">Definition explorer</span>{modePicker}{mode !== 'automation' && mode !== 'security' && mode !== 'organization' && <label className="fixture-picker">Example<select value={fixtureId} onChange={event => setFixtureId(event.target.value)}>{fixtures.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}</header>}
    <main className={mode === 'author' ? 'author-main' : undefined}>{mode === 'organization' ? <OrganizationNotice /> : mode === 'security' ? <SecurityNotice /> : mode === 'automation' ? <AutomationNotice /> : mode === 'author' ? <Author modePicker={modePicker} client={import.meta.env.VITE_OPENSIGHT_OFFLINE_DEMO === 'true' ? undefined : api} /> : mode === 'api' ? <ApiExplorer key={fixtureId} example={fixture} /> : fixture ? <Dashboard key={fixture.id} fixture={fixture} /> : <p>No fixtures available.</p>}</main>
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
    <p className="fixture-notice">API mode fetches definitions only. Charts use fixed, precomputed fixture results; no live data queries are run.</p>
    {!current && <p role="status">Loading definition…</p>}
    {current?.error && <div className="visual-error" role="alert"><strong>Unable to load definition</strong><p>{current.error}</p><p>Check that the API is running, then use Load definition to retry.</p></div>}
    {current?.fixture && <Dashboard key={`${request.kind}/${request.id}`} fixture={current.fixture} />}
  </>;
}
