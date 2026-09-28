import { useMemo, useState, type Dispatch } from 'react';
import { interpretQuestion, type InterpretationResult } from '@opensight/q-interpreter';
import { dataFields, type AuthorAction, type AuthorDraft } from './authoring.js';
import { prepareQVisual } from './q-authoring.js';
import { LiveAuthorVisual } from './LiveAuthorVisual.js';
import type { QueryClient } from './author-query.js';
import { QModeNotice } from './QModeNotice.js';

export function QEntry({ draft, dispatch, client }: { draft: AuthorDraft; dispatch: Dispatch<AuthorAction>; client?: QueryClient }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ result: InterpretationResult; schema: string }>();
  const [selected, setSelected] = useState(0);
  const [added, setAdded] = useState('');
  const schema = JSON.stringify(draft.calculatedFields);
  const result = answer?.schema === schema ? answer.result : undefined;
  const interpretation = result?.interpretations[selected];
  const prepared = useMemo(() => {
    if (!interpretation) return;
    try { return { value: prepareQVisual(interpretation, draft.calculatedFields) }; }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  }, [interpretation, draft.calculatedFields]);
  return <section className="q-entry" aria-label="Ask a question">
    <form className="q-bar" onSubmit={e => { e.preventDefault(); setSelected(0); setAdded(''); setAnswer({ schema, result: interpretQuestion(question, dataFields(draft.calculatedFields)) }); }}>
      <label htmlFor="q-question">Ask a question</label>
      <input id="q-question" type="search" maxLength={2000} value={question} placeholder="Sum of revenue by region" onChange={e => { setQuestion(e.target.value); setAnswer(undefined); setAdded(''); }} />
      <button type="submit">Ask</button>
      <span className="q-local-label">Local deterministic interpreter · No AI</span>
    </form>
    <QModeNotice />
    {result && <div className="q-answer">
      <div className="q-answer-actions"><strong>Interpreted question</strong><button type="button" onClick={() => setAnswer(undefined)}>Close answer</button></div>
      {result.errors.map(e => <p key={e.code} role="status" className="q-diagnostic">{e.code}: {e.message}</p>)}
      {interpretation && <>
        <p className="q-explanation">{interpretation.explanation} <span>Confidence {Math.round(interpretation.confidence * 100)}% (grammar match)</span></p>
        {prepared?.error && <p role="alert">{prepared.error}</p>}
        {prepared?.value && <div className="q-result"><LiveAuthorVisual visual={prepared.value.visual} calculations={[...draft.calculatedFields, ...prepared.value.calculatedFields]} client={client} theme={draft.theme} /></div>}
        <p className="q-source">{client ? 'Local sales API query.' : 'Offline demo: recomputed synthetic sales rows across all regions. No live queries run.'}</p>
        <button type="button" className="primary-button" disabled={!prepared?.value} onClick={() => {
          if (!prepared?.value) return;
          dispatch({ type: 'q-add', ...prepared.value }); setAnswer(undefined); setAdded('Added to the active analysis sheet.');
        }}>ADD TO ANALYSIS</button>
        {result.interpretations.length > 1 && <div className="q-alternatives"><h3>Did you mean…?</h3><div>{result.interpretations.map((item, index) => <button type="button" key={item.explanation} aria-pressed={index === selected} onClick={() => setSelected(index)}>{item.explanation}<small>{Math.round(item.confidence * 100)}% grammar match</small></button>)}</div></div>}
      </>}
    </div>}
    {added && <p role="status">{added}</p>}
  </section>;
}
