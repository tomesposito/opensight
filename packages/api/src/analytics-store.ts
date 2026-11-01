import { MetadataError, type Database, type SqlConnection, type SqlRow } from './metadata-db.js';
import type { TenantContext, TenantMetadata } from './metadata.js';
import { identifier, type Scope } from './metadata-resources.js';
import { validateAnalyticsEvent, type AnalyticsRow } from './analytics.js';

export const analyticsTables = ['analytics_events', 'analytics_settings'] as const;
export async function initializeAnalytics(db: Database): Promise<void> {
  await db.transaction(async c => {
    await c.query(`CREATE TABLE IF NOT EXISTS analytics_events (
      event_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL,
      event_name TEXT NOT NULL, props TEXT NOT NULL, created_at TEXT NOT NULL, delivered_at TEXT,
      FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`);
    // Owner migration only. Transaction-scoped wrappers may omit dialect, so
    // use the access-request savepoint probe outside known SQLite adapters.
    let hasDeliveredAt: boolean;
    if (db.dialect === 'sqlite') {
      hasDeliveredAt = (await c.query('PRAGMA table_info(analytics_events)')).some(row => row.name === 'delivered_at');
    } else {
      await c.query('SAVEPOINT opensight_delivered_at_check');
      hasDeliveredAt = true;
      try { await c.query('SELECT delivered_at FROM analytics_events LIMIT 0'); }
      catch { hasDeliveredAt = false; await c.query('ROLLBACK TO SAVEPOINT opensight_delivered_at_check'); }
      await c.query('RELEASE SAVEPOINT opensight_delivered_at_check');
    }
    if (!hasDeliveredAt) await c.query('ALTER TABLE analytics_events ADD COLUMN delivered_at TEXT');
    await c.query('CREATE INDEX IF NOT EXISTS analytics_event_scope ON analytics_events(tenant_id, namespace_id, created_at)');
    await c.query(`CREATE TABLE IF NOT EXISTS analytics_settings (
      tenant_id TEXT PRIMARY KEY, namespace_id TEXT NOT NULL, enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
      FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`);
  });
}
function analyticsRow(r: SqlRow): AnalyticsRow {
  return { id: String(r.event_id), tenantId: String(r.tenant_id), namespaceId: String(r.namespace_id), name: String(r.event_name) as AnalyticsRow['name'],
    props: JSON.parse(String(r.props)) as AnalyticsRow['props'], createdAt: String(r.created_at) };
}
/** Private operator connection, like HostedUsage. No tenant-role SQL grants or tenant-facing unscoped reads. */
export class AnalyticsStore {
  constructor(private readonly db: Database) {}
  private async scope(c: SqlConnection, scope: Scope): Promise<void> {
    identifier(scope.tenantId); identifier(scope.namespaceId);
    // Serialize off-switch changes with log admission and check the composite tenant mapping.
    if (!(await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' RETURNING tenant_id", [scope.tenantId])).length
      || !(await c.query('SELECT namespace_id FROM h1_namespaces WHERE tenant_id = ? AND namespace_id = ?', [scope.tenantId, scope.namespaceId])).length) throw new MetadataError('TENANT_UNAVAILABLE', 403);
  }
  private async overrideIn(c: SqlConnection, scope: Scope): Promise<boolean | undefined> {
    const row = (await c.query('SELECT enabled FROM analytics_settings WHERE tenant_id = ? AND namespace_id = ?', [scope.tenantId, scope.namespaceId]))[0];
    return row === undefined ? undefined : Number(row.enabled) === 1;
  }
  async enabled(scope: Scope, fallback: boolean): Promise<boolean> {
    return this.db.transaction(async c => { await this.scope(c, scope); return (await this.overrideIn(c, scope)) ?? fallback; }, scope);
  }
  async setting(scope: Scope): Promise<boolean | undefined> {
    return this.db.transaction(async c => { await this.scope(c, scope); return this.overrideIn(c, scope); }, scope);
  }
  async setEnabled(scope: Scope, enabled: boolean): Promise<void> {
    if (typeof enabled !== 'boolean') throw new MetadataError('ANALYTICS_SETTINGS_INVALID', 400);
    await this.db.transaction(async c => {
      await this.scope(c, scope);
      await c.query(`INSERT INTO analytics_settings VALUES (?,?,?) ON CONFLICT (tenant_id)
        DO UPDATE SET enabled = excluded.enabled`, [scope.tenantId, scope.namespaceId, enabled ? 1 : 0]);
    }, scope);
  }
  /** Trusted server writes only; request bodies cannot choose a scope or an event. */
  async append(row: AnalyticsRow, fallback: boolean): Promise<boolean> {
    const event = validateAnalyticsEvent({ name: row.name, props: row.props });
    if (!event) throw new MetadataError('ANALYTICS_EVENT_INVALID', 400);
    return this.db.transaction(async c => {
      await this.scope(c, row);
      if (!((await this.overrideIn(c, row)) ?? fallback)) return false;
      await c.query('INSERT INTO analytics_events (event_id, tenant_id, namespace_id, event_name, props, created_at) VALUES (?,?,?,?,?,?)', [row.id, row.tenantId, row.namespaceId, event.name, JSON.stringify(event.props), row.createdAt]);
      return true;
    }, row);
  }
  /** Deployment-wide vendor outbox; only the private operator connection can read it. */
  async undelivered(limit = 32): Promise<AnalyticsRow[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new MetadataError('ANALYTICS_DRAIN_LIMIT_INVALID', 400);
    return this.db.transaction(async c => (await c.query(
      'SELECT * FROM analytics_events WHERE delivered_at IS NULL ORDER BY created_at, event_id LIMIT ?', [limit])).map(analyticsRow));
  }
  async markDelivered(id: string): Promise<void> {
    await this.db.transaction(c => c.query('UPDATE analytics_events SET delivered_at = ? WHERE event_id = ? AND delivered_at IS NULL', [new Date().toISOString(), id]));
  }
  async read(metadata: TenantMetadata, context: TenantContext): Promise<AnalyticsRow[]> {
    metadata.assertContext(context); await metadata.revisions(context);
    return this.db.transaction(async c => {
      await this.scope(c, context);
      return (await c.query('SELECT * FROM analytics_events WHERE tenant_id = ? AND namespace_id = ? ORDER BY created_at, event_id', [context.tenantId, context.namespaceId])).map(analyticsRow);
    }, context);
  }
}
