import { aggregateValue, formatNumber, relativeDifference, shiftDate, resultDate, groupedPeriodDate } from '@opensight/query-engine/browser';
import type { Cell, Field } from './model.js';
import type { VisualFormatting } from './formatting.js';
import { fieldName } from './formatting.js';
import { insightFail, normalizeInsight } from './insight-configuration.js';
export { InsightError } from './insight-configuration.js';

export interface NarrativePart { text: string; value?: number }
export interface NarrativeParagraph { id: string; parts: NarrativePart[] }
export interface InsightNarrative { paragraphs: NarrativeParagraph[]; text: string }
export interface InsightRow { category: Cell; values: (number | null)[] }
export interface InsightInput { category?: Field; measures: Field[]; computations?: unknown; formatting?: VisualFormatting }

/** Pure post-processing of authorized, aggregated rows, shared by every renderer. */
export function insightNarrative(rows: readonly InsightRow[], input: InsightInput): InsightNarrative {
  const requests = normalizeInsight(input.computations ?? {}, input.category ? [input.category] : [], input.measures);
  const text = (text: string): NarrativePart => ({ text });
  const value = (n: number | null, percent = false): NarrativePart => {
    if (n === null) return text('unavailable');
    const displayed = percent ? n * 100 : n;
    if (!Number.isFinite(displayed)) return insightFail('INSIGHT_VALUE_INVALID', 'nonfinite computed result');
    return { text: `${formatNumber(displayed, input.formatting?.decimalPlaces ?? (percent ? 2 : undefined))}${percent ? '%' : ''}`, value: displayed };
  };
  const label = (c: Cell) => c === null ? '(null)' : String(c);
  for (const r of rows) if (r.values.length !== input.measures.length || r.values.some(n => n !== null && (typeof n !== 'number' || !Number.isFinite(n)))) insightFail('INSIGHT_VALUE_INVALID', 'each measure must be a finite number or null');
  if (new Set(rows.map(r => JSON.stringify(r.category))).size !== rows.length) insightFail('INSIGHT_CATEGORY_INVALID', 'expected unique aggregated categories');
  const sum = (index: number): number | null => {
    try { return aggregateValue('sum', rows.map(r => r.values[index]!)) as number | null; }
    catch { return insightFail('INSIGHT_VALUE_INVALID', 'nonfinite total'); }
  };
  const paragraphs = rows.length ? requests.map(request => {
    const name = fieldName(input.measures[request.measure]!, input.formatting), total = sum(request.measure);
    const numeric = rows.filter(r => r.values[request.measure] !== null);
    let parts: NarrativePart[];
    if (request.kind === 'totalAggregation') {
      parts = [text(`Total ${name}: `), value(total), text('.')];
    } else if (request.kind === 'maximumMinimum' || request.kind === 'topBottomRanked') {
      // Stable ties use typed category ordering, independent of incoming row order.
      const sorted = [...numeric].sort((a, b) => {
        const av = a.values[request.measure]!, bv = b.values[request.measure]!;
        const cmp = av === bv ? 0 : av! < bv! ? -1 : 1;
        if (cmp) return request.type === 'MINIMUM' || request.type === 'BOTTOM' ? cmp : -cmp;
        const ak = JSON.stringify(a.category), bk = JSON.stringify(b.category); return ak < bk ? -1 : ak > bk ? 1 : 0;
      });
      const chosen = sorted.slice(0, request.kind === 'maximumMinimum' ? 1 : request.size);
      parts = [text(`${request.kind === 'maximumMinimum' ? request.type === 'MAXIMUM' ? 'Highest' : 'Lowest' : request.type === 'TOP' ? `Top ${request.size}` : `Bottom ${request.size}`} ${name}: `)];
      if (!chosen.length) parts.push(text('no non-null values'));
      chosen.forEach((row, index) => {
        if (index) parts.push(text('; '));
        const n = row.values[request.measure]!;
        parts.push(text(`${label(row.category)} (`), value(n));
        if (request.kind === 'maximumMinimum') parts.push(text(', '), value(total === null || total === 0 ? null : n! / total, true), text(' of total'));
        parts.push(text(')'));
      });
      parts.push(text('.'));
    } else if (request.kind === 'metricComparison') {
      const target = sum(request.target!), targetName = fieldName(input.measures[request.target!]!, input.formatting);
      parts = [text(`${name} vs ${targetName}: `), value(total), text(' vs '), value(target), text('; difference '), value(total === null || target === null ? null : total - target), text(' ('), value(relativeDifference(total, target, true), true), text(').')];
    } else {
      const dated = rows.map(row => {
        const date = groupedPeriodDate(row.category, input.category!.dateGranularity!);
        if (!date) return insightFail('INSIGHT_TIME_REQUIRED', 'invalid date/time category for the bound grain');
        return { row, date };
      }).sort((a, b) => a.date.getTime() - b.date.getTime());
      if (new Set(dated.map(r => r.date.getTime())).size !== dated.length) insightFail('INSIGHT_CATEGORY_INVALID', 'duplicate date/time periods');
      const latest = dated.at(-1)!;
      const grain = input.category!.dateGranularity!;
      const previousDate = resultDate(shiftDate(latest.date.toISOString(), -1, { DAY: 'DD', MONTH: 'MM', QUARTER: 'Q', YEAR: 'YYYY' }[grain]));
      const previous = dated.find(r => r.date.getTime() === previousDate.getTime());
      if (!previous) parts = [text(`${request.kind === 'growthRate' ? 'Growth rate' : 'Period change'} for ${name}: previous period unavailable.`)];
      else {
        const current = latest.row.values[request.measure]!, prior = previous.row.values[request.measure]!;
        parts = [text(`${request.kind === 'growthRate' ? 'Growth rate' : 'Period change'} for ${name}, ${label(latest.row.category)} vs ${label(previous.row.category)}: `), value(current), text(' vs '), value(prior), text('; change '), value(current === null || prior === null ? null : current - prior), text(' ('), value(relativeDifference(current, prior), true), text(').')];
      }
    }
    const nulls = rows.length - numeric.length;
    if (nulls && ['totalAggregation', 'maximumMinimum', 'topBottomRanked'].includes(request.kind)) parts.push(text(` ${nulls} null group${nulls === 1 ? '' : 's'} excluded.`));
    return { id: request.id, parts };
  }) : [];
  return { paragraphs, text: paragraphs.map(p => p.parts.map(part => part.text).join('')).join('\n\n') };
}
