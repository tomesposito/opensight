import { metricColumn, planPreparedQuery, type InteractiveQuery, type PublishedMetric, type ResultValue } from '@opensight/query-engine';
import { MetadataError } from './metadata-db.js';
import type { TenantContext } from './metadata.js';
import { MetricCatalog, metricRecord } from './metric-model.js';
import { metricQuery } from './metric-consumption.js';
import type { DigestSpec } from './digest-model.js';
import { HostedPrep } from './hosted-prep.js';
import type { HostedData } from './hosted-data.js';
import { admitMetricDataset } from './digest-admission.js';
import { escapeHtml } from './reports.js';

export interface DigestPeriod { start: string; end: string }
export function digestPeriods(cadence: DigestSpec['cadence'], now: Date) {
  if (!Number.isFinite(now.getTime())) throw new MetadataError('DIGEST_PERIOD_INVALID', 422);
  const end = new Date(now); end.setUTCHours(0, 0, 0, 0);
  if (cadence === 'weekly') end.setUTCDate(end.getUTCDate() - (end.getUTCDay() + 6) % 7);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - (cadence === 'weekly' ? 7 : 1));
  const before = new Date(start); before.setUTCDate(before.getUTCDate() - (cadence === 'weekly' ? 7 : 1));
  return { current: { start: start.toISOString(), end: end.toISOString() }, previous: { start: before.toISOString(), end: start.toISOString() } };
}
export function digestQuery(spec: DigestSpec, metric: PublishedMetric, period: DigestPeriod, dimension?: string): InteractiveQuery {
  return { dimensions: dimension ? [{ fieldId: 'dimension', columnName: dimension }] : [],
    measures: [{ fieldId: 'value', columnName: metricColumn(metric.id), aggregation: metric.defaultAggregation }],
    parameterDeclarations: [{ name: 'DigestStart', type: 'datetime', multiple: false }, { name: 'DigestEnd', type: 'datetime', multiple: false }],
    parameterBindings: { DigestStart: [period.start], DigestEnd: [period.end] },
    filters: [{ columnName: spec.timeColumn, parameterName: 'DigestStart', operator: 'GREATER_THAN_OR_EQUAL_TO' },
      { columnName: spec.timeColumn, parameterName: 'DigestEnd', operator: 'LESS_THAN' }] };
}
export interface DigestDriver { dimension: string; value: ResultValue; current: number | null; previous: number | null; change: number | null }
export interface DigestResult {
  metric: PublishedMetric; periods: ReturnType<typeof digestPeriods>; current: number | null; previous: number | null;
  change: number | null; percentChange: number | null; drivers: DigestDriver[];
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const scalarKey = (v: ResultValue) => JSON.stringify([typeof v, v]);
/** Separate one-dimensional partitions, never a cross-product or summed
 * percentages. Non-additive metrics retain their own governed aggregation. */
export function digestDrivers(dimension: string, current: { value: ResultValue; metric: number | null }[], previous: { value: ResultValue; metric: number | null }[], zeroForMissing: boolean): DigestDriver[] {
  const index = (rows: typeof current) => new Map(rows.map(r => [scalarKey(r.value), r]));
  const a = index(current), b = index(previous);
  if (a.size !== current.length || b.size !== previous.length) throw new MetadataError('DIGEST_GROUP_INVALID', 422);
  const drivers = [...new Set([...a.keys(), ...b.keys()])].map(key => {
    const av = a.get(key), bv = b.get(key), current = av ? av.metric : zeroForMissing ? 0 : null, previous = bv ? bv.metric : zeroForMissing ? 0 : null;
    return { dimension, value: (av ?? bv)!.value, current, previous, change: current === null || previous === null ? null : current - previous };
  });
  return drivers.sort((a, b) => (b.change === null ? -1 : Math.abs(b.change)) - (a.change === null ? -1 : Math.abs(a.change)) || compare(scalarKey(a.value), scalarKey(b.value)));
}
const finite = (v: unknown): number | null => {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new MetadataError('DIGEST_VALUE_UNAVAILABLE', 422);
  return v;
};
export class DigestComputation {
  readonly prep: HostedPrep;
  constructor(readonly data: HostedData) { this.prep = new HostedPrep(data); }
  private async prepare(context: TenantContext, spec: DigestSpec, now: Date) {
    const metadata = this.data.sources.metadata, stamp = await metadata.revisions(context);
    const ref = await metadata.assetTransaction(context, false, a => {
      const c = new MetricCatalog(a), r = c.get(spec.metricId), b = metricRecord(r);
      if (b.publishedVersion === null) throw new MetadataError('METRIC_NOT_PUBLISHED', 409);
      const dataset = c.dataset(b.dataset);
      // Do not use metadata visibility alone as a data grant.
      if (dataset.body.folderId != null) a.folder(String(dataset.body.folderId));
      if (!a.allows(dataset.body.grants)) throw new MetadataError('DIGEST_VIEW_FORBIDDEN', 403);
      return b.dataset;
    });
    const resolution = await metadata.metricExecution(context, ref);
    const metric = resolution.metrics.find(m => m.id === spec.metricId);
    if (!metric) throw new MetadataError('METRIC_NOT_PUBLISHED', 409);
    if (ref.kind === 'prepared-dataset' && ref.ownerId !== context.userId) throw new MetadataError('DIGEST_DATASET_ACCESS_DENIED', 403);
    const admission = ref.kind === 'dataset' ? await admitMetricDataset(this.data, context, ref.id) : undefined;
    const columns = admission?.physical.columns ?? (await this.prep.describe(context, ref.id)).columns;
    if (!columns.some(c => c.name === spec.timeColumn && c.type === 'DATETIME')) throw new MetadataError('DIGEST_TIME_COLUMN_INVALID', 422);
    for (const dimension of spec.dimensions) if (!columns.some(c => c.name === dimension && c.type !== 'BOOLEAN')) throw new MetadataError('DIGEST_DIMENSION_INVALID', 422);
    const periods = digestPeriods(spec.cadence, now);
    const query = async (period: DigestPeriod, dimension?: string) => {
      const resolved = await metricQuery(digestQuery(spec, metric, period, dimension), ref, async () => resolution);
      const plan = planPreparedQuery(columns, resolved, admission?.security);
      return { resolved, plan };
    };
    // Validate all requested columns/expressions, including CLS, before data I/O.
    for (const dimension of [undefined, ...spec.dimensions]) await query(periods.current, dimension);
    await this.data.publication(context, stamp);
    return { metric, ref, admission, periods, query, stamp };
  }
  async authorize(context: TenantContext, spec: DigestSpec) { await this.prepare(context, spec, new Date()); }
  async compute(context: TenantContext, spec: DigestSpec, now: Date): Promise<DigestResult> {
    const p = await this.prepare(context, spec, now), data = this.data;
    const run = async (period: DigestPeriod, dimension?: string) => {
      const { resolved, plan } = await p.query(period, dimension);
      const result = p.admission ? await data.work(context, false, [p.admission], async () => {
        const table = await data.table(context, p.admission!, data.read(p.admission!).columns);
        return data.computeQuery(context, table, resolved);
      }, p.stamp) : await this.prep.execute(context, p.ref.id, 'query', digestQuery(spec, p.metric, period, dimension));
      if (!('rows' in result) || !Array.isArray(result.rows)) throw new MetadataError('DIGEST_VALUE_UNAVAILABLE', 422);
      const measure = plan.measures[0]!.outputName, group = plan.dimensions[0]?.outputName;
      return result.rows.map(row => {
        const value = group ? row[group] : null;
        if (value !== null && typeof value !== 'string' && typeof value !== 'number') throw new MetadataError('DIGEST_GROUP_INVALID', 422);
        return { value, metric: finite(row[measure]) };
      });
    };
    const a = await run(p.periods.current), b = await run(p.periods.previous);
    if (a.length > 1 || b.length > 1) throw new MetadataError('DIGEST_VALUE_UNAVAILABLE', 422);
    const count = p.metric.defaultAggregation === 'COUNT' || p.metric.defaultAggregation === 'DISTINCT_COUNT';
    const current = a[0]?.metric ?? (count ? 0 : null), previous = b[0]?.metric ?? (count ? 0 : null);
    const change = current === null || previous === null ? null : finite(current - previous), drivers: DigestDriver[] = [];
    for (const dimension of spec.dimensions) {
      const currentGroups = await run(p.periods.current, dimension), previousGroups = await run(p.periods.previous, dimension);
      // Missing categories are zero only for count/sum. Null aggregates remain
      // unavailable; AVG/MIN/MAX and derived expressions must not invent zeros.
      const zeroForMissing = /^(?:\s*\{[^{}]+\}\s*)$/.test(p.metric.expression) && ['SUM', 'COUNT', 'DISTINCT_COUNT'].includes(p.metric.defaultAggregation);
      drivers.push(...digestDrivers(dimension, currentGroups, previousGroups, zeroForMissing).slice(0, 5));
    }
    await data.publication(context, p.stamp);
    return { metric: p.metric, periods: p.periods, current, previous, change,
      percentChange: change === null || previous === null || previous === 0 ? null : finite(change / Math.abs(previous) * 100), drivers };
  }
}
export function digestMessage(result: DigestResult, drillBack: string, unsubscribe: string) {
  const format = (n: number | null) => n === null ? 'No data' : new Intl.NumberFormat('en-US', { style: result.metric.format.style === 'number' ? 'decimal' : result.metric.format.style,
    ...(result.metric.format.currency ? { currency: result.metric.format.currency } : {}), minimumFractionDigits: result.metric.format.decimalPlaces, maximumFractionDigits: result.metric.format.decimalPlaces }).format(n);
  const headline = result.change === 0 ? 'No change' : result.change === null ? 'Comparison unavailable' : `Change: ${format(result.change)}`;
  const period = (p: DigestPeriod) => `${p.start.slice(0, 10)} to ${p.end.slice(0, 10)} (end exclusive, UTC)`;
  return { subject: `OpenSight digest: ${result.metric.name.replace(/[\r\n\0]/g, ' ').slice(0, 120)} — ${headline}`,
    html: `<h1>${escapeHtml(headline)}</h1><h2>${escapeHtml(result.metric.name)}</h2><p>Published version ${result.metric.version}</p><p>Current: ${escapeHtml(format(result.current))} · ${period(result.periods.current)}</p><p>Previous: ${escapeHtml(format(result.previous))} · ${period(result.periods.previous)}</p><p>Percent change: ${result.percentChange === null ? 'Unavailable' : `${result.percentChange.toFixed(2)}%`}</p><h2>Top dimension changes</h2><p>Each dimension is evaluated separately with the governed aggregation. Group changes for averages, distinct counts and derived metrics need not add to the overall change.</p><ul>${result.drivers.map(d => `<li>${escapeHtml(d.dimension)}: ${escapeHtml(d.value === null ? '(null)' : String(d.value))} — ${escapeHtml(format(d.previous))} → ${escapeHtml(format(d.current))}; change ${escapeHtml(format(d.change))}</li>`).join('')}</ul><p><a href="${escapeHtml(drillBack)}">Open metric</a></p><p><a href="${escapeHtml(unsubscribe)}">Unsubscribe</a></p>` };
}
