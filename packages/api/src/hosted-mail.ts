import { randomUUID } from 'node:crypto';
import { MetadataError, type Database } from './metadata-db.js';
import type { MailMessage, MailTransport } from './mail.js';
import type { HostedBilling } from './hosted-billing.js';

export const MONTHLY_EMAILS = { free: 100, light: 500, regular: 5000, heavy: 25000 } as const;
export async function initializeTenantMail(db: Database): Promise<void> {
  await db.transaction(async c => {
    await c.query(`CREATE TABLE IF NOT EXISTS h10_mail_usage (
      tenant_id TEXT NOT NULL, period TEXT NOT NULL, used INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, period))`);
    await c.query(`CREATE TABLE IF NOT EXISTS h10_mail_receipts (
      tenant_id TEXT NOT NULL, delivery_id TEXT NOT NULL, PRIMARY KEY (tenant_id, delivery_id))`);
  });
}
/** The single hosted mail boundary. Count recipients, including all members of
 * a shared digest, immediately before transport acceptance. Durable reservations
 * are conservative after ambiguous SMTP failure; retries with the same delivery
 * key do not spend twice. Operator/identity messages have no tenantId. */
export class TenantMailTransport implements MailTransport {
  constructor(private readonly db: Database, private readonly billing: HostedBilling,
    private readonly transport: MailTransport, private readonly clock = Date.now) {}
  get configured(): boolean { return this.transport.configured; }
  get deliveryConfigured(): boolean { return this.transport.deliveryConfigured ?? this.transport.configured; }
  async send(message: MailMessage, authorize?: () => Promise<void>): Promise<void> {
    if (!message.tenantId) return this.transport.send(message, authorize);
    const tenantId = message.tenantId, deliveryId = message.dedupeKey ?? randomUUID();
    await this.transport.send(message, async () => {
      await authorize?.();
      const record = await this.billing.state(tenantId);
      this.billing.assertAccess(tenantId);
      // Existing hand-provisioned tenants without billing keep their operator configuration.
      if ('status' in record) return;
      const trial = this.billing.trial(tenantId);
      const limit = trial ? 25 : record.tier ? MONTHLY_EMAILS[record.tier] : 0;
      const period = trial ? `trial:${trial.endsAt}` : new Date(this.clock()).toISOString().slice(0, 7);
      await this.db.transaction(async c => {
        await c.query('UPDATE h1_tenants SET version = version WHERE tenant_id = ?', [tenantId]);
        if ((await c.query('SELECT delivery_id FROM h10_mail_receipts WHERE tenant_id = ? AND delivery_id = ?', [tenantId, deliveryId])).length) return;
        const rows = await c.query(`INSERT INTO h10_mail_usage (tenant_id, period, used) VALUES (?,?,0)
          ON CONFLICT (tenant_id, period) DO UPDATE SET used = h10_mail_usage.used RETURNING used`, [tenantId, period]);
        const count = message.to.length;
        if (!count || Number(rows[0]!.used) + count > limit) throw new MetadataError('EMAIL_LIMIT_EXCEEDED', 429);
        await c.query('UPDATE h10_mail_usage SET used = used + ? WHERE tenant_id = ? AND period = ?', [count, tenantId, period]);
        await c.query('INSERT INTO h10_mail_receipts (tenant_id, delivery_id) VALUES (?,?)', [tenantId, deliveryId]);
      });
    });
  }
}
