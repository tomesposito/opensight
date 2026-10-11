import { createHash } from 'node:crypto';
import { MetadataError, type Database } from './metadata-db.js';
import { coordinationChecksum, coordinationDeployment, coordinationFailure, coordinationNow, type CoordinationDialect } from './coordination-schema.js';

export const manifestTables = ['sr_manifest_schema', 'sr_manifest', 'sr_manifest_versions'] as const;
const scope = 'deployment, tenant_id, namespace_id, owner_id, kind, resource_id';
const columns = `deployment TEXT NOT NULL, tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('source','prepared-dataset')), resource_id TEXT NOT NULL`;
const schema = [
  `CREATE TABLE sr_manifest_schema (deployment TEXT PRIMARY KEY REFERENCES sr_control(deployment), version INTEGER NOT NULL CHECK (version = 1), checksum TEXT NOT NULL)`,
  `CREATE TABLE sr_manifest (${columns}, attempt_id TEXT NOT NULL, generation BIGINT NOT NULL CHECK (generation > 0),
    state TEXT NOT NULL CHECK (state IN ('running','ready','error')), body TEXT NOT NULL,
    PRIMARY KEY (${scope}), FOREIGN KEY (${scope}) REFERENCES sr_claim(${scope}),
    FOREIGN KEY (deployment, attempt_id, tenant_id, namespace_id, owner_id) REFERENCES sr_admission(deployment, attempt_id, tenant_id, namespace_id, owner_id))`,
  `CREATE TABLE sr_manifest_versions (${columns}, generation BIGINT NOT NULL CHECK (generation > 0), body TEXT NOT NULL,
    PRIMARY KEY (${scope}, generation), FOREIGN KEY (${scope}) REFERENCES sr_claim(${scope}))`,
];
export const manifestChecksum = createHash('sha256').update(schema.join('\n')).digest('hex');
export async function migrateManifests(database: Database, deployment: string, maintenance: string | undefined,
  dialect: CoordinationDialect = 'postgres'): Promise<void> {
  coordinationDeployment(deployment);
  if (database.durable !== true || !['sqlite', 'postgres'].includes(dialect)) throw new MetadataError('MANIFEST_CONFIG_INVALID', 503);
  if (maintenance !== 'frozen') throw new MetadataError('WORKSPACE_MAINTENANCE_REQUIRED', 503);
  await database.transaction(async c => {
    const lock = dialect === 'postgres' ? ' FOR UPDATE' : '';
    if (dialect === 'postgres' && !(await c.query("SELECT pg_try_advisory_xact_lock(hashtext(current_database()), hashtext(current_schema() || ':opensight-h8-reference')) AS acquired"))[0]?.acquired) throw new MetadataError('MIGRATION_BUSY', 503);
    const control = (await c.query(`SELECT * FROM sr_control WHERE deployment = ?${lock}`, [deployment]))[0];
    if (control?.state !== 'maintenance') throw new MetadataError('WORKSPACE_MAINTENANCE_REQUIRED', 503);
    if (!['schema_min', 'schema_max', 'protocol_min', 'protocol_max'].every(k => Number(control[k]) === 1)) throw new MetadataError('MIGRATION_SCHEMA_INCOMPATIBLE', 503);
    const marker = (await c.query('SELECT version, checksum FROM sr_coordination_schema WHERE deployment = ?', [deployment]))[0];
    if (Number(marker?.version) !== 1 || marker?.checksum !== coordinationChecksum) throw new MetadataError('COORDINATION_SCHEMA_REQUIRED', 503);
    if ((await c.query("SELECT attempt_id FROM sr_admission WHERE deployment = ? AND state = 'held' AND hold_until > ? LIMIT 1", [deployment, await coordinationNow(c, dialect)])).length) throw new MetadataError('WORKSPACE_DRAIN_REQUIRED', 503);
    const existing = await c.query(dialect === 'postgres'
      ? "SELECT c.relname AS name, CASE WHEN c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) THEN 1 ELSE 0 END AS owned FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relkind IN ('r','p')"
      : "SELECT name, 1 AS owned FROM sqlite_master WHERE type = 'table'");
    const found = existing.filter(r => manifestTables.includes(String(r.name) as typeof manifestTables[number]));
    if (found.length) {
      if (found.length !== manifestTables.length || found.some(r => Number(r.owned) !== 1)) throw new MetadataError('MANIFEST_FOREIGN_SCHEMA', 503);
      const row = (await c.query('SELECT version, checksum FROM sr_manifest_schema WHERE deployment = ?', [deployment]))[0];
      if (Number(row?.version) !== 1 || row?.checksum !== manifestChecksum) throw new MetadataError('MANIFEST_FOREIGN_SCHEMA', 503);
      return;
    }
    for (const sql of schema) await c.query(sql);
    if (dialect === 'postgres') for (const table of ['sr_manifest', 'sr_manifest_versions']) {
      await c.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await c.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await c.query(`CREATE POLICY sr_scope ON ${table} USING (tenant_id = current_setting('opensight.tenant_id', true) AND namespace_id = current_setting('opensight.namespace_id', true)) WITH CHECK (tenant_id = current_setting('opensight.tenant_id', true) AND namespace_id = current_setting('opensight.namespace_id', true))`);
    }
    await c.query('INSERT INTO sr_manifest_schema VALUES (?,1,?)', [deployment, manifestChecksum]);
  }).catch(coordinationFailure);
}
