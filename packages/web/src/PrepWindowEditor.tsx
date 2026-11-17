import { useState } from 'react';
import { prepWindowFunctions, type PrepColumn, type PrepWindowConfig, type PrepWindowStructured } from '@opensight/bundle-parser/prep';
import { PrepColumns } from './PrepColumns.js';
import { prepWindowDefaults, prepWindowExpression, prepWindowLabels } from './data-prep.js';

export function PrepWindowEditor({ config, columns, change }: { config: PrepWindowConfig; columns: readonly PrepColumn[]; change: (config: PrepWindowConfig) => void }) {
  const [structured, setStructured] = useState<PrepWindowStructured>(() => 'expression' in config ? prepWindowDefaults('rowNumber', columns) : config);
  const [advanced, setAdvanced] = useState<string | undefined>(() => 'expression' in config ? config.expression : undefined);
  const numeric = (label: string, key: 'frameBefore' | 'frameAfter' | 'buckets' | 'offset', value: number, min: number) => <label>{label}<input aria-label={label} type="number" min={min} max={2147483647} step={1} value={Number.isNaN(value) ? '' : value} onChange={e => change({ ...config, [key]: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>;
  return <>
    <label>Output name<input aria-label="Output name" value={config.name} onChange={e => change({ ...config, name: e.target.value })} /></label>
    <label className="prep-window-mode"><input type="checkbox" aria-label="Advanced mode" checked={'expression' in config} onChange={e => {
      if (e.target.checked && !('expression' in config)) { setStructured(config); change({ name: config.name, expression: advanced ?? prepWindowExpression(config) }); }
      else if ('expression' in config) { setAdvanced(config.expression); change({ ...structured, name: config.name }); }
    }} />Advanced mode</label>
    {'expression' in config ? <>
      <label>Window expression<textarea aria-label="Window expression" rows={5} value={config.expression} onChange={e => change({ ...config, expression: e.target.value })} /></label>
      <p>One supported window function with OVER only; unsupported SQL fails validation. Each mode retains its own draft.</p>
    </> : <>
      <label>Function<select aria-label="Function" value={config.function} onChange={e => {
        const fn = prepWindowFunctions.find(fn => fn === e.target.value);
        if (fn) change(prepWindowDefaults(fn, columns, config));
      }}>{prepWindowFunctions.map(fn => <option key={fn} value={fn}>{prepWindowLabels[fn]}</option>)}</select></label>
      {config.valueColumn !== undefined && <label>Value column<select aria-label="Value column" value={config.valueColumn} onChange={e => change({ ...config, valueColumn: e.target.value })}>
        {!columns.some(c => c.name === config.valueColumn) && <option value={config.valueColumn}>{config.valueColumn || 'Choose a column'}</option>}
        {columns.filter(c => config.function === 'lag' || config.function === 'lead' || c.type === 'INTEGER' || c.type === 'DECIMAL').map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
      </select></label>}
      <PrepColumns label="Partition by (restart for each)" columns={columns} selected={config.partitionBy} change={partitionBy => change({ ...config, partitionBy })} />
      <PrepColumns label="Order by (first to last priority)" columns={columns} selected={config.orderBy.map(o => o.column)} change={names => change({ ...config, orderBy: names.map(column => config.orderBy.find(o => o.column === column) ?? { column, direction: 'asc' }) })} />
      {config.orderBy.map((order, i) => <label key={order.column}>Direction for {order.column}<select aria-label={`Direction for ${order.column}`} value={order.direction} onChange={e => change({ ...config, orderBy: config.orderBy.map((o, n) => n === i ? { ...o, direction: e.target.value === 'desc' ? 'desc' : 'asc' } : o) })}><option value="asc">Ascending (first)</option><option value="desc">Descending (latest)</option></select></label>)}
      {(config.function === 'movingAverage' || config.function === 'movingSum') && <>{numeric('Rows before', 'frameBefore', config.frameBefore ?? 0, 0)}{numeric('Rows after', 'frameAfter', config.frameAfter ?? 0, 0)}</>}
      {config.function === 'ntile' && numeric('Buckets', 'buckets', config.buckets ?? 4, 1)}
      {(config.function === 'lag' || config.function === 'lead') && numeric('Offset', 'offset', config.offset ?? 1, 1)}
    </>}
    <p>Order by is required. Include unique tie-breakers for stable row numbers; nulls sort last. Preview sorting does not set window order.</p>
  </>;
}
