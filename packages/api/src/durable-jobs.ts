import { MetadataError, type SqlConnection, type SqlRow } from './metadata-db.js';
import { checksum } from './metadata-operator.js';
import { DurableExecution, type ExecutionEvent, type ExecutionHandle } from './durable-execution.js';
import { type DispatchEnvelope, type EventInput } from './dispatch.js';
import { JobStore } from './job-store.js';
import type { JobExecutor } from './job-renderer.js';
import { lockTenant, member, readJob, readOccurrence, scoped, scopeArgs, type Occurrence } from './job-schema.js';
import { hasCapability, type Role } from '@opensight/query-engine';
import { jobDueEvent, jobExecutionEvent } from './job-dispatch.js';
import { nextRun } from './schedule.js';
import { MailError, type MailTransport } from './mail.js';
import { currentAuthority } from './serverless-authority.js';

/** One source-bound record per invocation; no tick, scan, global reset or timer. */
export class DurableJobs {
  readonly execution: DurableExecution;
  constructor(readonly store: JobStore, readonly executor: JobExecutor, readonly mail: MailTransport) {
    if (!store.dispatch) throw new MetadataError('DISPATCH_CONFIG_INVALID', 503);
    this.execution = new DurableExecution(store.dispatch, (c, event, code, now) => this.terminal(c, event, code, now), async (c, event) => {
      if (event.kind === 'job-deliver') await c.query(`UPDATE h7_deliveries SET error_code = 'DELIVERY_AMBIGUOUS' WHERE ${scoped} AND delivery_id = ? AND state = 'sending'`, [...scopeArgs(event.scope), event.aggregateId]);
    });
  }
  private async due(c: SqlConnection, event: ExecutionEvent) {
    await lockTenant(c, event.scope);
    const due = (await c.query(`SELECT * FROM sr_job_due WHERE deployment = ? AND due_id = ? AND ${scoped} AND owner_id = ?`,
      [this.store.dispatch!.deployment, event.aggregateId, ...scopeArgs(event.scope), event.scope.userId]))[0];
    if (!due) throw new MetadataError('JOB_EVENT_INVALID', 409);
    const job = await this.store.find(c, event.scope, String(due.job_id));
    if (job.version !== Number(due.job_version) || job.version !== event.aggregateRevision || job.ownerId !== event.scope.userId
      || job.stopped || !job.spec.enabled || !job.nextRun || Date.parse(job.nextRun) !== Number(due.due_at)) return undefined;
    return job;
  }
  private async runRow(c: SqlConnection, event: ExecutionEvent): Promise<{ run: Occurrence; delivery?: SqlRow }> {
    const delivery = event.kind === 'job-deliver' ? (await c.query(`SELECT * FROM h7_deliveries WHERE ${scoped} AND delivery_id = ?`, [...scopeArgs(event.scope), event.aggregateId]))[0] : undefined;
    if (event.kind === 'job-deliver' && !delivery) throw new MetadataError('JOB_EVENT_INVALID', 409);
    const row = (await c.query(`SELECT * FROM h7_occurrences WHERE ${scoped} AND occurrence_id = ?`, [...scopeArgs(event.scope), delivery?.occurrence_id ?? event.aggregateId]))[0];
    if (!row || row.owner_id !== event.scope.userId || Number(row.job_version) !== event.aggregateRevision) throw new MetadataError('JOB_EVENT_INVALID', 409);
    return { run: readOccurrence(row), ...(delivery ? { delivery } : {}) };
  }
  private async append(c: SqlConnection, event: ExecutionEvent, events: EventInput[]): Promise<void> {
    for (let i = 0; i < events.length; i += 50) await this.store.dispatch!.append(c, event.eventId, events.slice(i, i + 50));
  }
  private async nextRefresh(c: SqlConnection, event: ExecutionEvent, run: Occurrence, now: number): Promise<void> {
    if (run.spec.kind !== 'refresh') return;
    const job = await this.store.find(c, run, run.jobId);
    if (job.version !== run.jobVersion || job.ownerId !== run.ownerId || job.stopped || !job.spec.enabled) return;
    const next = nextRun(run.spec.schedule, new Date(now));
    await c.query(`UPDATE h7_jobs SET next_run = ? WHERE ${scoped} AND job_id = ?`, [next, ...scopeArgs(run), run.jobId]);
    await this.append(c, event, await jobDueEvent(c, this.store.dispatch!.deployment, { ...job, nextRun: next }));
  }
  private async settle(c: SqlConnection, run: Occurrence, now: number): Promise<void> {
    const rows = await c.query(`SELECT state FROM h7_deliveries WHERE ${scoped} AND occurrence_id = ?`, [...scopeArgs(run), run.id]);
    if (!rows.length || rows.some(r => ['pending', 'sending'].includes(String(r.state)))) return;
    const failed = rows.some(r => r.state !== 'sent');
    await c.query(`UPDATE h7_occurrences SET state = ?, error_code = ?, finished_at = ? WHERE ${scoped} AND occurrence_id = ? AND state = 'delivering'`,
      [failed ? 'failed' : 'succeeded', failed ? 'JOB_DELIVERY_CANCELLED' : null, new Date(now).toISOString(), ...scopeArgs(run), run.id]);
  }
  private async terminal(c: SqlConnection, event: ExecutionEvent, code: string, now: number): Promise<void> {
    if (event.kind === 'job-due') {
      const due = (await c.query(`SELECT * FROM sr_job_due WHERE deployment = ? AND due_id = ? AND ${scoped} AND owner_id = ?`,
        [this.store.dispatch!.deployment, event.aggregateId, ...scopeArgs(event.scope), event.scope.userId]))[0];
      if (due) await c.query(`UPDATE h7_jobs SET stopped = 1, next_run = NULL, version = version + 1 WHERE ${scoped} AND job_id = ? AND owner_id = ? AND version = ? AND next_run = ?`,
        [...scopeArgs(event.scope), due.job_id!, event.scope.userId, due.job_version!, new Date(Number(due.due_at)).toISOString()]);
      return;
    }
    const { run, delivery } = await this.runRow(c, event);
    if (delivery) {
      await c.query(`UPDATE h7_deliveries SET state = 'cancelled', message = NULL, error_code = ? WHERE ${scoped} AND delivery_id = ? AND state IN ('pending','sending')`, [code, ...scopeArgs(run), event.aggregateId]);
      await this.settle(c, run, now); return;
    }
    // A current refresh still owes its next due after a failed compute attempt.
    if (run.spec.kind === 'refresh' && ['queued', 'running'].includes(run.state)) {
      try { await this.store.checkRun(c, run); await this.nextRefresh(c, event, run, now); }
      catch (error) { if (!(error instanceof MetadataError) || error.status >= 500) throw error; }
    }
    await c.query(`UPDATE h7_occurrences SET state = 'failed', error_code = ?, finished_at = ? WHERE ${scoped} AND occurrence_id = ? AND state IN ('queued','running')`, [code, new Date(now).toISOString(), ...scopeArgs(run), run.id]);
  }
  private async claimDue(handle: ExecutionHandle): Promise<void> {
    const event = handle.event;
    await this.execution.complete(handle, async (c, now) => {
      const job = await this.due(c, event); if (!job || job.spec.kind === 'alert') return;
      if (!hasCapability((await member(c, job, job.ownerId)).role as Role, 'build')) throw new MetadataError('JOB_OWNER_FORBIDDEN', 403);
      // claim checks the active owner; execution rechecks full tenant/owner/revision authority.
      const run = await this.store.claim(c, job, job.nextRun!);
      const next = job.spec.kind === 'refresh' ? null : nextRun(job.spec.schedule, new Date(now));
      await c.query(`UPDATE h7_jobs SET next_run = ? WHERE ${scoped} AND job_id = ?`, [next, ...scopeArgs(job), job.id]);
      await this.append(c, event, [jobExecutionEvent(run, now), ...await jobDueEvent(c, this.store.dispatch!.deployment, { ...job, nextRun: next })]);
    });
  }
  private async execute(handle: ExecutionHandle): Promise<void> {
    const event = handle.event;
    const run = await this.execution.checked(handle, async c => {
      const { run } = await this.runRow(c, event);
      if (!['queued', 'running'].includes(run.state)) return undefined;
      await this.store.checkRun(c, run);
      await c.query(`UPDATE h7_occurrences SET state = 'running' WHERE ${scoped} AND occurrence_id = ?`, [...scopeArgs(run), run.id]); return run;
    });
    if (!run) { await this.execution.complete(handle); return; }
    const verify = () => this.execution.checked(handle, async c => { await this.store.checkRun(c, run); });
    const owner = await this.store.context(run, run.ownerId);
    this.executor.begin(owner, verify);
    if (run.spec.kind !== 'refresh') await this.store.metadata.usage?.consume(this.store.metadata, owner, 'computeAttempts');
    // SR2's data adapter accounts/admit/fences actual native work, including refresh.
    const result = await this.executor.execute(owner, run.spec, this.store.clock());
    await this.execution.complete(handle, async (c, now) => {
      const job = await this.store.checkRun(c, run), events: EventInput[] = [];
      const notify = run.spec.kind === 'report' || run.spec.kind === 'alert' && result.triggered && job.alertState !== 'triggered';
      if (run.spec.kind === 'alert') await c.query(`UPDATE h7_jobs SET alert_state = ? WHERE ${scoped} AND job_id = ?`, [result.triggered ? 'triggered' : 'ok', ...scopeArgs(run), run.jobId]);
      if (notify && run.spec.kind !== 'refresh') for (const recipient of run.spec.recipients) {
        const id = checksum([run.tenantId, run.namespaceId, run.jobId, run.id, recipient]);
        await c.query(`INSERT INTO h7_deliveries (tenant_id, namespace_id, delivery_id, job_id, occurrence_id, recipient_id, state, next_attempt) VALUES (?,?,?,?,?,?,'pending',?) ON CONFLICT (tenant_id, namespace_id, occurrence_id, recipient_id) DO NOTHING`,
          [...scopeArgs(run), id, run.jobId, run.id, recipient, new Date(now).toISOString()]);
        events.push({ aggregateId: id, aggregateRevision: run.jobVersion, kind: 'job-deliver', dueAt: now, expiresAt: Math.min(event.expiresAt, now + 86400000) });
      }
      await c.query(`UPDATE h7_occurrences SET state = ?, finished_at = ? WHERE ${scoped} AND occurrence_id = ?`, [notify ? 'delivering' : 'succeeded', notify ? null : new Date(now).toISOString(), ...scopeArgs(run), run.id]);
      await this.nextRefresh(c, event, run, now);
      if (run.spec.kind === 'refresh' && run.spec.target.kind === 'dataset') {
        const alerts = (await c.query(`SELECT * FROM h7_jobs WHERE ${scoped} AND owner_id = ? AND stopped = 0`, [...scopeArgs(run), run.ownerId])).map(readJob);
        for (const alert of alerts) if (alert.spec.kind === 'alert' && alert.spec.enabled && alert.spec.datasetId === run.spec.target.id) {
          events.push(jobExecutionEvent(await this.store.claim(c, alert, `refresh:${run.id}`), now));
        }
      }
      await this.append(c, event, events);
    });
  }
  private async deliver(handle: ExecutionHandle, sending: () => void, accepted: () => void): Promise<void> {
    const { run, delivery } = await this.execution.checked(handle, c => this.runRow(c, handle.event));
    if (!delivery || ['sent', 'cancelled'].includes(String(delivery.state))) { await this.execution.complete(handle); return; }
    if (!this.mail.configured) throw new MailError('SMTP_NOT_CONFIGURED');
    let address: string | undefined;
    const verify = async (): Promise<void> => this.execution.checked(handle, async c => {
      await this.store.checkRun(c, run);
      const recipient = await member(c, run, String(delivery.recipient_id));
      if (address !== undefined && recipient.email !== address) throw new MetadataError('JOB_AUTHORIZATION_REVISED', 403);
      const row = (await c.query(`SELECT state FROM h7_deliveries WHERE ${scoped} AND delivery_id = ?`, [...scopeArgs(run), handle.event.aggregateId]))[0];
      if (!row || !['pending', 'sending'].includes(String(row.state))) throw new MetadataError('JOB_CANCELLED', 403);
      address ??= recipient.email;
    });
    await verify();
    const owner = await this.store.context(run, run.ownerId);
    this.executor.begin(owner, verify); await this.executor.authorize(owner, run.spec);
    const recipient = await this.store.context(run, String(delivery.recipient_id));
    this.executor.begin(recipient, verify); await this.executor.authorize(recipient, run.spec);
    await this.store.metadata.usage?.consume(this.store.metadata, recipient, 'computeAttempts');
    const rendered = await this.executor.render(recipient, run.spec, new Date(run.createdAt));
    await this.execution.checked(handle, async c => {
      await this.store.checkRun(c, run);
      await c.query(`UPDATE h7_deliveries SET state = 'sending', attempts = attempts + 1, message = NULL WHERE ${scoped} AND delivery_id = ?`, [...scopeArgs(run), handle.event.aggregateId]);
    });
    await this.execution.sending(handle); sending();
    await this.mail.send({ ...rendered, to: [address!], dedupeKey: handle.event.aggregateId }, async () => {
      // Full source/RLS/CLS authorization followed by the SQL linearization check.
      this.executor.begin(owner, verify); await this.executor.authorize(owner, run.spec);
      this.executor.begin(recipient, verify); await this.executor.authorize(recipient, run.spec);
      await this.executor.verifyDelivery?.(recipient);
      await verify();
    });
    accepted();
    await this.execution.complete(handle, async (c, now) => {
      // Record an already accepted effect even if permission changed after DATA.
      await c.query(`UPDATE h7_deliveries SET state = 'sent', sent_at = ?, error_code = CASE WHEN state = 'cancelled' THEN 'DELIVERY_ACCEPTED_AFTER_CANCEL' ELSE NULL END, message = NULL WHERE ${scoped} AND delivery_id = ? AND state IN ('sending','cancelled')`, [new Date(now).toISOString(), ...scopeArgs(run), handle.event.aggregateId]);
      await this.settle(c, run, now);
    });
  }
  async run(envelope: DispatchEnvelope, remainingMs = 110000): Promise<void> {
    const handle = await this.execution.claim(envelope, remainingMs);
    if (!handle) { await this.store.dispatch!.flushEvent(envelope); return; }
    let sending = false, accepted = false;
    try {
      if (handle.event.kind === 'job-due') await this.claimDue(handle);
      else if (handle.event.kind === 'job-execute') await this.execute(handle);
      else if (handle.event.kind === 'job-deliver') await this.deliver(handle, () => { sending = true; }, () => { accepted = true; });
      else throw new MetadataError('JOB_EVENT_INVALID', 409);
    } catch (error) {
      if (!accepted && await this.execution.failed(handle, error, sending && (!(error instanceof MetadataError) || error.status >= 500))) {
        await this.store.dispatch!.flushEvent(envelope); return;
      }
      throw error;
    }
    await this.store.dispatch!.flushEvent(envelope);
  }
  async replay(envelope: DispatchEnvelope, acceptAmbiguous = false): Promise<void> {
    const event = await this.store.dispatch!.inspect(envelope, true);
    if (!event || !event.kind.startsWith('job-')) throw new MetadataError('DISPATCH_REPLAY_DENIED', 409);
    let dueAuthority: { context: Awaited<ReturnType<JobStore['context']>>; revisions: Occurrence['revisions'] } | undefined;
    if (event.kind === 'job-due') {
      const job = await this.store.db.transaction(c => this.due(c, event));
      if (!job) throw new MetadataError('DISPATCH_REPLAY_DENIED', 409);
      const context = await this.store.context(job, job.ownerId), revisions = await this.store.metadata.revisions(context);
      await this.executor.authorize(context, job.spec); dueAuthority = { context, revisions };
    } else {
      const { run, delivery } = await this.store.db.transaction(c => this.runRow(c, event));
      await this.executor.authorize(await this.store.context(run, run.ownerId), run.spec);
      if (delivery) await this.executor.authorize(await this.store.context(run, String(delivery.recipient_id)), run.spec);
    }
    await this.execution.replay(envelope, async c => {
      if (this.store.metadata.usage) {
        const limit = this.store.metadata.usage.entitlement(event.scope), period = new Date(await this.store.dispatch!.time(c)).toISOString().slice(0, 10);
        const usage = (await c.query(`SELECT admitted FROM h8_usage WHERE ${scoped} AND period = ? AND metric = 'computeAttempts'`, [...scopeArgs(event.scope), period]))[0];
        if (Number(usage?.admitted ?? 0) >= limit.computeAttempts) throw new MetadataError('USAGE_LIMIT_EXCEEDED', 429);
      }
      if (event.kind === 'job-due') {
        await currentAuthority(c, this.store.metadata, dueAuthority!.context, dueAuthority!.revisions, true);
        const job = await this.due(c, event); if (!job) throw new MetadataError('DISPATCH_REPLAY_DENIED', 409);
        if (!hasCapability((await member(c, job, job.ownerId)).role as Role, 'build')) throw new MetadataError('JOB_OWNER_FORBIDDEN', 403);
        return;
      }
      const { run, delivery } = await this.runRow(c, event); await this.store.checkRun(c, run);
      if (delivery) {
        await member(c, run, String(delivery.recipient_id));
        if (!['pending', 'sending'].includes(String(delivery.state))) throw new MetadataError('DISPATCH_REPLAY_DENIED', 409);
      }
    }, acceptAmbiguous);
  }
}
