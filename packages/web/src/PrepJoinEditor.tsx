import { useState, type ReactNode } from 'react';
import type { PrepColumn, PrepStep } from '@opensight/bundle-parser/prep';
import { PrepJoinIcon, PrepTypeIcon } from './PrepIcons.js';
import { reorderPrepColumns, usePrepColumnDrag, type ColumnDrag } from './prep-column-drag.js';
type JoinConfig = Extract<PrepStep, { kind: 'join' }>['config'];
const joinTypes = ['left', 'inner', 'right', 'full'] as const;
const joinLabel = (type: JoinConfig['joinType']) => `${type[0]!.toUpperCase()}${type.slice(1)} join`;

function ColumnList({ side, columns, selected, choose, drag }: { side: 'left' | 'right'; columns: readonly PrepColumn[]; selected: readonly string[]; choose: (name: string) => void; drag: ReturnType<typeof usePrepColumnDrag> }) {
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState(columns.map(c => c.name));
  const matching = order.flatMap(name => columns.filter(c => c.name === name && c.name.toLowerCase().includes(search.toLowerCase())));
  return <><label className="prep-column-search"><span className="sr-only">Search {side} table columns</span><input type="search" placeholder="Search columns" value={search} onChange={e => setSearch(e.target.value)} /></label>
    <ul className="prep-join-columns" aria-label={`${side === 'left' ? 'Left' : 'Right'} table columns`}>{matching.map(c => <li key={c.name} {...drag.target(`${side}:${c.name}`, value => value.list === side && order.includes(value.name) && value.name !== c.name, (value, after) => setOrder(reorderPrepColumns(order, order.indexOf(value.name), order.indexOf(c.name), after)), 'y')}>
      <button type="button" {...drag.source({ list: side, name: c.name })} aria-label={`Use ${side} column ${c.name}`} title="Drag to reorder or assign a join key. Alt + ↑ / ↓ reorders this list." className={selected.includes(c.name) ? 'used' : ''} onClick={() => choose(c.name)} onKeyDown={e => {
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); const i = order.indexOf(c.name); setOrder(reorderPrepColumns(order, i, i + (e.key === 'ArrowUp' ? -1 : 1), e.key === 'ArrowDown')); }
      }}><PrepTypeIcon type={c.type} /><span>{c.name}</span></button></li>)}</ul>{matching.length === 0 && <p>No matching columns.</p>}</>;
}
function KeyColumn({ side, value, columns, change, index, drag, accepts, drop }: { side: 'left' | 'right'; value: string; columns: readonly PrepColumn[]; change: (value: string) => void; index: number; drag: ReturnType<typeof usePrepColumnDrag>; accepts: (value: ColumnDrag) => boolean; drop: (value: ColumnDrag) => void }) {
  return <label className={`prep-key-column${value ? '' : ' empty'}`} data-key-side={side} data-key-index={index} {...drag.target(`${side}-key:${index}`, accepts, drop)}>
    <span className="sr-only">{side === 'left' ? 'Left' : 'Right'} column {index + 1}</span>
    {value && <span className="prep-drag-handle" {...drag.source({ list: `${side}-keys`, name: value, index })} title="Drag to reorder this key pair" aria-hidden="true">⠿</span>}
    <select aria-label={`${side === 'left' ? 'Left' : 'Right'} column ${index + 1}`} value={value} onChange={e => change(e.target.value)}>
    <option value="" disabled>Add a column from {side} table</option>{value && !columns.some(c => c.name === value) && <option value={value}>{value} (missing)</option>}
    {columns.map(c => <option key={c.name} value={c.name}>{c.name} · {c.type}</option>)}
  </select></label>;
}
export function PrepJoinEditor({ config, leftColumns, rightColumns, leftInput, rightInput, outputs, change }: {
  config: JoinConfig; leftColumns: readonly PrepColumn[]; rightColumns: readonly PrepColumn[];
  leftInput: ReactNode; rightInput: ReactNode; outputs: ReactNode; change: (config: JoinConfig) => void;
}) {
  const drag = usePrepColumnDrag(JSON.stringify([config, leftColumns, rightColumns]));
  const choose = (side: 'left' | 'right', value: string, position?: number) => {
    const keys = config.keys.map(k => ({ ...k }));
    const empty = keys.findIndex(k => !k[side]);
    const index = position ?? (empty < 0 ? keys.length : empty);
    if (!keys[index]) keys.push({ left: '', right: '' });
    keys[index]![side] = value;
    change({ ...config, keys });
  };
  // A trailing placeholder adds a real key as soon as either side is chosen.
  // A half-filled key therefore blocks Apply instead of being silently omitted.
  const keys = config.keys.some(k => !k.left || !k.right) ? config.keys : [...config.keys, { left: '', right: '' }];
  const acceptsKey = (side: 'left' | 'right', position: number, value: ColumnDrag): boolean => {
    if (position >= 256) return false;
    if (value.list === `${side}-keys`) return value.index !== undefined && value.index !== position && position < config.keys.length && config.keys[value.index]?.[side] === value.name;
    if (value.list !== side) return false;
    const column = (side === 'left' ? leftColumns : rightColumns).find(c => c.name === value.name);
    const opposite = side === 'left' ? 'right' : 'left', key = keys[position];
    if (!column || !key || key[side] === value.name) return false;
    const other = (side === 'left' ? rightColumns : leftColumns).find(c => c.name === key[opposite]);
    if (key[opposite] && (!other || other.type !== column.type)) return false;
    return !config.keys.some((k, i) => i !== position && k[side] === value.name && k[opposite] === key[opposite]);
  };
  const dropKey = (side: 'left' | 'right', position: number, value: ColumnDrag) => {
    if (value.list === `${side}-keys` && value.index !== undefined) change({ ...config, keys: reorderPrepColumns(config.keys, value.index, position, value.index < position) });
    else choose(side, value.name, position);
  };
  return <div className="prep-join-editor">
    <div className="prep-join-table">{leftInput}<ColumnList key={JSON.stringify(leftColumns)} side="left" columns={leftColumns} selected={config.keys.map(k => k.left)} choose={name => choose('left', name)} drag={drag} /></div>
    <div className="prep-join-settings"><fieldset className="prep-join-type"><legend>Join type: <strong>{joinLabel(config.joinType)}</strong></legend><div role="radiogroup" aria-label="Join type">{joinTypes.map((type, i) => <button key={type} type="button" role="radio" aria-checked={config.joinType === type} aria-label={joinLabel(type)} title={joinLabel(type)} tabIndex={config.joinType === type ? 0 : -1} onClick={() => change({ ...config, joinType: type })} onKeyDown={e => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? 3 : (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? 3 : 1)) % 4;
        change({ ...config, joinType: joinTypes[next]! });
        e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
      }
    }}><PrepJoinIcon type={type} /></button>)}</div></fieldset>
      <fieldset className="prep-join-keys"><legend>Join keys</legend>{keys.map((key, i) => <div className="prep-join-key" key={i}>
        <KeyColumn side="left" index={i} value={key.left} columns={leftColumns} change={value => choose('left', value, i)} drag={drag} accepts={value => acceptsKey('left', i, value)} drop={value => dropKey('left', i, value)} /><span aria-hidden="true">=</span><KeyColumn side="right" index={i} value={key.right} columns={rightColumns} change={value => choose('right', value, i)} drag={drag} accepts={value => acceptsKey('right', i, value)} drop={value => dropKey('right', i, value)} />
        {i < config.keys.length && <button type="button" className="prep-remove-key" aria-label={`Remove key ${i + 1}`} title="Remove key" onClick={() => change({ ...config, keys: config.keys.filter((_, n) => n !== i) })}>×</button>}
      </div>)}</fieldset>
      <p className="prep-drag-help">Drag table columns onto the matching side of a join key. Drag a key handle to reorder pairs. Table list order is for browsing only.</p>
      <details className="prep-join-outputs"><summary>Right output columns</summary>{outputs}</details>
      <p>Key types must match exactly; use Change data type to convert them. Null keys do not match; duplicate keys multiply rows. Output names must be unique, including letter case.</p>
    </div>
    <div className="prep-join-table">{rightInput}<ColumnList key={JSON.stringify([config.source, rightColumns])} side="right" columns={rightColumns} selected={config.keys.map(k => k.right)} choose={name => choose('right', name)} drag={drag} /></div>
  </div>;
}
