import { ODashboardBuilder } from './ODashboardBuilder.js';
import { OSteps } from './OSteps.js';
import { useAccess, allowed, useAI } from './access.js';
import { useMemo, useState, useRef, useEffect, type Dispatch, type ReactNode } from 'react';
import { describeInterpretation, interpretQuestion, type Interpretation, type InterpretationResult } from '@opensight/o-interpreter';
import { type AuthorAction, type AuthorDraft } from './authoring.js';
import { prepareOVisual, oVocabulary } from './o-authoring.js';
import { LiveAuthorVisual } from './LiveAuthorVisual.js';
import type { AuthorRows, QueryClient } from './author-query.js';
import { OModeNotice } from './OModeNotice.js';

interface OEntryProps { draft: AuthorDraft; dispatch?: Dispatch<AuthorAction>; client?: QueryClient; dashboardId?: string; renderBar?: (bar: ReactNode) => ReactNode; onCanvasPreview?: (node: ReactNode) => void }
export function OEntry(props: OEntryProps) {
  const access = useAccess();
  if (access.mode !== 'local' && !allowed(access, 'ai')) return <>{props.renderBar?.(null)}</>;
  return <OEntryContent {...props} />;
}
function OEntryContent({ draft, dispatch, client, renderBar, dashboardId, onCanvasPreview }: OEntryProps) {
  const access = useAccess();
  const ai = useAI();
  const [mode, setMode] = useState<'ask' | 'build'>('ask'), [extensionsUnavailable, setExtensionsUnavailable] = useState(false);
  const [generative, setGenerative] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const revision = useRef(0);
  useEffect(() => () => { revision.current++; }, []);
  const previewClient = useMemo<QueryClient | undefined>(() => client ? { dataset: client.dataset, queryDataset: (id, query, signal) => {
    if (access.mode !== 'hosted' || draft.dataset && !dashboardId) return client.queryDataset(id, query, signal);
    if (!client.queryO) return Promise.reject(new Error('SECURITY_AI_REQUIRED: Hosted O endpoint required.'));
    return client.queryO(query, dashboardId, signal);
  } } : undefined, [access.mode, client, dashboardId, draft.dataset]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ result: InterpretationResult; schema: string; generated?: boolean }>();
  const [selected, setSelected] = useState(0);
  const [edited, setEdited] = useState<Interpretation>();
  const [added, setAdded] = useState('');
  // Governed-metric versions returned with the executed query result. The grounding line
  // names these once a result is displayed; the interpretation-time versions stay visible
  // separately when they differ (a publication landed between interpretation and execution).
  const [executedMetrics, setExecutedMetrics] = useState<AuthorRows['metrics']>();
  const schema = JSON.stringify([draft.calculatedFields, draft.dataset]);
  useEffect(() => { revision.current++; setPending(false); setError(''); setEdited(undefined); setExecutedMetrics(undefined); }, [schema, generative]);
  const result = answer?.schema === schema ? answer.result : undefined;
  const interpretation = result?.interpretations[selected] ? edited ?? result.interpretations[selected] : undefined;
  const edit = (patch: Partial<Pick<Interpretation, 'aggregation' | 'dimensions' | 'filters' | 'topN' | 'granularity' | 'suggestedVisualType'>>) => {
    if (!interpretation) return;
    const next: Interpretation = { ...interpretation, ...patch };
    next.explanation = describeInterpretation(next);
    const fieldsUsed = [...new Set([...(next.measure ? [next.measure] : []), ...next.dimensions, ...next.filters.map(f => f.field)])];
    next.grounding = { ...interpretation.grounding, fieldsUsed, synonymsMatched: interpretation.grounding.synonymsMatched.filter(s => fieldsUsed.includes(s.field)) };
    setEdited(next); setExecutedMetrics(undefined);
  };
  const prepared = useMemo(() => {
    if (!interpretation) return;
    try { return { value: prepareOVisual(interpretation, draft.calculatedFields, draft.dataset) }; }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  }, [interpretation, draft.calculatedFields, draft.dataset]);
  const metricsUsed = interpretation?.grounding.metricsUsed;
  const executedDiverged = !!metricsUsed?.length && executedMetrics !== undefined && metricsUsed.some(m => { const ex = executedMetrics.find(x => x.id === m.id); return !ex || ex.version !== m.version || ex.name !== m.name; });
  const submit = async () => {
    const current = ++revision.current; setSelected(0); setEdited(undefined); setAdded(''); setError(''); setAnswer(undefined); setExecutedMetrics(undefined);
    if (!generative || !ai.available) { setAnswer({ schema, result: interpretQuestion(question, oVocabulary(draft.calculatedFields, draft.dataset)) }); return; }
    if (!ai.available || !ai.client) return;
    setPending(true);
    try {
      const result = await ai.client.generateO({ question, calculatedFields: draft.calculatedFields, ...(dashboardId ? { dashboardId } : ai.mode && draft.dataset ? { datasetId: draft.dataset.id } : {}) });
      if (current === revision.current) setAnswer({ schema, result, generated: true });
    } catch (e) { if (current === revision.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (current === revision.current) setPending(false); void ai.refresh(); }
  };
  const bar = <form className="o-bar" onSubmit={e => { e.preventDefault(); void submit(); }}>
      {renderBar && <span className="o-mark" aria-hidden="true">O</span>}
      <label htmlFor="o-question">Ask a question</label>
      <input id="o-question" type="search" maxLength={2000} value={question} placeholder={renderBar ? `Ask a question about ${draft.dataset?.name ?? 'Local sales'}` : 'Sum of revenue by region'} onChange={e => { revision.current++; setPending(false); setError(''); setQuestion(e.target.value); setAnswer(undefined); setEdited(undefined); setAdded(''); setExecutedMetrics(undefined); }} />
      <button type="submit" disabled={pending}>Ask</button>
    </form>;
  return <>
    {renderBar?.(bar)}
    <section className={`o-entry${renderBar ? ' o-entry-toolbar' : ''}`} aria-label="Ask a question">
    {dispatch && allowed(access, 'build') && !extensionsUnavailable && (generative && ai.available || mode === 'build') && <div className="o-mode-tabs" role="group" aria-label="Ask O mode"><button aria-pressed={mode === 'ask'} onClick={() => setMode('ask')}>Ask a question</button><button aria-pressed={mode === 'build'} disabled={!ai.available} onClick={() => setMode('build')}>Build a dashboard</button></div>}
    {mode === 'ask' && !renderBar && bar}
    <span className="o-local-label">{(result ? answer?.generated : generative && ai.available) ? 'AI interpretation · Review before use' : ai.state === 'credit-limit' ? 'Standard interpreter · No AI' : 'Local deterministic interpreter · No AI'}</span>
    <OModeNotice available={ai.available} state={ai.state} mode={ai.mode} credits={ai.credits} checked={generative} onChange={value => { revision.current++; setGenerative(value); if (!value) setMode('ask'); setAnswer(undefined); setError(''); }} />
    {mode === 'build' && dispatch && <ODashboardBuilder draft={draft} dispatch={dispatch} client={previewClient} ai={ai} onCanvasPreview={onCanvasPreview} onUnavailable={() => { setExtensionsUnavailable(true); setMode('ask'); setError('Ask O dashboard generation is not configured on this server.'); }} />}
    {pending && <p role="status">Asking configured provider…</p>}{error && <p role="alert">{error}</p>}
    {mode === 'ask' && result && <div className="o-answer">
      <div className="o-answer-actions"><strong>Interpreted question</strong><button type="button" onClick={() => setAnswer(undefined)}>Close answer</button></div>
      {result.errors.map(e => <p key={e.code} role="status" className="o-diagnostic">{e.code}: {e.message}</p>)}
      {interpretation && <>
        <p className="o-explanation">{interpretation.explanation} <span>Confidence {Math.round(interpretation.confidence * 100)}% ({edited ? 'original grammar match; steps edited' : 'grammar match'})</span></p>
        <p className="o-grounding">Grounded in: {interpretation.grounding.fieldsUsed.length ? interpretation.grounding.fieldsUsed.join(', ') : 'row count'}</p>
        {!!metricsUsed?.length && (executedMetrics !== undefined
          ? <>
            <p className="o-grounding">Governed metrics (as executed): {metricsUsed.map(m => { const ex = executedMetrics.find(x => x.id === m.id); return ex ? `${ex.name} · version ${ex.version}` : `${m.name} · not returned by the executed query`; }).join(', ')}</p>
            {executedDiverged && <p className="o-grounding">Interpreted against: {metricsUsed.map(m => `${m.name} · version ${m.version}`).join(', ')}</p>}
          </>
          : <p className="o-grounding">Governed metrics: {metricsUsed.map(m => `${m.name} · version ${m.version}`).join(', ')}</p>)}
        {interpretation.grounding.synonymsMatched.length > 0 && <p className="o-grounding">Synonyms matched: {interpretation.grounding.synonymsMatched.map(s => `‘${s.term}’ → ${s.field}`).join(', ')}</p>}
        {interpretation.grounding.unmatchedTerms.length > 0 && <p className="o-grounding">Not understood: {interpretation.grounding.unmatchedTerms.join(', ')}</p>}
        <OSteps interpretation={interpretation} draft={draft} edit={edit} />
        {prepared?.error && <p role="alert">{prepared.error}</p>}
        {prepared?.value && <div className="o-result"><LiveAuthorVisual visual={prepared.value.visual} calculations={[...draft.calculatedFields, ...prepared.value.calculatedFields]} client={previewClient} theme={draft.theme} onExecutedMetrics={metrics => setExecutedMetrics(metrics)} /></div>}
        <p className="o-source">{client ? `${client.dataset?.name ?? 'Local sales'} API query.` : 'Offline demo: recomputed synthetic sales rows across all regions. No live queries run.'}</p>
        {dispatch && allowed(access, 'build') && <button type="button" className="primary-button" disabled={!prepared?.value} onClick={() => {
          if (!prepared?.value) return;
          dispatch({ type: 'o-add', ...prepared.value }); setAnswer(undefined); setAdded('Added to the active analysis sheet.');
        }}>ADD TO ANALYSIS</button>}
        {result.interpretations.length > 1 && <div className="o-alternatives"><h3>Did you mean…?</h3><div>{result.interpretations.map((item, index) => <button type="button" key={item.explanation} aria-pressed={index === selected} onClick={() => { setSelected(index); setEdited(undefined); setExecutedMetrics(undefined); }}>{item.explanation}<small>{Math.round(item.confidence * 100)}% grammar match</small></button>)}</div></div>}
      </>}
    </div>}
    {added && <p role="status">{added}</p>}
    </section>
  </>;
}
