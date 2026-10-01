import { useAccess, allowed, useAI } from './access.js';
import { useMemo, useState, useRef, useEffect, type Dispatch, type ReactNode } from 'react';
import { interpretQuestion, type InterpretationResult } from '@opensight/o-interpreter';
import { dataFields, type AuthorAction, type AuthorDraft } from './authoring.js';
import { prepareOVisual } from './o-authoring.js';
import { LiveAuthorVisual } from './LiveAuthorVisual.js';
import type { QueryClient } from './author-query.js';
import { OModeNotice } from './OModeNotice.js';

interface OEntryProps { draft: AuthorDraft; dispatch?: Dispatch<AuthorAction>; client?: QueryClient; dashboardId?: string; renderBar?: (bar: ReactNode) => ReactNode }
export function OEntry(props: OEntryProps) {
  const access = useAccess();
  if (!allowed(access, 'ai')) return <>{props.renderBar?.(null)}</>;
  return <OEntryContent {...props} />;
}
function OEntryContent({ draft, dispatch, client, renderBar, dashboardId }: OEntryProps) {
  const access = useAccess();
  const ai = useAI();
  const [generative, setGenerative] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const revision = useRef(0);
  useEffect(() => () => { revision.current++; }, []);
  const previewClient = useMemo<QueryClient | undefined>(() => client ? { queryDataset: (_id, query, signal) => {
    if (!client.queryO) return Promise.reject(new Error('SECURITY_AI_REQUIRED: Hosted O endpoint required.'));
    return client.queryO(query, dashboardId, signal);
  } } : undefined, [client, dashboardId]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ result: InterpretationResult; schema: string }>();
  const [selected, setSelected] = useState(0);
  const [added, setAdded] = useState('');
  const schema = JSON.stringify(draft.calculatedFields);
  useEffect(() => { revision.current++; setPending(false); setError(''); }, [schema, generative]);
  const result = answer?.schema === schema ? answer.result : undefined;
  const interpretation = result?.interpretations[selected];
  const prepared = useMemo(() => {
    if (!interpretation) return;
    try { return { value: prepareOVisual(interpretation, draft.calculatedFields) }; }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  }, [interpretation, draft.calculatedFields]);
  const submit = async () => {
    const current = ++revision.current; setSelected(0); setAdded(''); setError(''); setAnswer(undefined);
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
      <input id="o-question" type="search" maxLength={2000} value={question} placeholder={renderBar ? 'Ask a question about Local sales' : 'Sum of revenue by region'} onChange={e => { revision.current++; setPending(false); setError(''); setQuestion(e.target.value); setAnswer(undefined); setAdded(''); }} />
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
        <p className="o-explanation">{interpretation.explanation} <span>Confidence {Math.round(interpretation.confidence * 100)}% (grammar match)</span></p>
        {prepared?.error && <p role="alert">{prepared.error}</p>}
        {prepared?.value && <div className="o-result"><LiveAuthorVisual visual={prepared.value.visual} calculations={[...draft.calculatedFields, ...prepared.value.calculatedFields]} client={previewClient} theme={draft.theme} /></div>}
        <p className="o-source">{client ? 'Local sales API query.' : 'Offline demo: recomputed synthetic sales rows across all regions. No live queries run.'}</p>
        {dispatch && allowed(access, 'build') && <button type="button" className="primary-button" disabled={!prepared?.value} onClick={() => {
          if (!prepared?.value) return;
          dispatch({ type: 'o-add', ...prepared.value }); setAnswer(undefined); setAdded('Added to the active analysis sheet.');
        }}>ADD TO ANALYSIS</button>}
        {result.interpretations.length > 1 && <div className="o-alternatives"><h3>Did you mean…?</h3><div>{result.interpretations.map((item, index) => <button type="button" key={item.explanation} aria-pressed={index === selected} onClick={() => setSelected(index)}>{item.explanation}<small>{Math.round(item.confidence * 100)}% grammar match</small></button>)}</div></div>}
      </>}
    </div>}
    {added && <p role="status">{added}</p>}
    </section>
  </>;
}
