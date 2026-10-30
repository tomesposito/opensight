import { useAccess, allowed, useAI } from './access.js';
import { useMemo, useState, useRef, useEffect, type Dispatch, type ReactNode } from 'react';
import { describeInterpretation, datetime, interpretQuestion, numeric, type Aggregation, type Granularity, type Interpretation, type InterpretationResult } from '@opensight/o-interpreter';
import { dataFields, type AuthorAction, type AuthorDraft } from './authoring.js';
import { prepareOVisual } from './o-authoring.js';
import { LiveAuthorVisual } from './LiveAuthorVisual.js';
import type { QueryClient } from './author-query.js';
import { OModeNotice } from './OModeNotice.js';

interface OEntryProps { draft: AuthorDraft; dispatch?: Dispatch<AuthorAction>; client?: QueryClient; dashboardId?: string; renderBar?: (bar: ReactNode) => ReactNode }
export function OEntry(props: OEntryProps) {
  const access = useAccess();
  if (access.mode !== 'local' && !allowed(access, 'ai')) return <>{props.renderBar?.(null)}</>;
  return <OEntryContent {...props} />;
}
function OEntryContent({ draft, dispatch, client, renderBar, dashboardId }: OEntryProps) {
  const access = useAccess();
  const ai = useAI();
  const [generative, setGenerative] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const revision = useRef(0);
  useEffect(() => () => { revision.current++; }, []);
  const previewClient = useMemo<QueryClient | undefined>(() => client ? { dataset: client.dataset, queryDataset: (id, query, signal) => {
    if (access.mode !== 'hosted') return client.queryDataset(id, query, signal);
    if (!client.queryO) return Promise.reject(new Error('SECURITY_AI_REQUIRED: Hosted O endpoint required.'));
    return client.queryO(query, dashboardId, signal);
  } } : undefined, [access.mode, client, dashboardId]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ result: InterpretationResult; schema: string }>();
  const [selected, setSelected] = useState(0);
  const [edited, setEdited] = useState<Interpretation>();
  const [added, setAdded] = useState('');
  const schema = JSON.stringify([draft.calculatedFields, draft.dataset]);
  useEffect(() => { revision.current++; setPending(false); setError(''); setEdited(undefined); }, [schema, generative]);
  const result = answer?.schema === schema ? answer.result : undefined;
  const interpretation = result?.interpretations[selected] ? edited ?? result.interpretations[selected] : undefined;
  const edit = (patch: Partial<Pick<Interpretation, 'aggregation' | 'dimensions' | 'filters' | 'topN' | 'granularity' | 'suggestedVisualType'>>) => {
    if (!interpretation) return;
    const next: Interpretation = { ...interpretation, ...patch };
    next.explanation = describeInterpretation(next);
    const fieldsUsed = [...new Set([...(next.measure ? [next.measure] : []), ...next.dimensions, ...next.filters.map(f => f.field)])];
    next.grounding = { ...interpretation.grounding, fieldsUsed, synonymsMatched: interpretation.grounding.synonymsMatched.filter(s => fieldsUsed.includes(s.field)) };
    setEdited(next);
  };
  const prepared = useMemo(() => {
    if (!interpretation) return;
    try { return { value: prepareOVisual(interpretation, draft.calculatedFields, draft.dataset) }; }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  }, [interpretation, draft.calculatedFields, draft.dataset]);
  const stepFields = dataFields(draft.calculatedFields, draft.dataset);
  const measureField = interpretation ? stepFields.find(f => f.name === interpretation.measure) : undefined;
  const aggregationOptions: Aggregation[] = interpretation && (interpretation.measure === null || (measureField && !numeric(measureField))) ? ['COUNT'] : ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'];
  const hasDateDimension = interpretation ? interpretation.dimensions.some(name => { const f = stepFields.find(x => x.name === name); return !!f && datetime(f); }) : false;
  const submit = async () => {
    const current = ++revision.current; setSelected(0); setEdited(undefined); setAdded(''); setError(''); setAnswer(undefined);
    if (!generative) { setAnswer({ schema, result: interpretQuestion(question, dataFields(draft.calculatedFields, draft.dataset)) }); return; }
    if (!ai.available || !ai.client) return;
    setPending(true);
    try {
      const result = await ai.client.generateO({ question, calculatedFields: draft.calculatedFields, ...(dashboardId ? { dashboardId } : {}) });
      if (current === revision.current) setAnswer({ schema, result });
    } catch (e) { if (current === revision.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (current === revision.current) setPending(false); }
  };
  const bar = <form className="o-bar" onSubmit={e => { e.preventDefault(); void submit(); }}>
      {renderBar && <span className="o-mark" aria-hidden="true">O</span>}
      <label htmlFor="o-question">Ask a question</label>
      <input id="o-question" type="search" maxLength={2000} value={question} placeholder={renderBar ? `Ask a question about ${draft.dataset?.name ?? 'Local sales'}` : 'Sum of revenue by region'} onChange={e => { revision.current++; setPending(false); setError(''); setQuestion(e.target.value); setAnswer(undefined); setEdited(undefined); setAdded(''); }} />
      <button type="submit" disabled={pending}>Ask</button>
    </form>;
  return <>
    {renderBar?.(bar)}
    <section className={`o-entry${renderBar ? ' o-entry-toolbar' : ''}`} aria-label="Ask a question">
    {!renderBar && bar}
    <span className="o-local-label">{generative ? 'AI interpretation · Review before use' : 'Local deterministic interpreter · No AI'}</span>
    <OModeNotice available={ai.available} state={ai.state} checked={generative} onChange={value => { revision.current++; setGenerative(value); setAnswer(undefined); setError(''); }} />
    {pending && <p role="status">Asking configured provider…</p>}{error && <p role="alert">{error}</p>}
    {result && <div className="o-answer">
      <div className="o-answer-actions"><strong>Interpreted question</strong><button type="button" onClick={() => setAnswer(undefined)}>Close answer</button></div>
      {result.errors.map(e => <p key={e.code} role="status" className="o-diagnostic">{e.code}: {e.message}</p>)}
      {interpretation && <>
        <p className="o-explanation">{interpretation.explanation} <span>Confidence {Math.round(interpretation.confidence * 100)}% ({edited ? 'original grammar match; steps edited' : 'grammar match'})</span></p>
        <p className="o-grounding">Grounded in: {interpretation.grounding.fieldsUsed.length ? interpretation.grounding.fieldsUsed.join(', ') : 'row count'}</p>
        {interpretation.grounding.synonymsMatched.length > 0 && <p className="o-grounding">Synonyms matched: {interpretation.grounding.synonymsMatched.map(s => `‘${s.term}’ → ${s.field}`).join(', ')}</p>}
        {interpretation.grounding.unmatchedTerms.length > 0 && <p className="o-grounding">Not understood: {interpretation.grounding.unmatchedTerms.join(', ')}</p>}
        <div className="o-steps" aria-label="Interpretation steps">
          <label>Aggregation <select aria-label="Aggregation step" value={interpretation.aggregation} onChange={e => edit({ aggregation: e.target.value as Aggregation })}>{aggregationOptions.map(a => <option key={a} value={a}>{a}</option>)}</select></label>
          <span className="o-step-measure">Measure: {interpretation.measure ?? 'rows'}</span>
          {interpretation.dimensions.map(name => <span key={name} className="o-step-chip">Group by {name} <button type="button" aria-label={`Remove group-by ${name}`} onClick={() => { const dimensions = interpretation.dimensions.filter(d => d !== name); const anyDate = dimensions.some(d => { const f = stepFields.find(x => x.name === d); return !!f && datetime(f); }); edit({ dimensions, granularity: anyDate ? interpretation.granularity : null }); }}>×</button></span>)}
          {interpretation.filters.map((f, index) => <span key={`${f.field}-${index}`} className="o-step-chip">{f.field} {f.operator === 'year' ? 'in year' : 'is'} {String(f.value)} <button type="button" aria-label={`Remove filter ${f.field}`} onClick={() => edit({ filters: interpretation.filters.filter((_, i) => i !== index) })}>×</button></span>)}
          {hasDateDimension && <label>Granularity <select aria-label="Granularity step" value={interpretation.granularity ?? 'MONTH'} onChange={e => edit({ granularity: e.target.value as Granularity })}>{(['YEAR', 'QUARTER', 'MONTH', 'DAY'] as const).map(g => <option key={g} value={g}>{g}</option>)}</select></label>}
          {interpretation.topN !== null && <span className="o-step-chip"><label>Top <input aria-label="Top N step" type="number" min={1} max={10000} value={interpretation.topN} onChange={e => { const n = Number(e.target.value); if (Number.isSafeInteger(n)) edit({ topN: n }); }} /></label> <button type="button" aria-label="Clear top N" onClick={() => edit({ topN: null })}>×</button></span>}
          <label>Visual <select aria-label="Visual step" value={interpretation.suggestedVisualType} onChange={e => { const v = e.target.value as Interpretation['suggestedVisualType']; edit(v === 'kpi' ? { suggestedVisualType: v, topN: null } : { suggestedVisualType: v }); }}>{(['bar', 'line', 'pie', 'table', 'kpi'] as const).map(v => <option key={v} value={v}>{v}</option>)}</select></label>
        </div>
        {prepared?.error && <p role="alert">{prepared.error}</p>}
        {prepared?.value && <div className="o-result"><LiveAuthorVisual visual={prepared.value.visual} calculations={[...draft.calculatedFields, ...prepared.value.calculatedFields]} client={previewClient} theme={draft.theme} /></div>}
        <p className="o-source">{client ? `${client.dataset?.name ?? 'Local sales'} API query.` : 'Offline demo: recomputed synthetic sales rows across all regions. No live queries run.'}</p>
        {dispatch && allowed(access, 'build') && <button type="button" className="primary-button" disabled={!prepared?.value} onClick={() => {
          if (!prepared?.value) return;
          dispatch({ type: 'o-add', ...prepared.value }); setAnswer(undefined); setAdded('Added to the active analysis sheet.');
        }}>ADD TO ANALYSIS</button>}
        {result.interpretations.length > 1 && <div className="o-alternatives"><h3>Did you mean…?</h3><div>{result.interpretations.map((item, index) => <button type="button" key={item.explanation} aria-pressed={index === selected} onClick={() => { setSelected(index); setEdited(undefined); }}>{item.explanation}<small>{Math.round(item.confidence * 100)}% grammar match</small></button>)}</div></div>}
      </>}
    </div>}
    {added && <p role="status">{added}</p>}
    </section>
  </>;
}
