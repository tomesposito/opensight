import { aggregateValue, formatNumber, relativeDifference, shiftDate, resultDate, groupedPeriodDate } from '@opensight/query-engine/browser';
import type { Cell, Field } from './model.js';
import type { VisualFormatting } from './formatting.js';
import { fieldName } from './formatting.js';
import { insightFail, normalizeInsight } from './insight-configuration.js';
import { computeForecast, MIN_FORECAST_POINTS, prepareChronological } from './forecast.js';
export { InsightError } from './insight-configuration.js';

export interface NarrativePart { text: string; value?: number }
export interface NarrativeParagraph { id: string; parts: NarrativePart[] }
export interface InsightNarrative { paragraphs: NarrativeParagraph[]; text: string }
/** UniqueValues narrative budgets (issue #266): at most this many categories are named in the sentence. */
export const UNIQUE_VALUES_MAX_CATEGORIES = 20;
/** Each named category is truncated to at most this many characters. */
export const UNIQUE_VALUES_MAX_LABEL_CHARS = 100;
/** The named categories plus their separators occupy at most this many characters in total. */
export const UNIQUE_VALUES_MAX_TEXT_CHARS = 1000;
/**
 * Anomaly work budget (issue #317). Anomaly statistics are shared per measure
 * (one chronological preparation, one median and one MAD per distinct measure,
 * however many anomaly computations bind it), so the remaining work is bounded
 * and validated BEFORE any anomaly sorting: a series longer than
 * ANOMALY_MAX_SERIES_POINTS rows, or a total estimated work above
 * ANOMALY_MAX_WORK_UNITS, fails closed with INSIGHT_ANOMALY_WORK_EXCEEDED
 * instead of silently truncating observations. Work units estimate, per
 * distinct anomaly measure, points × ceil(log2(points)) for the two median
 * sorts plus points per anomaly computation on that measure for its filter
 * scan; the pre-check uses the row count as the point-count upper bound, so
 * it runs before the chronological preparation sorts anything.
 */
export const ANOMALY_MAX_SERIES_POINTS = 100_000;
export const ANOMALY_MAX_WORK_UNITS = 8_000_000;
export interface InsightRow { category: Cell; time?: Cell; values: (number | null)[] }
export interface InsightInput { category?: Field; time?: Field; measures: Field[]; computations?: unknown; formatting?: VisualFormatting }

function finiteAnomalyValue(n: number): number {
  if (!Number.isFinite(n)) return insightFail('INSIGHT_VALUE_INVALID', 'nonfinite anomaly arithmetic');
  return n;
}

