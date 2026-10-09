import type { PrepColumn } from '@opensight/bundle-parser/prep';
import { reorderPrepColumns, usePrepColumnDrag } from './prep-column-drag.js';

/** Selected order is the step's real column order; unselected fields stay below. */
export function PrepColumns({ label, columns, selected, change }: { label: string; columns: readonly PrepColumn[]; selected: string[]; change: (v: string[]) => void }) {
  const drag = usePrepColumnDrag(JSON.stringify([label, columns, selected]));
  const ordered = [...selected.flatMap(name => columns.filter(c => c.name === name)), ...columns.filter(c => !selected.includes(c.name))];
  return <fieldset className="prep-columns"><legend>{label}</legend><p>Drag selected columns to reorder, or focus a row and use Alt + ↑ / ↓.</p>{ordered.map(c => {
    const index = selected.indexOf(c.name);
    return <label key={c.name} data-column={c.name} tabIndex={index < 0 ? undefined : 0}
      {...(index < 0 ? {} : drag.source({ list: label, name: c.name }))}
      {...drag.target(c.name, value => value.list === label && selected.includes(value.name) && index >= 0 && value.name !== c.name, (value, after) => change(reorderPrepColumns(selected, selected.indexOf(value.name), index, after)), 'y')}
      onKeyDown={e => {
        if (e.altKey && index >= 0 && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault(); change(reorderPrepColumns(selected, index, index + (e.key === 'ArrowUp' ? -1 : 1), e.key === 'ArrowDown'));
        }
      }}>
      <span className="prep-drag-handle" aria-hidden="true">⠿</span><input type="checkbox" checked={index >= 0} onChange={e => change(e.target.checked ? [...selected, c.name] : selected.filter(n => n !== c.name))} />{c.name}<small>{c.type}</small>
    </label>;
  })}</fieldset>;
}
