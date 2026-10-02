import { checksum } from './metadata-operator.js';
import { MetadataError } from './metadata-db.js';
import type { MailMessage, MailTransport } from './mail.js';
import { nextRun } from './schedule.js';
import { cancelJob, lockTenant, member, readJob, readOccurrence, scoped, scopeArgs, type Occurrence } from './job-schema.js';
import { JobStore } from './job-store.js';
import type { JobExecutor } from './job-renderer.js';

const errorCode = (error: unknown) => error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'JOB_EXECUTION_FAILED';
const retryable = (code: string) => ['SMTP_SEND_FAILED', 'SMTP_NOT_CONFIGURED', 'WORKER_EXECUTION_FAILED', 'TENANT_BUDGET_EXCEEDED', 'NODE_BUDGET_EXCEEDED'].includes(code);
/** One scheduler only. Database records make restart durable, not multi-node safe. */
export class JobRunner {
  private pending?: Promise<void>;
  constructor(readonly store: JobStore, readonly executor: JobExecutor, readonly mail: MailTransport) {}
  async recover(): Promise<void> {
    await this.store.db.transaction(async c => {
      await c.query("UPDATE h7_occurrences SET state = 'queued' WHERE state = 'running'");
      await c.query("UPDATE h7_deliveries SET state = 'pending', next_attempt = ?, error_code = 'DELIVERY_INTERRUPTED' WHERE state = 'sending'", [this.store.clock().toISOString()]);
    });
  }
  tick(): Promise<void> { return this.pending ??= this.work().finally(() => { this.pending = undefined; }); }
  async idle(): Promise<void> { await this.pending; }
  async claimDue(): Promise<void> {
    const jobs = await this.store.db.transaction(c => c.query("SELECT * FROM h7_jobs WHERE stopped = 0 AND next_run <= ? ORDER BY next_run, tenant_id, job_id", [this.store.clock().toISOString()]));
    for (const raw of jobs) {
      const job = readJob(raw);
      try {
        await this.store.db.transaction(async c => {
          await lockTenant(c, job); const current = await this.store.find(c, job, job.id);
          if (current.version !== job.version || current.nextRun !== job.nextRun || current.stopped || current.spec.kind === 'alert') return;
          await this.store.claim(c, current, current.nextRun!);
          await c.query(`UPDATE h7_jobs SET next_run = ? WHERE ${scoped} AND job_id = ?`, [nextRun(current.spec.schedule, this.store.clock()), ...scopeArgs(job), job.id]);
        });
      } catch (error) {
        const code = errorCode(error);
        if (!['TENANT_UNAVAILABLE', 'JOB_PRINCIPAL_UNAVAILABLE', 'JOB_STOPPED'].includes(code)) throw error;
        await this.store.db.transaction(async c => {
          await cancelJob(c, job, job.id, code, this.store.clock().toISOString());
          if (code === 'JOB_PRINCIPAL_UNAVAILABLE') await c.query(`UPDATE h7_jobs SET stopped = 1, next_run = NULL, version = version + 1 WHERE ${scoped} AND job_id = ? AND version = ?`, [...scopeArgs(job), job.id, job.version]);
        });
      }
    }
  }
  private async work(): Promise<void> {
    await this.claimDue();
    // Include alert occurrences enqueued by refresh completion in this tick.
    const queued = async () => (await this.store.db.transaction(c => c.query("SELECT * FROM h7_occurrences WHERE state = 'queued' ORDER BY created_at, occurrence_id"))).map(readOccurrence);
    for (const run of await queued()) await this.execute(run);
    for (const run of await queued()) await this.execute(run);
    await this.deliver();
  }
  async execute(run: Occurrence): Promise<void> {
    try {
      await this.store.db.transaction(async c => {
        await this.store.checkRun(c, run);
        await c.query(`UPDATE h7_occurrences SET state = 'running' WHERE ${scoped} AND occurrence_id = ? AND state = 'queued'`, [...scopeArgs(run), run.id]);
      });
      const context = await this.store.context(run, run.ownerId);
      this.executor.begin(context, () => this.store.recheck(run));
      const result = await this.executor.execute(context, run.spec, this.store.clock());
      await this.store.db.transaction(async c => {
        const job = await this.store.checkRun(c, run), now = this.store.clock().toISOString();
        const notify = run.spec.kind === 'report' || run.spec.kind === 'alert' && result.triggered && job.alertState !== 'triggered';
        if (run.spec.kind === 'alert') await c.query(`UPDATE h7_jobs SET alert_state = ? WHERE ${scoped} AND job_id = ?`, [result.triggered ? 'triggered' : 'ok', ...scopeArgs(run), run.jobId]);
        if (notify && run.spec.kind !== 'refresh') for (const recipient of run.spec.recipients) {
          const key = checksum([run.tenantId, run.namespaceId, run.jobId, run.id, recipient]);
          await c.query(`INSERT INTO h7_deliveries (tenant_id, namespace_id, delivery_id, job_id, occurrence_id, recipient_id, state, next_attempt) VALUES (?,?,?,?,?,?,'pending',?)
            ON CONFLICT (tenant_id, namespace_id, occurrence_id, recipient_id) DO NOTHING`, [...scopeArgs(run), key, run.jobId, run.id, recipient, now]);
        }
        await c.query(`UPDATE h7_occurrences SET state = ?, finished_at = ? WHERE ${scoped} AND occurrence_id = ?`, [notify ? 'delivering' : 'succeeded', notify ? null : now, ...scopeArgs(run), run.id]);
        if (run.spec.kind === 'refresh') {
          await c.query(`UPDATE h7_jobs SET next_run = ? WHERE ${scoped} AND job_id = ?`, [nextRun(run.spec.schedule, this.store.clock()), ...scopeArgs(run), run.jobId]);
          const alerts = (await c.query(`SELECT * FROM h7_jobs WHERE ${scoped} AND owner_id = ? AND stopped = 0`, [...scopeArgs(run), run.ownerId])).map(readJob);
          for (const alert of alerts) if (alert.spec.kind === 'alert' && alert.spec.enabled && alert.spec.datasetId === run.spec.target.id) await this.store.claim(c, alert, `refresh:${run.id}`);
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
  async deliver(): Promise<void> {
    const deliveries = await this.store.db.transaction(c => c.query("SELECT * FROM h7_deliveries WHERE state = 'pending' AND next_attempt <= ? ORDER BY next_attempt, delivery_id", [this.store.clock().toISOString()]));
    for (const d of deliveries) {
      const scope = { tenantId: String(d.tenant_id), namespaceId: String(d.namespace_id) }, id = String(d.delivery_id);
      const row = (await this.store.db.transaction(c => c.query(`SELECT * FROM h7_occurrences WHERE ${scoped} AND occurrence_id = ?`, [...scopeArgs(scope), d.occurrence_id!])))[0]!;
      const run = readOccurrence(row);
      let accepted = false;
      try {
        const verify = async () => {
          await this.store.db.transaction(async c => {
            await this.store.checkRun(c, run); await member(c, run, String(d.recipient_id));
            const delivery = (await c.query(`SELECT state FROM h7_deliveries WHERE ${scoped} AND delivery_id = ?`, [...scopeArgs(run), id]))[0];
            if (!delivery || !['pending', 'sending'].includes(String(delivery.state))) throw new MetadataError('JOB_CANCELLED', 403);
          });
        };
        await verify();
        const owner = await this.store.context(run, run.ownerId);
        this.executor.begin(owner, verify); await this.executor.authorize(owner, run.spec);
        const recipient = await this.store.context(run, String(d.recipient_id));
        this.executor.begin(recipient, verify); await this.executor.authorize(recipient, run.spec);
        const rendered = d.message ? JSON.parse(String(d.message)) as Pick<MailMessage, 'subject' | 'html'> : await this.executor.render(recipient, run.spec, new Date(run.createdAt));
        const message = await this.store.db.transaction(async c => {
          await this.store.checkRun(c, run); const user = await member(c, run, recipient.userId);
          await c.query(`UPDATE h7_deliveries SET state = 'sending', attempts = attempts + 1, message = ? WHERE ${scoped} AND delivery_id = ? AND state = 'pending'`, [JSON.stringify(rendered), ...scopeArgs(run), id]);
          return { ...rendered, to: [user.email], dedupeKey: id };
        });
        await verify(); await this.mail.send(message, verify); accepted = true;
        await this.store.db.transaction(c => c.query(`UPDATE h7_deliveries SET state = 'sent', sent_at = ?, error_code = NULL, message = NULL WHERE ${scoped} AND delivery_id = ?`, [this.store.clock().toISOString(), ...scopeArgs(run), id]));
      } catch (error) {
        // A receipt-store failure after acceptance must leave the durable claim
        // recoverable. Do not turn an ambiguous external effect into a failure.
        if (accepted) throw error;
        const code = errorCode(error), retry = retryable(code), delay = Math.min(3600000, 1000 * 2 ** Math.min(12, Number(d.attempts)));
        await this.store.db.transaction(c => c.query(`UPDATE h7_deliveries SET state = ?, error_code = ?, next_attempt = ?, message = CASE WHEN ? = 1 THEN message ELSE NULL END WHERE ${scoped} AND delivery_id = ? AND state IN ('pending','sending')`,
          [retry ? 'pending' : 'cancelled', code, new Date(this.store.clock().getTime() + delay).toISOString(), retry ? 1 : 0, ...scopeArgs(run), id]));
      }
      await this.store.db.transaction(async c => {
        const rows = await c.query(`SELECT state FROM h7_deliveries WHERE ${scoped} AND occurrence_id = ?`, [...scopeArgs(run), run.id]);
        if (rows.some(r => ['pending', 'sending'].includes(String(r.state)))) return;
        const failed = rows.some(r => r.state !== 'sent');
        await c.query(`UPDATE h7_occurrences SET state = ?, error_code = ?, finished_at = ? WHERE ${scoped} AND occurrence_id = ? AND state = 'delivering'`, [failed ? 'failed' : 'succeeded', failed ? 'JOB_DELIVERY_CANCELLED' : null, this.store.clock().toISOString(), ...scopeArgs(run), run.id]);
      });
    }
  }
}
