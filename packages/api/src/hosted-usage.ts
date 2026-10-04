import { randomUUID } from 'node:crypto';
import { MetadataError, type Database, type SqlConnection } from './metadata-db.js';
import type { TenantContext, TenantMetadata } from './metadata.js';
import { identifier, object, type Scope } from './metadata-resources.js';
import { appendMetadataEvent } from './metadata-outbox.js';

export interface Entitlement { apiCalls: number; storageBytes: number; computeAttempts: number }
export interface Entitlements { defaults: Entitlement | null; tenants: Record<string, Entitlement> }
export function entitlementConfig(raw: string | undefined): Entitlements {
  try {
    const input = object(JSON.parse(raw!), ['defaults', 'tenants']);
    const limits = (raw: unknown): Entitlement => {
      const r = object(raw, ['apiCalls', 'storageBytes', 'computeAttempts']);
      for (const k of ['apiCalls', 'storageBytes', 'computeAttempts']) if (!Number.isSafeInteger(r[k]) || Number(r[k]) < 0) throw Error();
      return r as unknown as Entitlement;
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
    await c.query(`CREATE TABLE IF NOT EXISTS h8_audit (event_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, action TEXT NOT NULL)`);
    await c.query('CREATE TABLE IF NOT EXISTS h8_recovery (tenant_id TEXT PRIMARY KEY REFERENCES h1_tenants(tenant_id))');
    await c.query('CREATE TABLE IF NOT EXISTS h8_schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)');
    await c.query('INSERT INTO h8_schema VALUES (1,1) ON CONFLICT (id) DO NOTHING');
  });
}
export async function appendOperatorAudit(c: SqlConnection, action: string, now = Date.now()): Promise<void> {
  await c.query('INSERT INTO h8_audit VALUES (?,?,?)', [randomUUID(), new Date(now).toISOString(), action]);
}
export async function resourceBytes(c: SqlConnection, scope: Scope): Promise<number> {
  const rows = await c.query('SELECT body FROM h1_resources WHERE tenant_id = ? AND namespace_id = ?', [scope.tenantId, scope.namespaceId]);
  return rows.reduce((n, r) => n + Buffer.byteLength(String(r.body), 'utf8'), 0);
}
/** Limits are an immutable operator snapshot. Counters survive process restarts.
 * Storage uses the caller's H1 tenant transaction; no private SQL grants are needed. */
export class HostedUsage {
  readonly config: Entitlements;
  constructor(readonly db: Database, config: Entitlements, readonly clock = Date.now) { this.config = structuredClone(config); }
  entitlement(scope: Scope): Entitlement {
    const limit = Object.hasOwn(this.config.tenants, scope.tenantId) ? this.config.tenants[scope.tenantId] : this.config.defaults;
    if (!limit) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
    return limit;
  }
  async storage(c: SqlConnection, scope: Scope, before: number): Promise<void> {
    const limit = this.entitlement(scope), bytes = await resourceBytes(c, scope);
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
      const denied = Number(row.admitted) >= limit[metric];
      await c.query(`UPDATE h8_usage SET ${denied ? 'denied = denied + 1' : 'admitted = admitted + 1'} WHERE tenant_id = ? AND namespace_id = ? AND period = ? AND metric = ?`, args);
      await c.query('INSERT INTO h8_usage_events VALUES (?,?,?,?,?,?,?,?)', [randomUUID(), context.tenantId, context.namespaceId, now, metric, metric === 'apiCalls' ? 'call' : 'attempt', 1, denied ? 'denied' : 'admitted']);
      return denied;
    }).catch((error: unknown) => {
      if (error instanceof MetadataError) throw error;
      throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
    });
    if (denied) throw new MetadataError('USAGE_LIMIT_EXCEEDED', 429);
  }
  async metrics(): Promise<string> {
    return this.db.transaction(async c => {
      const lines = ['# TYPE opensight_usage_admitted gauge', '# TYPE opensight_usage_denied gauge', '# TYPE opensight_storage_bytes gauge'];
      const period = new Date(this.clock()).toISOString().slice(0, 10);
      for (const r of await c.query('SELECT * FROM h8_usage WHERE period = ? ORDER BY tenant_id, metric', [period])) {
        const labels = `tenant=${JSON.stringify(r.tenant_id)},metric=${JSON.stringify(r.metric)},period=${JSON.stringify(period)}`;
        lines.push(`opensight_usage_admitted{${labels}} ${Number(r.admitted)}`, `opensight_usage_denied{${labels}} ${Number(r.denied)}`);
      }
      for (const r of await c.query('SELECT tenant_id, namespace_id FROM h1_namespaces ORDER BY tenant_id')) lines.push(`opensight_storage_bytes{tenant=${JSON.stringify(r.tenant_id)}} ${await resourceBytes(c, { tenantId: String(r.tenant_id), namespaceId: String(r.namespace_id) })}`);
      return `${lines.join('\n')}\n`;
    });
  }
}
