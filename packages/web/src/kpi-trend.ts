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
