/** Shared post-aggregation arithmetic. Ratios stay fractions until display. */
export function relativeDifference(current: number | null, previous: number | null, absoluteBase = false): number | null {
  return current === null || previous === null || previous === 0 ? null
    : (current - previous) / (absoluteBase ? Math.abs(previous) : previous);
}
/** Presentation for aggregated numbers; no rounding enters query math. */
export function formatNumber(value: number, decimalPlaces?: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: decimalPlaces, maximumFractionDigits: decimalPlaces ?? 12 }).format(value);
}

/** Calendar shifting uses the same UTC/month-clamping rules as query expressions. */
export { addDate as shiftDate, asDate as resultDate } from './datetime.js';
