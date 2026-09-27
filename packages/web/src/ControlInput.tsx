import { useState } from 'react';
import type { AuthorControl } from './controls.js';
import { parameterValueError, type AuthorParameter, type ParameterValue } from './parameters.js';
export function ControlInput({ control, parameter, options = control.options ?? [], pending = false, error, onChange }: {
  control: AuthorControl; parameter: AuthorParameter; options?: ParameterValue[]; pending?: boolean; error?: string; onChange: (values: ParameterValue[]) => void;
}) {
  const [invalid, setInvalid] = useState('');
  const change = (values: ParameterValue[]) => { const problem = parameterValueError(parameter, values); setInvalid(problem ?? ''); if (!problem) onChange(values); };
  const value = parameter.values[0];
  return <div className="parameter-control" aria-busy={pending}>
    <label>{control.label}
      {control.kind === 'dropdown' ? <select aria-label={control.label} multiple={parameter.multiple} disabled={pending || !!error}
        value={parameter.multiple ? parameter.values.map(String) : value === undefined ? '' : String(value)} onChange={e => {
          const values = parameter.multiple ? Array.from(e.target.selectedOptions, o => o.value) : [e.target.value];
          change(values.map(v => parameter.type === 'number' ? Number(v) : v));
        }}>
        {!parameter.multiple && value === undefined && <option value="" disabled>Choose a value…</option>}
        {[...new Set([...options, ...parameter.values])].map(v => <option key={String(v)} value={String(v)}>{String(v) || '(empty string)'}{options.includes(v) ? '' : ' (unavailable)'}</option>)}
      </select> : control.kind === 'slider' ? <><input aria-label={control.label} type="range" min={control.min} max={control.max} step={control.step} value={value ?? control.min} onChange={e => change([Number(e.target.value)])} /><output>{value ?? 'No value'}</output></>
        : <input aria-label={control.label} type={control.kind === 'date' ? 'date' : 'text'} value={control.kind === 'date' ? String(value ?? '').slice(0, 10) : value ?? ''} onChange={e => change(control.kind === 'date' ? e.target.value ? [`${e.target.value}T00:00:00Z`] : [] : [e.target.value])} />}
    </label>
    {pending && <span role="status">Loading options…</span>}{(error || invalid) && <span role="alert">{error || invalid}</span>}
    <button type="button" onClick={() => change(parameter.defaultValues)}>Reset {control.label}</button>
    {parameter.multiple && <button type="button" onClick={() => change([])}>Clear {control.label}</button>}
  </div>;
}
