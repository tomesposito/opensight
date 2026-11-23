export type MeasureCombination = 'SUM' | 'MIN' | 'MAX' | 'NONE';

/** Combine grouped values only after the caller proves the measure's semantics. */
export function combineGroupedValues(values: readonly (number | null)[], mode: MeasureCombination, fail: (message: string) => never): number | null {
  if (mode === 'NONE') return fail('NONADDITIVE_MEASURE_COMBINATION: grouped values for this measure cannot be combined without recomputing from source data');
  let total: number | null = null;
  for (const value of values) {
    if (value === null) continue;
    total = total === null ? value : mode === 'SUM' ? total + value : mode === 'MIN' ? Math.min(total, value) : Math.max(total, value);
    if (!Number.isFinite(total)) fail('grouped measure total must be finite');
  }
  return total;
}
