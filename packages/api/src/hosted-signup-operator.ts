import { appendOperatorAudit } from './operator-audit.js';
import { MetadataError, type Database } from './metadata-db.js';
import { DAY_MS, type HostedBilling } from './hosted-billing.js';
import type { HostedSignup } from './hosted-signup.js';

/** The cap check runs inside existing provisioning's transaction/lock, so
 * simultaneous verifications cannot reserve the last slot twice. */
export class SignupOperator {
  constructor(private readonly db: Database, private readonly signup: HostedSignup,
    private readonly billing: HostedBilling, private readonly clock = Date.now) {
    signup.admission = async (c, row) => {
      if (!signup.config.enabled) return false;
      const setting = (await c.query('UPDATE h10_signup_settings SET id = id WHERE id = 1 RETURNING paused'))[0]!;
      if (Number(setting.paused)) return false;
      const cutoff = new Date(this.clock() - DAY_MS).toISOString();
      const counts = (await c.query(`SELECT COUNT(*) AS total, SUM(CASE WHEN created_ip = ? THEN 1 ELSE 0 END) AS per_ip
        FROM h10_signups WHERE trial_started_at > ?`, [row.created_ip!, cutoff]))[0]!;
      return Number(counts.total) < signup.config.volumeCap && Number(counts.per_ip ?? 0) < 3;
    };
  }
  async status() {
    await this.billing.expireTrials();
    return this.db.transaction(async c => {
      const today = new Date(this.clock()).toISOString().slice(0, 10) + 'T00:00:00.000Z';
      const cutoff = new Date(this.clock() - DAY_MS).toISOString();
      const counts = (await c.query(`SELECT SUM(CASE WHEN trial_started_at >= ? THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN trial_started_at > ? THEN 1 ELSE 0 END) AS recent,
        SUM(CASE WHEN queued_at IS NOT NULL AND state = 'pending' THEN 1 ELSE 0 END) AS queued FROM h10_signups`, [today, cutoff]))[0]!;
      const paused = Number((await c.query('SELECT paused FROM h10_signup_settings WHERE id = 1'))[0]!.paused) === 1;
      const convertedToday = Number((await c.query(`SELECT COUNT(DISTINCT tenant_id) AS count FROM h8_audit WHERE created_at >= ? AND action = 'billing.trial.converted'
        AND tenant_id IN (SELECT tenant_id FROM h10_signups WHERE trial_started_at IS NOT NULL)
        AND tenant_id IN (SELECT tenant_id FROM h9_billing WHERE tier IN ('light','regular','heavy'))`, [today]))[0]?.count ?? 0);
      const expiredToday = Number((await c.query(`SELECT COUNT(*) AS count FROM h9_billing WHERE trial_ends_at IS NOT NULL AND pause_effective_at >= ? AND access_state = 'paused'`, [today]))[0]?.count ?? 0);
      const trialsLast24h = Number(counts.recent ?? 0);
      const retentionDue = await c.query(`SELECT b.tenant_id, t.display_name, b.retention_due_at FROM h9_billing b JOIN h1_tenants t ON t.tenant_id = b.tenant_id
        WHERE b.access_state = 'paused' AND b.retention_due_at <= ? AND t.state NOT IN ('deleted','deleting') ORDER BY b.retention_due_at`, [new Date(this.clock()).toISOString()]);
      return { enabled: this.signup.config.enabled, paused, volumeCap: this.signup.config.volumeCap, trialsToday: Number(counts.today ?? 0), trialsLast24h,
        convertedToday, expiredToday, queued: Number(counts.queued ?? 0), pausedAtCap: trialsLast24h >= this.signup.config.volumeCap,
        retentionDue: retentionDue.map(row => ({ tenantId: String(row.tenant_id), displayName: row.display_name, retentionDueAt: String(row.retention_due_at) })) };
    });
  }
  async setPaused(paused: unknown) {
    if (typeof paused !== 'boolean') throw new MetadataError('SIGNUP_SETTING_INVALID', 400);
    await this.db.transaction(async c => {
      await c.query('UPDATE h10_signup_settings SET paused = ? WHERE id = 1', [paused ? 1 : 0]);
      await appendOperatorAudit(c, { action: paused ? 'signup.paused' : 'signup.resumed', detail: { paused } }, this.clock());
    });
    if (!paused) await this.drain();
    return this.status();
  }
  private draining = false;
  async drain(): Promise<void> {
    if (this.draining || !this.signup.config.enabled) return;
    this.draining = true;
    try {
      const rows = await this.db.transaction(c => c.query(`SELECT s.* FROM h10_signups s WHERE (s.state = 'pending' AND s.verified_at IS NOT NULL) OR (s.state = 'verified' AND EXISTS (SELECT 1 FROM h1_operations o WHERE o.tenant_id = s.tenant_id AND o.action = 'provision' AND o.status <> 'complete')) ORDER BY s.queued_at, s.id LIMIT ?`, [this.signup.config.volumeCap]));
      for (const row of rows) {
        // Each provisioning call rechecks cap/pause. A shared IP queues rather
        // than becoming a permanent identity refusal. Initial invitation is the ready email.
        try { await this.signup.provision(row); } catch (error) {
          await this.db.transaction(c => appendOperatorAudit(c, { action: 'signup.provisioning.failed', subject: String(row.id), detail: { code: error instanceof MetadataError ? error.code : 'SIGNUP_PROVISIONING_FAILED' } }, this.clock()));
        }
      }
    } finally { this.draining = false; }
  }
}
