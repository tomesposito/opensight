import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type { Interpretation } from '@opensight/o-interpreter';
import type { AuthorAction, AuthorDraft, AuthorVisual } from './authoring.js';
import type { QueryClient } from './author-query.js';
import type { useAI } from './access.js';
import { prepareOVisual } from './o-authoring.js';
import { editOInterpretation } from './o-dashboard.js';
import { LiveAuthorVisual } from './LiveAuthorVisual.js';
import { OSteps } from './OSteps.js';
import { ApiError } from './api-client.js';
export const UNSTAMPED_O_MESSAGE = "This visual wasn't created by Ask O, so O can't revise it conversationally. You can edit it with the normal editors, or ask a new question and add a fresh tile.";
export function revisionSeedProblem(visual: AuthorVisual, draft: AuthorDraft): string | undefined {
  if (!visual.o) return UNSTAMPED_O_MESSAGE;
  for (const used of visual.o.interpretation.grounding.metricsUsed ?? []) {
    const current = draft.dataset?.metrics?.find(m => m.id === used.id);
    if (!current || current.version !== used.version || current.name !== used.name) return 'METRIC_STALE: The governed metric behind this tile changed. Ask a new question using the current metric.';
  }
  try { prepareOVisual(visual.o.interpretation, draft.calculatedFields, draft.dataset); }
  catch (e) { return e instanceof Error ? e.message : String(e); }
}
export function ORevision({ visual, draft, dispatch, client, ai, onPreview, onUnavailable }: { visual: AuthorVisual; draft: AuthorDraft; dispatch: Dispatch<AuthorAction>; client?: QueryClient; ai: ReturnType<typeof useAI>; onPreview?: (id?: string) => void; onUnavailable: () => void }) {
  const [question, setQuestion] = useState(''), [proposal, setProposal] = useState<Interpretation>(), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const epoch = useRef(0), seed = JSON.stringify([visual, draft.dataset, draft.calculatedFields]);
  useEffect(() => { epoch.current++; setProposal(undefined); setError(''); setPending(false); }, [seed]);
  useEffect(() => { onPreview?.(proposal ? visual.id : undefined); return () => onPreview?.(undefined); }, [proposal, visual.id, onPreview]);
  useEffect(() => () => { epoch.current++; }, []);
  const prepared = useMemo(() => {
    if (!proposal) return;
    try { return { value: prepareOVisual(proposal, draft.calculatedFields, draft.dataset) }; }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  }, [proposal, draft.calculatedFields, draft.dataset]);
  if (!visual.o) return <p className="o-unstamped">{UNSTAMPED_O_MESSAGE}</p>;
  const submit = async () => {
    const problem = revisionSeedProblem(visual, draft);
    if (problem) { setError(problem); return; }
    if (!ai.client || !ai.available || !visual.o) return;
    const current = ++epoch.current; setPending(true); setError(''); setProposal(undefined);
    try {
      const result = await ai.client.reviseO({ question, currentQuestion: visual.o.question, calculatedFields: draft.calculatedFields, ...(ai.mode && draft.dataset ? { datasetId: draft.dataset.id } : {}) });
      const interpretation = result.interpretations[0];
      if (!interpretation || result.errors.some(e => e.code !== 'AMBIGUOUS_QUESTION')) throw Error(result.errors[0]?.message ?? 'No supported interpretation.');
      prepareOVisual(interpretation, draft.calculatedFields, draft.dataset);
      if (current === epoch.current) setProposal(interpretation);
    } catch (e) { if (current === epoch.current) { setError(e instanceof Error ? e.message : String(e)); if (e instanceof ApiError && e.errorCode === 'AI_NOT_CONFIGURED') onUnavailable(); } }
    finally { if (current === epoch.current) setPending(false); void ai.refresh(); }
  };
  const discard = () => { epoch.current++; setPending(false); setProposal(undefined); setError(''); };
  return <section className="o-revision" aria-label="Revise this tile"><h3>Revise this tile</h3><strong>{visual.title}</strong><p>{visual.o.interpretation.explanation}</p>
    <form onSubmit={e => { e.preventDefault(); void submit(); }}><label>Follow-up<input aria-label="Tile follow-up" maxLength={2000} value={question} onChange={e => { epoch.current++; setPending(false); setQuestion(e.target.value); }} /></label><button disabled={pending || !ai.available || !question.trim()}>Propose revision</button></form>
    {ai.mode === 'managed' && <small>Uses 1 credit when a proposal is delivered, whether you replace or discard it.</small>}
    {pending && <p role="status">Preparing revision…</p>}{error && <p role="alert">{error}</p>}
    {proposal && <><p role="status">{ai.mode === 'managed' ? 'Revision ready · 1 credit used' : 'Revision ready'}</p><p>Was: {visual.o.interpretation.explanation}<br />Now: {proposal.explanation}</p>
      <OSteps interpretation={proposal} draft={draft} edit={patch => setProposal(editOInterpretation(proposal, patch))} />
      {prepared?.error && <p role="alert">{prepared.error}</p>}{prepared?.value && <div className="o-result"><LiveAuthorVisual visual={prepared.value.visual} calculations={[...draft.calculatedFields, ...prepared.value.calculatedFields]} client={client} theme={draft.theme} /></div>}
      <button className="primary-button" disabled={!prepared?.value} onClick={() => { if (prepared?.value && !revisionSeedProblem(visual, draft)) { dispatch({ type: 'o-replace', id: visual.id, ...prepared.value }); discard(); } }}>Replace</button><button onClick={discard}>Discard revision</button>
    </>}
  </section>;
}
