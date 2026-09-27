import { useState, type Dispatch } from 'react';
import { activeSheet, sheetParameters, type AuthorAction, type AuthorDraft } from './authoring.js';
import { parameterError, type AuthorParameter, type ParameterValue } from './parameters.js';
export function ParameterEditor({ draft, dispatch }: { draft: AuthorDraft; dispatch: Dispatch<AuthorAction> }) {
  const [open, setOpen] = useState(false), [name, setName] = useState(''), [type, setType] = useState<AuthorParameter['type']>('string');
  const [multiple, setMultiple] = useState(false), [integer, setInteger] = useState(false), [defaults, setDefaults] = useState(''), [error, setError] = useState('');
  return <details className="parameter-editor" open><summary>Parameters</summary>
    {sheetParameters(draft).map(p => <div key={p.id}><strong>{p.name}</strong> · {p.integer ? 'integer' : p.type} · {p.multiple ? 'multiple' : 'single'}
      <p>Default: {p.defaultValues.join(', ') || '(none)'}</p><button type="button" onClick={() => dispatch({ type: 'parameter-default', id: p.id, values: p.values })}>Use current values as default for {p.name}</button>
    </div>)}
    <button type="button" onClick={() => setOpen(!open)}>+ Parameter</button>
    {open && <form aria-label="Create parameter" onSubmit={e => {
      e.preventDefault();
      const values: ParameterValue[] = defaults === '' ? [] : (multiple ? defaults.split('\n') : [defaults]).map(v => type === 'number' ? Number(v) : v);
      const p: AuthorParameter = { id: 'parameter-1', name, type, multiple: type !== 'datetime' && multiple, ...(type === 'number' ? { integer } : {}), values, defaultValues: values, ...((activeSheet(draft).imported?.memberPath ?? draft.bundle?.primaryPath) ? { memberPath: activeSheet(draft).imported?.memberPath ?? draft.bundle!.primaryPath } : {}) };
      const problem = parameterError(p) ?? (sheetParameters(draft).some(p => p.name === name) ? 'A parameter with that name already exists.' : undefined);
      if (problem) setError(problem); else { dispatch({ type: 'parameter-add', parameter: p }); setOpen(false); setError(''); setName(''); setDefaults(''); }
    }}>
      <label>Parameter name<input value={name} onChange={e => setName(e.target.value)} /></label>
      <label>Parameter type<select value={type} onChange={e => { setType(e.target.value as AuthorParameter['type']); setMultiple(false); }}><option value="string">String</option><option value="number">Number</option><option value="datetime">Datetime</option></select></label>
      {type !== 'datetime' && <label><input type="checkbox" checked={multiple} onChange={e => setMultiple(e.target.checked)} />Multiple values</label>}
      {type === 'number' && <label><input type="checkbox" checked={integer} onChange={e => setInteger(e.target.checked)} />Integer</label>}
      <label>Default values{multiple ? ' (one per line)' : ''}<textarea value={defaults} onChange={e => setDefaults(e.target.value)} /></label>
      {error && <p role="alert">{error}</p>}<button type="submit">Create parameter</button>
    </form>}
  </details>;
}
