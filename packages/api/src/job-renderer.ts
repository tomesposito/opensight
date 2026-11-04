import type { DigestSpec } from './digest-model.js';
import type { JobStore } from './job-store.js';
import type { DigestResult } from './digest-computation.js';
import { DigestComputation, digestMessage } from './digest-computation.js';
import { planPreparedVisual } from '@opensight/query-engine';
import { compileVisual } from '@opensight/web/compiler';
import { HostedData } from './hosted-data.js';
import { HostedPrep } from './hosted-prep.js';
import { EmbedContent, embedVisuals } from './embed-content.js';
import { containedWork, wireTable, type QueryResult } from './contained-work.js';
import type { TenantContext } from './metadata.js';
import { identifier, object } from './metadata-resources.js';
import { MetadataError } from './metadata-db.js';
import { assembleReport, escapeHtml } from './reports.js';
import { evaluateCondition, MetricError, periodWindows } from './alerts.js';
import type { JobSpec } from './job-schema.js';
import type { MailMessage } from './mail.js';

export interface JobExecutor {
  authorize(context: TenantContext, spec: JobSpec): Promise<void>;
  execute(context: TenantContext, spec: JobSpec, now: Date): Promise<{ triggered?: boolean }>;
  render(context: TenantContext, spec: JobSpec, now: Date, jobId?: string): Promise<Pick<MailMessage, 'subject' | 'html'>>;
  begin(context: TenantContext, recheck: () => Promise<void>): void;
  authorizeSharedDigest?(context: TenantContext, spec: DigestSpec, store: JobStore): Promise<void>;
  renderSharedDigest?(context: TenantContext, spec: DigestSpec, now: Date, jobId: string, store: JobStore): Promise<{ message: Omit<MailMessage, 'dedupeKey'>; verify: () => Promise<void> }>;
  verifyDelivery?(context: TenantContext): Promise<void>;
}
/** Reuse the dataset-bound reader, with recipient identities and H3/H4 gates.
 * Neither legacy DashboardSnapshots nor the operator identity can render data. */
