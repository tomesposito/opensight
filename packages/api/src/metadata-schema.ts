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
    CHECK (kind IN ('user','group','folder','analysis','dashboard','dataset','prepared-dataset','policy','source','secret','ai-config','invitation','job','metric')),
    CHECK (kind NOT IN ('user','group','folder','analysis','dashboard','dataset','policy','ai-config','invitation','job','metric') OR owner_id = ''),
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
export async function ensureTenantNaming(c: SqlConnection, dialect: 'sqlite' | 'postgres'): Promise<void> {
  const columns = await c.query(dialect === 'postgres'
    ? "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'h1_tenants'"
    : 'PRAGMA table_info(h1_tenants)');
  for (const column of ['display_name', 'slug']) {
    if (!columns.some(row => row.name === column)) await c.query(`ALTER TABLE h1_tenants ADD COLUMN ${column} TEXT`);
  }
  await c.query('CREATE UNIQUE INDEX IF NOT EXISTS h1_tenants_slug ON h1_tenants(slug)');
}

export async function initializeMetadata(database: Database, dialect: 'sqlite' | 'postgres' = 'sqlite'): Promise<void> {
  await database.transaction(async c => {
    for (const sql of schema) await c.query(sql);
    await ensureMetricKind(c, dialect);
    await ensureTenantNaming(c, dialect);
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

/** Upgrade the asset kind constraint without losing rows or dataset links. */
async function ensureMetricKind(c: SqlConnection, dialect: 'sqlite' | 'postgres'): Promise<void> {
  if (dialect === 'postgres') {
    const checks = await c.query("SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'h1_resources'::regclass AND contype = 'c'");
    for (const row of checks) {
      const definition = String(row.definition), name = String(row.conname);
      if (!definition.includes("'job'") || definition.includes("'metric'")) continue;
      if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Unexpected metadata constraint name');
      await c.query(`ALTER TABLE h1_resources DROP CONSTRAINT "${name}"`);
      await c.query(`ALTER TABLE h1_resources ADD CONSTRAINT "${name}" ${definition.replaceAll("'job'::text", "'job'::text, 'metric'::text")}`);
    }
    return;
  }
  const rows = await c.query("SELECT sql FROM sqlite_master WHERE name = 'h1_resources'");
  if (String(rows[0]?.sql).includes("'metric'")) return;
  await c.query('CREATE TEMP TABLE metric_link_backup AS SELECT * FROM h1_links');
  await c.query('DROP TABLE h1_links');
  await c.query(schema[3]!.replace('h1_resources', 'h1_resources_metrics'));
  await c.query('INSERT INTO h1_resources_metrics SELECT * FROM h1_resources');
  await c.query('DROP TABLE h1_resources');
  await c.query('ALTER TABLE h1_resources_metrics RENAME TO h1_resources');
  await c.query(schema[4]!);
  await c.query('INSERT INTO h1_links SELECT * FROM metric_link_backup');
  await c.query('DROP TABLE metric_link_backup');
}
