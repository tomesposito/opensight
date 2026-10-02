import { hasCapability, type Role } from '@opensight/query-engine';
import { checksum } from './metadata-operator.js';
import { MetadataError, missing, type SqlConnection } from './metadata-db.js';
import { identifier, object, type Scope } from './metadata-resources.js';
import { cancelJob, lockTenant, member, readJob, revisions, scoped, scopeArgs } from './job-schema.js';
import { JobStore } from './job-store.js';
import type { JobExecutor } from './job-renderer.js';

export interface JobDisposition { action: 'stop' | 'transfer'; preview: string; transferTo?: string }
export function disposition(raw: unknown): JobDisposition | undefined {
  if (raw === undefined) return undefined;
  const b = object(raw, ['action', 'preview', 'transferTo']);
  if (!['stop', 'transfer'].includes(String(b.action)) || typeof b.preview !== 'string' || !/^[a-f0-9]{64}$/.test(b.preview) || b.action === 'stop' && b.transferTo !== undefined) throw new MetadataError('JOB_DISPOSITION_INVALID', 400);
  return { action: b.action as JobDisposition['action'], preview: b.preview, ...(b.action === 'transfer' ? { transferTo: identifier(b.transferTo) } : {}) };
}
export async function removalPreview(c: SqlConnection, s: Scope, userId: string) {
  const m = (await c.query(`SELECT status, version FROM h2_memberships WHERE ${scoped} AND user_id = ?`, [...scopeArgs(s), identifier(userId)]))[0];
  if (!m) missing();
  const jobs = (await c.query(`SELECT * FROM h7_jobs WHERE ${scoped} AND owner_id = ? AND stopped = 0 ORDER BY job_id`, [...scopeArgs(s), userId])).map(readJob);
  const candidates = await c.query(`SELECT m.user_id, u.body FROM h2_memberships m JOIN h2_identities i ON i.subject = m.subject
    JOIN h1_resources u ON u.tenant_id = m.tenant_id AND u.namespace_id = m.namespace_id AND u.kind = 'user' AND u.owner_id = '' AND u.resource_id = m.user_id
    WHERE m.tenant_id = ? AND m.namespace_id = ? AND m.user_id <> ? AND m.status = 'active' AND i.status = 'active' ORDER BY m.user_id`, [...scopeArgs(s), userId]);
  return { userId, status: String(m.status), preview: checksum([s, userId, m, jobs.map(j => [j.id, j.version]), await revisions(c, s)]),
    jobs: jobs.map(j => ({ id: j.id, kind: j.spec.kind, enabled: j.spec.enabled })),
    candidates: candidates.filter(r => hasCapability(object(JSON.parse(String(r.body))).role as Role, 'build')).map(r => ({ id: String(r.user_id), name: String(object(JSON.parse(String(r.body))).name) })) };
}
export class JobOwnership {
  constructor(readonly store: JobStore, readonly executor: JobExecutor) {}
  async scope(c: SqlConnection, tenantId: string): Promise<Scope> {
    const row = (await c.query('SELECT namespace_id FROM h1_namespaces WHERE tenant_id = ?', [identifier(tenantId)]))[0];
    if (!row) missing(); return { tenantId, namespaceId: String(row.namespace_id) };
  }
  async preview(tenantId: string, userId: string) {
    return this.store.db.transaction(async c => { const s = await this.scope(c, tenantId); await lockTenant(c, s); return removalPreview(c, s, userId); });
  }
  async users(tenantId: string) {
    return this.store.db.transaction(async c => {
      const s = await this.scope(c, tenantId); await lockTenant(c, s);
      const rows = await c.query(`SELECT m.user_id, m.status, u.body FROM h2_memberships m JOIN h1_resources u ON u.tenant_id = m.tenant_id AND u.namespace_id = m.namespace_id AND u.kind = 'user' AND u.owner_id = '' AND u.resource_id = m.user_id
        WHERE m.tenant_id = ? AND m.namespace_id = ? AND m.status <> 'removed' ORDER BY m.user_id`, scopeArgs(s));
      return rows.map(r => ({ id: String(r.user_id), status: String(r.status), ...object(JSON.parse(String(r.body))) }));
    });
  }
  async validateTransfer(tenantId: string, userId: string, choice: JobDisposition): Promise<void> {
    if (choice.action !== 'transfer') return;
    const snapshot = await this.preview(tenantId, userId);
    if (snapshot.preview !== choice.preview) throw new MetadataError('JOB_DISPOSITION_STALE');
    if (!snapshot.candidates.some(u => u.id === choice.transferTo)) throw new MetadataError('JOB_TRANSFER_TARGET_INVALID', 403);
    const s = await this.store.db.transaction(c => this.scope(c, tenantId)), context = await this.store.context(s, choice.transferTo!);
    for (const j of snapshot.jobs) {
      const job = await this.store.db.transaction(c => this.store.find(c, s, j.id));
      await this.executor.authorize(context, job.spec);
      if (job.spec.kind !== 'refresh') for (const recipient of job.spec.recipients) {
        const recipientContext = await this.store.context(s, recipient);
        await this.executor.authorize(recipientContext, job.spec);
      }
    }
    // applyDisposition compares the same fingerprint inside the removal transaction.
  }
}
export async function applyDisposition(c: SqlConnection, s: Scope, userId: string, choice: JobDisposition | undefined, now: string): Promise<void> {
  const current = await removalPreview(c, s, userId);
  if (current.status === 'removed') return;
  if (current.jobs.length && !choice) throw new MetadataError('JOB_DISPOSITION_REQUIRED');
  if (choice && choice.preview !== current.preview) throw new MetadataError('JOB_DISPOSITION_STALE');
  if (choice?.action === 'transfer') {
    if (!current.candidates.some(u => u.id === choice.transferTo)) throw new MetadataError('JOB_TRANSFER_TARGET_INVALID', 403);
    await member(c, s, choice.transferTo!);
  }
  for (const j of current.jobs) {
    await cancelJob(c, s, j.id, choice?.action === 'transfer' ? 'JOB_OWNER_TRANSFERRED' : 'JOB_OWNER_REMOVED', now);
    if (choice?.action === 'transfer') await c.query(`UPDATE h7_jobs SET owner_id = ?, version = version + 1, alert_state = 'ok' WHERE ${scoped} AND job_id = ?`, [choice.transferTo!, ...scopeArgs(s), j.id]);
    else await c.query(`UPDATE h7_jobs SET stopped = 1, next_run = NULL, version = version + 1 WHERE ${scoped} AND job_id = ?`, [...scopeArgs(s), j.id]);
  }
  await c.query(`UPDATE h7_deliveries SET state = 'cancelled', error_code = 'JOB_RECIPIENT_REMOVED', message = NULL WHERE ${scoped} AND recipient_id = ? AND state IN ('pending','sending')`, [...scopeArgs(s), userId]);
  await c.query(`UPDATE h7_occurrences SET state = 'failed', error_code = 'JOB_RECIPIENT_REMOVED', finished_at = ? WHERE ${scoped} AND state = 'delivering'
    AND NOT EXISTS (SELECT 1 FROM h7_deliveries d WHERE d.tenant_id = h7_occurrences.tenant_id AND d.namespace_id = h7_occurrences.namespace_id AND d.occurrence_id = h7_occurrences.occurrence_id AND d.state IN ('pending','sending'))`, [now, ...scopeArgs(s)]);
}
