import { randomUUID, timingSafeEqual } from 'node:crypto';
import { digestInput, newDigest } from './digest-model.js';
import { JobStore } from './job-store.js';
import { cancelJob, member, scoped, scopeArgs, type Job } from './job-schema.js';
import { MetadataError, missing } from './metadata-db.js';
import type { TenantContext } from './metadata.js';
import { MetricCatalog, metricRecord } from './metric-model.js';
import { identifier, type Scope } from './metadata-resources.js';
import type { JobExecutor } from './job-renderer.js';

export function digestView(job: Job) {
  if (job.spec.kind !== 'digest') return missing();
  const { metricId, subscriberId, cadence, timeColumn, dimensions } = job.spec;
  return { id: job.id, metricId, subscriberId, cadence, timeColumn, dimensions, destination: job.spec.destination === 'shared' ? { kind: 'shared', recipients: job.spec.recipients } : { kind: 'self' }, stopped: job.stopped, nextRun: job.nextRun };
}
export class DigestStore {
  constructor(readonly jobs: JobStore, readonly executor: JobExecutor) {}
  async create(context: TenantContext, metricId: string, raw: unknown) {
    const input = digestInput(raw);
    await this.jobs.metadata.assetTransaction(context, false, a => {
      const catalog = new MetricCatalog(a), record = metricRecord(catalog.get(metricId));
      if (record.publishedVersion === null) throw new MetadataError('METRIC_NOT_PUBLISHED', 409);
      if (input.destination.kind === 'shared' && a.user().body.role !== 'administrator' && record.createdBy !== context.userId) throw new MetadataError('DIGEST_SHARED_FORBIDDEN', 403);
    });
    if (input.destination.kind === 'shared') {
      const ids = input.destination.recipientIds;
      await this.jobs.checked(context, async c => {
        for (const id of ids) {
          try { await member(c, context, id); }
          catch (e) {
            if (e instanceof MetadataError && e.code === 'JOB_PRINCIPAL_UNAVAILABLE') throw new MetadataError('DIGEST_SHARED_RECIPIENT_INVALID', 422);
            throw e;
          }
        }
      });
    }
    const spec = newDigest(metricId, context.userId, raw);
    return digestView(await this.jobs.put(context, `digest-${randomUUID()}`, spec, 0, (c, s) => this.executor.authorize(c, s)));
  }
  async list(context: TenantContext, metricId: string) {
    // Access to a subscription never reveals a different subscriber's inbox.
    return (await this.jobs.list(context)).filter(j => j.spec.kind === 'digest' && j.spec.metricId === metricId && j.spec.subscriberId === context.userId && !j.stopped).map(digestView);
  }
  async remove(context: TenantContext, id: string) {
    const job = await this.jobs.get(context, id); digestView(job);
    if (!job.stopped) await this.jobs.stop(context, id, job.version);
  }
  /** Bearer capability grants only stopping this subscription, including after
   * sign-out or owner removal. Replays are harmless; tokens never list/query data. */
  async unsubscribe(scope: Scope, id: string, token: string) {
    identifier(scope.tenantId); identifier(scope.namespaceId); identifier(id);
    if (!/^[a-f0-9]{64}$/.test(token)) throw new MetadataError('DIGEST_UNSUBSCRIBE_INVALID', 404);
    await this.jobs.db.transaction(async c => {
      // Serialize with delivery/revocation, including when a tenant is suspended.
      await c.query('UPDATE h1_tenants SET version = version WHERE tenant_id = ?', [scope.tenantId]);
      const job = await this.jobs.find(c, scope, id);
      if (job.spec.kind !== 'digest' || !timingSafeEqual(Buffer.from(token), Buffer.from(job.spec.unsubscribeToken))) throw new MetadataError('DIGEST_UNSUBSCRIBE_INVALID', 404);
      if (job.stopped) return;
      await cancelJob(c, scope, id, 'DIGEST_UNSUBSCRIBED', this.jobs.clock().toISOString());
      await c.query(`UPDATE h7_jobs SET stopped = 1, next_run = NULL, version = version + 1 WHERE ${scoped} AND job_id = ?`, [...scopeArgs(scope), id]);
    });
  }
}
