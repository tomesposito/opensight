import { MetadataError, type Database, type SqlConnection } from './metadata-db.js';
import type { TenantContext, TenantMetadata } from './metadata.js';
import { identifier, type Scope } from './metadata-resources.js';
import { validateAnalyticsEvent, type AnalyticsRow } from './analytics.js';

export const analyticsTables = ['analytics_events', 'analytics_settings'] as const;
export async function initializeAnalytics(db: Database): Promise<void> {
  await db.transaction(async c => {
    await c.query(`CREATE TABLE IF NOT EXISTS analytics_events (
      event_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL,
      event_name TEXT NOT NULL, props TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`);
    await c.query('CREATE INDEX IF NOT EXISTS analytics_event_scope ON analytics_events(tenant_id, namespace_id, created_at)');
    await c.query(`CREATE TABLE IF NOT EXISTS analytics_settings (
      tenant_id TEXT PRIMARY KEY, namespace_id TEXT NOT NULL, enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
      FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`);
  });
}
/** Private operator connection, like HostedUsage. No tenant-role SQL grants or unscoped read API. */
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
  /** Trusted server writes only; request bodies cannot choose a scope or an event. */
  async append(row: AnalyticsRow, fallback: boolean): Promise<boolean> {
    const event = validateAnalyticsEvent({ name: row.name, props: row.props });
    if (!event) throw new MetadataError('ANALYTICS_EVENT_INVALID', 400);
    return this.db.transaction(async c => {
      await this.scope(c, row);
      if (!((await this.overrideIn(c, row)) ?? fallback)) return false;
      await c.query('INSERT INTO analytics_events VALUES (?,?,?,?,?,?)', [row.id, row.tenantId, row.namespaceId, event.name, JSON.stringify(event.props), row.createdAt]);
      return true;
    }, row);
  }
  async read(metadata: TenantMetadata, context: TenantContext): Promise<AnalyticsRow[]> {
    metadata.assertContext(context); await metadata.revisions(context);
    return this.db.transaction(async c => {
      await this.scope(c, context);
      return (await c.query('SELECT * FROM analytics_events WHERE tenant_id = ? AND namespace_id = ? ORDER BY created_at, event_id', [context.tenantId, context.namespaceId])).map(r => ({
        id: String(r.event_id), tenantId: String(r.tenant_id), namespaceId: String(r.namespace_id), name: String(r.event_name) as AnalyticsRow['name'],
        props: JSON.parse(String(r.props)) as AnalyticsRow['props'], createdAt: String(r.created_at),
      }));
    }, context);
  }
}
