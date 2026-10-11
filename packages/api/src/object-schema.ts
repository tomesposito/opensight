import { createHash } from 'node:crypto';
import { MetadataError, type Database } from './metadata-db.js';
import { coordinationDeployment, coordinationFailure, coordinationNow, type CoordinationDialect } from './coordination-schema.js';
import { dispatchChecksum } from './dispatch-schema.js';

export const objectTables = ['sr_object_schema', 'sr_object', 'sr_storage_usage', 'sr_object_pin'] as const;
const scope = 'deployment, tenant_id, namespace_id, owner_id';
const columns = 'deployment TEXT NOT NULL REFERENCES sr_control(deployment), tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, owner_id TEXT NOT NULL';
const schema = [
  'CREATE TABLE sr_object_schema (deployment TEXT PRIMARY KEY REFERENCES sr_control(deployment), version INTEGER NOT NULL CHECK (version = 1), checksum TEXT NOT NULL)',
  `CREATE TABLE sr_storage_usage (deployment TEXT NOT NULL REFERENCES sr_control(deployment), tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL,
    reserved_bytes BIGINT NOT NULL CHECK (reserved_bytes >= 0), live_bytes BIGINT NOT NULL CHECK (live_bytes >= 0),
    PRIMARY KEY (deployment, tenant_id, namespace_id), FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`,
  `CREATE TABLE sr_object (${columns}, object_id TEXT NOT NULL, intent_id TEXT NOT NULL, object_key TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('raw-upload','source','cache','result')), capacity_bytes BIGINT NOT NULL CHECK (capacity_bytes > 0),
    actual_bytes BIGINT, checksum TEXT, media_type TEXT NOT NULL, object_version TEXT, descriptor TEXT,
    state TEXT NOT NULL CHECK (state IN ('reserved','live','retiring','deleted')), created_at BIGINT NOT NULL,
    retention_until BIGINT NOT NULL, signature_until BIGINT NOT NULL,
    PRIMARY KEY (deployment, object_id), UNIQUE (deployment, object_key), UNIQUE (${scope}, object_id),
    FOREIGN KEY (${scope}, intent_id) REFERENCES sr_dispatch_intent(${scope}, intent_id),
    CHECK (actual_bytes IS NULL OR (actual_bytes > 0 AND actual_bytes <= capacity_bytes)),
    CHECK (state <> 'live' OR (actual_bytes IS NOT NULL AND checksum IS NOT NULL AND object_version IS NOT NULL)))`,
  `CREATE TABLE sr_object_pin (${columns}, object_id TEXT NOT NULL, pin_id TEXT NOT NULL, expires_at BIGINT NOT NULL,
    PRIMARY KEY (${scope}, object_id, pin_id), FOREIGN KEY (${scope}, object_id) REFERENCES sr_object(${scope}, object_id))`,
];
export const objectChecksum = createHash('sha256').update(schema.join('\n')).digest('hex');
export async function migrateObjects(database: Database, deployment: string, maintenance: string | undefined,
  dialect: CoordinationDialect = 'postgres'): Promise<void> {
  coordinationDeployment(deployment);
  if (database.durable !== true || !['sqlite', 'postgres'].includes(dialect)) throw new MetadataError('OBJECT_CONFIG_INVALID', 503);
  if (maintenance !== 'frozen') throw new MetadataError('WORKSPACE_MAINTENANCE_REQUIRED', 503);
  await database.transaction(async c => {
    const lock = dialect === 'postgres' ? ' FOR UPDATE' : '';
    if (dialect === 'postgres' && !(await c.query("SELECT pg_try_advisory_xact_lock(hashtext(current_database()), hashtext(current_schema() || ':opensight-h8-reference')) AS acquired"))[0]?.acquired) throw new MetadataError('MIGRATION_BUSY', 503);
    const control = (await c.query(`SELECT * FROM sr_control WHERE deployment = ?${lock}`, [deployment]))[0];
    if (control?.state !== 'maintenance') throw new MetadataError('WORKSPACE_MAINTENANCE_REQUIRED', 503);
    if (!['schema_min', 'schema_max', 'protocol_min', 'protocol_max'].every(k => Number(control[k]) === 1)) throw new MetadataError('MIGRATION_SCHEMA_INCOMPATIBLE', 503);
    const marker = (await c.query('SELECT version, checksum FROM sr_dispatch_schema WHERE deployment = ?', [deployment]))[0];
    if (Number(marker?.version) !== 1 || marker?.checksum !== dispatchChecksum) throw new MetadataError('DISPATCH_SCHEMA_REQUIRED', 503);
    if ((await c.query("SELECT attempt_id FROM sr_admission WHERE deployment = ? AND state = 'held' AND hold_until > ? LIMIT 1", [deployment, await coordinationNow(c, dialect)])).length) throw new MetadataError('WORKSPACE_DRAIN_REQUIRED', 503);
    const existing = await c.query(dialect === 'postgres'
      ? "SELECT c.relname AS name, CASE WHEN c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) THEN 1 ELSE 0 END AS owned FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relkind IN ('r','p')"
      : "SELECT name, 1 AS owned FROM sqlite_master WHERE type = 'table'");
    const found = existing.filter(r => objectTables.includes(String(r.name) as typeof objectTables[number]));
    if (found.length) {
      const row = found.length === objectTables.length && found.every(r => Number(r.owned) === 1)
        ? (await c.query('SELECT version, checksum FROM sr_object_schema WHERE deployment = ?', [deployment]))[0] : undefined;
      if (Number(row?.version) !== 1 || row?.checksum !== objectChecksum) throw new MetadataError('OBJECT_FOREIGN_SCHEMA', 503);
      return;
    }
    for (const sql of schema) await c.query(sql);
    if (dialect === 'postgres') for (const table of ['sr_object', 'sr_storage_usage', 'sr_object_pin']) {
      await c.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await c.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await c.query(`CREATE POLICY sr_scope ON ${table} USING (tenant_id = current_setting('opensight.tenant_id', true) AND namespace_id = current_setting('opensight.namespace_id', true)) WITH CHECK (tenant_id = current_setting('opensight.tenant_id', true) AND namespace_id = current_setting('opensight.namespace_id', true))`);
    }
    await c.query('INSERT INTO sr_object_schema VALUES (?,1,?)', [deployment, objectChecksum]);
  }).catch(coordinationFailure);
}
