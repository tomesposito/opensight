import { groupedPeriodDate } from '@opensight/query-engine/browser';
import { compareCells } from './cell-sort.js';
import type { Cell, Field, Row } from './model.js';
import { combineGroupedValues, type MeasureCombination } from './measure-combination.js';

/** A single group needs no combination proof; nulls never manufacture a zero. */
export function kpiTotal(values: readonly (number | null)[], mode: MeasureCombination, fail: (message: string) => never): number | null {
  return values.length <= 1 ? values[0] ?? null : combineGroupedValues(values, mode, fail);
}

/** Sort already grouped rows without mutating input or combining result values. */
export function orderKpiTrend(rows: readonly Row[], field: Field, direction: 'ASC' | 'DESC', cell: (row: Row, field: Field) => Cell, fail: (message: string) => never): Row[] {
  const seen = new Set<string>();
  const keyed = rows.map(row => {
    const value = cell(row, field);
    let key: Cell = value, identity = JSON.stringify(value);
    if (value !== null && field.dateGranularity) {
      // Decode every label through the shared grain-aware decoder and detect
      // duplicates on the canonical period (issue #315): equivalent labels
      // ('2025-01' vs '2025-01-01T00:00:00Z') and distinct timestamps inside
      // one declared period are the same group. Original values stay on the
      // rows for display; only the ordering/identity key is canonicalized.
      const date = groupedPeriodDate(value, field.dateGranularity);
      if (!date || !Number.isFinite(date.getTime())) fail('invalid date trend key');
      key = date.getTime();
      identity = `date:${key}`;
    }
    if (seen.has(identity)) fail('duplicate trend groups: expected aggregated result rows');
    seen.add(identity);
    return { row, key };
  });
  return keyed.sort((a, b) => compareCells(a.key, b.key, direction)).map(({ row }) => row);
}

/** Compare the final two ordered groups; null/zero bases do not invent a value. */
export function kpiComparison(values: readonly (number | null)[], method: 'DIFFERENCE' | 'PERCENT_DIFFERENCE'): number | null {
  if (values.length < 2) return null;
  const current = values.at(-1)!, previous = values.at(-2)!;
  if (current === null || previous === null || method === 'PERCENT_DIFFERENCE' && previous === 0) return null;
  const difference = current - previous;
  const result = method === 'DIFFERENCE' ? difference : difference / previous * 100;
  return Number.isFinite(result) ? result : null;
}
