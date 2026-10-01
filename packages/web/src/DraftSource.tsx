import { useEffect, useState } from 'react';
import type { QueryClient } from './author-query.js';
import type { AuthorDataset, AuthorDraft } from './authoring.js';
import type { PrepSourceSummary } from './data-prep.js';
import { compatibleDataset, draftSourceProblem, reconnectDraft } from './draft-source.js';

export function useDraftSource(dataset: AuthorDataset | undefined, client: QueryClient | undefined, enabled: boolean) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ dataset: AuthorDataset; list: QueryClient['listPrepSources']; revision: number; sources: PrepSourceSummary[]; problem?: string }>();
  const list = client?.listPrepSources;
  useEffect(() => {
    if (!enabled || !dataset || !list) return;
    let active = true;
    void list().then(sources => { if (active) setState({ dataset, list, revision, sources, problem: draftSourceProblem(dataset, sources) }); })
      .catch(error => { if (active) setState({ dataset, list, revision, sources: [], problem: `Could not check source data: ${error instanceof Error ? error.message : String(error)}. Connect to the local API, then retry.` }); });
    return () => { active = false; };
  }, [enabled, dataset, list, revision]);
  if (!enabled || !dataset) return { sources: [], retry: () => setRevision(n => n + 1) };
  const current = state?.dataset === dataset && state.list === list && state.revision === revision ? state : undefined;
  return { problem: !list ? 'This draft needs its local API to load source data.' : current ? current.problem : 'Checking source data…', sources: current?.sources ?? [], retry: () => setRevision(n => n + 1) };
}

export function DraftSourceRecovery({ draft, sources, problem, onRetry, onSources, onReconnect }: {
  draft: AuthorDraft; sources: PrepSourceSummary[]; problem: string; onRetry: () => void; onSources?: () => void; onReconnect: (draft: AuthorDraft) => void;
}) {
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const choices = sources.filter(s => s.available && typeof s.ref === 'object' && 'dataset' in s.ref && s.ref.dataset !== draft.dataset?.id && draft.dataset && compatibleDataset(draft.dataset, s));
  return <aside className="draft-source-recovery" aria-label="Draft source data">
    <p role={problem === 'Checking source data…' ? 'status' : 'alert'}>{problem}</p>
    {problem !== 'Checking source data…' && <>
      <p>Re-upload and prepare the file, reopen this saved draft, then reconnect it below. Keep the original column names and types. Visuals and formatting stay in the draft.</p>
      {onSources && <button type="button" onClick={onSources}>Re-upload file</button>}
      <button type="button" onClick={onRetry}>Retry source data</button>
      <label>Replacement dataset<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choose a compatible dataset…</option>{choices.map(s => <option key={s.id} value={s.id}>{s.name ?? s.id}</option>)}</select></label>
      <button type="button" disabled={!choices.some(s => s.id === selected)} onClick={() => {
        try { const source = choices.find(s => s.id === selected); if (source) { onReconnect(reconnectDraft(draft, source)); setError(''); } }
        catch (error) { setError(error instanceof Error ? error.message : String(error)); }
      }}>Reconnect draft</button>
      {error && <p role="alert">{error}</p>}
    </>}
  </aside>;
}
