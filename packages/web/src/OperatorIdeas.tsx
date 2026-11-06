import { OperatorNav } from './operator-provisioning.js';
import { useRef, useState } from 'react';
import { IdeaDetails } from './Ideas.js';
import { declineLabels, ideaLabels, nextIdeaStatuses, type Idea, type IdeaStatus } from './ideas.js';

type Transition = { status: IdeaStatus; declineCategory?: string; declineNote?: string; shippedReference?: string };
function ReviewIdea({ idea, busy, transition }: { idea: Idea; busy: boolean; transition: (input: Transition) => void }) {
  const choices = nextIdeaStatuses[idea.status];
  const [status, setStatus] = useState<IdeaStatus>(choices[0] ?? idea.status), [category, setCategory] = useState('');
  const [note, setNote] = useState(''), [reference, setReference] = useState('');
  return <article className="data-card idea-review"><h2>{idea.title}</h2>
    <p>{idea.name ?? idea.userId}{idea.email ? ` · ${idea.email}` : ''} · Workspace: {idea.tenantId}</p>
    <IdeaDetails idea={idea} /><p>Surface: {idea.surface} · Product version: {idea.productVersion}</p>
    {!!choices.length && <form className="idea-form" aria-label={`Review ${idea.title}`} onSubmit={event => { event.preventDefault(); transition({ status,
      ...(status === 'declined' ? { declineCategory: category, declineNote: note.trim() } : {}), ...(status === 'shipped' ? { shippedReference: reference.trim() } : {}) }); }}>
      <label>Next status<select value={status} disabled={busy} onChange={event => setStatus(event.target.value as IdeaStatus)}>{choices.map(value => <option key={value} value={value}>{ideaLabels[value]}</option>)}</select></label>
      {status === 'declined' && <><label>Decline category<select required value={category} disabled={busy} onChange={event => setCategory(event.target.value)}><option value="">Choose a reason</option>{Object.entries(declineLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Decline note<input required maxLength={500} value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></label></>}
      {status === 'shipped' && <label>Shipped reference<input required maxLength={500} value={reference} disabled={busy} onChange={event => setReference(event.target.value)} /></label>}
      <button type="submit" disabled={busy || status === 'declined' && (!category || !note.trim()) || status === 'shipped' && !reference.trim()}>Update status</button>
    </form>}
  </article>;
}
/** Separate operator plane, matching OperatorUsers. Credentials stay in component memory. */
export function OperatorIdeas({ baseUrl = '/api', fetcher = fetch }: { baseUrl?: string; fetcher?: typeof fetch }) {
  const [credential, setCredential] = useState(''), [connection, setConnection] = useState<string>();
  const [status, setStatus] = useState(''), [tenant, setTenant] = useState('');
  const [ideas, setIdeas] = useState<Idea[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const running = useRef(false);
  const request = async <T,>(key: string, suffix = '', input?: Transition): Promise<T> => {
    const response = await fetcher(`${baseUrl.replace(/\/+$/, '')}/api/host/ideas${suffix}`, { method: input ? 'PATCH' : 'GET', credentials: 'omit',
      headers: { Authorization: `Operator ${key}`, ...(input ? { 'Content-Type': 'application/json' } : { ...(status ? { 'Idea-Status': status } : {}), ...(tenant.trim() ? { 'Idea-Tenant': tenant.trim() } : {}) }) }, ...(input ? { body: JSON.stringify(input) } : {}) });
    const value = await response.json() as T & { errorCode?: string };
    if (!response.ok) throw new Error(value.errorCode ?? 'Request failed'); return value;
  };
  const load = async (key: string) => { setIdeas([]); const result = await request<{ ideas: Idea[] }>(key); setIdeas(result.ideas); };
  const run = async (action: () => Promise<void>) => {
    if (running.current) return; running.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); }
    finally { running.current = false; setBusy(false); }
  };
  return <main className="admin-settings data-page ideas-page"><OperatorNav current="ideas" />
    <h1>Operator · Ideas</h1><p>Review suggestions with the product owner. Every decision is made by a human. Accepting an idea does not create an issue or start a build.</p>
    <form className="idea-form" aria-label="Operator connection" onSubmit={event => { event.preventDefault(); void run(async () => { setConnection(undefined); await load(credential); setConnection(credential); setCredential(''); }); }}>
      <label>Operator credential<input type="password" autoComplete="off" required value={credential} disabled={busy} onChange={event => setCredential(event.target.value)} /></label><button type="submit" disabled={busy}>Load ideas</button>
    </form>
    {connection && <><p>The credential is held in memory until this page closes.</p><button disabled={busy} onClick={() => { setConnection(undefined); setIdeas([]); setError(''); setMessage('Disconnected.'); }}>Disconnect</button>
      <form className="idea-filters" aria-label="Filter ideas" onSubmit={event => { event.preventDefault(); void run(() => load(connection)); }}>
        <label>Status<select value={status} disabled={busy} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option>{Object.entries(ideaLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>Tenant ID<input value={tenant} maxLength={512} pattern="[A-Za-z0-9_-]+" disabled={busy} onChange={event => setTenant(event.target.value)} /></label><button disabled={busy}>Apply filters</button>
      </form>
      {!busy && !error && !ideas.length && <p>No ideas match these filters.</p>}
      {!error && ideas.map(idea => <ReviewIdea key={`${idea.id}/${idea.status}`} idea={idea} busy={busy} transition={input => { void run(async () => {
        await request(connection, `/${encodeURIComponent(idea.id)}`, input); await load(connection); setMessage('Idea status updated.');
      }); }} />)}
    </>}
    {busy && <p role="status">Working…</p>}{message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </main>;
}
