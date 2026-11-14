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
      quarantine_reason TEXT,
      FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`);
    // Owner migration only. Transaction-scoped wrappers may omit dialect, so
    // use the access-request savepoint probe outside known SQLite adapters.
    const hasColumn = async (column: string): Promise<boolean> => {
      if (db.dialect === 'sqlite') {
        return (await c.query('PRAGMA table_info(analytics_events)')).some(row => row.name === column);
      }
      await c.query(`SAVEPOINT opensight_${column}_check`);
      let present = true;
      try { await c.query(`SELECT ${column} FROM analytics_events LIMIT 0`); }
      catch { present = false; await c.query(`ROLLBACK TO SAVEPOINT opensight_${column}_check`); }
      await c.query(`RELEASE SAVEPOINT opensight_${column}_check`);
      return present;
    };
    if (!await hasColumn('delivered_at')) await c.query('ALTER TABLE analytics_events ADD COLUMN delivered_at TEXT');
    if (!await hasColumn('quarantine_reason')) await c.query('ALTER TABLE analytics_events ADD COLUMN quarantine_reason TEXT');
    await c.query('CREATE INDEX IF NOT EXISTS analytics_event_scope ON analytics_events(tenant_id, namespace_id, created_at)');
    await c.query(`CREATE TABLE IF NOT EXISTS analytics_settings (
      tenant_id TEXT PRIMARY KEY, namespace_id TEXT NOT NULL, enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
      FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`);
  });
}
/** Named quarantine reasons for persisted rows that can never be delivered (#247). */
export const analyticsQuarantineReasons = { propsMalformed: 'ANALYTICS_EVENT_PROPS_MALFORMED', eventInvalid: 'ANALYTICS_EVENT_INVALID' } as const;
/** Deserialize and validate one persisted row independently. A malformed row
 * (restored, legacy or corrupted) yields its named quarantine reason instead of
 * throwing, so one bad row can never abort or starve the rest of the batch. */
function parseAnalyticsRow(r: SqlRow): { row: AnalyticsRow } | { reason: string } {
  let props: unknown;
  try { props = JSON.parse(String(r.props)); } catch { return { reason: analyticsQuarantineReasons.propsMalformed }; }
  const event = validateAnalyticsEvent({ name: String(r.event_name), props });
  if (!event) return { reason: analyticsQuarantineReasons.eventInvalid };
  return { row: { id: String(r.event_id), tenantId: String(r.tenant_id), namespaceId: String(r.namespace_id), name: event.name,
    props: event.props, createdAt: String(r.created_at) } };
}
async function quarantineRow(c: SqlConnection, id: string, reason: string): Promise<void> {
  await c.query('UPDATE analytics_events SET quarantine_reason = ? WHERE event_id = ? AND quarantine_reason IS NULL', [reason, id]);
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
  /** Scan ordered pages until `limit` valid rows are collected or rows run out.
   * Malformed rows are quarantined with their named reason as they are met, so
   * they drop out of later pages; the offset advances only past valid rows
   * examined, which stay pending until the caller marks them delivered. */
  private async selectValid(c: SqlConnection, limit: number,
    page: (limit: number, offset: number) => Promise<SqlRow[]>): Promise<AnalyticsRow[]> {
    const valid: AnalyticsRow[] = [];
    let offset = 0;
    while (valid.length < limit) {
      const rows = await page(limit, offset);
      if (!rows.length) break;
      let examinedValid = 0;
      for (const r of rows) {
        const parsed = parseAnalyticsRow(r);
        if ('reason' in parsed) { await quarantineRow(c, String(r.event_id), parsed.reason); continue; }
        examinedValid++;
        if (valid.length < limit) valid.push(parsed.row);
      }
      offset += examinedValid;
      if (rows.length < limit) break;
    }
    return valid;
  }
  /** Deployment-wide vendor outbox; only the private operator connection can read it. */
  async undelivered(limit = 32): Promise<AnalyticsRow[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new MetadataError('ANALYTICS_DRAIN_LIMIT_INVALID', 400);
    return this.db.transaction(async c => this.selectValid(c, limit, (pageLimit, offset) => c.query(
      'SELECT * FROM analytics_events WHERE delivered_at IS NULL AND quarantine_reason IS NULL ORDER BY created_at, event_id LIMIT ? OFFSET ?', [pageLimit, offset])));
  }
  /** Filter before limiting so blocked tenants retain their rows without starving eligible tenants. */
  async undeliveredEligible(limit: number, fallbackEnabled: boolean): Promise<AnalyticsRow[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new MetadataError('ANALYTICS_DRAIN_LIMIT_INVALID', 400);
    return this.db.transaction(async c => this.selectValid(c, limit, (pageLimit, offset) => c.query(`SELECT e.* FROM analytics_events e
      JOIN h1_tenants t ON t.tenant_id = e.tenant_id AND t.state = 'active'
      JOIN h1_namespaces n ON n.tenant_id = e.tenant_id AND n.namespace_id = e.namespace_id
      LEFT JOIN analytics_settings s ON s.tenant_id = e.tenant_id AND s.namespace_id = e.namespace_id
      WHERE e.delivered_at IS NULL AND e.quarantine_reason IS NULL AND COALESCE(s.enabled, ?) = 1
      ORDER BY e.created_at, e.event_id LIMIT ? OFFSET ?`, [fallbackEnabled ? 1 : 0, pageLimit, offset])));
  }
  async markDelivered(id: string): Promise<void> {
    await this.db.transaction(c => c.query('UPDATE analytics_events SET delivered_at = ? WHERE event_id = ? AND delivered_at IS NULL', [new Date().toISOString(), id]));
  }
  async read(metadata: TenantMetadata, context: TenantContext): Promise<AnalyticsRow[]> {
    metadata.assertContext(context); await metadata.revisions(context);
    return this.db.transaction(async c => {
      await this.scope(c, context);
      const rows: AnalyticsRow[] = [];
      for (const r of await c.query('SELECT * FROM analytics_events WHERE tenant_id = ? AND namespace_id = ? AND quarantine_reason IS NULL ORDER BY created_at, event_id', [context.tenantId, context.namespaceId])) {
        const parsed = parseAnalyticsRow(r);
        if ('reason' in parsed) { await quarantineRow(c, String(r.event_id), parsed.reason); continue; }
        rows.push(parsed.row);
      }
      return rows;
    }, context);
  }
}
