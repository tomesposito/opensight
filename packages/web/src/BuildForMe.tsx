import { useAI } from './access.js';
import { useState, useRef, useEffect } from 'react';
import { suggestCalculation, type CalculationResult } from '@opensight/o-interpreter';
import { dataFields, expressionError, type AuthorDataset, type CalculatedField } from './authoring.js';
import { OModeNotice } from './OModeNotice.js';

export function BuildForMe({ dataset, fields, onInsert }: { dataset?: AuthorDataset; fields: readonly CalculatedField[]; onInsert: (field: CalculatedField) => void }) {
  const ai = useAI();
  const [generative, setGenerative] = useState(false), [pending, setPending] = useState(false), [requestError, setRequestError] = useState('');
  const revision = useRef(0);
  useEffect(() => () => { revision.current++; }, []);
  useEffect(() => { revision.current++; setPending(false); setResult(undefined); }, [fields]);
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<CalculationResult>();
  const suggestion = result?.suggestion;
  const error = result?.error ? `${result.error.code}: ${result.error.message}` : suggestion ? expressionError(suggestion.expression, dataFields(fields, dataset)) : undefined;
  const suggest = async () => {
    const current = ++revision.current; setResult(undefined); setRequestError('');
    if (!generative) { setResult(suggestCalculation(question, dataFields(fields, dataset))); return; }
    if (!ai.available || !ai.client) return;
    setPending(true);
    try { const value = await ai.client.generateCalculation({ question, calculatedFields: fields }); if (current === revision.current) setResult(value); }
    catch (e) { if (current === revision.current) setRequestError(e instanceof Error ? e.message : String(e)); }
    finally { if (current === revision.current) setPending(false); }
  };
  return <details className="o-build-for-me"><summary>Build for me</summary>
    <p>{generative ? 'AI calculated field · Review before inserting' : 'Local deterministic templates · No AI'}</p>
    <OModeNotice available={ai.available} state={ai.state} checked={generative} onChange={value => { revision.current++; setPending(false); setResult(undefined); setGenerative(value); }} />
    <label>Describe a calculated field<input maxLength={2000} value={question} placeholder="Year over year sales growth" onChange={e => { revision.current++; setPending(false); setRequestError(''); setQuestion(e.target.value); setResult(undefined); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void suggest(); } }} /></label>
    <button type="button" disabled={pending} onClick={() => void suggest()}>Suggest expression</button>
    {pending && <p role="status">Asking configured provider…</p>}{requestError && <p role="alert">{requestError}</p>}
    {error && <p role="alert">{error}</p>}
    {suggestion && <><pre aria-label="Suggested expression">{suggestion.expression}</pre><p>{suggestion.explanation}</p>
      <div className="dialog-actions"><button type="button" disabled={!!error} onClick={() => { onInsert({ name: suggestion.name, expression: suggestion.expression, role: suggestion.role }); setResult(undefined); }}>INSERT EXPRESSION</button>
        <button type="button" onClick={() => setResult(undefined)}>DISCARD</button></div>
    </>}
  </details>;
}
