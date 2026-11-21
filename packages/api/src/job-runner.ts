import { occurrenceTime, deliveryKey, deliveryRecipients, isRetryableDeliveryError, MAX_DELIVERY_ATTEMPTS, MAX_DELIVERY_TOTAL_ATTEMPTS } from './digest-delivery.js';
import { checksum } from './metadata-operator.js';
import { MetadataError, type SqlConnection } from './metadata-db.js';
import { MailError, type MailMessage, type MailTransport } from './mail.js';
import { nextRun } from './schedule.js';
import { cancelJob, lockTenant, member, readJob, readOccurrence, scoped, scopeArgs, type Occurrence } from './job-schema.js';
import { JobStore } from './job-store.js';
import type { JobExecutor } from './job-renderer.js';

const errorCode = (error: unknown) => error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'JOB_EXECUTION_FAILED';
// Delivery is at-least-once (HQ-13): transient load outcomes — budget
// pressure, queue waits and execution-budget cancellations under load —
// retry with backoff instead of cancelling the delivery for good (#199).
// The sequence is bounded (#233): at MAX_DELIVERY_ATTEMPTS the delivery
// dead-letters instead of rescheduling, so its occurrence can settle.
const retryable = isRetryableDeliveryError;
/** One scheduler only. Database records make restart durable, not multi-node safe. */
export class JobRunner {
  private pending?: Promise<void>;
  private stopping = false;
  stop(): void { this.stopping = true; }
  constructor(readonly store: JobStore, readonly executor: JobExecutor, readonly mail: MailTransport,
    readonly checkAccess?: (tenantId: string) => Promise<void>) {}
  async recover(): Promise<void> {
    await this.store.db.transaction(async c => {
      await c.query("UPDATE h7_occurrences SET state = 'queued' WHERE state = 'running'");
      const exhausted = await c.query("UPDATE h7_deliveries SET state = 'dead', error_code = CASE WHEN total_attempts >= ? THEN 'JOB_DELIVERY_EXHAUSTED' WHEN state = 'sending' THEN 'DELIVERY_INTERRUPTED' ELSE COALESCE(error_code, 'JOB_DELIVERY_EXHAUSTED') END, message = NULL WHERE state IN ('pending','sending') AND (attempts >= ? OR total_attempts >= ?) RETURNING tenant_id, namespace_id, occurrence_id", [MAX_DELIVERY_TOTAL_ATTEMPTS, MAX_DELIVERY_ATTEMPTS, MAX_DELIVERY_TOTAL_ATTEMPTS]);
      await c.query("UPDATE h7_deliveries SET state = 'pending', next_attempt = ?, error_code = 'DELIVERY_INTERRUPTED' WHERE state = 'sending' AND attempts < ? AND total_attempts < ?", [this.store.clock().toISOString(), MAX_DELIVERY_ATTEMPTS, MAX_DELIVERY_TOTAL_ATTEMPTS]);
      for (const d of exhausted) await this.settleOccurrence(c, { tenantId: String(d.tenant_id), namespaceId: String(d.namespace_id), id: String(d.occurrence_id) });
    });
  }
  tick(): Promise<void> { return this.pending ??= this.work().finally(() => { this.pending = undefined; }); }
  async idle(): Promise<void> { await this.pending; }
  async claimDue(): Promise<void> {
    const jobs = await this.store.db.transaction(c => c.query("SELECT * FROM h7_jobs WHERE stopped = 0 AND next_run <= ? ORDER BY next_run, tenant_id, job_id", [this.store.clock().toISOString()]));
    for (const raw of jobs) {
      if (this.stopping) return;
      const job = readJob(raw);
      try {
        // Trial expiry may write billing state, so check outside the job transaction.
        await this.checkAccess?.(job.tenantId);
        await this.store.db.transaction(async c => {
          await lockTenant(c, job); const current = await this.store.find(c, job, job.id);
          if (current.version !== job.version || current.nextRun !== job.nextRun || current.stopped || current.spec.kind === 'alert') return;
          if (current.spec.kind === 'refresh' && current.spec.target.kind === 'prepared-dataset' && current.id === checksum(['prepared-refresh', current.ownerId, current.spec.target.id])) {
            const target = (await c.query(`SELECT body FROM h1_resources WHERE ${scoped} AND kind = 'prepared-dataset' AND owner_id = ? AND resource_id = ?`, [...scopeArgs(current), current.ownerId, current.spec.target.id]))[0];
            const execution = target ? (JSON.parse(String(target.body)) as { execution?: { mode?: string; intervalMinutes?: number } }).execution : undefined;
            if (!execution || execution.mode !== 'BLAZE' || current.spec.schedule.kind !== 'interval' || execution.intervalMinutes !== current.spec.schedule.minutes) {
              await cancelJob(c, current, current.id, 'JOB_SCHEDULE_REVISED', this.store.clock().toISOString());
              await c.query(`UPDATE h7_jobs SET stopped = 1, next_run = NULL, version = version + 1 WHERE ${scoped} AND job_id = ?`, [...scopeArgs(current), current.id]); return;
            }
          }
          await this.store.claim(c, current, current.nextRun!);
          await c.query(`UPDATE h7_jobs SET next_run = ? WHERE ${scoped} AND job_id = ?`, [nextRun(current.spec.schedule, this.store.clock()), ...scopeArgs(job), job.id]);
        });
      } catch (error) {
        const code = errorCode(error);
        // Leave the schedule due and intact: resolving billing admits the next tick.
        if (['TRIAL_EXPIRED', 'BILLING_ACCESS_PAUSED'].includes(code)) continue;
        if (!['TENANT_UNAVAILABLE', 'JOB_PRINCIPAL_UNAVAILABLE', 'JOB_STOPPED'].includes(code)) throw error;
        await this.store.db.transaction(async c => {
          await cancelJob(c, job, job.id, code, this.store.clock().toISOString());
          if (code === 'JOB_PRINCIPAL_UNAVAILABLE') await c.query(`UPDATE h7_jobs SET stopped = 1, next_run = NULL, version = version + 1 WHERE ${scoped} AND job_id = ? AND version = ?`, [...scopeArgs(job), job.id, job.version]);
        });
      }
    }
  }
  private async work(): Promise<void> {
    // The prior single-flight tick may have lost a receipt transaction. There
    // cannot be a live claim in this process while a new tick starts.
    await this.recover();
    await this.claimDue();
    // Include alert occurrences enqueued by refresh completion in this tick.
    const queued = async () => (await this.store.db.transaction(c => c.query("SELECT * FROM h7_occurrences WHERE state = 'queued' ORDER BY created_at, occurrence_id"))).map(readOccurrence);
    for (const run of await queued()) { if (this.stopping) return; await this.execute(run); }
    for (const run of await queued()) { if (this.stopping) return; await this.execute(run); }
    await this.deliver();
  }
  private async recheck(run: Occurrence): Promise<void> {
    await this.checkAccess?.(run.tenantId);
    await this.store.recheck(run);
  }
  async execute(run: Occurrence): Promise<void> {
    try {
      await this.checkAccess?.(run.tenantId);
      await this.store.db.transaction(async c => {
        await this.store.checkRun(c, run);
        await c.query(`UPDATE h7_occurrences SET state = 'running' WHERE ${scoped} AND occurrence_id = ? AND state = 'queued'`, [...scopeArgs(run), run.id]);
      });
      const context = await this.store.context(run, run.ownerId);
      await this.checkAccess?.(run.tenantId);
      await this.store.metadata.usage?.consume(this.store.metadata, context, 'computeAttempts');
      this.executor.begin(context, () => this.recheck(run));
      let result: { triggered?: boolean };
      if (run.spec.kind === 'digest' && run.spec.destination === 'shared') {
        if (!this.executor.authorizeSharedDigest) throw new MetadataError('DIGEST_SHARED_RESOLVER_REQUIRED', 503);
        await this.executor.authorizeSharedDigest(context, run.spec, this.store); result = {};
      } else result = await this.executor.execute(context, run.spec, this.store.clock());
      await this.checkAccess?.(run.tenantId);
      await this.store.db.transaction(async c => {
        const job = await this.store.checkRun(c, run), now = this.store.clock().toISOString();
        const notify = run.spec.kind === 'digest' || run.spec.kind === 'report' || run.spec.kind === 'alert' && result.triggered && job.alertState !== 'triggered';
        if (run.spec.kind === 'alert') await c.query(`UPDATE h7_jobs SET alert_state = ? WHERE ${scoped} AND job_id = ?`, [result.triggered ? 'triggered' : 'ok', ...scopeArgs(run), run.jobId]);
        if (notify && run.spec.kind !== 'refresh') for (const recipient of deliveryRecipients(run.spec)) {
          const key = deliveryKey(run, recipient);
          await c.query(`INSERT INTO h7_deliveries (tenant_id, namespace_id, delivery_id, job_id, occurrence_id, recipient_id, state, next_attempt) VALUES (?,?,?,?,?,?,'pending',?)
            ON CONFLICT (tenant_id, namespace_id, occurrence_id, recipient_id) DO NOTHING`, [...scopeArgs(run), key, run.jobId, run.id, recipient, now]);
        }
        await c.query(`UPDATE h7_occurrences SET state = ?, finished_at = ? WHERE ${scoped} AND occurrence_id = ?`, [notify ? 'delivering' : 'succeeded', notify ? null : now, ...scopeArgs(run), run.id]);
        if (run.spec.kind === 'refresh') {
          await c.query(`UPDATE h7_jobs SET next_run = ? WHERE ${scoped} AND job_id = ?`, [nextRun(run.spec.schedule, this.store.clock()), ...scopeArgs(run), run.jobId]);
          const alerts = (await c.query(`SELECT * FROM h7_jobs WHERE ${scoped} AND owner_id = ? AND stopped = 0`, [...scopeArgs(run), run.ownerId])).map(readJob);
          for (const alert of alerts) if (run.spec.target.kind === 'dataset' && alert.spec.kind === 'alert' && alert.spec.enabled && alert.spec.datasetId === run.spec.target.id) await this.store.claim(c, alert, `refresh:${run.id}`);
        }
      });
    } catch (error) {
      const code = errorCode(error);
      await this.store.db.transaction(async c => {
        await c.query(`UPDATE h7_occurrences SET state = 'failed', error_code = ?, finished_at = ? WHERE ${scoped} AND occurrence_id = ? AND state IN ('queued','running')`, [code, this.store.clock().toISOString(), ...scopeArgs(run), run.id]);
        if (run.spec.kind === 'refresh') await c.query(`UPDATE h7_jobs SET next_run = ? WHERE ${scoped} AND job_id = ? AND version = ? AND stopped = 0`, [nextRun(run.spec.schedule, this.store.clock()), ...scopeArgs(run), run.jobId, run.jobVersion]);
        if (code === 'JOB_PRINCIPAL_UNAVAILABLE') {
          await cancelJob(c, run, run.jobId, code, this.store.clock().toISOString());
          await c.query(`UPDATE h7_jobs SET stopped = 1, next_run = NULL, version = version + 1 WHERE ${scoped} AND job_id = ? AND version = ?`, [...scopeArgs(run), run.jobId, run.jobVersion]);
        }
      });
    }
  }
  private async settleOccurrence(c: SqlConnection, run: Pick<Occurrence, 'tenantId' | 'namespaceId' | 'id'>): Promise<void> {
    const rows = await c.query(`SELECT state FROM h7_deliveries WHERE ${scoped} AND occurrence_id = ?`, [...scopeArgs(run), run.id]);
    if (rows.some(r => ['pending', 'sending'].includes(String(r.state)))) return;
    const failed = rows.some(r => r.state !== 'sent'), dead = rows.some(r => r.state === 'dead');
    await c.query(`UPDATE h7_occurrences SET state = ?, error_code = ?, finished_at = ? WHERE ${scoped} AND occurrence_id = ? AND state = 'delivering'`, [failed ? 'failed' : 'succeeded', failed ? dead ? 'JOB_DELIVERY_EXHAUSTED' : 'JOB_DELIVERY_CANCELLED' : null, this.store.clock().toISOString(), ...scopeArgs(run), run.id]);
  }
  async deliver(): Promise<void> {
    const deliveries = await this.store.db.transaction(c => c.query("SELECT * FROM h7_deliveries WHERE state = 'pending' AND next_attempt <= ? ORDER BY next_attempt, delivery_id", [this.store.clock().toISOString()]));
    for (const d of deliveries) {
      if (this.stopping) return;
      const scope = { tenantId: String(d.tenant_id), namespaceId: String(d.namespace_id) }, id = String(d.delivery_id);
      const row = (await this.store.db.transaction(c => c.query(`SELECT * FROM h7_occurrences WHERE ${scoped} AND occurrence_id = ?`, [...scopeArgs(scope), d.occurrence_id!])))[0]!;
      const run = readOccurrence(row);
      let accepted = false, attempt = Number(d.attempts) + 1, totalAttempts = Number(d.total_attempts) + 1;
      try {
        const verify = async () => {
          await this.checkAccess?.(run.tenantId);
          await this.store.db.transaction(async c => {
            await this.store.checkRun(c, run); await member(c, run, String(d.recipient_id));
            const delivery = (await c.query(`SELECT state FROM h7_deliveries WHERE ${scoped} AND delivery_id = ?`, [...scopeArgs(run), id]))[0];
            if (!delivery || !['pending', 'sending'].includes(String(delivery.state))) throw new MetadataError('JOB_CANCELLED', 403);
          });
        };
        // Exhausted pending rows need only terminal bookkeeping; below the
        // cap, keep authorization ahead of the attempt-consuming claim.
        if (Number(d.attempts) < MAX_DELIVERY_ATTEMPTS && Number(d.total_attempts) < MAX_DELIVERY_TOTAL_ATTEMPTS) await verify();
        const claimed = await this.store.db.transaction(async c => {
          const rows = await c.query(`UPDATE h7_deliveries SET state = 'sending', attempts = attempts + 1, total_attempts = total_attempts + 1 WHERE ${scoped} AND delivery_id = ? AND state = 'pending' AND attempts < ? AND total_attempts < ? RETURNING delivery_id, attempts, total_attempts`, [...scopeArgs(run), id, MAX_DELIVERY_ATTEMPTS, MAX_DELIVERY_TOTAL_ATTEMPTS]);
          if (!rows.length) {
            const exhausted = await c.query(`UPDATE h7_deliveries SET state = 'dead', error_code = CASE WHEN total_attempts >= ? THEN 'JOB_DELIVERY_EXHAUSTED' ELSE COALESCE(error_code, 'JOB_DELIVERY_EXHAUSTED') END, message = NULL WHERE ${scoped} AND delivery_id = ? AND state = 'pending' AND (attempts >= ? OR total_attempts >= ?) RETURNING delivery_id`, [MAX_DELIVERY_TOTAL_ATTEMPTS, ...scopeArgs(run), id, MAX_DELIVERY_ATTEMPTS, MAX_DELIVERY_TOTAL_ATTEMPTS]);
            if (exhausted.length) await this.settleOccurrence(c, run);
          }
          return rows;
        });
        if (!claimed.length) continue;
        attempt = Number(claimed[0]!.attempts);
        totalAttempts = Number(claimed[0]!.total_attempts);
        const owner = await this.store.context(run, run.ownerId);
        await this.checkAccess?.(run.tenantId);
        if (run.spec.kind === 'digest' && run.spec.destination === 'shared') {
          if (!this.executor.renderSharedDigest) throw new MetadataError('DIGEST_SHARED_RESOLVER_REQUIRED', 503);
          this.executor.begin(owner, verify);
          await this.store.metadata.usage?.consume(this.store.metadata, owner, 'computeAttempts');
          const shared = await this.executor.renderSharedDigest(owner, run.spec, occurrenceTime(run), run.jobId, this.store);
          await verify();
          try { await this.mail.send({ ...shared.message, tenantId: run.tenantId, dedupeKey: id }, async () => {
            await shared.verify(); await this.executor.verifyDelivery?.(owner); await verify();
          }); }
          catch (error) { if (!(error instanceof Error && 'code' in error)) throw new MailError('SMTP_SEND_FAILED'); throw error; }
        } else {
          this.executor.begin(owner, verify); await this.executor.authorize(owner, run.spec);
          const recipient = await this.store.context(run, String(d.recipient_id));
          this.executor.begin(recipient, verify); await this.executor.authorize(recipient, run.spec);
          await this.checkAccess?.(run.tenantId);
          if (!d.message) await this.store.metadata.usage?.consume(this.store.metadata, recipient, 'computeAttempts');
          const rendered = d.message && run.spec.kind !== 'digest' ? JSON.parse(String(d.message)) as Pick<MailMessage, 'subject' | 'html'> : await this.executor.render(recipient, run.spec, occurrenceTime(run), run.jobId);
          const message = await this.store.db.transaction(async c => {
            await this.store.checkRun(c, run); const user = await member(c, run, recipient.userId);
            await c.query(`UPDATE h7_deliveries SET message = ? WHERE ${scoped} AND delivery_id = ? AND state = 'sending'`, [run.spec.kind === 'digest' ? null : JSON.stringify(rendered), ...scopeArgs(run), id]);
            return { ...rendered, to: [user.email], dedupeKey: id };
          });
          await verify();
          try { await this.mail.send({ ...message, tenantId: run.tenantId }, async () => {
            if (run.spec.kind === 'digest') {
              this.executor.begin(owner, verify); await this.executor.authorize(owner, run.spec);
              this.executor.begin(recipient, verify); await this.executor.authorize(recipient, run.spec);
              await this.executor.verifyDelivery?.(recipient);
              const current = await this.store.db.transaction(c => member(c, run, recipient.userId));
              if (current.email !== message.to[0]) throw new MetadataError('JOB_AUTHORIZATION_REVISED', 403);
            }
            await verify();
          }); }
          catch (error) { if (!(error instanceof Error && 'code' in error)) throw new MailError('SMTP_SEND_FAILED'); throw error; }
        }
        accepted = true;
        await this.store.db.transaction(c => c.query(`UPDATE h7_deliveries SET state = 'sent', sent_at = ?, error_code = NULL, message = NULL WHERE ${scoped} AND delivery_id = ?`, [this.store.clock().toISOString(), ...scopeArgs(run), id]));
      } catch (error) {
        // Below the cap, leave an accepted send's lost receipt recoverable.
        // At the cap, end the ambiguous sequence without another send (#251).
        if (accepted && attempt < MAX_DELIVERY_ATTEMPTS && totalAttempts < MAX_DELIVERY_TOTAL_ATTEMPTS) throw error;
        const code = errorCode(error), retry = accepted || retryable(code);
        const exhausted = retry && (attempt >= MAX_DELIVERY_ATTEMPTS || totalAttempts >= MAX_DELIVERY_TOTAL_ATTEMPTS);
        const state = !retry ? 'cancelled' : exhausted ? 'dead' : 'pending';
        const delay = Math.min(3600000, 1000 * 2 ** Math.min(12, Number(d.attempts)));
        await this.store.db.transaction(async c => {
          await c.query(`UPDATE h7_deliveries SET state = ?, error_code = ?, next_attempt = ?, message = CASE WHEN ? = 1 THEN message ELSE NULL END WHERE ${scoped} AND delivery_id = ? AND state IN ('pending','sending')`,
            [state, code, new Date(this.store.clock().getTime() + delay).toISOString(), state === 'pending' ? 1 : 0, ...scopeArgs(run), id]);
          await this.settleOccurrence(c, run);
        });
        continue;
      }
      await this.store.db.transaction(c => this.settleOccurrence(c, run));
    }
  }
}
