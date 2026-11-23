import type { Cell, Field, Row, VisualModel } from './model.js';
import type { VisualKind } from './visual-catalog.js';
import { combineGroupedValues, type MeasureCombination } from './measure-combination.js';

export const CATEGORY_LIMIT_KINDS: readonly VisualKind[] = ['pie', 'bar', 'bar100', 'line', 'area', 'combo'];

interface CategoryLimitFields {
  category: Field;
  remainingDimensions: readonly Field[];
  measures: readonly Field[];
  extraFields: readonly Field[];
  cell: (row: Row, field: Field) => Cell;
  number: (row: Row, field: Field) => number | null;
  column: (field: Field) => string;
  combination: (field: Field) => MeasureCombination;
  fail: (message: string) => never;
}

/** Limit distinct categories within one facet, in first-appearance display
 * order. Keep all rows for each retained category; merge the rest by the
 * remaining dimensions. Unset/non-binding limits preserve the input rows. */
export function applyCategoryLimit(rows: Row[], limit: VisualModel['sliceLimit'], fields: CategoryLimitFields): Row[] {
  if (!limit) return rows;
  const { category, remainingDimensions, measures, extraFields, cell, number, column, combination, fail } = fields;
  const categories = new Set(rows.map(row => cell(row, category)));
  if (categories.size <= limit.count) return rows;
  const retained = new Set([...categories].slice(0, limit.count));
  const kept = rows.filter(row => retained.has(cell(row, category)));
  if (!limit.includeOther) return kept;
  const rest = rows.filter(row => !retained.has(cell(row, category)));
  // A retained literal Other folds into the bucket without promoting another
  // category (#126). Append it after the dropped rows to preserve pie sums.
  rest.push(...kept.filter(row => cell(row, category) === 'Other'));
  const result = kept.filter(row => cell(row, category) !== 'Other');
  const key = (row: Row) => JSON.stringify(remainingDimensions.map(field => cell(row, field)));
  const buckets = new Map<string, Row[]>();
  for (const row of rest) {
    const k = key(row);
    const bucket = buckets.get(k) ?? [];
    bucket.push(row);
    buckets.set(k, bucket);
  }
  for (const [k, bucket] of buckets) {
    // Pie historically copies the first retained row before replacing the
    // category, measures and extras. Keep that behavior for its one bucket.
    const other: Record<string, Cell> = { ...kept.find(row => key(row) === k) ?? bucket[0]! };
    other[column(category)] = 'Other';
    for (const measure of measures) {
      const values = bucket.map(row => number(row, measure));
      other[column(measure)] = values.length === 1 ? values[0]! : combineGroupedValues(values, combination(measure), fail);
    }
    // Adornments cannot be inferred from already aggregated rows.
    for (const extra of extraFields) other[column(extra)] = null;
    result.push(other);
  }
  return result;
}
