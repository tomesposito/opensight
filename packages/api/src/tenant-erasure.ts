import { MetadataError, type Database, type SqlConnection } from './metadata-db.js';

export interface TenantDeletionOptions { dryRun?: boolean; confirmTenantId?: string }
export interface ErasureCount {
  store: string;
  action: 'delete' | 'scrub' | 'retain' | 'fence';
  count: number;
}
export interface TenantDeletionReport {
  tenantId: string; operationId: string; dryRun: boolean;
  status: 'planned' | 'deleted' | 'noop';
  counts: ErasureCount[];
}
/** Fixed predicates, shared by inventory and purge. Never accept SQL from an operator. */
export const tenantDeletionTables = [
  'analytics_events', 'analytics_settings', 'h8_ai_warnings', 'h8_recovery', 'h8_usage_events', 'h8_usage',
  'h7_deliveries', 'h7_occurrences', 'h7_jobs', 'h7_migrations', 'h6_sessions', 'h5_embedding_config',
  'h2_onboarding', 'h2_invitations', 'h2_sessions',
  'h1_links', 'h1_resources',
] as const;
// Shared people survive. Unrelated orphan identities are not this tenant's data.
export const exclusiveIdentities = `SELECT m.subject FROM h2_memberships m WHERE m.tenant_id = ?
  AND NOT EXISTS (SELECT 1 FROM h2_memberships other WHERE other.subject = m.subject AND other.tenant_id <> ?)`;
export const tenantScrub = 'placement IS NOT NULL OR limit_policy IS NOT NULL OR display_name IS NOT NULL OR slug IS NOT NULL';
export async function erasureCount(c: SqlConnection, table: string, predicate: string, args: readonly string[]): Promise<number> {
  const count = Number((await c.query(`SELECT COUNT(*) AS count FROM ${table} WHERE ${predicate}`, args))[0]?.count);
  if (!Number.isSafeInteger(count) || count < 0) throw new MetadataError('TENANT_ERASURE_INVENTORY_INVALID', 503);
  return count;
}
export async function tenantDeletionInventory(c: SqlConnection, tenantId: string): Promise<ErasureCount[]> {
  const counts: ErasureCount[] = [];
  for (const table of tenantDeletionTables) {
    if (table === 'h1_resources') {
      // The table total includes every kind; the breakdown is informational, not additive.
      counts.push({ store: table, action: 'delete', count: await erasureCount(c, table, 'tenant_id = ?', [tenantId]) });
      const rows = await c.query('SELECT kind, COUNT(*) AS count FROM h1_resources WHERE tenant_id = ? GROUP BY kind ORDER BY kind', [tenantId]);
      for (const row of rows) counts.push({ store: `${table}.${String(row.kind)}`, action: 'delete', count: Number(row.count) });
    } else counts.push({ store: table, action: 'delete', count: await erasureCount(c, table, 'tenant_id = ?', [tenantId]) });
  }
  for (const table of ['h2_login_selections', 'h2_identities']) counts.push({ store: table, action: 'delete',
    count: await erasureCount(c, table, `subject IN (${exclusiveIdentities})`, [tenantId, tenantId]) });
  counts.push({ store: 'h2_memberships', action: 'delete', count: await erasureCount(c, 'h2_memberships', 'tenant_id = ?', [tenantId]) });
  counts.push({ store: 'h1_namespaces', action: 'scrub', count: await erasureCount(c, 'h1_namespaces', "tenant_id = ? AND name <> 'deleted'", [tenantId]) });
  counts.push({ store: 'h1_tenants', action: 'scrub', count: await erasureCount(c, 'h1_tenants', `tenant_id = ? AND (${tenantScrub})`, [tenantId]) });
  for (const table of ['h8_audit', 'h1_outbox', 'h1_operations', 'h1_revisions']) counts.push({ store: table, action: 'retain',
    count: await erasureCount(c, table, 'tenant_id = ?', [tenantId]) });
  return counts;
}
export function deletionOptions(env: NodeJS.ProcessEnv): TenantDeletionOptions {
  const mode = env.OPENSIGHT_DELETE_MODE ?? 'dry-run';
  if (mode !== 'dry-run' && mode !== 'execute') throw new MetadataError('TENANT_ERASURE_MODE_INVALID', 400);
  return { dryRun: mode === 'dry-run', confirmTenantId: env.OPENSIGHT_DELETE_CONFIRM };
}

export interface TenantErasureCache {
  countTenant(tenantId: string): number;
  purgeTenant(tenantId: string): void;
}
/** Refuse databases whose tenant stores the reference cannot erase. In particular,
 * serverless object versions require their own storage/dispatch maintenance fence. */
export async function assertReferenceErasureStores(db: Database): Promise<void> {
  await db.transaction(async c => {
    let tables: string[];
    if (db.dialect === 'sqlite') {
      tables = [];
      for (const row of await c.query("SELECT name FROM sqlite_schema WHERE type = 'table'")) {
        const name = String(row.name);
        if (name.startsWith('sr_')) tables.push(name);
        else if (/^[a-z][a-z0-9_]*$/.test(name) && (await c.query(`PRAGMA table_info(${name})`)).some(column => column.name === 'tenant_id')) tables.push(name);
      }
    } else tables = (await c.query(`SELECT DISTINCT table_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND (column_name = 'tenant_id' OR substr(table_name, 1, 3) = 'sr_')`)).map(row => String(row.table_name));
    const supported = new Set<string>([...tenantDeletionTables, 'h2_memberships', 'h1_namespaces', 'h1_tenants', 'h8_audit', 'h1_outbox', 'h1_operations', 'h1_revisions']);
    const unsupported = tables.filter(table => !supported.has(table)).sort();
    if (unsupported.length) throw new MetadataError('TENANT_ERASURE_STORE_UNSUPPORTED', 503, { stores: unsupported });
    // A v4 source references external bytes even if its serverless schema is absent.
    const external = await c.query("SELECT body FROM h1_resources WHERE kind = 'source'");
    for (const row of external) {
      let value: unknown;
      try { value = JSON.parse(String(row.body)); } catch { throw new MetadataError('TENANT_ERASURE_INVENTORY_INVALID', 503); }
      if (value && typeof value === 'object' && 'binding' in value && value.binding && typeof value.binding === 'object'
        && ('objectId' in value.binding || 'version' in value.binding && value.binding.version === 4)) {
        throw new MetadataError('TENANT_ERASURE_STORE_UNSUPPORTED', 503, { stores: ['source.objects'] });
      }
    }
  });
}

export async function purgeTenantRows(c: SqlConnection, tenantId: string): Promise<string[]> {
  // Capture exclusive subjects before deleting memberships, in the same transaction.
  const subjects = (await c.query(exclusiveIdentities, [tenantId, tenantId])).map(row => String(row.subject));
  for (const table of tenantDeletionTables) await c.query(`DELETE FROM ${table} WHERE tenant_id = ?`, [tenantId]);
  for (const subject of subjects) await c.query('DELETE FROM h2_login_selections WHERE subject = ?', [subject]);
  await c.query('DELETE FROM h2_memberships WHERE tenant_id = ?', [tenantId]);
  for (const subject of subjects) await c.query('DELETE FROM h2_identities WHERE subject = ?', [subject]);
  await c.query("UPDATE h1_namespaces SET name = 'deleted' WHERE tenant_id = ? AND name <> 'deleted'", [tenantId]);
  await c.query(`UPDATE h1_tenants SET placement = NULL, limit_policy = NULL, display_name = NULL, slug = NULL
    WHERE tenant_id = ? AND (${tenantScrub})`, [tenantId]);
  return subjects;
}
