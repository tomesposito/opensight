import { useEffect, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { activeSheet, type AuthorAction, type AuthorDraft } from './authoring.js';
import type { QueryClient } from './author-query.js';
import type { useAI } from './access.js';
import { LiveAuthorVisual } from './LiveAuthorVisual.js';
import { OSteps } from './OSteps.js';
import { editOInterpretation, prepareOPlan, oPlanItems, type StagedPlan } from './o-dashboard.js';
import { ApiError } from './api-client.js';
export function ODashboardBuilder({ draft, dispatch, client, ai, onCanvasPreview, onUnavailable }: { draft: AuthorDraft; dispatch: Dispatch<AuthorAction>; client?: QueryClient; ai: ReturnType<typeof useAI>; onCanvasPreview?: (node: ReactNode) => void; onUnavailable: () => void }) {
  const [question, setQuestion] = useState(''), [plan, setPlan] = useState<StagedPlan>(), [selected, setSelected] = useState(0), [reask, setReask] = useState(''), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const epoch = useRef(0), schema = JSON.stringify([draft.dataset, draft.calculatedFields]);
  useEffect(() => { epoch.current++; setPending(false); setPlan(undefined); setError(''); }, [schema]);
  useEffect(() => () => { epoch.current++; onCanvasPreview?.(null); }, [onCanvasPreview]);
  const update = (next: StagedPlan) => { epoch.current++; setPending(false); setPlan(prepareOPlan(next, draft)); };
  const toggle = (index: number) => { if (plan) update({ ...plan, tiles: plan.tiles.map((t, i) => i === index ? { ...t, kept: !t.kept } : t) }); };
  const discard = () => { epoch.current++; setPlan(undefined); setPending(false); setError(''); };
  const commit = (newSheet: boolean) => {
    if (!plan) return;
    const sheet = activeSheet(draft), items = oPlanItems(plan, draft, newSheet ? 0 : Math.max(0, ...sheet.layout.map(p => p.y + p.h)));
    if (!items.length) return;
    dispatch({ type: 'o-add-many', target: newSheet ? { kind: 'new-sheet', name: plan.sheetTitle } : { kind: 'sheet', sheetId: sheet.id }, items }); discard();
  };
  useEffect(() => {
    if (!plan) { onCanvasPreview?.(null); return; }
    const items = oPlanItems(plan, draft), calculations = [...draft.calculatedFields, ...items.flatMap(p => p.calculatedFields)];
    onCanvasPreview?.(<section className="o-staging" aria-label="Proposed sheet">
      <div className="o-staging-banner"><strong>Proposed sheet — "{plan.sheetTitle}" · Not saved yet</strong><div>
        <button className="primary-button" disabled={!items.length} onClick={() => commit(true)}>Add as new sheet</button>
        <button disabled={!items.length} onClick={() => commit(false)}>Add to current sheet</button><button onClick={discard}>Discard proposed sheet</button></div></div>
      <div className="o-staging-grid">{items.map(p => { const index = Number(p.visual.id.slice(7)); return <article key={p.visual.id} style={{ gridColumn: `${p.placement.x + 1} / span ${p.placement.w}`, gridRow: `${p.placement.y + 1} / span ${p.placement.h}` }}><header><strong>{p.visual.title}</strong><button onClick={() => toggle(index)}>Remove</button></header><LiveAuthorVisual visual={p.visual} calculations={calculations} client={client} theme={draft.theme} /></article>; })}</div>
      {plan.tiles.map((t, i) => (!t.kept || t.status !== 'ok') && <div className="o-plan-placeholder" key={i}><strong>{t.question}</strong><p>{!t.kept ? 'Removed from this proposal.' : `${t.code}: ${t.message}`}</p><button onClick={() => toggle(i)}>{t.kept ? 'Remove' : 'Keep'}</button></div>)}
    </section>);
  }, [plan, draft, client, onCanvasPreview]);
  const request = async (tile?: number) => {
    if (!ai.available || !ai.client) return;
    const current = ++epoch.current; setPending(true); setError('');
    const scope = { calculatedFields: draft.calculatedFields, ...(ai.mode && draft.dataset ? { datasetId: draft.dataset.id } : {}) };
    try {
      if (tile === undefined) {
        const result = await ai.client.planO({ ...scope, question });
        if (current === epoch.current) { setPlan(prepareOPlan(result, draft)); setSelected(0); setReask(result.tiles[0]?.question ?? ''); }
      } else if (plan) {
        const result = await ai.client.generateO({ ...scope, question: reask });
        const interpretation = result.interpretations[0];
        if (!interpretation || result.errors.some(e => e.code !== 'AMBIGUOUS_QUESTION')) throw Error(result.errors[0]?.message ?? 'No supported interpretation.');
        const next = prepareOPlan({ ...plan, tiles: plan.tiles.map((t, i) => i === tile ? { ...t, question: reask, status: 'ok', result, interpretation } : t) }, draft);
        if (next.tiles[tile]?.status !== 'ok') throw Error(next.tiles[tile]?.message);
        if (current === epoch.current) setPlan(next);
      }
    } catch (e) { if (current === epoch.current) { setError(e instanceof Error ? e.message : String(e)); if (e instanceof ApiError && e.errorCode === 'AI_NOT_CONFIGURED') onUnavailable(); } }
    finally { if (current === epoch.current) setPending(false); void ai.refresh(); }
  };
  const tile = plan?.tiles[selected];
  return <section aria-label="Build a dashboard">
    {ai.mode === 'managed' && <p>Uses 1 credit per tile built, up to 8 tiles. Removed tiles were delivered and charged; removing or discarding them does not refund credits. Failed and credit-limited tiles cost 0.</p>}
    <form onSubmit={e => { e.preventDefault(); void request(); }}><label>Dashboard prompt<input type="search" aria-label="Dashboard prompt" maxLength={2000} value={question} onChange={e => { epoch.current++; setPending(false); setQuestion(e.target.value); }} /></label><button disabled={pending || !ai.available || !question.trim()}>Build dashboard</button></form>
    {pending && <p role="status">Preparing proposal…</p>}{error && <p role="alert">{error}</p>}
    {plan && <><p>{plan.delivered} tiles delivered · Review before adding.</p><ol className="o-plan-list">{plan.tiles.map((t, i) => <li key={i}><button aria-pressed={selected === i} onClick={() => { setSelected(i); setReask(t.question); }}>{t.interpretation?.explanation ?? t.question}</button><button aria-label={`${t.kept ? 'Remove' : 'Keep'} tile ${i + 1}`} onClick={() => toggle(i)}>{t.kept ? 'Remove' : 'Keep'}</button>{t.status !== 'ok' && <p role="status">{t.code}: {t.message}</p>}</li>)}</ol>
      {tile && <><h3>Fix by hand</h3>{tile.interpretation && <OSteps interpretation={tile.interpretation} draft={draft} edit={patch => update({ ...plan, tiles: plan.tiles.map((t, i) => i === selected ? { ...t, interpretation: editOInterpretation(tile.interpretation!, patch) } : t) })} />}
        <label>Re-ask tile<input aria-label="Re-ask tile" value={reask} maxLength={2000} onChange={e => { epoch.current++; setPending(false); setReask(e.target.value); }} /></label><button disabled={pending || !ai.available || !reask.trim()} onClick={() => void request(selected)}>Re-ask</button>{ai.mode === 'managed' && <small>Re-ask uses 1 credit when a new answer is delivered.</small>}</>}
      {!onCanvasPreview && <div><button disabled={!oPlanItems(plan, draft).length} onClick={() => commit(true)}>Add as new sheet</button><button onClick={discard}>Discard proposed sheet</button></div>}
    </>}
  </section>;
}
