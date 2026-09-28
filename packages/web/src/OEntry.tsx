import { useMemo, useState, type Dispatch, type ReactNode } from 'react';
import { interpretQuestion, type InterpretationResult } from '@opensight/o-interpreter';
import { dataFields, type AuthorAction, type AuthorDraft } from './authoring.js';
import { prepareOVisual } from './o-authoring.js';
import { LiveAuthorVisual } from './LiveAuthorVisual.js';
import type { QueryClient } from './author-query.js';
import { OModeNotice } from './OModeNotice.js';

export function OEntry({ draft, dispatch, client, renderBar }: { draft: AuthorDraft; dispatch: Dispatch<AuthorAction>; client?: QueryClient; renderBar?: (bar: ReactNode) => ReactNode }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ result: InterpretationResult; schema: string }>();
  const [selected, setSelected] = useState(0);
  const [added, setAdded] = useState('');
  const schema = JSON.stringify(draft.calculatedFields);
  const result = answer?.schema === schema ? answer.result : undefined;
  const interpretation = result?.interpretations[selected];
  const prepared = useMemo(() => {
    if (!interpretation) return;
    try { return { value: prepareOVisual(interpretation, draft.calculatedFields) }; }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  }, [interpretation, draft.calculatedFields]);
  const bar = <form className="o-bar" onSubmit={e => { e.preventDefault(); setSelected(0); setAdded(''); setAnswer({ schema, result: interpretQuestion(question, dataFields(draft.calculatedFields)) }); }}>
      {renderBar && <span className="o-mark" aria-hidden="true">O</span>}
      <label htmlFor="o-question">Ask a question</label>
      <input id="o-question" type="search" maxLength={2000} value={question} placeholder={renderBar ? 'Ask a question about Local sales' : 'Sum of revenue by region'} onChange={e => { setQuestion(e.target.value); setAnswer(undefined); setAdded(''); }} />
      <button type="submit">Ask</button>
    </form>;
  return <>
    {renderBar?.(bar)}
    <section className={`o-entry${renderBar ? ' o-entry-toolbar' : ''}`} aria-label="Ask a question">
    {!renderBar && bar}
    <span className="o-local-label">Local deterministic interpreter · No AI</span>
    <OModeNotice />
    {result && <div className="o-answer">
      <div className="o-answer-actions"><strong>Interpreted question</strong><button type="button" onClick={() => setAnswer(undefined)}>Close answer</button></div>
      {result.errors.map(e => <p key={e.code} role="status" className="o-diagnostic">{e.code}: {e.message}</p>)}
      {interpretation && <>
        <p className="o-explanation">{interpretation.explanation} <span>Confidence {Math.round(interpretation.confidence * 100)}% (grammar match)</span></p>
        {prepared?.error && <p role="alert">{prepared.error}</p>}
        {prepared?.value && <div className="o-result"><LiveAuthorVisual visual={prepared.value.visual} calculations={[...draft.calculatedFields, ...prepared.value.calculatedFields]} client={client} theme={draft.theme} /></div>}
        <p className="o-source">{client ? 'Local sales API query.' : 'Offline demo: recomputed synthetic sales rows across all regions. No live queries run.'}</p>
        <button type="button" className="primary-button" disabled={!prepared?.value} onClick={() => {
          if (!prepared?.value) return;
          dispatch({ type: 'o-add', ...prepared.value }); setAnswer(undefined); setAdded('Added to the active analysis sheet.');
        }}>ADD TO ANALYSIS</button>
        {result.interpretations.length > 1 && <div className="o-alternatives"><h3>Did you mean…?</h3><div>{result.interpretations.map((item, index) => <button type="button" key={item.explanation} aria-pressed={index === selected} onClick={() => setSelected(index)}>{item.explanation}<small>{Math.round(item.confidence * 100)}% grammar match</small></button>)}</div></div>}
      </>}
    </div>}
    {added && <p role="status">{added}</p>}
    </section>
  </>;
}
