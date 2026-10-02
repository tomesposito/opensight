import { randomUUID } from 'node:crypto';
import { hasCapability, type Role } from '@opensight/query-engine';
import { checksum } from './metadata-operator.js';
import { MetadataError, missing, type Database, type SqlConnection } from './metadata-db.js';
import { identifier, type Scope } from './metadata-resources.js';
import { type TenantContext, TenantMetadata, type Revisions } from './metadata.js';
import type { ExecutionSettings } from './blaze.js';
import { object } from './metadata-resources.js';
import { appendMetadataEvent } from './metadata-outbox.js';
import { nextRun } from './schedule.js';
import { cancelJob, jobSpec, lockTenant, member, readJob, readOccurrence, revisions, scoped, scopeArgs, type Job, type JobSpec, type Occurrence } from './job-schema.js';

export class JobStore {
  constructor(readonly db: Database, readonly metadata: TenantMetadata, readonly clock = () => new Date()) {}
  async context(s: Scope, userId: string): Promise<TenantContext> {
    await this.db.transaction(async c => { await lockTenant(c, s); await member(c, s, userId); });
    const context = await this.metadata.authenticate(null, async () => ({ namespaceId: s.namespaceId, userId }));
    if (context.tenantId !== s.tenantId) throw new MetadataError('JOB_PRINCIPAL_UNAVAILABLE', 403);
    return context;
  }
  async checked<T>(context: TenantContext, work: (c: SqlConnection, administrator: boolean) => Promise<T>): Promise<T> {
    this.metadata.assertContext(context);
    return this.db.transaction(async c => {
      await lockTenant(c, context); const user = await member(c, context, context.userId);
      if ((await revisions(c, context)).authorization !== context.authorizationRevision) throw new MetadataError('AUTHORIZATION_REVISED', 403);
      return work(c, user.role === 'administrator');
    });
  }
  async find(c: SqlConnection, s: Scope, id: string): Promise<Job> {
    const row = (await c.query(`SELECT * FROM h7_jobs WHERE ${scoped} AND job_id = ?`, [...scopeArgs(s), identifier(id)]))[0];
    return row ? readJob(row) : missing();
  }
  async get(context: TenantContext, id: string): Promise<Job> {
    return this.checked(context, async (c, admin) => { const job = await this.find(c, context, id); if (!admin && job.ownerId !== context.userId) missing(); return job; });
  }
  async list(context: TenantContext): Promise<Job[]> {
    return this.checked(context, async (c, admin) => (await c.query(`SELECT * FROM h7_jobs WHERE ${scoped}${admin ? '' : ' AND owner_id = ?'} ORDER BY job_id`, [...scopeArgs(context), ...admin ? [] : [context.userId]])).map(readJob));
  }
  async recipients(context: TenantContext) {
    return this.checked(context, async c => {
      const user = await member(c, context, context.userId);
      if (!hasCapability(user.role as Role, 'build')) throw new MetadataError('JOB_WRITE_FORBIDDEN', 403);
      const rows = await c.query(`SELECT m.user_id, u.body, i.email FROM h2_memberships m JOIN h2_identities i ON i.subject = m.subject
        JOIN h1_resources u ON u.tenant_id = m.tenant_id AND u.namespace_id = m.namespace_id AND u.kind = 'user' AND u.owner_id = '' AND u.resource_id = m.user_id
        WHERE m.tenant_id = ? AND m.namespace_id = ? AND m.status = 'active' AND i.status = 'active' ORDER BY m.user_id`, scopeArgs(context));
      return rows.map(r => ({ id: String(r.user_id), name: String((JSON.parse(String(r.body)) as { name: string }).name), email: String(r.email) }));
    });
  }
  /** Commit a validated prepared execution setting and its owned schedule together.
   * The private H7 tables use the membership pool, never grants to tenant SQL. */
  async configurePrepared(context: TenantContext, id: string, settings: ExecutionSettings, expectedVersion: number, expected: Revisions): Promise<void> {
    await this.checked(context, async c => {
      const user = await member(c, context, context.userId);
      if (!hasCapability(user.role as Role, 'build')) throw new MetadataError('JOB_WRITE_FORBIDDEN', 403);
      if (JSON.stringify(expected) !== JSON.stringify(await revisions(c, context))) throw new MetadataError('METADATA_REVISED', 403);
      const args = [...scopeArgs(context), context.userId, identifier(id)], predicate = `${scoped} AND kind = 'prepared-dataset' AND owner_id = ? AND resource_id = ?`;
      const r = (await c.query(`SELECT body, version FROM h1_resources WHERE ${predicate}`, args))[0];
      if (!r) missing(); if (Number(r.version) !== expectedVersion) throw new MetadataError('METADATA_CONFLICT');
      const body = object(JSON.parse(String(r.body)));
      await c.query(`UPDATE h1_resources SET body = ?, version = version + 1 WHERE ${predicate}`, [JSON.stringify({ ...body, execution: settings }), ...args]);
      await c.query(`UPDATE h1_revisions SET configuration = configuration + 1 WHERE ${scoped}`, scopeArgs(context));
      await appendMetadataEvent(c, context, 'prepared.execution.changed');
      const jobId = checksum(['prepared-refresh', context.userId, id]);
      const existing = (await c.query(`SELECT * FROM h7_jobs WHERE ${scoped} AND job_id = ?`, [...scopeArgs(context), jobId]))[0];
      await cancelJob(c, context, jobId, 'JOB_REVISED', this.clock().toISOString());
      if (settings.intervalMinutes === null) {
        if (existing) await c.query(`UPDATE h7_jobs SET stopped = 1, next_run = NULL, version = version + 1 WHERE ${scoped} AND job_id = ?`, [...scopeArgs(context), jobId]);
        return;
      }
      const spec: JobSpec = { kind: 'refresh', target: { kind: 'prepared-dataset', id }, enabled: true, schedule: { kind: 'interval', minutes: settings.intervalMinutes, timeZone: 'UTC' } };
      const next = nextRun(spec.schedule, this.clock());
      if (existing) await c.query(`UPDATE h7_jobs SET owner_id = ?, version = version + 1, spec = ?, next_run = ?, stopped = 0 WHERE ${scoped} AND job_id = ?`, [context.userId, JSON.stringify(spec), next, ...scopeArgs(context), jobId]);
      else await c.query('INSERT INTO h7_jobs (tenant_id, namespace_id, job_id, owner_id, version, spec, next_run) VALUES (?,?,?,?,1,?,?)', [...scopeArgs(context), jobId, context.userId, JSON.stringify(spec), next]);
    });
  }
  async put(context: TenantContext, id: string, raw: unknown, expectedVersion: number, authorize: (context: TenantContext, spec: JobSpec) => Promise<void>): Promise<Job> {
    identifier(id); const spec = jobSpec(raw);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new MetadataError('JOB_VERSION_REQUIRED', 400);
    const rev = await this.metadata.revisions(context);
    await authorize(context, spec);
    return this.checked(context, async c => {
      if (JSON.stringify(rev) !== JSON.stringify(await revisions(c, context))) throw new MetadataError('METADATA_REVISED', 403);
      const user = await member(c, context, context.userId);
      if (!hasCapability(user.role as Role, 'build')) throw new MetadataError('JOB_WRITE_FORBIDDEN', 403);
      const row = (await c.query(`SELECT * FROM h7_jobs WHERE ${scoped} AND job_id = ?`, [...scopeArgs(context), id]))[0];
      if (row && row.owner_id !== context.userId) missing();
      if (Number(row?.version ?? 0) !== expectedVersion) throw new MetadataError('JOB_VERSION_CONFLICT');
      if (spec.kind !== 'refresh') for (const id of spec.recipients) await member(c, context, id);
      const next = spec.enabled && spec.kind !== 'alert' ? nextRun(spec.schedule, this.clock()) : null;
      if (row) {
        await cancelJob(c, context, id, 'JOB_REVISED', this.clock().toISOString());
        await c.query(`UPDATE h7_jobs SET version = version + 1, spec = ?, next_run = ?, stopped = 0, alert_state = 'ok' WHERE ${scoped} AND job_id = ?`, [JSON.stringify(spec), next, ...scopeArgs(context), id]);
      } else await c.query('INSERT INTO h7_jobs (tenant_id, namespace_id, job_id, owner_id, version, spec, next_run) VALUES (?,?,?,?,1,?,?)', [...scopeArgs(context), id, context.userId, JSON.stringify(spec), next]);
      return this.find(c, context, id);
    });
  }
  async stop(context: TenantContext, id: string, expectedVersion: number): Promise<void> {
    await this.checked(context, async (c, admin) => {
      const job = await this.find(c, context, id); if (!admin && job.ownerId !== context.userId) missing();
      if (job.version !== expectedVersion) throw new MetadataError('JOB_VERSION_CONFLICT');
      await cancelJob(c, context, id, 'JOB_STOPPED', this.clock().toISOString());
      await c.query(`UPDATE h7_jobs SET stopped = 1, next_run = NULL, version = version + 1 WHERE ${scoped} AND job_id = ?`, [...scopeArgs(context), id]);
    });
  }
  async history(context: TenantContext, id: string): Promise<Occurrence[]> {
    return this.checked(context, async (c, admin) => { const job = await this.find(c, context, id); if (!admin && job.ownerId !== context.userId) missing();
      return (await c.query(`SELECT * FROM h7_occurrences WHERE ${scoped} AND job_id = ? ORDER BY created_at, occurrence_id`, [...scopeArgs(context), id])).map(readOccurrence);
    });
  }
  async deliveries(context: TenantContext, id: string) {
    return this.checked(context, async (c, admin) => { const job = await this.find(c, context, id); if (!admin && job.ownerId !== context.userId) missing();
      return c.query(`SELECT delivery_id, occurrence_id, recipient_id, state, attempts, error_code, sent_at FROM h7_deliveries WHERE ${scoped} AND job_id = ? ORDER BY delivery_id`, [...scopeArgs(context), id]);
    });
  }
  async enqueue(context: TenantContext, id: string): Promise<Occurrence> {
    return this.checked(context, async (c, admin) => {
      const job = await this.find(c, context, id); if (!admin && job.ownerId !== context.userId) missing();
      if (job.spec.kind === 'alert') throw new MetadataError('JOB_REFRESH_REQUIRED', 409);
      return this.claim(c, job, `manual:${randomUUID()}`, context.userId);
    });
  }
  async claim(c: SqlConnection, job: Job, due: string, initiatedBy = job.ownerId): Promise<Occurrence> {
    if (job.stopped || !job.spec.enabled) throw new MetadataError('JOB_STOPPED', 409);
    await member(c, job, job.ownerId);
    const pending = (await c.query(`SELECT * FROM h7_occurrences WHERE ${scoped} AND job_id = ? AND state IN ('queued','running','delivering')`, [...scopeArgs(job), job.id]))[0];
    if (pending) return readOccurrence(pending);
    const id = checksum([job.tenantId, job.namespaceId, job.id, job.version, due]), now = this.clock().toISOString();
    await c.query(`INSERT INTO h7_occurrences VALUES (?,?,?,?,?,?,?,?,?,?,'queued',NULL,?,NULL) ON CONFLICT (tenant_id,namespace_id,job_id,job_version,due) DO NOTHING`,
      [...scopeArgs(job), id, job.id, job.ownerId, initiatedBy, job.version, due, JSON.stringify(job.spec), JSON.stringify(await revisions(c, job)), now]);
    return readOccurrence((await c.query(`SELECT * FROM h7_occurrences WHERE ${scoped} AND occurrence_id = ?`, [...scopeArgs(job), id]))[0]!);
  }
  async checkRun(c: SqlConnection, run: Occurrence): Promise<Job> {
    await lockTenant(c, run); const owner = await member(c, run, run.ownerId);
    const job = await this.find(c, run, run.jobId);
    if (job.stopped || !job.spec.enabled || job.version !== run.jobVersion || job.ownerId !== run.ownerId) throw new MetadataError('JOB_REVISED', 403);
    if (JSON.stringify(run.revisions) !== JSON.stringify(await revisions(c, run))) throw new MetadataError('JOB_AUTHORIZATION_REVISED', 403);
    if (!hasCapability(owner.role as Role, 'build')) throw new MetadataError('JOB_OWNER_FORBIDDEN', 403);
    const row = (await c.query(`SELECT state FROM h7_occurrences WHERE ${scoped} AND occurrence_id = ?`, [...scopeArgs(run), run.id]))[0];
    if (!row || !['queued', 'running', 'delivering'].includes(String(row.state))) throw new MetadataError('JOB_CANCELLED', 403);
    return job;
  }
  async recheck(run: Occurrence): Promise<void> { await this.db.transaction(c => this.checkRun(c, run)); }
}
