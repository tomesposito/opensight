import { useState } from 'react';
import type { PrepColumn } from '@opensight/bundle-parser/prep';
import type { PrepPreview } from '@opensight/query-engine';
import { reorderPrepColumns, usePrepColumnDrag } from './prep-column-drag.js';

/** Preview order is presentation-only: rows still bind by column name. */
export function PrepPreviewTable({ columns, rows, onAction, actionsDisabled = false }: {
  columns: readonly PrepColumn[]; rows: PrepPreview['rows'];
  onAction?: (kind: 'calculate' | 'filter' | 'rename', column?: string) => void;
  actionsDisabled?: boolean;
}) {
  const [order, setOrder] = useState(columns.map(c => c.name));
  const drag = usePrepColumnDrag(JSON.stringify(columns));
  const ordered = order.flatMap(name => columns.filter(c => c.name === name));
  return <>{onAction && <div className="prep-grid-tools"><button type="button" disabled={actionsDisabled} onClick={() => onAction('calculate')}>＋ Formula column</button><span>{actionsDisabled ? 'Select the last valid step to add grid transformations.' : 'Column actions add preparation steps. Cell values are read-only.'}</span></div>}
    <p>Drag headers to reorder this preview only, or focus a header and use Alt + ← / →. Use Select columns to change dataset column order.</p>
    <div className="prep-table-scroll" role="region" aria-label="Dataset preview grid" tabIndex={0}><table><thead><tr><th scope="col" className="prep-row-number"><span className="sr-only">Row number</span>#</th>{ordered.map((c, index) => <th scope="col" key={c.name} tabIndex={0} {...drag.source({ list: 'preview', name: c.name })}
      {...drag.target(c.name, value => value.list === 'preview' && order.includes(value.name) && value.name !== c.name, (value, after) => setOrder(reorderPrepColumns(order, order.indexOf(value.name), index, after)), 'x')}
      onKeyDown={e => { if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); setOrder(reorderPrepColumns(order, index, index + (e.key === 'ArrowLeft' ? -1 : 1), e.key === 'ArrowRight')); } }}>
      {c.name}<small>{c.type}</small>{onAction && <div className="prep-grid-column-actions">
        <button type="button" aria-label={`Filter ${c.name}`} disabled={actionsDisabled} onClick={() => onAction('filter', c.name)}>Filter</button>
        <button type="button" aria-label={`Rename ${c.name}`} disabled={actionsDisabled} onClick={() => onAction('rename', c.name)}>Rename</button>
      </div>}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}><th scope="row" className="prep-row-number">{i + 1}</th>{ordered.map(c => <td key={c.name}>{row[c.name] === null ? <em>null</em> : String(row[c.name])}</td>)}</tr>)}</tbody></table></div></>;
}
