import type { Cell } from './model.js';

/** Shared field/category and facet ordering: numeric pairs compare numerically,
 * other cells compare as strings, and null stays last in either direction. */
export function compareCells(a: Cell, b: Cell, direction: 'ASC' | 'DESC'): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  const cmp = typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  return direction === 'DESC' ? -cmp : cmp;
}
