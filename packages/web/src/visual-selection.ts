import type { CompiledVisual } from './compiler.js';
import type { Selection } from './interactions.js';
export interface VisualInteraction { onSelect: (selection: Selection) => void; onClear?: () => void; brush?: boolean }
export function rowSelection(compiled: CompiledVisual, index: number): Selection | undefined {
  const row = compiled.table.rows[index];
  if (!row || compiled.state !== 'ready' || compiled.table.rowKinds?.[index] && compiled.table.rowKinds[index] !== 'detail') return;
  const fields = compiled.model.kind === 'pivot' ? compiled.model.rowDimensions : compiled.model.dimensions;
  const values: Selection['values'] = Object.fromEntries(fields.flatMap((field, i) => { const cell = row[i]; return typeof cell === 'string' || typeof cell === 'number' ? [[field.column, cell]] : []; }));
  return Object.keys(values).length ? { values } : undefined;
}
export function brushSelection(compiled: CompiledVisual, range: unknown): Selection | undefined {
  if (!Array.isArray(range) || range.length !== 2 || !range.every(n => typeof n === 'number' && Number.isFinite(n))) return;
  const first = Math.max(0, Math.ceil(Math.min(...range as number[]))), last = Math.min(compiled.table.rows.length - 1, Math.floor(Math.max(...range as number[])));
  if (first > last) return;
  const a = rowSelection(compiled, first), b = rowSelection(compiled, last), field = compiled.model.dimensions[0]?.column;
  if (!a || !b || !field) return;
  return { values: a.values, range: [String(a.values[field]), String(b.values[field])] };
}
