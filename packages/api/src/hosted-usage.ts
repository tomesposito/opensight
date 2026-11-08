import { randomUUID } from 'node:crypto';
import { MetadataError, type Database, type SqlConnection } from './metadata-db.js';
import type { TenantContext, TenantMetadata } from './metadata.js';
import { identifier, object, type Scope } from './metadata-resources.js';
import { appendMetadataEvent } from './metadata-outbox.js';
import { appendOperatorAudit, initializeAudit } from './operator-audit.js';
import type { AiMeter } from './ai-settings.js';

export interface Entitlement {
  apiCalls: number; storageBytes: number; computeAttempts: number;
  /** Optional monthly egress cap in bytes. Absent = no cap (metering still records). */
  egressBytes?: number;
  /** Optional AI spend cap in cents per UTC day. Absent = no cap (metering still records). */
  aiSpendCapCents?: number;
  /** Successful managed answers per UTC month. Absent = managed unavailable. */
  aiCallsPerMonth?: number;
  /** Warning threshold as a percentage of the cap, 0-100. Default 80 when a cap is set. */
  aiWarnPct?: number;
  /** Operator price in cents per million tokens. Default 0 = spend tracking disabled, request counts still metered. */
  aiCostCentsPerMillionTokens?: number;
}
export interface Entitlements { defaults: Entitlement | null; tenants: Record<string, Entitlement> }
export interface EgressReservation {
  readonly scope: Readonly<Scope>;
  /** Null for uncapped admissions, which have no durable reservation row. */
  readonly id: string | null;
}
/** Durable monthly billing shape for D-81. Counts and bytes only; no customer content.
 * A null storageAsOf denotes an explicit empty read before the first rollup. */
export interface MonthlyUsage {
  tenantId: string; namespaceId: string; period: string;
  apiCallsAdmitted: number; apiCallsDenied: number;
  computeAttemptsAdmitted: number; computeAttemptsDenied: number;
  storageBytes: number; storageAsOf: string | null; egressBytes: number;
}
export function usageMonth(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 7 || !/^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/.test(value)) throw new MetadataError('USAGE_PERIOD_INVALID', 400);
  return value;
}
function usageInteger(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.length || /[^0-9]/.test(value))) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
  return count;
}
function emptyMonthlyUsage(scope: Scope, period: string): MonthlyUsage {
  return { tenantId: scope.tenantId, namespaceId: scope.namespaceId, period, apiCallsAdmitted: 0, apiCallsDenied: 0, computeAttemptsAdmitted: 0, computeAttemptsDenied: 0,
    storageBytes: 0, storageAsOf: null, egressBytes: 0 };
}
export function entitlementConfig(raw: string | undefined): Entitlements {
  try {
    const input = object(JSON.parse(raw!), ['defaults', 'tenants']);
    const limits = (raw: unknown): Entitlement => {
      const r = object(raw, ['apiCalls', 'storageBytes', 'computeAttempts', 'egressBytes', 'aiSpendCapCents', 'aiCallsPerMonth', 'aiWarnPct', 'aiCostCentsPerMillionTokens']);
      for (const k of ['apiCalls', 'storageBytes', 'computeAttempts']) if (!Number.isSafeInteger(r[k]) || Number(r[k]) < 0) throw Error();
      const out: Entitlement = { apiCalls: Number(r.apiCalls), storageBytes: Number(r.storageBytes), computeAttempts: Number(r.computeAttempts) };
      if (r.egressBytes !== undefined) { if (!Number.isSafeInteger(r.egressBytes) || Number(r.egressBytes) < 0) throw Error(); out.egressBytes = Number(r.egressBytes); }
      if (r.aiCallsPerMonth !== undefined) { if (!Number.isSafeInteger(r.aiCallsPerMonth) || Number(r.aiCallsPerMonth) < 0) throw Error(); out.aiCallsPerMonth = Number(r.aiCallsPerMonth); }
      if (r.aiSpendCapCents !== undefined) { if (!Number.isSafeInteger(r.aiSpendCapCents) || Number(r.aiSpendCapCents) < 0) throw Error(); out.aiSpendCapCents = Number(r.aiSpendCapCents); }
      if (r.aiWarnPct !== undefined) { if (!Number.isSafeInteger(r.aiWarnPct) || Number(r.aiWarnPct) < 0 || Number(r.aiWarnPct) > 100) throw Error(); out.aiWarnPct = Number(r.aiWarnPct); }
      if (r.aiCostCentsPerMillionTokens !== undefined) { if (!Number.isSafeInteger(r.aiCostCentsPerMillionTokens) || Number(r.aiCostCentsPerMillionTokens) < 0) throw Error(); out.aiCostCentsPerMillionTokens = Number(r.aiCostCentsPerMillionTokens); }
      return out;
    };
    const tenants: Record<string, Entitlement> = Object.create(null) as Record<string, Entitlement>;
    for (const [id, value] of Object.entries(object(input.tenants))) tenants[identifier(id)] = limits(value);
    return { defaults: input.defaults === null ? null : limits(input.defaults), tenants };
  } catch { throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503); }
}
export async function initializeUsage(db: Database): Promise<void> {
  await db.transaction(async c => {
    await c.query(`CREATE TABLE IF NOT EXISTS h8_usage (
      tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, period TEXT NOT NULL, metric TEXT NOT NULL,
      admitted BIGINT NOT NULL, denied BIGINT NOT NULL, PRIMARY KEY (tenant_id, namespace_id, period, metric),
      FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`);
    await c.query(`CREATE TABLE IF NOT EXISTS h8_usage_events (
      event_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, created_at TEXT NOT NULL,
      metric TEXT NOT NULL, unit TEXT NOT NULL, amount BIGINT NOT NULL, outcome TEXT NOT NULL,
      FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`);
    await c.query(`CREATE TABLE IF NOT EXISTS h8_egress_reservations (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, period TEXT NOT NULL,
      reserved_bytes BIGINT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`);
    await c.query('CREATE INDEX IF NOT EXISTS h8_egress_reservations_scope ON h8_egress_reservations (tenant_id, namespace_id, period)');
    await c.query(`CREATE TABLE IF NOT EXISTS h8_monthly_usage (
      tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, period TEXT NOT NULL,
      api_calls_admitted BIGINT NOT NULL, api_calls_denied BIGINT NOT NULL,
      compute_attempts_admitted BIGINT NOT NULL, compute_attempts_denied BIGINT NOT NULL,
      storage_bytes BIGINT NOT NULL, storage_as_of TEXT NOT NULL, egress_bytes BIGINT NOT NULL,
      PRIMARY KEY (tenant_id, namespace_id, period),
      FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`);
    await c.query(`CREATE TABLE IF NOT EXISTS h8_ai_warnings (
      tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, period TEXT NOT NULL,
      detail TEXT NOT NULL, created_at TEXT NOT NULL, delivered_at TEXT,
      PRIMARY KEY (tenant_id, period))`);
    await initializeAudit(c);
    await c.query('CREATE TABLE IF NOT EXISTS h8_recovery (tenant_id TEXT PRIMARY KEY REFERENCES h1_tenants(tenant_id))');
    await c.query('CREATE TABLE IF NOT EXISTS h8_schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)');
    await c.query('INSERT INTO h8_schema VALUES (1,1) ON CONFLICT (id) DO NOTHING');
  });
}
export async function resourceBytes(c: SqlConnection, scope: Scope): Promise<number> {
  const rows = await c.query('SELECT body FROM h1_resources WHERE tenant_id = ? AND namespace_id = ?', [scope.tenantId, scope.namespaceId]);
  return rows.reduce((n, r) => n + Buffer.byteLength(String(r.body), 'utf8'), 0);
}
/** Limits are an immutable operator snapshot. Counters survive process restarts.
 * Storage uses the caller's H1 tenant transaction; no private SQL grants are needed. */