export class JobRenderer implements JobExecutor {
  readonly prep: HostedPrep;
  constructor(readonly data: HostedData, readonly content: EmbedContent, readonly origin = process.env.OPENSIGHT_PUBLIC_ORIGIN) { this.prep = new HostedPrep(data); }
  begin(context: TenantContext, recheck: () => Promise<void>): void { this.data.prepaidCompute.add(context); this.content.data.prepaidCompute.add(context); this.data.begin(context, undefined, recheck, recheck); this.content.data.begin(context, undefined, recheck, recheck); }
  async verifyDelivery(context: TenantContext): Promise<void> {
    await this.data.publication(context, await this.data.sources.metadata.revisions(context));
    await this.content.data.publication(context, await this.content.data.sources.metadata.revisions(context));
  }
  private async dashboard(context: TenantContext, spec: Extract<JobSpec, { kind: 'report' | 'alert' }>) {
    const asset = await this.content.asset(context, 'dashboard', spec.dashboardId), stored = object(asset.body.definition), definition = object(stored.Definition);
    if (!Array.isArray(asset.body.datasets) || asset.body.datasets.length !== 1 || !Array.isArray(definition.DataSetIdentifierDeclarations) || definition.DataSetIdentifierDeclarations.length !== 1) throw new MetadataError('JOB_DATASET_UNSUPPORTED', 422);
    const binding = object(asset.body.datasets[0]);
    if (binding.kind !== 'dataset') throw new MetadataError('JOB_DATASET_UNSUPPORTED', 422);
    const datasetId = identifier(binding.id);
    if (asset.body.published) {
      const dataset = await this.data.sources.metadata.get(context, { kind: 'dataset', id: datasetId });
      const sources = dataset.body.sources;
      if (!Array.isArray(sources) || sources.length !== 1 || object(sources[0]).ownerId !== context.userId) throw new MetadataError('DASHBOARD_DATASET_ACCESS_DENIED', 403);
    }
    if (spec.kind === 'alert' && datasetId !== spec.datasetId) throw new MetadataError('JOB_DATASET_MISMATCH', 422);
    const admission = await this.content.admission(context, { anonymous: false, tags: {} }, datasetId);
    const analysis = { ResourceType: 'Analysis', AnalysisId: asset.id, Name: String(stored.Name ?? asset.id), Definition: definition };
    return { asset, stored, definition, admission, analysis, dataSetArn: String(object(definition.DataSetIdentifierDeclarations[0]).DataSetArn) };
  }
  async authorize(context: TenantContext, spec: JobSpec): Promise<void> {
    if (spec.kind === 'digest') {
      if (context.userId !== spec.subscriberId) throw new MetadataError('DIGEST_SELF_ONLY', 403);
      await new DigestComputation(this.data).authorize(context, spec); return;
    }
    if (spec.kind === 'refresh') {
      await this.data.sources.capability(context, 'build');
      if (spec.target.kind === 'prepared-dataset') { await this.prep.get(context, spec.target.id); return; }
      if (spec.target.kind === 'source') await this.data.admit(context, spec.target.id, 'query');
      else await this.content.admission(context, { anonymous: false, tags: {} }, spec.target.id);
      return;
    }
    const d = await this.dashboard(context, spec), visuals = embedVisuals(d.definition);
    const selected = spec.kind === 'report' ? visuals : visuals.filter(v => v.id === spec.visualId);
    if (spec.kind === 'alert' && selected.length !== 1) throw new MetadataError('JOB_VISUAL_UNRESOLVED', 422);
    for (const v of selected) {
      const period = spec.kind === 'alert' && spec.condition.kind === 'percent-change' ? { columnName: spec.condition.period.columnName, ...periodWindows(spec.condition.period.unit, new Date()).current } : undefined;
      const plan = planPreparedVisual(d.admission.physical.columns, d.analysis, v.id, d.dataSetArn, d.admission.security, period);
      if (spec.kind === 'alert' && (!plan.measures.some(m => m.fieldId === spec.fieldId) || Object.keys(spec.dimensions).some(k => !plan.dimensions.some(d => d.fieldId === k)))) throw new MetadataError('JOB_METRIC_INVALID', 422);
    }
  }
  private async metric(context: TenantContext, spec: Extract<JobSpec, { kind: 'alert' }>, now: Date) {
    const d = await this.dashboard(context, spec), data = this.content.data, a = d.admission;
    const windows = spec.condition.kind === 'percent-change' ? periodWindows(spec.condition.period.unit, now) : undefined;
    const measure = async (window?: { start: string; end: string }) => {
      const period = window && spec.condition.kind === 'percent-change' ? { ...window, columnName: spec.condition.period.columnName } : undefined;
      const plan = planPreparedVisual(a.physical.columns, d.analysis, spec.visualId, d.dataSetArn, a.security, period);
      return data.work(context, false, [a], async () => {
        const table = await data.table(context, a, data.read(a).columns);
        const result = await containedWork<QueryResult>(data.scope(context), { kind: 'visual', table: await wireTable(data.scope(context), table, { ...a.physical, columns: table.columns }), analysis: d.analysis, visualId: spec.visualId, dataSetArn: d.dataSetArn, period }, data.limits(context));
        const matches = result.rows.filter(row => Object.entries(spec.dimensions).every(([key, value]) => row[plan.dimensions.find(d => d.fieldId === key)!.outputName] === value));
        const m = plan.measures.find(m => m.fieldId === spec.fieldId), value = m && matches[0]?.[m.outputName];
        if (matches.length !== 1 || typeof value !== 'number' || !Number.isFinite(value)) throw new MetricError('METRIC_UNAVAILABLE', 'Expected one finite metric');
        return value;
      });
    };
    const current = await measure(windows?.current), previous = windows ? await measure(windows.previous) : undefined;
    return { current, previous, ...evaluateCondition(spec.condition, current, previous) };
  }
  async execute(context: TenantContext, spec: JobSpec, now: Date): Promise<{ triggered?: boolean }> {
    await this.authorize(context, spec);
    if (spec.kind === 'alert') return this.metric(context, spec, now);
    if (spec.kind === 'refresh') {
      if (spec.target.kind === 'prepared-dataset') await this.prep.execute(context, spec.target.id, 'refresh');
      else if (spec.target.kind === 'source') await this.data.refresh(context, spec.target.id);
      else { const d = await this.content.dataset(context, spec.target.id); await this.content.data.refresh(context, d.sourceId); }
    }
    return {};
  }
  async authorizeSharedDigest(context: TenantContext, spec: DigestSpec, store: JobStore) {
    await new DigestComputation(this.data, store).authorizeShared(context, spec);
  }
  async renderSharedDigest(context: TenantContext, spec: DigestSpec, now: Date, jobId: string, store: JobStore) {
    const { result, to, verify } = await new DigestComputation(this.data, store).sharedDelivery(context, spec, now);
    return { message: { ...this.digestMail(context, spec, result, jobId), to }, verify };
  }
  private digestMail(context: TenantContext, spec: DigestSpec, result: DigestResult, jobId?: string) {
    if (!this.origin || !jobId) throw new MetadataError('DIGEST_ORIGIN_REQUIRED', 503);
    const url = new URL(this.origin);
    if (url.origin !== this.origin || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new MetadataError('DIGEST_ORIGIN_REQUIRED', 503);
    const unsubscribe = `${this.origin}/api/api/v1/metric-unsubscribe/${[context.tenantId, context.namespaceId, jobId, spec.unsubscribeToken].map(encodeURIComponent).join('/')}`;
    return digestMessage(result, `${this.origin}/#/metrics/${encodeURIComponent(spec.metricId)}`, unsubscribe);
  }
  async render(context: TenantContext, spec: JobSpec, now: Date, jobId?: string): Promise<Pick<MailMessage, 'subject' | 'html'>> {
    await this.authorize(context, spec);
    if (spec.kind === 'digest') {
      const result = await new DigestComputation(this.data).compute(context, spec, now);
      return this.digestMail(context, spec, result, jobId);
    }
    if (spec.kind === 'refresh') throw new MetadataError('JOB_DELIVERY_INVALID', 422);
    if (spec.kind === 'alert') {
      const metric = await this.metric(context, spec, now);
      if (!metric.triggered) throw new MetadataError('JOB_RECIPIENT_NOT_TRIGGERED', 403);
      return { subject: `OpenSight alert: ${spec.dashboardId.slice(0, 150)}`, html: `<h1>Alert triggered</h1><p>${escapeHtml(spec.dashboardId)} / ${escapeHtml(spec.visualId)}</p><p>${escapeHtml(spec.fieldId)} = ${metric.current}</p>${metric.percentChange === null ? '' : `<p>Previous: ${metric.previous}; change: ${metric.percentChange}%</p>`}` };
    }
    const asset = await this.content.asset(context, 'dashboard', spec.dashboardId), title = String(object(asset.body.definition).Name ?? asset.id);
    const visuals = await this.content.visuals(context, { anonymous: false, tags: {}, experience: { kind: 'dashboard', dashboardId: asset.id } }, asset);
    return { subject: `OpenSight report: ${title.replace(/[\r\n\0]/g, ' ').slice(0, 150)}`, html: assembleReport({ dashboardId: asset.id, title, capturedAt: now.toISOString(), visuals: visuals.map(compileVisual) }) };
  }
}
