import { metricColumn, metricExpression, parseExpression, planPreparedQuery, type RowExpression, type InteractiveQuery, type PublishedMetric, type ResultValue } from '@opensight/query-engine';
import { MetadataError } from './metadata-db.js';
import type { TenantContext } from './metadata.js';
import { digestAudience, digestMetricAccess } from './digest-audience.js';
import type { JobStore } from './job-store.js';
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
  emptyIntersection?: boolean; withheldDimensions?: string[];
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
    return { dimension, value: (av ?? bv)!.value, current, previous, change: current === null || previous === null ? null : finite(current - previous) };
  });
  return drivers.sort((a, b) => (b.change === null ? -1 : Math.abs(b.change)) - (a.change === null ? -1 : Math.abs(a.change)) || compare(scalarKey(a.value), scalarKey(b.value)));
}
const finite = (v: unknown): number | null => {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new MetadataError('DIGEST_VALUE_UNAVAILABLE', 422);
  return v;
};
/** Zero is the identity of these aggregates, including linear combinations.
 * Ratios/averages/extrema retain unavailable values for absent groups. */
export function zeroIdentity(expression: RowExpression): boolean {
  if (expression.kind === 'call') return ['sum', 'count', 'distinct_count'].includes(expression.name.toLowerCase());
  if (expression.kind === 'unary' && ['+', '-'].includes(expression.operator)) return zeroIdentity(expression.operand);
  if (expression.kind === 'binary') {
    if (['+', '-'].includes(expression.operator)) return zeroIdentity(expression.left) && zeroIdentity(expression.right);
    const constant = (v: RowExpression) => v.kind === 'literal' && typeof v.value === 'number' && Number.isFinite(v.value);
    if (expression.operator === '*') return constant(expression.left) && zeroIdentity(expression.right) || zeroIdentity(expression.left) && constant(expression.right);
    if (expression.operator === '/') return zeroIdentity(expression.left) && constant(expression.right) && expression.right.kind === 'literal' && expression.right.value !== 0;
  }
  return false;
}
export class DigestComputation {
  readonly prep: HostedPrep;
  constructor(readonly data: HostedData, readonly jobs?: JobStore) { this.prep = new HostedPrep(data); }
  private async prepare(context: TenantContext, spec: DigestSpec, now: Date, shared = spec.destination === 'shared') {
    const metadata = this.data.sources.metadata, stamp = await metadata.revisions(context);
    if (shared && context.userId !== spec.subscriberId) throw new MetadataError('DIGEST_SELF_ONLY', 403);
    const ref = await digestMetricAccess(metadata, context, spec);
    const resolution = await metadata.metricExecution(context, ref);
    const metric = resolution.metrics.find(m => m.id === spec.metricId);
    if (!metric) throw new MetadataError('METRIC_NOT_PUBLISHED', 409);
    if (ref.kind === 'prepared-dataset' && ref.ownerId !== context.userId) throw new MetadataError('DIGEST_DATASET_ACCESS_DENIED', 403);
    let admission = ref.kind === 'dataset' ? await admitMetricDataset(this.data, context, ref.id) : undefined;
    const columns = admission?.physical.columns ?? (await this.prep.describe(context, ref.id)).columns;
    if (!columns.some(c => c.name === spec.timeColumn && c.type === 'DATETIME')) throw new MetadataError('DIGEST_TIME_COLUMN_INVALID', 422);
    for (const dimension of spec.dimensions) if (!columns.some(c => c.name === dimension && c.type !== 'BOOLEAN')) throw new MetadataError('DIGEST_DIMENSION_INVALID', 422);
    const periods = digestPeriods(spec.cadence, now);
    let recipients: { id: string; email: string }[] = [];
    if (shared) {
      if (!this.jobs) throw new MetadataError('DIGEST_SHARED_RESOLVER_REQUIRED', 503);
      const measureQuery = await metricQuery({ ...digestQuery(spec, metric, periods.current), filters: [] }, ref, async () => resolution);
      ({ admission, recipients } = await digestAudience(this.data, this.jobs, context, spec, ref, admission, measureQuery));
    }
    const withheldDimensions = shared ? spec.dimensions.filter(d => admission?.deniedColumns.includes(d)) : [];
    const dimensions = spec.dimensions.filter(d => !withheldDimensions.includes(d));
    const emptyIntersection = shared && !!admission?.deniedColumns.includes(spec.timeColumn);
    const query = async (period: DigestPeriod, dimension?: string) => {
      const raw = digestQuery(spec, metric, period, dimension);
      if (shared && !dimension) {
        let name = '__digest_rows';
        while (columns.some(c => c.name === name) || resolution.metrics.some(m => m.name === name)) name += '_';
        raw.calculatedFields = [{ name, expression: '1' }];
        raw.measures.push({ fieldId: 'digestRows', columnName: name, aggregation: 'COUNT' });
      }
      const resolved = await metricQuery(raw, ref, async () => resolution);
      const plan = planPreparedQuery(columns, resolved, admission?.security);
      return { raw, resolved, plan };
    };
    // Validate all requested columns/expressions, including CLS, before data I/O.
    if (!emptyIntersection) for (const dimension of [undefined, ...dimensions]) await query(periods.current, dimension);
    await this.data.publication(context, stamp);
    return { metric, ref, admission, periods, query, stamp, recipients, dimensions, withheldDimensions, emptyIntersection, shared };
  }
  async authorize(context: TenantContext, spec: DigestSpec) { await this.prepare(context, spec, new Date(), false); }
  async authorizeShared(context: TenantContext, spec: DigestSpec) { await this.prepare(context, spec, new Date()); }
  async compute(context: TenantContext, spec: DigestSpec, now: Date): Promise<DigestResult> {
    return this.evaluate(context, await this.prepare(context, spec, now));
  }
  async sharedDelivery(context: TenantContext, spec: DigestSpec, now: Date) {
    if (spec.destination !== 'shared') throw new MetadataError('DIGEST_DESTINATION_INVALID', 422);
    const p = await this.prepare(context, spec, now), result = await this.evaluate(context, p);
    const proof = (v: typeof p) => JSON.stringify([v.stamp, v.recipients, v.admission?.security]);
    return { result, to: [...new Set(p.recipients.map(r => r.email))], verify: async () => {
      const current = await this.prepare(context, spec, now);
      if (proof(current) !== proof(p)) throw new MetadataError('JOB_AUTHORIZATION_REVISED', 403);
      await this.data.publication(context, p.stamp);
    } };
  }
  private async evaluate(context: TenantContext, p: Awaited<ReturnType<DigestComputation['prepare']>>): Promise<DigestResult> {
    const data = this.data;
    const empty = (): DigestResult => ({ metric: p.metric, periods: p.periods, current: null, previous: null, change: null, percentChange: null, drivers: [], emptyIntersection: true, withheldDimensions: p.withheldDimensions });
    if (p.emptyIntersection) return empty();
    const run = async (period: DigestPeriod, dimension?: string) => {
      const { raw, resolved, plan } = await p.query(period, dimension);
      const result = p.admission ? await data.work(context, false, [p.admission], async () => {
        const table = await data.table(context, p.admission!, data.read(p.admission!).columns);
        return data.computeQuery(context, table, resolved);
      }, p.stamp) : await this.prep.execute(context, p.ref.id, 'query', raw);
      if (!('rows' in result) || !Array.isArray(result.rows)) throw new MetadataError('DIGEST_VALUE_UNAVAILABLE', 422);
      const measure = plan.measures[0]!.outputName, group = plan.dimensions[0]?.outputName;
      return result.rows.map(row => {
        const value = group ? row[group] : null;
        if (value !== null && typeof value !== 'string' && typeof value !== 'number') throw new MetadataError('DIGEST_GROUP_INVALID', 422);
        return { value, metric: finite(row[measure]), rows: p.shared && !dimension ? finite(row[plan.measures[1]!.outputName]) : undefined };
      });
    };
    const a = await run(p.periods.current), b = await run(p.periods.previous);
    if (a.length > 1 || b.length > 1) throw new MetadataError('DIGEST_VALUE_UNAVAILABLE', 422);
    if (p.shared && !a.some(r => (r.rows ?? 0) > 0) && !b.some(r => (r.rows ?? 0) > 0)) return empty();
    const expression = parseExpression(metricExpression(p.metric), '$.metric', { validationOnly: true });
    const count = expression.kind === 'call' && ['count', 'distinct_count'].includes(expression.name.toLowerCase());
    const current = a[0]?.metric ?? (count ? 0 : null), previous = b[0]?.metric ?? (count ? 0 : null);
    const change = current === null || previous === null ? null : finite(current - previous), drivers: DigestDriver[] = [];
    for (const dimension of p.dimensions) {
      const currentGroups = await run(p.periods.current, dimension), previousGroups = await run(p.periods.previous, dimension);
      // Missing categories are zero only for count/sum. Null aggregates remain
      // unavailable; AVG/MIN/MAX and derived expressions must not invent zeros.
      const zeroForMissing = zeroIdentity(expression);
      drivers.push(...digestDrivers(dimension, currentGroups, previousGroups, zeroForMissing).slice(0, 5));
    }
    await data.publication(context, p.stamp);
    return { metric: p.metric, periods: p.periods, current, previous, change,
      percentChange: change === null || previous === null || previous === 0 ? null : finite(change / Math.abs(previous) * 100), drivers, ...(p.shared ? { emptyIntersection: false, withheldDimensions: p.withheldDimensions } : {}) };
  }
}
export function digestMessage(result: DigestResult, drillBack: string, unsubscribe: string) {
  const format = (n: number | null) => n === null ? 'No data' : new Intl.NumberFormat('en-US', { style: result.metric.format.style === 'number' ? 'decimal' : result.metric.format.style,
    ...(result.metric.format.currency ? { currency: result.metric.format.currency } : {}), minimumFractionDigits: result.metric.format.decimalPlaces, maximumFractionDigits: result.metric.format.decimalPlaces }).format(n);
  const headline = result.emptyIntersection ? 'No data is visible to all recipients' : result.change === 0 ? 'No change' : result.change === null ? 'Comparison unavailable' : `Change: ${format(result.change)}`;
  const period = (p: DigestPeriod) => `${p.start.slice(0, 10)} to ${p.end.slice(0, 10)} (end exclusive, UTC)`;
  const links = `<p><a href="${escapeHtml(drillBack)}">Open metric</a></p><p><a href="${escapeHtml(unsubscribe)}">Unsubscribe</a></p>`;
  const withheld = result.withheldDimensions?.length ? '<p>A dimension was withheld because it is not visible to all recipients.</p>' : '';
  if (result.emptyIntersection) return { subject: `OpenSight digest: ${headline}`, html: `<h1>${headline}</h1><h2>${escapeHtml(result.metric.name)}</h2><p>${period(result.periods.current)}; previous: ${period(result.periods.previous)}</p>${links}` };
  return { subject: `OpenSight digest: ${result.metric.name.replace(/[\r\n\0]/g, ' ').slice(0, 120)} — ${headline}`,
    html: `<h1>${escapeHtml(headline)}</h1><h2>${escapeHtml(result.metric.name)}</h2><p>Published version ${result.metric.version}</p><p>Current: ${escapeHtml(format(result.current))} · ${period(result.periods.current)}</p><p>Previous: ${escapeHtml(format(result.previous))} · ${period(result.periods.previous)}</p><p>Percent change: ${result.percentChange === null ? 'Unavailable' : `${result.percentChange.toFixed(2)}%`}</p><h2>Top dimension changes</h2><p>Each dimension is evaluated separately with the governed aggregation. Group changes for averages, distinct counts and derived metrics need not add to the overall change.</p><ul>${result.drivers.map(d => `<li>${escapeHtml(d.dimension)}: ${escapeHtml(d.value === null ? '(null)' : String(d.value))} — ${escapeHtml(format(d.previous))} → ${escapeHtml(format(d.current))}; change ${escapeHtml(format(d.change))}</li>`).join('')}</ul>${withheld}${links}` };
}
