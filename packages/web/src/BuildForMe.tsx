import { useState } from 'react';
import { suggestCalculation, type CalculationResult } from '@opensight/o-interpreter';
import { dataFields, expressionError, type CalculatedField } from './authoring.js';
import { OModeNotice } from './OModeNotice.js';

export function BuildForMe({ fields, onInsert }: { fields: readonly CalculatedField[]; onInsert: (field: CalculatedField) => void }) {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<CalculationResult>();
  const suggestion = result?.suggestion;
  const error = result?.error ? `${result.error.code}: ${result.error.message}` : suggestion ? expressionError(suggestion.expression, dataFields(fields)) : undefined;
  return <details className="o-build-for-me"><summary>Build for me</summary>
    <p>Local deterministic templates · No AI</p>
    <OModeNotice />
    <label>Describe a calculated field<input maxLength={2000} value={question} placeholder="Year over year sales growth" onChange={e => { setQuestion(e.target.value); setResult(undefined); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setResult(suggestCalculation(question, dataFields(fields))); } }} /></label>
    <button type="button" onClick={() => setResult(suggestCalculation(question, dataFields(fields)))}>Suggest expression</button>
    {error && <p role="alert">{error}</p>}
    {suggestion && <><pre aria-label="Suggested expression">{suggestion.expression}</pre><p>{suggestion.explanation}</p>
      <div className="dialog-actions"><button type="button" disabled={!!error} onClick={() => { onInsert({ name: suggestion.name, expression: suggestion.expression, role: suggestion.role }); setResult(undefined); }}>INSERT EXPRESSION</button>
        <button type="button" onClick={() => setResult(undefined)}>DISCARD</button></div>
    </>}
  </details>;
}
