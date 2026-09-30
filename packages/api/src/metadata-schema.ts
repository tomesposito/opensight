import type { Database } from './metadata-db.js';

export const metadataTables = ['tenants', 'namespaces', 'revisions', 'resources', 'links', 'operations', 'outbox', 'migrations'] as const;

/** The same composite constraints run in SQLite and Postgres. Portable IDs are values, never paths. */
const schema = [
  `CREATE TABLE IF NOT EXISTS h1_tenants (
    tenant_id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK (state IN ('provisioning','active','suspended','deleting','deleted')),
    version INTEGER NOT NULL CHECK (version > 0), tombstone TEXT, placement TEXT, limit_policy TEXT,
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

export async function initializeMetadata(database: Database, dialect: 'sqlite' | 'postgres' = 'sqlite'): Promise<void> {
  await database.transaction(async c => {
    for (const sql of schema) await c.query(sql);
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
