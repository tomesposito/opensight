import { useEffect, useRef, useState } from 'react';
import { useAccess } from './access.js';
import { declineLabels, ideaLabels, ideaReferenceUrl, type Idea, type IdeasClient } from './ideas.js';

export function IdeaDetails({ idea }: { idea: Idea }) {
  const reference = idea.shippedReference, url = reference ? ideaReferenceUrl(reference) : undefined;
  return <><p className="idea-description">{idea.description}</p><p><strong>{ideaLabels[idea.status]}</strong> · <time dateTime={idea.createdAt}>{new Date(idea.createdAt).toLocaleDateString()}</time></p>
    {idea.status === 'declined' && <p>Reason: {idea.declineCategory ? declineLabels[idea.declineCategory] : ''} · {idea.declineNote}</p>}
    {idea.status === 'shipped' && reference && <p>Shipped: {url ? <a href={url} target="_blank" rel="noopener noreferrer">{reference}</a> : reference}</p>}
  </>;
}
export function Ideas({ client, surface = 'ideas' }: { client?: IdeasClient; surface?: string }) {
  const access = useAccess();
  return <section className="ideas-page" aria-labelledby="ideas-title"><h1 id="ideas-title">Ideas</h1>
    <p>A human reviews every idea. Nothing is built automatically.</p>
    {access.mode === 'hosted' && access.session?.tenantId && client
      ? <HostedIdeas key={`${access.session.tenantId}/${access.session.namespaceId}/${access.session.id}`} client={client} surface={surface} />
      : <div className="data-card ideas-notice"><h2>Ideas need a hosted workspace</h2><p>For local and self-hosted installations, suggest improvements through <a href="https://github.com/tomesposito/opensight/issues" target="_blank" rel="noopener noreferrer">GitHub issues</a>.</p></div>}
  </section>;
}
function HostedIdeas({ client, surface }: { client: IdeasClient; surface: string }) {
  const [title, setTitle] = useState(''), [description, setDescription] = useState('');
  const [items, setItems] = useState<Idea[]>([]), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false), submitting = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setLoadError('');
    void client.listMyIdeas(abort.signal).then(result => { if (!abort.signal.aborted) setItems(result.ideas); })
      .catch((e: unknown) => { if (!abort.signal.aborted) setLoadError(e instanceof Error ? e.message : 'Could not load ideas.'); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [client, revision]);
  const submit = async () => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await client.submitIdea({ title: title.trim(), description: description.trim(), surface });
      if (mounted.current) { setTitle(''); setDescription(''); setMessage('Idea received. You can follow its status below.'); setRevision(value => value + 1); }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Could not submit idea.'); }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  };
  return <><form className="data-card idea-form" aria-label="Suggest an idea" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h2>Suggest an idea</h2><p>Your ideas are private to you and the people reviewing them.</p>
    <label>Title<input required maxLength={160} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
    <label>Description<textarea required maxLength={10000} rows={6} value={description} disabled={busy} onChange={event => setDescription(event.target.value)} /></label>
    <button className="data-primary" disabled={busy || !title.trim() || !description.trim()} type="submit">{busy ? 'Submitting…' : 'Submit idea'}</button>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </form><section className="data-card idea-list" aria-labelledby="my-ideas-title"><div className="data-toolbar"><h2 id="my-ideas-title">My ideas</h2><button disabled={loading || busy} onClick={() => setRevision(value => value + 1)}>Refresh ideas</button></div>
    {loading ? <p role="status">Loading ideas…</p> : loadError ? <p role="alert">{loadError}</p> : !items.length ? <p>No ideas submitted yet.</p> : <ul>{items.map(idea => <li key={idea.id}><h3>{idea.title}</h3><IdeaDetails idea={idea} /></li>)}</ul>}
  </section></>;
}
