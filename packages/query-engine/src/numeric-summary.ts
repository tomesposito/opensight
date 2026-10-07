import { asDate, truncateDate } from './datetime.js';
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

/** Decode the date labels emitted by every grouped-query dialect and fixture evaluator. */
export function groupedPeriodDate(value: unknown, grain: 'DAY' | 'MONTH' | 'QUARTER' | 'YEAR'): Date | null {
  if (typeof value !== 'string') return null;
  let iso = value;
  if (grain === 'YEAR' && /^\d{4}$/.test(value)) iso += '-01-01';
  else if (grain === 'MONTH' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) iso += '-01';
  else if (grain === 'QUARTER' && /^\d{4}-Q[1-4]$/.test(value)) iso = `${value.slice(0, 4)}-${String((Number(value.at(-1)) - 1) * 3 + 1).padStart(2, '0')}-01`;
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(iso)) return null;
  const date = asDate(iso);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso.slice(0, 10)) return null;
  const period = truncateDate(date.toISOString(), { DAY: 'DD', MONTH: 'MM', QUARTER: 'Q', YEAR: 'YYYY' }[grain]);
  return period === null ? null : asDate(period);
}