/** Nonempty finite series; midpoint avoids overflowing a sum of large values. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a === b ? 0 : a < b ? -1 : 1);
  const middle = Math.floor(sorted.length / 2), upper = sorted[middle]!;
  if (sorted.length % 2) return upper;
  const lower = sorted[middle - 1]!;
  return finiteAnomalyValue(Math.sign(lower) === Math.sign(upper) ? lower + (upper - lower) / 2 : lower / 2 + upper / 2);
}

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
  const duplicateCode = requests.some(r => r.kind === 'forecast' || r.kind === 'periodToDate' || r.kind === 'anomaly') ? 'INSIGHT_VALUE_INVALID' : 'INSIGHT_CATEGORY_INVALID';
  if (requests.some(r => r.kind === 'topBottomMovers')) {
    // Movers rows are grouped by (category, period): categories repeat across periods, pairs must not.
    if (new Set(rows.map(r => JSON.stringify([r.category, r.time]))).size !== rows.length) insightFail('INSIGHT_VALUE_INVALID', 'expected unique aggregated category/period rows');
  } else if (new Set(rows.map(r => JSON.stringify(r.category))).size !== rows.length) insightFail(duplicateCode, 'expected unique aggregated categories');
  // Chronological preparation is computed once per narrative and shared by
  // every dated computation (issue #317): previously each anomaly, forecast
  // or period computation re-decoded and re-sorted the entire series.
  let datedCache: { row: InsightRow; date: Date }[] | undefined;
  const datedRows = () => {
    if (datedCache) return datedCache;
    // Shared chronological preparation with the chart forecast surfaces
    // (issue #259): sort by decoded period, reject decoded duplicates.
    const prepared = prepareChronological(rows, row => groupedPeriodDate(row.category, input.category!.dateGranularity!));
    if (!prepared.ok && prepared.reason === 'invalid') return insightFail('INSIGHT_TIME_REQUIRED', 'invalid date/time category for the bound grain');
    if (!prepared.ok) return insightFail(duplicateCode, 'duplicate date/time periods');
    return datedCache = prepared.entries.map(({ item, date }) => ({ row: item, date }));
  };
  // Anomaly statistics shared per measure (issue #317): the dated non-null
  // points, the median center and the MAD spread are computed once per
  // distinct measure and reused by every anomaly computation bound to it;
  // only the direction/sensitivity filter scan stays per computation.
  interface AnomalySeries { dated: { row: InsightRow; date: Date }[]; points: { date: Date; n: number; deviation: number }[]; center: number; spread: number }
  const anomalySeriesCache = new Map<number, AnomalySeries>();
  let anomalyBudgetChecked = false;
  const checkAnomalyBudget = () => {
    if (anomalyBudgetChecked) return;
    anomalyBudgetChecked = true;
    const perMeasure = new Map<number, number>();
    for (const request of requests) if (request.kind === 'anomaly') perMeasure.set(request.measure, (perMeasure.get(request.measure) ?? 0) + 1);
    if (!perMeasure.size) return;
    const points = rows.length;
    if (points > ANOMALY_MAX_SERIES_POINTS) insightFail('INSIGHT_ANOMALY_WORK_EXCEEDED', `anomaly series of ${points} points exceeds the ${ANOMALY_MAX_SERIES_POINTS}-point budget`);
    const sortUnits = points * Math.ceil(Math.log2(points + 1));
    let work = 0;
    for (const computations of perMeasure.values()) work += sortUnits + computations * points;
    if (work > ANOMALY_MAX_WORK_UNITS) insightFail('INSIGHT_ANOMALY_WORK_EXCEEDED', `anomaly work estimate of ${work} units exceeds the ${ANOMALY_MAX_WORK_UNITS}-unit budget`);
  };
  const anomalySeries = (measure: number): AnomalySeries => {
    const cached = anomalySeriesCache.get(measure);
    if (cached) return cached;
    const dated = datedRows().filter(({ row }) => row.values[measure] !== null);
    // Statistics are computed only at or above the five-point minimum, as
    // before: shorter series take the unavailable sentence and never sort.
    if (dated.length < 5) { const series: AnomalySeries = { dated, points: [], center: 0, spread: 0 }; anomalySeriesCache.set(measure, series); return series; }
    const center = median(dated.map(({ row }) => row.values[measure]! as number));
    const points = dated.map(({ row, date }) => ({ date, n: row.values[measure]! as number,
      deviation: finiteAnomalyValue(row.values[measure]! - center) }));
    const series: AnomalySeries = { dated, points, center, spread: median(points.map(point => Math.abs(point.deviation))) };
    anomalySeriesCache.set(measure, series);
    return series;
  };
  const sum = (index: number, groups = rows): number | null => {
    try { return aggregateValue('sum', groups.map(r => r.values[index]!)) as number | null; }
    catch { return insightFail('INSIGHT_VALUE_INVALID', 'nonfinite total'); }
  };
  const paragraphs = requests.filter(request => rows.length || request.kind === 'periodToDate' || request.kind === 'anomaly').map(request => {
    const name = request.kind === 'uniqueValues' ? '' : fieldName(input.measures[request.measure]!, input.formatting), total = request.kind === 'forecast' || request.kind === 'periodToDate' || request.kind === 'uniqueValues' || request.kind === 'topBottomMovers' || request.kind === 'anomaly' ? null : sum(request.measure);
    const numeric = rows.filter(r => r.values[request.measure] !== null);
    let parts: NarrativePart[];
    if (request.kind === 'uniqueValues') {
      // Distinct categories in deterministic typed order, independent of incoming row order.
      const sorted = [...rows].sort((a, b) => { const ak = JSON.stringify(a.category), bk = JSON.stringify(b.category); return ak < bk ? -1 : ak > bk ? 1 : 0; });
      // Bound the narrative (issue #266): cap the category count, each label
      // length, and the total named text, and disclose how many categories
      // were omitted. The complete authorized result stays available through
      // View data/export; only this sentence is bounded.
      const shown: string[] = [];
      let used = 0;
      for (const row of sorted) {
        if (shown.length >= UNIQUE_VALUES_MAX_CATEGORIES) break;
        const raw = label(row.category);
        const named = raw.length > UNIQUE_VALUES_MAX_LABEL_CHARS ? `${raw.slice(0, UNIQUE_VALUES_MAX_LABEL_CHARS - 1)}…` : raw;
        const cost = named.length + (shown.length ? 2 : 0);
        if (used + cost > UNIQUE_VALUES_MAX_TEXT_CHARS) break;
        shown.push(named); used += cost;
      }
      const omitted = sorted.length - shown.length;
      parts = [text(`Unique ${fieldName(input.category!, input.formatting)}: `),
        ...shown.flatMap((named, index) => [...(index ? [text('; ')] : []), text(named)]),
        ...(omitted ? [text(`; and ${omitted} more`)] : []), text('.')];
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
      // Reject duplicate decoded category/period pairs before building the
      // map (issue #265): raw spellings such as `2024-01` and `2024-01-01`
      // decode to the same period, and a silent overwrite would make the
      // ranking depend on input order. The category key stays typed via
      // JSON, so a string and a number with the same text remain distinct.
      const seenPairs = new Set<string>();
      for (const { row, date } of dated) {
        const pair = JSON.stringify([row.category, date.getTime()]);
        if (seenPairs.has(pair)) return insightFail('INSIGHT_VALUE_INVALID', 'duplicate decoded category/period rows');
        seenPairs.add(pair);
      }
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
    } else if (request.kind === 'anomaly') {
      // Validate the documented work budget before any anomaly sorting
      // (issue #317); the pre-check uses the row count, so it precedes the
      // chronological preparation as well.
      checkAnomalyBudget();
      // Decode every period before excluding nulls, so duplicate or invalid
      // periods cannot disappear behind a missing measure. The preparation
      // and the median/MAD statistics are shared per measure (issue #317).
      const { dated, points, center, spread } = anomalySeries(request.measure);
      const heading = `Statistical anomaly detection for ${name} by ${fieldName(input.category!, input.formatting)}: `;
      if (dated.length < 5) parts = [text(`${heading}unavailable (not enough data points to detect anomalies; at least 5 non-null points required).`)];
      else {
        const { direction, minSensitivityPercentage } = request.anomalyDetection;
        // A zero median cannot scale a percentage; skip only that extra filter.
        const minimum = center === 0 || minSensitivityPercentage === undefined ? 0
          : finiteAnomalyValue((minSensitivityPercentage / 100) * Math.abs(center));
        const anomalies = points.filter(({ deviation }) => {
          // MAD=0 has an explicit infinite-deviation rule; do not manufacture
          // an Infinity that could mask an unrelated arithmetic overflow.
          const candidate = spread === 0 ? deviation !== 0 : Math.abs(finiteAnomalyValue(0.6745 * deviation / spread)) >= 3.5;
          return candidate && Math.abs(deviation) >= minimum
            && (direction === 'BOTH' || (direction === 'HIGHER' ? deviation > 0 : deviation < 0));
        });
        parts = [text(heading)];
        if (!anomalies.length) parts.push(text('no anomalies detected'));
        anomalies.slice(0, 5).forEach(({ date, n, deviation }, index) => {
          const iso = date.toISOString(), grain = input.category!.dateGranularity!;
          const period = grain === 'YEAR' ? iso.slice(0, 4) : grain === 'MONTH' ? iso.slice(0, 7)
            : grain === 'QUARTER' ? `${iso.slice(0, 4)}-Q${Math.floor(date.getUTCMonth() / 3) + 1}` : iso.slice(0, 10);
          if (index) parts.push(text('; '));
          parts.push(text(`${period} (`), value(n), text(`, unusually ${deviation > 0 ? 'high' : 'low'})`));
        });
        if (anomalies.length > 5) parts.push(text(`; and ${anomalies.length - 5} more`));
        parts.push(text('.'));
      }
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
    if (nulls && ['totalAggregation', 'maximumMinimum', 'topBottomRanked', 'anomaly'].includes(request.kind)) parts.push(text(` ${nulls} null group${nulls === 1 ? '' : 's'} excluded.`));
    return { id: request.id, parts };
  });
  return { paragraphs, text: paragraphs.map(p => p.parts.map(part => part.text).join('')).join('\n\n') };
}