export class HostedUsage {
  readonly config: Entitlements;
  private readonly egressFinishes = new WeakMap<EgressReservation, Promise<void>>();
  /** Optional billing tier override (issue #194): when the hosted server has
   * Stripe billing configured, a tenant's durable billing tier entitlement
   * wins over the operator snapshot. Wired by composition only; unset in
   * every other mode, where the snapshot alone decides. */
  tierEntitlement?: (tenantId: string) => Entitlement | null | undefined;
  constructor(readonly db: Database, config: Entitlements, readonly clock = Date.now, private readonly objectDeployment?: string) { this.config = structuredClone(config); }
  private async billingScope(c: SqlConnection, scope: Scope, lock = false): Promise<void> {
    // Reporting includes suspended/provisioning/deleting tenants, but never resurrects
    // erased tenants. Rollups serialize with metering and H1 writes on the tenant row.
    const sql = lock ? "UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state <> 'deleted' RETURNING tenant_id"
      : "SELECT tenant_id FROM h1_tenants WHERE tenant_id = ? AND state <> 'deleted'";
    if (!(await c.query(sql, [scope.tenantId])).length) throw new MetadataError('TENANT_UNAVAILABLE', 403);
    if (!(await c.query('SELECT tenant_id FROM h1_namespaces WHERE tenant_id = ? AND namespace_id = ?', [scope.tenantId, scope.namespaceId])).length) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
  }
  /** Recompute UTC daily totals; never increment a previously rolled-up total.
   * Storage is the CURRENT gauge, not a sum or a historical month-end measurement.
   * Each run replaces that snapshot and its timestamp, even for a past month. */
  async rollupMonthlyUsage(scope: Scope, month: string): Promise<MonthlyUsage> {
    const period = usageMonth(month);
    return this.db.transaction(async c => {
      await this.billingScope(c, scope, true);
      const record = emptyMonthlyUsage(scope, period);
      const rows = await c.query(`SELECT metric, admitted, denied FROM h8_usage
        WHERE tenant_id = ? AND namespace_id = ? AND period >= ? AND period <= ?
        AND metric IN ('apiCalls', 'computeAttempts', 'egressBytes')`, [scope.tenantId, scope.namespaceId, `${period}-01`, `${period}-31`]);
      for (const row of rows) {
        const admitted = usageInteger(row.admitted), denied = usageInteger(row.denied);
        if (row.metric === 'apiCalls') {
          record.apiCallsAdmitted = usageInteger(record.apiCallsAdmitted + admitted);
          record.apiCallsDenied = usageInteger(record.apiCallsDenied + denied);
        } else if (row.metric === 'computeAttempts') {
          record.computeAttemptsAdmitted = usageInteger(record.computeAttemptsAdmitted + admitted);
          record.computeAttemptsDenied = usageInteger(record.computeAttemptsDenied + denied);
        } else {
          record.egressBytes = usageInteger(record.egressBytes + admitted);
        }
      }
      record.storageBytes = usageInteger(await this.storageBytes(c, scope));
      record.storageAsOf = new Date(this.clock()).toISOString();
      await c.query(`INSERT INTO h8_monthly_usage (tenant_id, namespace_id, period, api_calls_admitted, api_calls_denied,
        compute_attempts_admitted, compute_attempts_denied, storage_bytes, storage_as_of, egress_bytes) VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT (tenant_id, namespace_id, period) DO UPDATE SET
        api_calls_admitted = excluded.api_calls_admitted, api_calls_denied = excluded.api_calls_denied,
        compute_attempts_admitted = excluded.compute_attempts_admitted, compute_attempts_denied = excluded.compute_attempts_denied,
        storage_bytes = excluded.storage_bytes, storage_as_of = excluded.storage_as_of, egress_bytes = excluded.egress_bytes`,
      [scope.tenantId, scope.namespaceId, period, record.apiCallsAdmitted, record.apiCallsDenied,
        record.computeAttemptsAdmitted, record.computeAttemptsDenied, record.storageBytes, record.storageAsOf, record.egressBytes]);
      return record;
    }).catch((error: unknown) => { if (error instanceof MetadataError) throw error; throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503); });
  }
  /** Read the durable snapshot without touching enforcement counters or refreshing
   * storage. An unrolled month is explicit: all zeros and storageAsOf = null. */
  async monthlyUsage(scope: Scope, month: string): Promise<MonthlyUsage> {
    const period = usageMonth(month);
    return this.db.transaction(async c => {
      await this.billingScope(c, scope);
      const row = (await c.query('SELECT * FROM h8_monthly_usage WHERE tenant_id = ? AND namespace_id = ? AND period = ?', [scope.tenantId, scope.namespaceId, period]))[0];
      if (!row) return emptyMonthlyUsage(scope, period);
      const storageAsOf = row.storage_as_of;
      if (typeof storageAsOf !== 'string' || !Number.isFinite(Date.parse(storageAsOf)) || new Date(storageAsOf).toISOString() !== storageAsOf) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
      return { tenantId: scope.tenantId, namespaceId: scope.namespaceId, period, apiCallsAdmitted: usageInteger(row.api_calls_admitted), apiCallsDenied: usageInteger(row.api_calls_denied),
        computeAttemptsAdmitted: usageInteger(row.compute_attempts_admitted), computeAttemptsDenied: usageInteger(row.compute_attempts_denied),
        storageBytes: usageInteger(row.storage_bytes), storageAsOf, egressBytes: usageInteger(row.egress_bytes) };
    }).catch((error: unknown) => { if (error instanceof MetadataError) throw error; throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503); });
  }
  private async billingScopes(tenantId?: string): Promise<Scope[]> {
    if (tenantId !== undefined) identifier(tenantId);
    return this.db.transaction(async c => {
      const rows = await c.query(`SELECT n.tenant_id, n.namespace_id FROM h1_namespaces n
        JOIN h1_tenants t ON t.tenant_id = n.tenant_id WHERE t.state <> 'deleted'${tenantId === undefined ? '' : ' AND n.tenant_id = ?'}
        ORDER BY n.tenant_id, n.namespace_id`, tenantId === undefined ? [] : [tenantId]);
      if (tenantId !== undefined && !rows.length) throw new MetadataError('TENANT_UNAVAILABLE', 403);
      return rows.map(row => ({ tenantId: String(row.tenant_id), namespaceId: String(row.namespace_id) }));
    }).catch((error: unknown) => { if (error instanceof MetadataError) throw error; throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503); });
  }
  /** Operator view, with one distinct record per tenant/namespace, including empty months. */
  async monthlyUsageForPeriod(month: string, tenantId?: string): Promise<MonthlyUsage[]> {
    const period = usageMonth(month), records: MonthlyUsage[] = [];
    for (const scope of await this.billingScopes(tenantId)) records.push(await this.monthlyUsage(scope, period));
    return records;
  }
  /** Current enforcement view: API/queries are daily caps, NLQ is monthly, storage a live gauge.
   * Keep the durable monthly billing records unchanged; never present an unrolled snapshot as live usage. */
  async operatorOverview(tenantId: string, period: string) {
    const day = new Date(this.clock()).toISOString().slice(0, 10);
    if (usageMonth(period) !== day.slice(0, 7)) return null;
    const [scope] = await this.billingScopes(tenantId);
    if (!scope) throw new MetadataError('TENANT_UNAVAILABLE', 403);
    const quotas = this.entitlement(scope);
    return this.db.transaction(async c => {
      await this.billingScope(c, scope);
      const rows = await c.query('SELECT metric, admitted FROM h8_usage WHERE tenant_id = ? AND namespace_id = ? AND period = ?', [scope.tenantId, scope.namespaceId, day]);
      const count = (metric: string) => usageInteger(rows.find(row => row.metric === metric)?.admitted ?? 0);
      return { day, period, apiCalls: count('apiCalls'), queries: count('computeAttempts'), storageBytes: await this.storageBytes(c, scope),
        nlq: await this.monthlyAiCalls(c, scope, period), quotas: { apiCalls: quotas.apiCalls, queries: quotas.computeAttempts, storageBytes: quotas.storageBytes, nlq: quotas.aiCallsPerMonth ?? null } };
    });
  }
  /** Operator-triggered refresh; each scope commits independently and is safe to retry. */
  async rollupMonthlyUsageForPeriod(month: string, tenantId?: string): Promise<MonthlyUsage[]> {
    const period = usageMonth(month), records: MonthlyUsage[] = [];
    for (const scope of await this.billingScopes(tenantId)) records.push(await this.rollupMonthlyUsage(scope, period));
    return records;
  }
  entitlement(scope: Scope): Entitlement {
    const override = this.tierEntitlement?.(scope.tenantId);
    if (override === null) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
    if (override) return override;
    const limit = Object.hasOwn(this.config.tenants, scope.tenantId) ? this.config.tenants[scope.tenantId] : this.config.defaults;
    if (!limit) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
    return limit;
  }
  async storageBytes(c: SqlConnection, scope: Scope): Promise<number> {
    const metadata = await resourceBytes(c, scope);
    if (this.objectDeployment === undefined) return metadata;
    const row = (await c.query('SELECT reserved_bytes, live_bytes FROM sr_storage_usage WHERE deployment = ? AND tenant_id = ? AND namespace_id = ?',
      [this.objectDeployment, scope.tenantId, scope.namespaceId]))[0];
    if (!row) return metadata;
    const reserved = Number(row.reserved_bytes), live = Number(row.live_bytes);
    if (![reserved, live, metadata + reserved + live].every(n => Number.isSafeInteger(n) && n >= 0)) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
    return metadata + reserved + live;
  }
  async storage(c: SqlConnection, scope: Scope, before: number): Promise<void> {
    const limit = this.entitlement(scope), bytes = await this.storageBytes(c, scope);
    if (bytes > limit.storageBytes && bytes > before) throw new MetadataError('USAGE_LIMIT_EXCEEDED', 429);
    // Exact committed logical-byte gauge. Stored in the existing append-only H1
    // stream so the tenant role cannot alter private entitlement counters.
    await appendMetadataEvent(c, scope, `usage.storage.bytes:${bytes}`);
  }
  async consume(metadata: TenantMetadata, context: TenantContext, metric: 'apiCalls' | 'computeAttempts'): Promise<void> {
    metadata.assertContext(context);
    await metadata.revisions(context);
    const limit = this.entitlement(context), now = new Date(this.clock()).toISOString(), period = now.slice(0, 10);
    const denied = await this.db.transaction(async c => {
      // Same per-tenant serialization as H1 writes and lifecycle changes.
      if (!(await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' RETURNING tenant_id", [context.tenantId])).length) throw new MetadataError('TENANT_UNAVAILABLE', 403);
      const r = (await c.query('SELECT "authorization" FROM h1_revisions WHERE tenant_id = ? AND namespace_id = ?', [context.tenantId, context.namespaceId]))[0];
      if (Number(r?.authorization) !== context.authorizationRevision) throw new MetadataError('AUTHORIZATION_REVISED', 403);
      const args = [context.tenantId, context.namespaceId, period, metric];
      await c.query('INSERT INTO h8_usage VALUES (?,?,?,?,0,0) ON CONFLICT (tenant_id, namespace_id, period, metric) DO NOTHING', args);
      const row = (await c.query('SELECT admitted FROM h8_usage WHERE tenant_id = ? AND namespace_id = ? AND period = ? AND metric = ?', args))[0]!;
      const admitted = Number(row.admitted);
      if (!Number.isSafeInteger(admitted) || admitted < 0) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
      const denied = admitted >= limit[metric];
      await c.query(`UPDATE h8_usage SET ${denied ? 'denied = denied + 1' : 'admitted = admitted + 1'} WHERE tenant_id = ? AND namespace_id = ? AND period = ? AND metric = ?`, args);
      await c.query('INSERT INTO h8_usage_events VALUES (?,?,?,?,?,?,?,?)', [randomUUID(), context.tenantId, context.namespaceId, now, metric, metric === 'apiCalls' ? 'call' : 'attempt', 1, denied ? 'denied' : 'admitted']);
      return denied;
    }).catch((error: unknown) => {
      if (error instanceof MetadataError) throw error;
      throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
    });
    if (denied) throw new MetadataError('USAGE_LIMIT_EXCEEDED', 429);
  }
  private egressCap(scope: Scope): number | undefined {
    const cap = this.entitlement(scope).egressBytes;
    if (cap !== undefined && (!Number.isSafeInteger(cap) || cap < 0)) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
    return cap;
  }
  /** Admission accounting only: reservations never enter usage, events or metrics. */
  private async committedEgress(c: SqlConnection, scope: Scope, month: string): Promise<number> {
    const rows = await c.query(`SELECT admitted, denied FROM h8_usage
      WHERE tenant_id = ? AND namespace_id = ? AND period >= ? AND period <= ?
      AND metric = 'egressBytes'`, [scope.tenantId, scope.namespaceId, `${month}-01`, `${month}-31`]);
    let total = 0;
    for (const row of rows) {
      usageInteger(row.denied);
      total = usageInteger(total + usageInteger(row.admitted));
    }
    const reservations = await c.query('SELECT reserved_bytes FROM h8_egress_reservations WHERE tenant_id = ? AND namespace_id = ? AND period = ?',
      [scope.tenantId, scope.namespaceId, month]);
    for (const row of reservations) total = usageInteger(total + usageInteger(row.reserved_bytes));
    return total;
  }
  /** Check recorded plus reserved monthly bytes without claiming allowance.
   * Denials record nothing. Absent cap never denies; corrupt/unsafe counters
   * fail closed. Concurrent hosted requests must use reserveEgress instead. */
  async checkEgress(scope: Scope): Promise<void> {
    const cap = this.egressCap(scope);
    const month = new Date(this.clock()).toISOString().slice(0, 7);
    const denied = await this.db.transaction(async c => {
      await this.lockAiScope(c, scope);
      const total = await this.committedEgress(c, scope, month);
      return cap !== undefined && total >= cap;
    }).catch((error: unknown) => { if (error instanceof MetadataError) throw error; throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503); });
    if (denied) throw new MetadataError('USAGE_LIMIT_EXCEEDED', 429);
  }
  /** Claim the ENTIRE remainder: response size is unknown at admission. While
   * a capped response is in flight, concurrent admissions for its scope get
   * 429. This bounds overshoot to the one permitted crossing response. */
  async reserveEgress(scope: Scope): Promise<EgressReservation> {
    return this.db.transaction(async c => {
      await this.lockAiScope(c, scope);
      const cap = this.egressCap(scope);
      if (cap === undefined) return { scope: { tenantId: scope.tenantId, namespaceId: scope.namespaceId }, id: null };
      const now = new Date(this.clock()).toISOString(), month = now.slice(0, 7);
      const committed = await this.committedEgress(c, scope, month);
      if (committed >= cap) throw new MetadataError('USAGE_LIMIT_EXCEEDED', 429);
      const id = randomUUID();
      await c.query('INSERT INTO h8_egress_reservations (id, tenant_id, namespace_id, period, reserved_bytes, created_at) VALUES (?,?,?,?,?,?)',
        [id, scope.tenantId, scope.namespaceId, month, cap - committed, now]);
      return { scope: { tenantId: scope.tenantId, namespaceId: scope.namespaceId }, id };
    }).catch((error: unknown) => { if (error instanceof MetadataError) throw error; throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503); });
  }
  /** Record actual bytes and remove the claim atomically. A failed transaction
   * retains the full claim, including after restart; never release on failure. */
  settleEgress(handle: EgressReservation, actualBytes: number): Promise<void> {
    return this.finishEgress(handle, { bytes: actualBytes });
  }
  /** Only for admissions that never reached the counted response path. */
  releaseEgress(handle: EgressReservation): Promise<void> {
    return this.finishEgress(handle);
  }
  private finishEgress(handle: EgressReservation, settlement?: { bytes: number }): Promise<void> {
    const existing = this.egressFinishes.get(handle);
    if (existing) return existing;
    const finishing = this.db.transaction(async c => {
      const { scope, id } = handle;
      if (!settlement && id === null) return;
      await this.lockAiScope(c, scope);
      // The tenant lock and durable row also prevent duplicate capped settlement
      // through another HostedUsage instance. Rollback restores a deleted claim.
      if (id !== null && !(await c.query('DELETE FROM h8_egress_reservations WHERE id = ? AND tenant_id = ? AND namespace_id = ? RETURNING id',
        [id, scope.tenantId, scope.namespaceId])).length) return;
      if (settlement) {
        const { bytes } = settlement;
        if (!Number.isSafeInteger(bytes) || bytes < 0) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
        this.entitlement(scope);
        await this.recordEgressIn(c, scope, bytes, new Date(this.clock()).toISOString());
      }
    }).catch((error: unknown) => { if (error instanceof MetadataError) throw error; throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503); });
    // Cache failures too: an accidental release after failed settlement must
    // never erase the retained reservation. Weak keys do not retain requests.
    this.egressFinishes.set(handle, finishing);
    return finishing;
  }
  private async recordEgressIn(c: SqlConnection, scope: Scope, bytes: number, now: string): Promise<void> {
    const args = [scope.tenantId, scope.namespaceId, now.slice(0, 10), 'egressBytes'];
    await c.query('INSERT INTO h8_usage VALUES (?,?,?,?,0,0) ON CONFLICT (tenant_id, namespace_id, period, metric) DO NOTHING', args);
    const row = (await c.query('SELECT admitted, denied FROM h8_usage WHERE tenant_id = ? AND namespace_id = ? AND period = ? AND metric = ?', args))[0]!;
    usageInteger(usageInteger(row.admitted) + bytes);
    usageInteger(row.denied);
    await c.query('UPDATE h8_usage SET admitted = admitted + ? WHERE tenant_id = ? AND namespace_id = ? AND period = ? AND metric = ?', [bytes, ...args]);
    await c.query('INSERT INTO h8_usage_events VALUES (?,?,?,?,?,?,?,?)', [randomUUID(), scope.tenantId, scope.namespaceId, now, 'egressBytes', 'byte', bytes, 'admitted']);
  }
  /** Record actual transferred bytes from a caller that knows the amount.
   * Never infer egress from API calls or estimates. */
  async recordEgressBytes(scope: Scope, bytes: number): Promise<void> {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
    this.entitlement(scope);
    const now = new Date(this.clock()).toISOString();
    await this.db.transaction(async c => {
      await this.lockAiScope(c, scope);
      await this.recordEgressIn(c, scope, bytes, now);
    }).catch((error: unknown) => { if (error instanceof MetadataError) throw error; throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503); });
  }
  /** Derived spend in cents for a token total under an entitlement. Zero when no price is configured. */
  aiSpendCents(entitlement: Entitlement, tokens: number): number {
    return tokens * (entitlement.aiCostCentsPerMillionTokens ?? 0) / 1_000_000;
  }
  private async aiCountIn(c: SqlConnection, scope: Scope, period: string, metric: 'aiCalls' | 'aiTokens'): Promise<number> {
    const row = (await c.query('SELECT admitted FROM h8_usage WHERE tenant_id = ? AND namespace_id = ? AND period = ? AND metric = ?', [scope.tenantId, scope.namespaceId, period, metric]))[0];
    const count = row === undefined ? 0 : Number(row.admitted);
    if (!Number.isSafeInteger(count) || count < 0) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
    return count;
  }
  private async lockAiScope(c: SqlConnection, scope: Scope): Promise<void> {
    if (!(await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' RETURNING tenant_id", [scope.tenantId])).length) throw new MetadataError('TENANT_UNAVAILABLE', 403);
    if (!(await c.query('SELECT tenant_id FROM h1_namespaces WHERE tenant_id = ? AND namespace_id = ?', [scope.tenantId, scope.namespaceId])).length) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
  }
  /** Delivery and acknowledgement commit together, independently of the charge. */
  private async deliverAiWarnings(scope: Scope): Promise<Set<string>> {
    return this.db.transaction(async c => {
      await this.lockAiScope(c, scope);
      const pending = await c.query('SELECT namespace_id, period, detail, created_at FROM h8_ai_warnings WHERE tenant_id = ? AND delivered_at IS NULL ORDER BY period', [scope.tenantId]);
      const delivered = new Set<string>();
      for (const row of pending) {
        const period = String(row.period), detail: unknown = JSON.parse(String(row.detail));
        await appendOperatorAudit(c, { action: 'ai.spend.warning', tenantId: scope.tenantId, subject: String(row.namespace_id), detail }, Date.parse(String(row.created_at)));
        await c.query('UPDATE h8_ai_warnings SET delivered_at = ? WHERE tenant_id = ? AND period = ?', [new Date(this.clock()).toISOString(), scope.tenantId, period]);
        delivered.add(period);
      }
      return delivered;
    });
  }
  private async monthlyAiCalls(c: SqlConnection, scope: Scope, period: string): Promise<number> {
    const rows = await c.query("SELECT admitted FROM h8_usage WHERE tenant_id = ? AND namespace_id = ? AND period >= ? AND period <= ? AND metric = 'aiCalls'",
      [scope.tenantId, scope.namespaceId, `${period}-01`, `${period}-31`]);
    return rows.reduce((total, row) => usageInteger(total + usageInteger(row.admitted)), 0);
  }
  async aiCredits(scope: Scope) {
    const period = new Date(this.clock()).toISOString().slice(0, 7), limit = this.entitlement(scope).aiCallsPerMonth ?? null;
    const used = await this.db.transaction(async c => { await this.billingScope(c, scope); return this.monthlyAiCalls(c, scope, period); });
    const reset = new Date(`${period}-01T00:00:00Z`); reset.setUTCMonth(reset.getUTCMonth() + 1);
    return { period, limit, used, remaining: limit === null ? 0 : Math.max(0, limit - used), resetsAt: reset.toISOString() };
  }
  private async denyAi(c: SqlConnection, scope: Scope, now: string): Promise<void> {
    const args = [scope.tenantId, scope.namespaceId, now.slice(0, 10), 'aiCalls'];
    await c.query('INSERT INTO h8_usage VALUES (?,?,?,?,0,0) ON CONFLICT (tenant_id, namespace_id, period, metric) DO NOTHING', args);
    await c.query('UPDATE h8_usage SET denied = denied + 1 WHERE tenant_id = ? AND namespace_id = ? AND period = ? AND metric = ?', args);
    await c.query('INSERT INTO h8_usage_events VALUES (?,?,?,?,?,?,?,?)', [randomUUID(), scope.tenantId, scope.namespaceId, now, 'aiCalls', 'call', 1, 'denied']);
  }
  private async creditGate(c: SqlConnection, scope: Scope, now: string, count = 1): Promise<boolean> {
    const limit = this.entitlement(scope).aiCallsPerMonth;
    if (limit === undefined) throw new MetadataError('AI_MANAGED_UNAVAILABLE', 503);
    if (await this.monthlyAiCalls(c, scope, now.slice(0, 7)) + count <= limit) return true;
    await this.denyAi(c, scope, now); return false;
  }
  async checkAiCredits(scope: Scope): Promise<void> {
    const allowed = await this.db.transaction(async c => { await this.lockAiScope(c, scope); return this.creditGate(c, scope, new Date(this.clock()).toISOString()); });
    if (!allowed) throw new MetadataError('AI_CREDITS_EXHAUSTED', 429);
  }
  /** Current durable AI usage snapshot for a tenant scope (today's UTC period). */
  async aiUsage(scope: Scope): Promise<{ tenantId: string; namespaceId: string; period: string; aiCalls: number; aiTokens: number; spendCents: number; capCents?: number; warnPct: number }> {
    const entitlement = this.entitlement(scope), period = new Date(this.clock()).toISOString().slice(0, 10);
    return this.db.transaction(async c => {
      const aiCalls = await this.aiCountIn(c, scope, period, 'aiCalls');
      const aiTokens = await this.aiCountIn(c, scope, period, 'aiTokens');
      return { tenantId: scope.tenantId, namespaceId: scope.namespaceId, period, aiCalls, aiTokens, spendCents: this.aiSpendCents(entitlement, aiTokens),
        ...(entitlement.aiSpendCapCents === undefined ? {} : { capCents: entitlement.aiSpendCapCents }), warnPct: entitlement.aiWarnPct ?? 80 };
    }).catch((error: unknown) => { if (error instanceof MetadataError) throw error; throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503); });
  }
  /**
   * Pre-call cap gate (fail closed). When a cap and a price are configured and
   * recorded spend already meets/exceeds the cap, the denial is recorded in
   * h8_usage/h8_usage_events and AI_SPEND_CAP_EXCEEDED (429) is thrown; the
   * caller must not invoke the provider. No cap, or a zero price (spend
   * tracking disabled), never denies here.
   */
  async checkAiSpend(scope: Scope): Promise<void> {
    try { await this.deliverAiWarnings(scope); } catch { /* Pending warnings must not block the counter-based gate. */ }
    const entitlement = this.entitlement(scope);
    const cap = entitlement.aiSpendCapCents, cost = entitlement.aiCostCentsPerMillionTokens ?? 0, now = new Date(this.clock()).toISOString(), period = now.slice(0, 10);
    const denied = await this.db.transaction(async c => {
      await this.lockAiScope(c, scope);
      const tokens = await this.aiCountIn(c, scope, period, 'aiTokens'), spendCents = this.aiSpendCents(entitlement, tokens);
      await this.aiCountIn(c, scope, period, 'aiCalls');
      if (cap === undefined || cost === 0 || BigInt(tokens) * BigInt(cost) < BigInt(cap) * 1_000_000n) return undefined;
      const args = [scope.tenantId, scope.namespaceId, period, 'aiCalls'];
      await c.query('INSERT INTO h8_usage VALUES (?,?,?,?,0,0) ON CONFLICT (tenant_id, namespace_id, period, metric) DO NOTHING', args);
      await c.query('UPDATE h8_usage SET denied = denied + 1 WHERE tenant_id = ? AND namespace_id = ? AND period = ? AND metric = ?', args);
      await c.query('INSERT INTO h8_usage_events VALUES (?,?,?,?,?,?,?,?)', [randomUUID(), scope.tenantId, scope.namespaceId, now, 'aiCalls', 'call', 1, 'denied']);
      return { tenantId: scope.tenantId, namespaceId: scope.namespaceId, period, capCents: cap, spendCents, aiTokens: tokens };
    }).catch((error: unknown) => { if (error instanceof MetadataError) throw error; throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503); });
    if (denied) throw new MetadataError('AI_SPEND_CAP_EXCEEDED', 429, denied);
  }
  /**
   * Post-call metering: durably adds one aiCalls call and the call's aiTokens
   * tokens in the same tables/serialization as other usage. When cumulative
   * spend first crosses aiWarnPct of the cap in a period, a durable warning
   * intent commits with the charge. Audit delivery is retried independently.
   * Warning-intent storage failure never rolls back the charge (see below).
   */
  async recordAiUsage(scope: Scope, tokens: number, estimated = false, managed = false, count = 1): Promise<{ aiCalls: number; aiTokens: number; spendCents: number; warned: boolean }> {
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(tokens) || tokens < 0) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
    const entitlement = this.entitlement(scope), now = new Date(this.clock()).toISOString(), period = now.slice(0, 10);
    const recorded = await this.db.transaction(async c => {
      await this.lockAiScope(c, scope);
      const after = await this.aiCountIn(c, scope, period, 'aiTokens') + tokens;
      if (managed && !await this.creditGate(c, scope, now, count)) return undefined;
      const aiCalls = await this.aiCountIn(c, scope, period, 'aiCalls') + count;
      if (!Number.isSafeInteger(after) || !Number.isSafeInteger(aiCalls)) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
      for (const [metric, amount, unit] of [['aiCalls', count, 'call'], ['aiTokens', tokens, estimated ? 'estimated-token' : 'token']] as const) {
        const args = [scope.tenantId, scope.namespaceId, period, metric];
        await c.query('INSERT INTO h8_usage VALUES (?,?,?,?,0,0) ON CONFLICT (tenant_id, namespace_id, period, metric) DO NOTHING', args);
        await c.query('UPDATE h8_usage SET admitted = admitted + ? WHERE tenant_id = ? AND namespace_id = ? AND period = ? AND metric = ?', [amount, ...args]);
        await c.query('INSERT INTO h8_usage_events VALUES (?,?,?,?,?,?,?,?)', [randomUUID(), scope.tenantId, scope.namespaceId, now, metric, unit, amount, 'admitted']);
      }
      const spendCents = this.aiSpendCents(entitlement, after);
      const cap = entitlement.aiSpendCapCents, cost = entitlement.aiCostCentsPerMillionTokens ?? 0;
      if (cap !== undefined && cost > 0) {
        const warnPct = entitlement.aiWarnPct ?? 80;
        if (BigInt(after) * BigInt(cost) * 100n >= BigInt(cap) * BigInt(warnPct) * 1_000_000n) {
          // The warning intent is advisory, not accounting: the usage counters
          // above are the charge. An unavailable warning-intent store (missing
          // table, permission or write failure — #138 reopen) must never roll
          // the charge back, or the next admission sees the unchanged below-cap
          // counter and pays the provider again. Guard the whole intent block
          // with a savepoint, exactly like the audit lookup inside it: on
          // failure, roll back only the intent attempt and commit the charge.
          // The intent is then absent for this crossing; a later charge in the
          // same period retries it once the store recovers.
          await c.query('SAVEPOINT opensight_ai_warning_intent');
          try {
            const intent = await c.query('SELECT period FROM h8_ai_warnings WHERE tenant_id = ? AND period = ?', [scope.tenantId, period]);
            if (!intent.length) {
              // Preserve pre-intent audit deduplication. An unavailable audit store
              // must not abort the charge transaction, including on Postgres.
              let prior = false;
              await c.query('SAVEPOINT opensight_ai_warning_prior');
              try {
                prior = (await c.query("SELECT event_id FROM h8_audit WHERE tenant_id = ? AND action = 'ai.spend.warning' AND substr(created_at,1,10) = ?", [scope.tenantId, period])).length > 0;
              } catch {
                await c.query('ROLLBACK TO SAVEPOINT opensight_ai_warning_prior');
              }
              await c.query('RELEASE SAVEPOINT opensight_ai_warning_prior');
              if (!prior) await c.query('INSERT INTO h8_ai_warnings (tenant_id, namespace_id, period, detail, created_at, delivered_at) VALUES (?,?,?,?,?,NULL)',
                [scope.tenantId, scope.namespaceId, period, JSON.stringify({ period, spendCents, capCents: cap, warnPct, estimated }), now]);
            }
          } catch {
            await c.query('ROLLBACK TO SAVEPOINT opensight_ai_warning_intent');
          }
          await c.query('RELEASE SAVEPOINT opensight_ai_warning_intent');
        }
      }
      return { aiCalls, aiTokens: after, spendCents };
    }).catch((error: unknown) => { if (error instanceof MetadataError) throw error; throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503); });
    if (!recorded) throw new MetadataError('AI_CREDITS_EXHAUSTED', 429);
    let warned = false;
    try { warned = (await this.deliverAiWarnings(scope)).has(period); } catch { /* The charge is committed; retain the warning for retry. */ }
    return { ...recorded, warned };
  }
  /** Resolve the authenticated namespace using H1's immutable one-namespace-per-tenant mapping.
   * Hosted callers cannot opt out by returning an unresolved scope. Self-hosted omits the meter. */
  aiMeter(): AiMeter {
    const resolveScope = async (namespaceId: string): Promise<Scope> => {
      try {
        const rows = await this.db.transaction(c => c.query('SELECT tenant_id FROM h1_namespaces WHERE namespace_id = ?', [namespaceId]));
        if (rows.length !== 1) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
        return { tenantId: String(rows[0]!.tenant_id), namespaceId };
      } catch (error) {
        if (error instanceof MetadataError) throw error;
        throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
      }
    };
    return {
      check: async (namespaceId, managed) => { const scope = await resolveScope(namespaceId); if (managed) await this.checkAiCredits(scope); await this.checkAiSpend(scope); },
      credits: async namespaceId => this.aiCredits(await resolveScope(namespaceId)),
      commit: async (namespaceId, tokens, estimated, count = 1) => { await this.recordAiUsage(await resolveScope(namespaceId), tokens, estimated, true, count); },
      record: async (namespaceId, tokens, estimated) => { await this.recordAiUsage(await resolveScope(namespaceId), tokens, estimated); },
    };
  }
  async metrics(): Promise<string> {
    return this.db.transaction(async c => {
      const lines = ['# TYPE opensight_usage_admitted gauge', '# TYPE opensight_usage_denied gauge', '# TYPE opensight_storage_bytes gauge'];
      const period = new Date(this.clock()).toISOString().slice(0, 10);
      for (const r of await c.query('SELECT * FROM h8_usage WHERE period = ? ORDER BY tenant_id, metric', [period])) {
        const labels = `tenant=${JSON.stringify(r.tenant_id)},metric=${JSON.stringify(r.metric)},period=${JSON.stringify(period)}`;
        lines.push(`opensight_usage_admitted{${labels}} ${Number(r.admitted)}`, `opensight_usage_denied{${labels}} ${Number(r.denied)}`);
      }
      for (const r of await c.query('SELECT tenant_id, namespace_id FROM h1_namespaces ORDER BY tenant_id')) lines.push(`opensight_storage_bytes{tenant=${JSON.stringify(r.tenant_id)}} ${await this.storageBytes(c, { tenantId: String(r.tenant_id), namespaceId: String(r.namespace_id) })}`);
      lines.push('# TYPE opensight_ai_calls gauge', '# TYPE opensight_ai_tokens gauge', '# TYPE opensight_ai_spend_cents gauge');
      for (const r of await c.query("SELECT tenant_id, namespace_id, admitted FROM h8_usage WHERE period = ? AND metric = 'aiTokens' ORDER BY tenant_id, namespace_id", [period])) {
        const tokens = Number(r.admitted), labels = `tenant=${JSON.stringify(r.tenant_id)},namespace=${JSON.stringify(r.namespace_id)},period=${JSON.stringify(period)}`;
        const scope = { tenantId: String(r.tenant_id), namespaceId: String(r.namespace_id) };
        lines.push(`opensight_ai_calls{${labels}} ${await this.aiCountIn(c, scope, period, 'aiCalls')}`, `opensight_ai_tokens{${labels}} ${tokens}`);
        lines.push(`opensight_ai_spend_cents{${labels}} ${this.aiSpendCents(this.entitlement(scope), tokens)}`);
      }
      return `${lines.join('\n')}\n`;
    });
  }
}
