import { groupedPeriodDate, resultDate } from '@opensight/query-engine/browser';
import { compareCells } from './cell-sort.js';
import type { Cell, Field, Row } from './model.js';

/** Sort already grouped rows without mutating input or combining result values. */
export function orderKpiTrend(rows: readonly Row[], field: Field, direction: 'ASC' | 'DESC', cell: (row: Row, field: Field) => Cell, fail: (message: string) => never): Row[] {
  const seen = new Set<string>();
  const keyed = rows.map(row => {
    const value = cell(row, field), identity = JSON.stringify(value);
    if (seen.has(identity)) fail('duplicate trend groups: expected aggregated result rows');
    seen.add(identity);
    let key = value;
    if (value !== null && field.dateGranularity) {
      const date = typeof value === 'string' && value.includes('T') ? resultDate(value) : groupedPeriodDate(value, field.dateGranularity);
      if (!date || !Number.isFinite(date.getTime())) fail('invalid date trend key');
      key = date.getTime();
    }
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
