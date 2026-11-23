import type { Cell } from './model.js';

/** Rank for the explicit cross-type order: numbers, then strings, then booleans. */
function typeRank(value: string | number | boolean): number {
  return typeof value === 'number' ? 0 : typeof value === 'string' ? 1 : 2;
}

/** Shared field/category and facet ordering. The comparator is a total order:
 * cells first order by type rank (number < string < boolean), then within a
 * type numerically, lexically, or false-before-true. A mixed-type column
 * therefore sorts the same regardless of incoming row order — the previous
 * numeric-pair/string-otherwise rule was intransitive (2 < 10 numerically,
 * 10 < "15" textually, "15" < 2 textually). NaN sorts after every other
 * number and equal to itself so numeric order stays total. Null stays last
 * in either direction. */
export function compareCells(a: Cell, b: Cell, direction: 'ASC' | 'DESC'): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  let cmp: number;
  if (typeof a === 'number' && typeof b === 'number') {
    cmp = Number.isNaN(a) ? (Number.isNaN(b) ? 0 : 1) : Number.isNaN(b) ? -1 : a < b ? -1 : a > b ? 1 : 0;
  } else if (typeof a === 'string' && typeof b === 'string') {
    cmp = a < b ? -1 : a > b ? 1 : 0;
  } else if (typeof a === 'boolean' && typeof b === 'boolean') {
    cmp = a === b ? 0 : a ? 1 : -1;
  } else {
    cmp = typeRank(a) - typeRank(b);
  }
  return direction === 'DESC' && cmp !== 0 ? -cmp : cmp;
}
