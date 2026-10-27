import { allowed, useAccess, type Session } from './access.js';
import { useEffect, useMemo, useState } from 'react';
import type { createApiClient } from './api-client.js';
import type { PublishedDashboard as Definition, ControlValues } from './published-dashboard.js';
import { publishedBindings, readerControls } from './published-dashboard.js';
import { buildApiPreview } from './api-preview.js';
import { viewVisualId } from './dashboard-interactions.js';
import { VisualCard } from './VisualCard.js';
import { ControlInput } from './ControlInput.js';
import type { FixtureVisual } from './model.js';
import { AppLink, type Navigate } from './AppNavigation.js';

type ReaderClient = Pick<ReturnType<typeof createApiClient>, 'getPublishedDashboard' | 'queryDashboardVisual'> & Partial<Pick<ReturnType<typeof createApiClient>, 'listUsers' | 'shareDashboard'>>;
export function PublishedDashboard({ id, client, navigate }: { id: string; client: ReaderClient; navigate: Navigate }) {
  const access = useAccess();
  const [state, setState] = useState<{ value?: Definition; error?: string }>(), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setState(undefined);
    void client.getPublishedDashboard(id, abort.signal).then(value => { if (!abort.signal.aborted) setState({ value }); })
      .catch((error: unknown) => { if (!abort.signal.aborted) setState({ error: error instanceof Error ? error.message : String(error) }); });
    return () => abort.abort();
  }, [client, id, attempt]);
  return <section className="published-dashboard">
    <AppLink to={{ page: 'dashboards' }} navigate={navigate}>All dashboards</AppLink>
    {!state && <p role="status">Loading dashboard…</p>}
    {state?.error && <p role="alert">{state.error}</p>}
    <button type="button" onClick={() => setAttempt(value => value + 1)}>Refresh dashboard</button>
    {state?.value && allowed(access, 'admin') && client.listUsers && client.shareDashboard && <DashboardAccess id={id} client={client} />}
    {state?.value && <PublishedContent key={`${id}:${attempt}`} value={state.value} client={client} />}
  </section>;
}
function PublishedContent({ value, client }: { value: Definition; client: ReaderClient }) {
  const preview = useMemo(() => buildApiPreview(value, 'dashboard', []), [value]);
  const [sheetId, setSheetId] = useState(preview.sheets[0]?.id);
  const sheet = preview.sheets.find(s => s.id === sheetId), rawSheet = value.definition.sheets?.find(s => s.sheetId === sheetId);
  const [controlValues, setControlValues] = useState<ControlValues>({});
  const controls = useMemo(() => rawSheet ? readerControls(value.definition, rawSheet) : { bindings: [], messages: [] }, [value, rawSheet]);
  return <>
    <div className="dashboard-heading"><h1>{value.name}</h1><span className="phase-badge">Published · Version {value.version} · Live data</span></div>
    {value.errors.map((error, i) => <p role="alert" key={i}>{error.errorCode}: {error.message}</p>)}
    <nav className="sheet-tabs" aria-label="Sheets">{preview.sheets.map(s => <button key={s.id} aria-current={s.id === sheetId ? 'page' : undefined} onClick={() => setSheetId(s.id)}>{s.name}</button>)}</nav>
    {!!controls.bindings.length && <section className="controls-strip" aria-label={`${sheet?.name} controls`}><div className="controls-row">{controls.bindings.map(({ control, parameter, problem }) => <ControlInput key={control.id} control={control} parameter={{ ...parameter, values: controlValues[control.id] ?? parameter.defaultValues }} error={problem} onChange={values => setControlValues(previous => ({ ...previous, [control.id]: values }))} />)}</div></section>}
    {controls.messages.map(message => <p role="alert" key={message}>{message}</p>)}
    {sheet?.visuals.length ? <div className="dashboard-grid" aria-label={sheet.name}>{sheet.visuals.map(visual => <PublishedVisual key={visual.path} visual={visual} value={value} controls={controlValues} client={client} />)}</div> : <p role="status">This published sheet has no visuals.</p>}
  </>;
}
function PublishedVisual({ visual, value, controls, client }: { visual: FixtureVisual; value: Definition; controls: ControlValues; client: ReaderClient }) {
  const key = JSON.stringify([value.id, value.version, viewVisualId(visual), controls]);
  const [state, setState] = useState<{ key: string; rows: FixtureVisual['rows']; error?: string }>();
  useEffect(() => {
    const abort = new AbortController();
    void client.queryDashboardVisual(value.id, value.version, viewVisualId(visual), controls, abort.signal)
      .then(result => { if (!abort.signal.aborted) setState({ key, rows: result.rows }); })
      .catch((error: unknown) => { if (!abort.signal.aborted) setState({ key, rows: null, error: error instanceof Error ? error.message : String(error) }); });
    return () => abort.abort();
  }, [client, key]);
  const current = state?.key === key ? state : undefined;
  const bindings = useMemo(() => { try { return publishedBindings(visual); } catch { return {}; } }, [visual]);
  return <VisualCard visual={{ ...visual, bindings, rows: current?.rows ?? null }} loading={!current} dataMessage={current?.error} />;
}

function DashboardAccess({ id, client }: { id: string; client: ReaderClient }) {
  const [users, setUsers] = useState<Session[]>([]), [userId, setUserId] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void client.listUsers!().then(users => { if (active) setUsers(users); }).catch((error: unknown) => { if (active) setStatus(String(error)); });
    return () => { active = false; };
  }, [client]);
  return <details className="dashboard-access"><summary>Dashboard access</summary>
    <p>Administrators can grant viewing access. Viewers still need independent dataset access; prepared datasets remain owner-only.</p>
    <form onSubmit={event => {
      event.preventDefault(); if (!userId || busy) return; setBusy(true); setStatus('Granting dashboard access…');
      void client.shareDashboard!(id, userId).then(() => setStatus('Dashboard viewing access granted. Dataset permissions are unchanged.'))
        .catch((error: unknown) => setStatus(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false));
    }}><label>Viewer<select value={userId} onChange={event => setUserId(event.target.value)} required><option value="">Choose a workspace user</option>{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><button disabled={busy || !userId} type="submit">Grant dashboard access</button></form>
    {status && <p role="status">{status}</p>}
  </details>;
}
