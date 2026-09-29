import { useState, type ReactNode } from 'react';
import { prepTypes, type PrepColumn, type PrepStep, type PrepAggregation, type PrepJoinInput } from '@opensight/bundle-parser/prep';
import { prepLabel, prepRefKey, prepRefLabel, prepSourceRef, prepSourceLabel, prepMessage, type PrepSourceSummary } from './data-prep.js';
const aggregations: PrepAggregation[] = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'];
function Select({ label, value, values, change }: { label: string; value: string; values: readonly string[]; change: (v: string) => void }) {
  return <label>{label}<select value={value} onChange={e => change(e.target.value)}>{!values.includes(value) && <option value={value}>{value || 'Choose a column'}</option>}{values.map(v => <option key={v} value={v}>{v}</option>)}</select></label>;
}
export function PrepSourcePicker({ label, value, sources, change }: { label: string; value: PrepJoinInput; sources: readonly PrepSourceSummary[]; change: (ref: PrepJoinInput) => void }) {
  const key = prepRefKey(value);
  return <label>{label}<select value={key} onChange={e => { const source = sources.find(s => prepRefKey(prepSourceRef(s)) === e.target.value); if (source) change(prepSourceRef(source)); }}>
    {!sources.some(s => prepRefKey(prepSourceRef(s)) === key) && <option value={key}>{prepRefLabel(value) || 'Choose a source'}</option>}
    {sources.map(s => <option key={prepRefKey(prepSourceRef(s))} value={prepRefKey(prepSourceRef(s))} disabled={!s.available}>{prepSourceLabel(s)}{!s.available ? ` (${s.errorCode ?? 'unavailable'})` : ''}</option>)}
  </select></label>;
}
function KeyColumn({ label, value, columns, change }: { label: string; value: string; columns: readonly PrepColumn[]; change: (value: string) => void }) {
  return <label>{label}<select value={value} onChange={e => change(e.target.value)}>{!columns.some(c => c.name === value) && <option value={value}>{value || 'Choose a column'}</option>}{columns.map(c => <option key={c.name} value={c.name}>{c.name} · {c.type}</option>)}</select></label>;
}
function Text({ label, value, change }: { label: string; value: string; change: (v: string) => void }) { return <label>{label}<input value={value} onChange={e => change(e.target.value)} /></label>; }
function Columns({ label, columns, selected, change }: { label: string; columns: readonly PrepColumn[]; selected: string[]; change: (v: string[]) => void }) {
  return <fieldset className="prep-columns"><legend>{label}</legend>{columns.map(c => <label key={c.name}><input type="checkbox" checked={selected.includes(c.name)} onChange={e => change(e.target.checked ? [...selected, c.name] : selected.filter(n => n !== c.name))} />{c.name}<small>{c.type}</small></label>)}</fieldset>;
}
export function PrepStepEditor({ step, columns, sources, apply, cancel, validate }: { step: PrepStep; columns: readonly PrepColumn[]; sources: readonly PrepSourceSummary[]; apply: (step: PrepStep) => void; cancel: () => void; validate?: (step: PrepStep) => void }) {
  const [edited, setEdited] = useState<PrepStep>(() => structuredClone(step));
  const names = columns.map(c => c.name), sourceIds = sources.filter(s => !s.ref || typeof s.ref === 'string').map(s => s.id);
  let fields: ReactNode;
  switch (edited.kind) {
    case 'changeType': { const c = edited.config; fields = <><Select label="Column" value={c.column} values={names} change={column => setEdited({ ...edited, config: { ...c, column } })} /><Select label="New type" value={c.type} values={prepTypes} change={type => setEdited({ ...edited, config: { ...c, type: type as typeof c.type } })} /><p>Invalid text conversions become null. Integer conversion truncates decimals.</p></>; break; }
    case 'rename': { const c = edited.config; fields = <><Select label="Column" value={c.column} values={names} change={column => setEdited({ ...edited, config: { ...c, column } })} /><Text label="New name" value={c.name} change={name => setEdited({ ...edited, config: { ...c, name } })} /></>; break; }
    case 'select': { const c = edited.config; fields = <Columns label="Keep columns" columns={columns} selected={c.columns} change={columns => setEdited({ ...edited, config: { columns } })} />; break; }
    case 'calculate': { const c = edited.config; fields = <><Text label="Column name" value={c.name} change={name => setEdited({ ...edited, config: { ...c, name } })} /><label>Expression<textarea aria-label="Expression" rows={5} value={c.expression} placeholder="{revenue} * 0.9" onChange={e => setEdited({ ...edited, config: { ...c, expression: e.target.value } })} /></label><p>Use row functions and {'{column}'} references. Calculations run in step order. Use Aggregate for totals.</p></>; break; }
    case 'filter': {
      const c = edited.config;
      fields = <>{c.filters.map((f, i) => {
        const numeric = ['INTEGER', 'DECIMAL'].includes(columns.find(col => col.name === f.columnName)?.type ?? '');
        const update = (next: typeof f) => setEdited({ ...edited, config: { filters: c.filters.map((old, n) => n === i ? next : old) } });
        return <fieldset key={i}><legend>Condition {i + 1} (AND)</legend><Select label="Column" value={f.columnName} values={names} change={columnName => update({ columnName, values: [] })} /><Select label="Operator" value={'values' in f ? 'IN' : f.operator ?? 'EQUALS'} values={['IN','EQUALS','GREATER_THAN_OR_EQUAL_TO','LESS_THAN_OR_EQUAL_TO']} change={op => update(op === 'IN' ? { columnName: f.columnName, values: [] } : { columnName: f.columnName, operator: op as typeof f.operator, value: numeric ? 0 : '' })} />{'values' in f ? <label>Values (one per line)<textarea value={f.values.join('\n')} onChange={e => update({ ...f, values: e.target.value === '' ? [] : e.target.value.split('\n') })} /></label> : <Text label="Value" value={String(f.value)} change={value => update({ ...f, value })} />}<button type="button" onClick={() => setEdited({ ...edited, config: { filters: c.filters.filter((_, n) => n !== i) } })}>Remove condition</button></fieldset>;
      })}<button type="button" onClick={() => setEdited({ ...edited, config: { filters: [...c.filters, { columnName: names[0] ?? '', values: [] }] } })}>Add condition</button><p>An empty value list matches no rows. Nulls never match. Dates use ISO UTC values.</p></>; break;
    }
    case 'aggregate': {
      const c = edited.config;
      fields = <><Columns label="Group by" columns={columns} selected={c.groupBy} change={groupBy => setEdited({ ...edited, config: { ...c, groupBy } })} />{c.measures.map((m, i) => {
        const update = (next: typeof m) => setEdited({ ...edited, config: { ...c, measures: c.measures.map((v, n) => n === i ? next : v) } });
        return <fieldset key={i}><legend>Measure {i + 1}</legend><Select label="Column" value={m.column} values={names} change={column => update({ ...m, column })} /><Select label="Aggregation" value={m.aggregation} values={aggregations} change={aggregation => update({ ...m, aggregation: aggregation as PrepAggregation })} /><Text label="Output name" value={m.name} change={name => update({ ...m, name })} /><button type="button" onClick={() => setEdited({ ...edited, config: { ...c, measures: c.measures.filter((_, n) => n !== i) } })}>Remove measure</button></fieldset>;
      })}<button type="button" onClick={() => setEdited({ ...edited, config: { ...c, measures: [...c.measures, { column: names[0] ?? '', name: `measure_${c.measures.length + 1}`, aggregation: 'COUNT' }] } })}>Add measure</button></>; break;
    }
    case 'append': { const c = edited.config; fields = <><Select label="Append source" value={c.source} values={sourceIds} change={source => setEdited({ ...edited, config: { source } })} /><p>Names and types must match. Columns align by name; duplicates are kept.</p></>; break; }
    case 'join': {
      const c = edited.config, rightColumns = sources.find(s => prepRefKey(prepSourceRef(s)) === prepRefKey(c.source))?.columns ?? [], right = rightColumns.map(c => c.name);
      const outputs = c.columns ?? right.map(column => ({ column, name: `${c.prefix}${column}` }));
      const explicit = (columns: { column: string; name: string }[]) => setEdited({ ...edited, config: { source: c.source, joinType: c.joinType, keys: c.keys, columns } });
      fields = <><PrepSourcePicker label="Right source" value={c.source} sources={sources} change={source => setEdited({ ...edited, config: { ...c, source } })} /><Select label="Join type" value={c.joinType} values={['inner','left','right','full']} change={joinType => setEdited({ ...edited, config: { ...c, joinType: joinType as typeof c.joinType } })} />{c.keys.map((k, i) => {
        const update = (next: typeof k) => setEdited({ ...edited, config: { ...c, keys: c.keys.map((v, n) => n === i ? next : v) } });
        return <fieldset key={i}><legend>Join key {i + 1}</legend><KeyColumn label="Left column" value={k.left} columns={columns} change={left => update({ ...k, left })} /><KeyColumn label="Right column" value={k.right} columns={rightColumns} change={right => update({ ...k, right })} /><button type="button" onClick={() => setEdited({ ...edited, config: { ...c, keys: c.keys.filter((_, n) => n !== i) } })}>Remove key</button></fieldset>;
      })}<button type="button" onClick={() => setEdited({ ...edited, config: { ...c, keys: [...c.keys, { left: names[0] ?? '', right: right[0] ?? '' }] } })}>Add key</button>
      <Select label="Right output mode" value={c.columns ? 'Explicit aliases' : 'All columns with prefix'} values={['All columns with prefix', 'Explicit aliases']} change={mode => mode === 'Explicit aliases' ? explicit(outputs) : setEdited({ ...edited, config: { source: c.source, joinType: c.joinType, keys: c.keys, prefix: 'joined_' } })} />
      {c.columns ? <>{c.columns.map((col, i) => {
        const update = (next: typeof col) => explicit(outputs.map((v, n) => n === i ? next : v));
        return <fieldset key={i}><legend>Right output {i + 1}</legend><Select label="Right column to include" value={col.column} values={right} change={column => update({ ...col, column })} /><Text label="Output name" value={col.name} change={name => update({ ...col, name })} /><button type="button" onClick={() => explicit(outputs.filter((_, n) => n !== i))}>Remove output</button></fieldset>;
      })}<button type="button" onClick={() => explicit([...outputs, { column: right[0] ?? '', name: `joined_${outputs.length + 1}` }])}>Add right output</button></> : <><Text label="Right column prefix" value={c.prefix} change={prefix => setEdited({ ...edited, config: { ...c, prefix } })} /><p className="prep-output-names">Right output columns: {outputs.map(c => c.name).join(', ') || 'Choose a right source'}</p></>}
      <p>Key types must match exactly; use Change type to convert them. Null keys do not match; duplicate keys multiply rows. Output names must be unique, including letter case.</p></>; break;
    }
    case 'pivot': {
      const c = edited.config, numeric = ['INTEGER','DECIMAL'].includes(columns.find(col => col.name === c.column)?.type ?? '');
      fields = <><Columns label="Group by" columns={columns} selected={c.groupBy} change={groupBy => setEdited({ ...edited, config: { ...c, groupBy } })} /><Select label="Pivot column" value={c.column} values={names} change={column => setEdited({ ...edited, config: { ...c, column } })} /><Select label="Value column" value={c.value} values={names} change={value => setEdited({ ...edited, config: { ...c, value } })} /><Select label="Aggregation" value={c.aggregation} values={aggregations} change={aggregation => setEdited({ ...edited, config: { ...c, aggregation: aggregation as PrepAggregation } })} />{c.values.map((v,i) => {
        const update = (next: typeof v) => setEdited({ ...edited, config: { ...c, values: c.values.map((old,n) => n === i ? next : old) } });
        return <fieldset key={i}><legend>Pivot output {i + 1}</legend><Text label="Pivot value" value={String(v.value)} change={value => update({ ...v, value })} /><Text label="Output name" value={v.name} change={name => update({ ...v, name })} /><button type="button" onClick={() => setEdited({ ...edited, config: { ...c, values: c.values.filter((_,n) => n !== i) } })}>Remove pivot output</button></fieldset>;
      })}<button type="button" onClick={() => setEdited({ ...edited, config: { ...c, values: [...c.values, { value: numeric ? 0 : '', name: `pivot_${c.values.length + 1}` }] } })}>Add pivot output</button><p>Only these explicit values contribute to pivot measures. Unlisted values contribute no measure.</p></>; break;
    }
    case 'unpivot': { const c = edited.config; fields = <><Columns label="Unpivot columns" columns={columns} selected={c.columns} change={columns => setEdited({ ...edited, config: { ...c, columns } })} /><Text label="Name column" value={c.nameColumn} change={nameColumn => setEdited({ ...edited, config: { ...c, nameColumn } })} /><Text label="Value column" value={c.valueColumn} change={valueColumn => setEdited({ ...edited, config: { ...c, valueColumn } })} /><p>Selected columns must have the same type. Null values are kept.</p></>; break; }
  }
  const configured = (): PrepStep => {
    const value = (raw: string | number, column: string): string | number => typeof raw === 'string' && raw.trim() && ['INTEGER', 'DECIMAL'].includes(columns.find(c => c.name === column)?.type ?? '') ? Number(raw) : raw;
    if (edited.kind === 'filter') return { ...edited, config: { filters: edited.config.filters.map(f => 'value' in f ? { ...f, value: value(f.value, f.columnName) } : { ...f, values: f.values.map(v => value(v, f.columnName)) }) } };
    if (edited.kind === 'pivot') return { ...edited, config: { ...edited.config, values: edited.config.values.map(v => ({ ...v, value: value(v.value, edited.config.column) })) } };
    return edited;
  };
  let problem = '';
  if (edited.kind === 'join' && validate) try { validate(edited); } catch (e) { problem = prepMessage(e); }
  return <form className="prep-step-editor" onSubmit={e => { e.preventDefault(); if (!problem) apply(configured()); }}><h3>{prepLabel(edited.kind)}</h3>{fields}{problem && <p className="prep-error" role="alert">{problem}</p>}<div className="prep-actions"><button type="submit" disabled={!!problem}>Apply step</button><button type="button" onClick={cancel}>Cancel</button></div></form>;
}
