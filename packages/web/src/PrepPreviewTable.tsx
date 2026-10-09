import { useState } from 'react';
import type { PrepColumn } from '@opensight/bundle-parser/prep';
import type { PrepPreview } from '@opensight/query-engine';
import { reorderPrepColumns, usePrepColumnDrag } from './prep-column-drag.js';

/** Preview order is presentation-only: rows still bind by column name. */
export function PrepPreviewTable({ columns, rows }: { columns: readonly PrepColumn[]; rows: PrepPreview['rows'] }) {
  const [order, setOrder] = useState(columns.map(c => c.name));
  const drag = usePrepColumnDrag(JSON.stringify(columns));
  const ordered = order.flatMap(name => columns.filter(c => c.name === name));
  return <><p>Drag headers to reorder this preview only, or focus a header and use Alt + ← / →. Use Select columns to change dataset column order.</p>
    <div className="prep-table-scroll"><table><thead><tr>{ordered.map((c, index) => <th key={c.name} tabIndex={0} {...drag.source({ list: 'preview', name: c.name })}
      {...drag.target(c.name, value => value.list === 'preview' && order.includes(value.name) && value.name !== c.name, (value, after) => setOrder(reorderPrepColumns(order, order.indexOf(value.name), index, after)), 'x')}
      onKeyDown={e => { if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); setOrder(reorderPrepColumns(order, index, index + (e.key === 'ArrowLeft' ? -1 : 1), e.key === 'ArrowRight')); } }}>
      {c.name}<small>{c.type}</small></th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{ordered.map(c => <td key={c.name}>{row[c.name] === null ? <em>null</em> : String(row[c.name])}</td>)}</tr>)}</tbody></table></div></>;
}
