import { useEffect, useMemo, useState, type Dispatch } from 'react';
import { activeSheet, dataFields, sheetParameters, type AuthorAction, type AuthorDraft } from './authoring.js';
import { controlError, type AuthorControl, type ControlKind } from './controls.js';
import { ControlInput } from './ControlInput.js';
import { buildControlQuery, loadAuthorRows, type QueryClient } from './author-query.js';
import { executeFixtureQuery } from './fixture-query.js';
import type { AuthorParameter, ParameterValue } from './parameters.js';
export function ControlsStrip({ draft, dispatch, client }: { draft: AuthorDraft; dispatch: Dispatch<AuthorAction>; client?: QueryClient }) {
  const sheet = activeSheet(draft), parameters = sheetParameters(draft);
  const [open, setOpen] = useState(false), [error, setError] = useState('');
  const [parameterId, setParameter] = useState(''), [kind, setKind] = useState<ControlKind>('dropdown'), [label, setLabel] = useState('');
  const [options, setOptions] = useState(''), [column, setColumn] = useState(''), [parent, setParent] = useState(''), [parentColumn, setParentColumn] = useState('region');
  const [min, setMin] = useState('0'), [max, setMax] = useState('100'), [step, setStep] = useState('1');
  const parameter = parameters.find(p => p.id === parameterId) ?? parameters[0];
  const strings = dataFields().filter(f => f.type === 'STRING');
  const parentParameter = parameters.find(p => p.id === sheet.controls.find(c => c.id === parent)?.parameterId);
  const parentFields = dataFields().filter(f => parentParameter?.type === (f.type === 'STRING' ? 'string' : f.type === 'DATETIME' ? 'datetime' : 'number'));
  const matchColumn = parentFields.find(f => f.name === parentColumn)?.name ?? parentFields[0]?.name ?? '';
  return <section className="controls-strip" aria-label={`${sheet.name} controls`}>
    <div className="controls-heading"><strong>Controls</strong><button type="button" disabled={!parameters.length} onClick={() => setOpen(!open)}>+ Add control</button></div>
    {!parameters.length && <p>Create a parameter in the Data panel to add controls.</p>}
    <div className="controls-row">{sheet.controls.map((c, i) => {
      const p = parameters.find(p => p.id === c.parameterId);
      return <div className="control-container" key={c.id}>
        {p ? <BoundControl control={c} controls={sheet.controls} parameters={parameters} parameter={p} client={client} onChange={values => dispatch({ type: 'parameter-value', id: p.id, values })} /> : <p role="alert">Unresolved parameter</p>}
        <details className="control-settings"><summary>Edit {c.label}</summary>
          <label>Bound parameter<select aria-label={`Bind ${c.label}`} value={c.parameterId} onChange={e => dispatch({ type: 'control-bind', id: c.id, parameterId: e.target.value })}>{parameters.filter(p => !controlError({ ...c, parameterId: p.id }, parameters)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <button type="button" aria-label={`Move ${c.label} left`} disabled={!i} onClick={() => dispatch({ type: 'control-move', id: c.id, offset: -1 })}>←</button>
          <button type="button" aria-label={`Move ${c.label} right`} disabled={i === sheet.controls.length - 1} onClick={() => dispatch({ type: 'control-move', id: c.id, offset: 1 })}>→</button>
          <button type="button" onClick={() => dispatch({ type: 'control-remove', id: c.id })}>Remove {c.label}</button>
        </details>
      </div>;
    })}</div>
    {open && <form className="control-form" aria-label="Add control" onSubmit={e => {
      e.preventDefault(); if (!parameter) return;
      const control: AuthorControl = { id: 'new', label: label.trim() || parameter.name, kind, parameterId: parameter.id,
        ...(kind === 'slider' ? { min: Number(min), max: Number(max), step: Number(step) } : {}),
        ...(kind === 'dropdown' ? column ? { source: { columnName: column, dataSetIdentifier: 'sales_data', local: true }, ...(parent ? { cascade: [{ controlId: parent, columnName: matchColumn }] } : {}) } : { options: options === '' ? [] : options.split('\n').map(v => parameter.type === 'number' ? Number(v) : v) } : {}),
      };
      const problem = controlError(control, parameters);
      if (problem) setError(problem); else { dispatch({ type: 'control-add', control }); setOpen(false); setError(''); setLabel(''); }
    }}>
      <label>Control label<input value={label} onChange={e => setLabel(e.target.value)} /></label>
      <label>Parameter<select value={parameter?.id ?? ''} onChange={e => { setParameter(e.target.value); setColumn(''); }} aria-label="Control parameter">{parameters.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Control type<select value={kind} onChange={e => setKind(e.target.value as ControlKind)}><option value="dropdown">Dropdown</option><option value="slider">Numeric slider</option><option value="date">Date picker</option><option value="text">Text input</option></select></label>
      {kind === 'dropdown' && <>
        <label>Options source<select value={column} onChange={e => setColumn(e.target.value)}><option value="">Static values</option>{parameter?.type === 'string' && strings.map(f => <option key={f.name} value={f.name}>{f.name} (local sales)</option>)}</select></label>
        {!column ? <label>Options (one per line)<textarea value={options} onChange={e => setOptions(e.target.value)} /></label> : <>
          <label>Cascade from<select value={parent} onChange={e => setParent(e.target.value)}><option value="">No parent</option>{sheet.controls.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
          {parent && <label>Parent filter column<select value={matchColumn} onChange={e => setParentColumn(e.target.value)}>{parentFields.map(f => <option key={f.name}>{f.name}</option>)}</select></label>}
        </>}
      </>}
      {kind === 'slider' && <><label>Minimum<input type="number" value={min} onChange={e => setMin(e.target.value)} /></label><label>Maximum<input type="number" value={max} onChange={e => setMax(e.target.value)} /></label><label>Step<input type="number" value={step} onChange={e => setStep(e.target.value)} /></label></>}
      {error && <p role="alert">{error}</p>}<button type="submit">Create control</button>
    </form>}
  </section>;
}
function BoundControl({ control, controls, parameters, parameter, client, onChange }: {
  control: AuthorControl; controls: AuthorControl[]; parameters: AuthorParameter[]; parameter: AuthorParameter; client?: QueryClient; onChange: (values: ParameterValue[]) => void;
}) {
  const key = JSON.stringify(buildControlQuery(control, controls, parameters) ?? null);
  const request = useMemo(() => JSON.parse(key) as ReturnType<typeof buildControlQuery> | null, [key]);
  const [state, setState] = useState<{ key: string; client: QueryClient; values: ParameterValue[]; error?: string }>();
  useEffect(() => {
    if (!client || !request) return;
    const abort = new AbortController();
    const timer = setTimeout(() => { void loadAuthorRows(client, request, abort.signal).then(result => {
      if (!abort.signal.aborted) setState({ key, client, values: (result.rows ?? []).flatMap(row => row[control.source!.columnName] === null ? [] : [row[control.source!.columnName] as ParameterValue]), error: result.message });
    }).catch(() => {}); }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [client, request, key, control.source?.columnName]);
  const fixture = useMemo(() => !client && request ? executeFixtureQuery(request) : undefined, [client, request]);
  const current = client ? state?.key === key && state.client === client ? state : undefined : fixture ? { values: (fixture.rows ?? []).flatMap(row => row[control.source!.columnName] === null ? [] : [row[control.source!.columnName] as ParameterValue]), error: fixture.message } : undefined;
  return <ControlInput control={control} parameter={parameter} options={control.source ? current?.values ?? [] : control.options} pending={!!client && !!request && !current} error={control.source && !request ? 'Unresolved control dataset or cascade' : current?.error} onChange={onChange} />;
}
