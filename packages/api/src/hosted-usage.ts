import { randomUUID } from 'node:crypto';
import { MetadataError, type Database, type SqlConnection } from './metadata-db.js';
import type { TenantContext, TenantMetadata } from './metadata.js';
import { identifier, object, type Scope } from './metadata-resources.js';
import { appendMetadataEvent } from './metadata-outbox.js';
import { appendOperatorAudit, initializeAudit } from './operator-audit.js';
import type { AiMeter } from './ai-settings.js';

export interface Entitlement {
  apiCalls: number; storageBytes: number; computeAttempts: number;
  /** Optional AI spend cap in cents per UTC day. Absent = no cap (metering still records). */
  aiSpendCapCents?: number;
  /** Warning threshold as a percentage of the cap, 0-100. Default 80 when a cap is set. */
  aiWarnPct?: number;
  /** Operator price in cents per million tokens. Default 0 = spend tracking disabled, request counts still metered. */
  aiCostCentsPerMillionTokens?: number;
}
export interface Entitlements { defaults: Entitlement | null; tenants: Record<string, Entitlement> }
/** Durable monthly billing shape for D-81. Counts and bytes only; no customer content.
 * A null storageAsOf denotes an explicit empty read before the first rollup. */
export interface MonthlyUsage {
  tenantId: string; namespaceId: string; period: string;
  apiCallsAdmitted: number; apiCallsDenied: number;
  computeAttemptsAdmitted: number; computeAttemptsDenied: number;
  storageBytes: number; storageAsOf: string | null; egressBytes: number;
}
export function entitlementConfig(raw: string | undefined): Entitlements {
  try {
    const input = object(JSON.parse(raw!), ['defaults', 'tenants']);
    const limits = (raw: unknown): Entitlement => {
      const r = object(raw, ['apiCalls', 'storageBytes', 'computeAttempts', 'aiSpendCapCents', 'aiWarnPct', 'aiCostCentsPerMillionTokens']);
      for (const k of ['apiCalls', 'storageBytes', 'computeAttempts']) if (!Number.isSafeInteger(r[k]) || Number(r[k]) < 0) throw Error();
      const out: Entitlement = { apiCalls: Number(r.apiCalls), storageBytes: Number(r.storageBytes), computeAttempts: Number(r.computeAttempts) };
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
  constructor(readonly db: Database, config: Entitlements, readonly clock = Date.now, private readonly objectDeployment?: string) { this.config = structuredClone(config); }
  entitlement(scope: Scope): Entitlement {
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
   */
  async recordAiUsage(scope: Scope, tokens: number, estimated = false): Promise<{ aiCalls: number; aiTokens: number; spendCents: number; warned: boolean }> {
    if (!Number.isSafeInteger(tokens) || tokens < 0) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
    const entitlement = this.entitlement(scope), now = new Date(this.clock()).toISOString(), period = now.slice(0, 10);
    const recorded = await this.db.transaction(async c => {
      await this.lockAiScope(c, scope);
      const after = await this.aiCountIn(c, scope, period, 'aiTokens') + tokens;
      const aiCalls = await this.aiCountIn(c, scope, period, 'aiCalls') + 1;
      if (!Number.isSafeInteger(after) || !Number.isSafeInteger(aiCalls)) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
      for (const [metric, amount, unit] of [['aiCalls', 1, 'call'], ['aiTokens', tokens, estimated ? 'estimated-token' : 'token']] as const) {
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
        }
      }
      return { aiCalls, aiTokens: after, spendCents };
    }).catch((error: unknown) => { if (error instanceof MetadataError) throw error; throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503); });
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
      check: async namespaceId => { await this.checkAiSpend(await resolveScope(namespaceId)); },
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
