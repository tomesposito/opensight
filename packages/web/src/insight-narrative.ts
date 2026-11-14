import { aggregateValue, formatNumber, relativeDifference, shiftDate, resultDate, groupedPeriodDate } from '@opensight/query-engine/browser';
import type { Cell, Field } from './model.js';
import type { VisualFormatting } from './formatting.js';
import { fieldName } from './formatting.js';
import { insightFail, normalizeInsight } from './insight-configuration.js';
import { computeForecast, MIN_FORECAST_POINTS } from './forecast.js';
export { InsightError } from './insight-configuration.js';

export interface NarrativePart { text: string; value?: number }
export interface NarrativeParagraph { id: string; parts: NarrativePart[] }
export interface InsightNarrative { paragraphs: NarrativeParagraph[]; text: string }
export interface InsightRow { category: Cell; time?: Cell; values: (number | null)[] }
export interface InsightInput { category?: Field; time?: Field; measures: Field[]; computations?: unknown; formatting?: VisualFormatting }

/** Pure post-processing of authorized, aggregated rows, shared by every renderer. */
export function insightNarrative(rows: readonly InsightRow[], input: InsightInput): InsightNarrative {
  const requests = normalizeInsight(input.computations ?? {}, input.category ? [input.category, ...(input.time ? [input.time] : [])] : [], input.measures);
  const text = (text: string): NarrativePart => ({ text });
  const value = (n: number | null, percent = false): NarrativePart => {
    if (n === null) return text('unavailable');
    const displayed = percent ? n * 100 : n;
    if (!Number.isFinite(displayed)) return insightFail('INSIGHT_VALUE_INVALID', 'nonfinite computed result');
    return { text: `${formatNumber(displayed, input.formatting?.decimalPlaces ?? (percent ? 2 : undefined))}${percent ? '%' : ''}`, value: displayed };
  };
  const label = (c: Cell) => c === null ? '(null)' : String(c);
  for (const r of rows) if (r.values.length !== input.measures.length || r.values.some(n => n !== null && (typeof n !== 'number' || !Number.isFinite(n)))) insightFail('INSIGHT_VALUE_INVALID', 'each measure must be a finite number or null');
  const duplicateCode = requests.some(r => r.kind === 'forecast' || r.kind === 'periodToDate') ? 'INSIGHT_VALUE_INVALID' : 'INSIGHT_CATEGORY_INVALID';
  if (requests.some(r => r.kind === 'topBottomMovers')) {
    // Movers rows are grouped by (category, period): categories repeat across periods, pairs must not.
    if (new Set(rows.map(r => JSON.stringify([r.category, r.time]))).size !== rows.length) insightFail('INSIGHT_VALUE_INVALID', 'expected unique aggregated category/period rows');
  } else if (new Set(rows.map(r => JSON.stringify(r.category))).size !== rows.length) insightFail(duplicateCode, 'expected unique aggregated categories');
  const datedRows = () => {
    const dated = rows.map(row => {
      const date = groupedPeriodDate(row.category, input.category!.dateGranularity!);
      if (!date) return insightFail('INSIGHT_TIME_REQUIRED', 'invalid date/time category for the bound grain');
      return { row, date };
    }).sort((a, b) => a.date.getTime() - b.date.getTime());
    if (new Set(dated.map(r => r.date.getTime())).size !== dated.length) insightFail(duplicateCode, 'duplicate date/time periods');
    return dated;
  };
  const sum = (index: number, groups = rows): number | null => {
    try { return aggregateValue('sum', groups.map(r => r.values[index]!)) as number | null; }
    catch { return insightFail('INSIGHT_VALUE_INVALID', 'nonfinite total'); }
  };
  const paragraphs = requests.filter(request => rows.length || request.kind === 'periodToDate').map(request => {
    const name = request.kind === 'uniqueValues' ? '' : fieldName(input.measures[request.measure]!, input.formatting), total = request.kind === 'forecast' || request.kind === 'periodToDate' || request.kind === 'uniqueValues' || request.kind === 'topBottomMovers' ? null : sum(request.measure);
    const numeric = rows.filter(r => r.values[request.measure] !== null);
    let parts: NarrativePart[];
    if (request.kind === 'uniqueValues') {
      // Distinct categories in deterministic typed order, independent of incoming row order.
      const sorted = [...rows].sort((a, b) => { const ak = JSON.stringify(a.category), bk = JSON.stringify(b.category); return ak < bk ? -1 : ak > bk ? 1 : 0; });
      parts = [text(`Unique ${fieldName(input.category!, input.formatting)}: `),
        ...sorted.flatMap((row, index) => [...(index ? [text('; ')] : []), text(label(row.category))]), text('.')];
    } else if (request.kind === 'totalAggregation') {
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
    } else if (request.kind === 'periodToDate') {
      const dated = datedRows(), latest = dated.at(-1), grain = request.periodTimeGranularity;
      const grains = ['DAY', 'MONTH', 'QUARTER', 'YEAR'];
      if (!latest) parts = [text(`Period-to-date ${name}: unavailable (no dated rows).`)];
      else if (grains.indexOf(grain) < grains.indexOf(input.category!.dateGranularity!)) {
        parts = [text(`Period-to-date ${name}: unavailable (${grain} is finer than the bound ${input.category!.dateGranularity!} grain).`)];
      } else {
        const start = groupedPeriodDate(latest.date.toISOString(), grain)!;
        const next = resultDate(shiftDate(start.toISOString(), 1, { DAY: 'DD', MONTH: 'MM', QUARTER: 'Q', YEAR: 'YYYY' }[grain]));
        const groups = dated.filter(r => r.date >= start && r.date < next).map(r => r.row);
        const periodTotal = sum(request.measure, groups), iso = start.toISOString();
        const period = grain === 'YEAR' ? iso.slice(0, 4) : grain === 'MONTH' ? iso.slice(0, 7)
          : grain === 'QUARTER' ? `${iso.slice(0, 4)}-Q${Math.floor(start.getUTCMonth() / 3) + 1}` : iso.slice(0, 10);
        parts = [text(`Period-to-date ${name} for ${period} (${grain}): `),
          ...(periodTotal === null ? [text('unavailable (no non-null values in the period)')] : [value(periodTotal)]), text('.')];
        const nulls = groups.filter(r => r.values[request.measure] === null).length;
        if (nulls) parts.push(text(` ${nulls} null group${nulls === 1 ? '' : 's'} excluded.`));
      }
    } else if (request.kind === 'topBottomMovers') {
      const grain = input.time!.dateGranularity!;
      const dated = rows.map(row => {
        const date = groupedPeriodDate(row.time, grain);
        if (!date) return insightFail('INSIGHT_TIME_REQUIRED', 'invalid date/time value for the bound grain');
        return { row, date };
      });
      const latestTime = Math.max(...dated.map(d => d.date.getTime()));
      const latestDate = new Date(latestTime);
      const previousDate = resultDate(shiftDate(latestDate.toISOString(), -1, { DAY: 'DD', MONTH: 'MM', QUARTER: 'Q', YEAR: 'YYYY' }[grain]));
      const periodLabel = (d: Date): string => {
        const iso = d.toISOString();
        return grain === 'YEAR' ? iso.slice(0, 4) : grain === 'MONTH' ? iso.slice(0, 7)
          : grain === 'QUARTER' ? `${iso.slice(0, 4)}-Q${Math.floor(d.getUTCMonth() / 3) + 1}` : iso.slice(0, 10);
      };
      interface Mover { category: Cell; prev: number; cur: number; diff: number; pct: number | null }
      const byCategory = new Map<string, { category: Cell; values: Map<number, number | null> }>();
      for (const { row, date } of dated) {
        const key = JSON.stringify(row.category);
        let group = byCategory.get(key);
        if (!group) { group = { category: row.category, values: new Map() }; byCategory.set(key, group); }
        group.values.set(date.getTime(), row.values[request.measure]!);
      }
      const movers: Mover[] = [];
      let excluded = 0;
      for (const group of byCategory.values()) {
        const cur = group.values.get(latestTime), prev = group.values.get(previousDate.getTime());
        if (cur === undefined || cur === null || prev === undefined || prev === null) { excluded++; continue; }
        const diff = cur - prev;
        if (!Number.isFinite(diff)) return insightFail('INSIGHT_VALUE_INVALID', 'nonfinite computed result');
        movers.push({ category: group.category, prev, cur, diff, pct: relativeDifference(cur, prev) });
      }
      const metric = (m: Mover): number | null => request.sortOrder === 'PERCENT_DIFFERENCE' ? m.pct : m.diff;
      const eligible = movers.filter(m => metric(m) !== null);
      excluded += movers.length - eligible.length;
      eligible.sort((a, b) => {
        const am = metric(a)!, bm = metric(b)!;
        const cmp = am === bm ? 0 : am < bm ? -1 : 1;
        if (cmp) return request.type === 'TOP' ? -cmp : cmp;
        const ak = JSON.stringify(a.category), bk = JSON.stringify(b.category); return ak < bk ? -1 : ak > bk ? 1 : 0;
      });
      const chosen = eligible.slice(0, request.size);
      const heading = `${request.type === 'TOP' ? 'Top' : 'Bottom'} movers ${name} (${periodLabel(latestDate)} vs ${periodLabel(previousDate)}): `;
      if (!chosen.length) parts = [text(heading), text('unavailable (no category has a value in both periods)'), text('.')];
      else {
        parts = [text(heading)];
        chosen.forEach((m, index) => {
          if (index) parts.push(text('; '));
          parts.push(text(`${label(m.category)} (`), value(m.prev), text(' → '), value(m.cur), text('; '), value(m.diff), text(', '), value(m.pct, true), text(')'));
        });
        parts.push(text('.'));
      }
      if (excluded) parts.push(text(` ${excluded} categor${excluded === 1 ? 'y' : 'ies'} excluded (no value in both periods${request.sortOrder === 'PERCENT_DIFFERENCE' ? ' or no computable percent change' : ''}).`));
    } else if (request.kind === 'forecast') {
      const dated = datedRows(), grain = input.category!.dateGranularity!, config = request.forecast;
      const result = numeric.length >= MIN_FORECAST_POINTS && config.periodsForward > 0
        ? computeForecast(dated.map(r => r.row.values[request.measure]!), grain, config) : null;
      const final = result?.future.at(-1);
      if (!final) {
        const reason = config.periodsForward === 0 ? 'no future periods requested'
          : numeric.length < MIN_FORECAST_POINTS ? `at least ${MIN_FORECAST_POINTS} usable data points required` : 'forecast could not be computed';
        parts = [text(`Statistical forecast for ${name}: unavailable (${reason}).`)];
      }
      else {
        const date = resultDate(shiftDate(dated.at(-1)!.date.toISOString(), config.periodsForward, { DAY: 'DD', MONTH: 'MM', QUARTER: 'Q', YEAR: 'YYYY' }[grain]));
        const iso = date.toISOString();
        const period = grain === 'YEAR' ? iso.slice(0, 4) : grain === 'MONTH' ? iso.slice(0, 7)
          : grain === 'QUARTER' ? `${iso.slice(0, 4)}-Q${Math.floor(date.getUTCMonth() / 3) + 1}` : iso.slice(0, 10);
        parts = [text(`Statistical forecast for ${name} in ${config.periodsForward} ${grain.toLowerCase()}${config.periodsForward === 1 ? '' : 's'} (${period}): `),
          value(final.value), text(`; ${config.predictionInterval}% prediction interval `), value(final.lower), text('–'), value(final.upper), text('.')];
      }
    } else {
      const dated = datedRows();
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
  });
  return { paragraphs, text: paragraphs.map(p => p.parts.map(part => part.text).join('')).join('\n\n') };
}
