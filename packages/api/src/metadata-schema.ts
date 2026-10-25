import type { Database, SqlConnection } from './metadata-db.js';

export const metadataTables = ['tenants', 'namespaces', 'revisions', 'resources', 'links', 'operations', 'outbox', 'migrations'] as const;

/** The same composite constraints run in SQLite and Postgres. Portable IDs are values, never paths. */
const schema = [
  `CREATE TABLE IF NOT EXISTS h1_tenants (
    tenant_id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK (state IN ('provisioning','active','suspended','deleting','deleted')),
    version INTEGER NOT NULL CHECK (version > 0), tombstone TEXT, placement TEXT, limit_policy TEXT,
    display_name TEXT, slug TEXT UNIQUE,
    CHECK ((state = 'deleted') = (tombstone IS NOT NULL)))`,
  `CREATE TABLE IF NOT EXISTS h1_namespaces (
    namespace_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL UNIQUE REFERENCES h1_tenants(tenant_id), name TEXT NOT NULL,
    UNIQUE (tenant_id, namespace_id))`,
  `CREATE TABLE IF NOT EXISTS h1_revisions (
    tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL,
    "authorization" INTEGER NOT NULL CHECK ("authorization" > 0), policy INTEGER NOT NULL CHECK (policy > 0), configuration INTEGER NOT NULL CHECK (configuration > 0),
    PRIMARY KEY (tenant_id, namespace_id), FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`,
  `CREATE TABLE IF NOT EXISTS h1_resources (
    tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, kind TEXT NOT NULL,
    owner_id TEXT NOT NULL, resource_id TEXT NOT NULL, body TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0),
    CHECK (kind IN ('user','group','folder','analysis','dashboard','dataset','prepared-dataset','policy','source','secret','ai-config','invitation','job')),
    CHECK (kind NOT IN ('user','group','folder','analysis','dashboard','dataset','policy','ai-config','invitation','job') OR owner_id = ''),
    CHECK (kind <> 'prepared-dataset' OR owner_id <> ''),
    PRIMARY KEY (tenant_id, namespace_id, kind, owner_id, resource_id),
    FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`,
  `CREATE TABLE IF NOT EXISTS h1_links (
    tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL,
    kind TEXT NOT NULL, owner_id TEXT NOT NULL, resource_id TEXT NOT NULL,
    target_kind TEXT NOT NULL, target_owner TEXT NOT NULL, target_id TEXT NOT NULL,
    PRIMARY KEY (tenant_id, namespace_id, kind, owner_id, resource_id, target_kind, target_owner, target_id),
    FOREIGN KEY (tenant_id, namespace_id, kind, owner_id, resource_id) REFERENCES h1_resources(tenant_id, namespace_id, kind, owner_id, resource_id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, namespace_id, target_kind, target_owner, target_id) REFERENCES h1_resources(tenant_id, namespace_id, kind, owner_id, resource_id) DEFERRABLE INITIALLY DEFERRED)`,
  `CREATE TABLE IF NOT EXISTS h1_operations (
    operation_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES h1_tenants(tenant_id), namespace_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('provision','suspend','resume','delete')), request_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','complete')), step TEXT NOT NULL,
    FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`,
  `CREATE TABLE IF NOT EXISTS h1_outbox (
    event_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, event_type TEXT NOT NULL,
    revision INTEGER NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`,
  `CREATE TABLE IF NOT EXISTS h1_migrations (
    migration_id TEXT PRIMARY KEY, checksum TEXT NOT NULL, counts TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('inventoried','committed','rolled-back','sealed')), backup_version INTEGER NOT NULL)`
];

/**
 * Additive upgrade for databases created before workspace naming (issue
 * #146): both columns are nullable so legacy tenants keep working via the
 * display-label fallback. UNIQUE cannot ride ALTER TABLE ... ADD COLUMN on
 * SQLite, so slug uniqueness is a named unique index on both dialects
 * (NULLs exempt — many unnamed tenants coexist).
 */
async function ensureTenantNaming(c: SqlConnection): Promise<void> {
  for (const [column, definition] of [['display_name', 'TEXT'], ['slug', 'TEXT']] as const) {
    // Column names are fixed constants, never caller input. The savepoint
    // keeps a duplicate-column failure from aborting the caller's
    // transaction on Postgres (same discipline as operator-audit.ts).
    await c.query('SAVEPOINT opensight_tenant_naming');
    try {
      await c.query(`ALTER TABLE h1_tenants ADD COLUMN ${column} ${definition}`);
      await c.query('RELEASE SAVEPOINT opensight_tenant_naming');
    } catch (error) {
      await c.query('ROLLBACK TO SAVEPOINT opensight_tenant_naming');
      await c.query('RELEASE SAVEPOINT opensight_tenant_naming');
      const code = error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      const message = error instanceof Error ? error.message : '';
      if (code === '42701' || /duplicate column/i.test(message)) continue; // already migrated
      throw error;
    }
  }
  await c.query('CREATE UNIQUE INDEX IF NOT EXISTS h1_tenants_slug ON h1_tenants(slug)');
}

export async function initializeMetadata(database: Database, dialect: 'sqlite' | 'postgres' = 'sqlite'): Promise<void> {
  await database.transaction(async c => {
    for (const sql of schema) await c.query(sql);
    await ensureTenantNaming(c);
    if (dialect === 'postgres') {
      await c.query('ALTER TABLE h1_tenants ENABLE ROW LEVEL SECURITY');
      await c.query('ALTER TABLE h1_tenants FORCE ROW LEVEL SECURITY');
      await c.query('DROP POLICY IF EXISTS h1_scope ON h1_tenants');
      await c.query("CREATE POLICY h1_scope ON h1_tenants USING (tenant_id = current_setting('opensight.tenant_id', true)) WITH CHECK (tenant_id = current_setting('opensight.tenant_id', true))");
    }
    if (dialect === 'postgres') for (const table of metadataTables.filter(t => !['tenants', 'migrations'].includes(t))) {
      await c.query(`ALTER TABLE h1_${table} ENABLE ROW LEVEL SECURITY`);
      await c.query(`ALTER TABLE h1_${table} FORCE ROW LEVEL SECURITY`);
      await c.query(`DROP POLICY IF EXISTS h1_scope ON h1_${table}`);
      await c.query(`CREATE POLICY h1_scope ON h1_${table} USING (tenant_id = current_setting('opensight.tenant_id', true) AND namespace_id = current_setting('opensight.namespace_id', true))
        WITH CHECK (tenant_id = current_setting('opensight.tenant_id', true) AND namespace_id = current_setting('opensight.namespace_id', true))`);
    }
  });
}
