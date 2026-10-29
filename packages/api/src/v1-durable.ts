import { createHash, randomUUID } from 'node:crypto';
import { MetadataError, type Database, type SqlConnection, type SqlRow } from './metadata-db.js';
import type { TenantContext, TenantMetadata } from './metadata.js';
import { coordinationNow, type CoordinationDialect } from './coordination-schema.js';
import { RETRY_TTL_MS, retryLimits, v1RateLimit, type RetryAdapter, type RetryReservation } from './retry-store.js';

const pendingMs = 60000;
const capacity = (): never => { throw new MetadataError('IDEMPOTENCY_CAPACITY_EXCEEDED', 429); };
const stale = (): never => { throw new MetadataError('IDEMPOTENCY_IN_PROGRESS', 409); };
/** No payload or tenant identity is accepted from HTTP. The context is metadata-verified. */
export class DurableV1 implements RetryAdapter {
  private readonly limits;
  private readonly perMinute: number;
  constructor(private readonly database: Database, private readonly metadata: TenantMetadata, private readonly context: TenantContext,
    private readonly deployment: string, env: NodeJS.ProcessEnv, private readonly dialect: CoordinationDialect = 'postgres') {
    metadata.assertContext(context); this.limits = retryLimits(env); this.perMinute = v1RateLimit(env);
  }
  close(): void { /* Invocation-scoped, no timers or sockets. */ }
  private key(key: string) { return createHash('sha256').update(JSON.stringify([this.context.tenantId, this.context.namespaceId, this.context.userId, key])).digest('hex'); }
  private async lock(c: SqlConnection): Promise<void> {
    const row = (await c.query(`SELECT entries, bytes FROM sr_v1_capacity WHERE deployment = ? AND tenant_id = ''${this.dialect === 'postgres' ? ' FOR UPDATE' : ''}`, [this.deployment]))[0];
    if (!row) throw new MetadataError('V1_DURABLE_SCHEMA_REQUIRED', 503);
  }
  private async active(c: SqlConnection): Promise<void> {
    const row = (await c.query('SELECT t.state, r."authorization" FROM h1_tenants t JOIN h1_revisions r ON r.tenant_id = t.tenant_id WHERE t.tenant_id = ? AND r.namespace_id = ?', [this.context.tenantId, this.context.namespaceId]))[0];
    if (row?.state !== 'active' || Number(row.authorization) !== this.context.authorizationRevision) throw new MetadataError('AUTHORIZATION_REVISED', 403);
  }
  private async account(c: SqlConnection, tenant: string, entries: number, bytes: number): Promise<void> {
    for (const id of ['', tenant]) {
      const rows = await c.query('UPDATE sr_v1_capacity SET entries = entries + ?, bytes = bytes + ? WHERE deployment = ? AND tenant_id = ? RETURNING entries', [entries, bytes, this.deployment, id]);
      if (rows.length !== 1) throw new MetadataError('V1_DURABLE_SCHEMA_INVALID', 503);
    }
  }
  private async prune(c: SqlConnection, now: number): Promise<void> {
    const expired = await c.query('DELETE FROM sr_v1_receipts WHERE deployment = ? AND expires_at <= ? RETURNING tenant_id, bytes', [this.deployment, now]);
    for (const row of expired) await this.account(c, String(row.tenant_id), -1, -Number(row.bytes));
  }
  private async check(c: SqlConnection, entries: number, bytes: number): Promise<void> {
    const rows = await c.query('SELECT tenant_id, entries, bytes FROM sr_v1_capacity WHERE deployment = ? AND (tenant_id = ? OR tenant_id = ?)', [this.deployment, '', this.context.tenantId]);
    if (rows.length !== 2) throw new MetadataError('V1_DURABLE_SCHEMA_INVALID', 503);
    for (const row of rows) if (Number(row.entries) + entries > (row.tenant_id === '' ? this.limits.entries : this.limits.tenantEntries)
      || Number(row.bytes) + bytes > (row.tenant_id === '' ? this.limits.bytes : this.limits.tenantBytes)) capacity();
  }
  private async row(c: SqlConnection, key: string): Promise<SqlRow | undefined> {
    return (await c.query('SELECT * FROM sr_v1_receipts WHERE deployment = ? AND receipt_key = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ?',
      [this.deployment, key, this.context.tenantId, this.context.namespaceId, this.context.userId]))[0];
  }
  async get<T>(key: string): Promise<T | undefined> {
    this.metadata.assertContext(this.context);
    return this.database.transaction(async c => {
      const now = await coordinationNow(c, this.dialect), row = await this.row(c, this.key(key));
      return row?.state === 'complete' && Number(row.expires_at) > now ? JSON.parse(String(row.body)) as T : undefined;
    });
  }
  async reserve<T>(tenantId: string, key: string): Promise<RetryReservation<T>> {
    this.metadata.assertContext(this.context);
    if (tenantId !== this.context.tenantId) throw new MetadataError('TENANT_CONTEXT_REQUIRED', 401);
    const receiptKey = this.key(key), token = randomUUID();
    await this.database.transaction(async c => {
      await this.lock(c); await this.active(c); const now = await coordinationNow(c, this.dialect); await this.prune(c, now);
      if (await this.row(c, receiptKey)) stale();
      await c.query('INSERT INTO sr_v1_capacity (deployment, tenant_id, entries, bytes) VALUES (?, ?, 0, 0) ON CONFLICT (deployment, tenant_id) DO NOTHING', [this.deployment, tenantId]);
      await this.check(c, 1, 0);
      await c.query("INSERT INTO sr_v1_receipts VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, NULL)", [this.deployment, tenantId, this.context.namespaceId, this.context.userId, receiptKey, token, now + pendingMs]);
      await this.account(c, tenantId, 1, 0);
    });
    let serialized: string | undefined;
    const persist = async (c: SqlConnection) => {
      if (serialized === undefined) throw new Error('Retry receipt must be prepared before commit');
      await this.lock(c); const now = await coordinationNow(c, this.dialect), row = await this.row(c, receiptKey);
      if (!row || row.token !== token || Number(row.expires_at) <= now) throw new MetadataError('IDEMPOTENCY_IN_PROGRESS', 409);
      if (row.state === 'complete') {
        if (row.body !== serialized) throw new MetadataError('IDEMPOTENCY_CONFLICT', 409);
        return;
      }
      const bytes = Buffer.byteLength(serialized); await this.check(c, 0, bytes);
      await c.query("UPDATE sr_v1_receipts SET state = 'complete', body = ?, bytes = ?, expires_at = ? WHERE deployment = ? AND receipt_key = ? AND token = ?", [serialized, bytes, now + RETRY_TTL_MS, this.deployment, receiptKey, token]);
      await this.account(c, tenantId, 0, bytes);
    };
    return {
      prepare: value => { serialized = JSON.stringify(value); if (serialized === undefined) throw new Error('Retry receipts must be JSON serializable'); },
      persist,
      commit: () => this.database.transaction(persist),
      release: () => this.database.transaction(async c => {
        await this.lock(c);
        const rows = await c.query("DELETE FROM sr_v1_receipts WHERE deployment = ? AND receipt_key = ? AND token = ? AND state = 'pending' RETURNING tenant_id", [this.deployment, receiptKey, token]);
        if (rows.length) await this.account(c, tenantId, -1, 0);
      }),
    };
  }
  async take(): Promise<{ allowed: boolean; retryAfter: number }> {
    this.metadata.assertContext(this.context);
    return this.database.transaction(async c => {
      // Serialize tenant lifecycle changes before updating a rate window.
      if (!(await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' RETURNING version", [this.context.tenantId])).length) throw new MetadataError('TENANT_UNAVAILABLE', 403);
      await this.active(c);
      const values = [this.deployment, this.context.tenantId, this.context.namespaceId];
      await c.query('INSERT INTO sr_v1_rates VALUES (?, ?, ?, 0, 0) ON CONFLICT (deployment, tenant_id, namespace_id) DO NOTHING', values);
      const row = (await c.query(`SELECT used, reset_at FROM sr_v1_rates WHERE deployment = ? AND tenant_id = ? AND namespace_id = ?${this.dialect === 'postgres' ? ' FOR UPDATE' : ''}`, values))[0]!;
      const now = await coordinationNow(c, this.dialect), expired = Number(row.reset_at) <= now;
      const used = expired ? 0 : Number(row.used), reset = expired ? now + 60000 : Number(row.reset_at);
      if (used >= this.perMinute) return { allowed: false, retryAfter: Math.max(1, Math.ceil((reset - now) / 1000)) };
      await c.query('UPDATE sr_v1_rates SET used = ?, reset_at = ? WHERE deployment = ? AND tenant_id = ? AND namespace_id = ?', [used + 1, reset, ...values]);
      return { allowed: true, retryAfter: 0 };
    });
  }
}
