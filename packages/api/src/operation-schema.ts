import { createHash } from 'node:crypto';
import { MetadataError, type Database } from './metadata-db.js';
import { coordinationDeployment, coordinationFailure, coordinationNow, type CoordinationDialect } from './coordination-schema.js';
import { objectChecksum } from './object-schema.js';

export const operationTables = ['sr_operation_schema', 'sr_upload', 'sr_operation', 'sr_result_chunk'] as const;
const scope = 'deployment, tenant_id, namespace_id, owner_id';
const columns = 'deployment TEXT NOT NULL REFERENCES sr_control(deployment), tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, owner_id TEXT NOT NULL';
const schema = [
  'CREATE TABLE sr_operation_schema (deployment TEXT PRIMARY KEY REFERENCES sr_control(deployment), version INTEGER NOT NULL CHECK (version = 1), checksum TEXT NOT NULL)',
  `CREATE TABLE sr_upload (${columns}, upload_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision > 0), intent_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('reserved','accepted','completed','cancelled','expired','failed')), raw_object_id TEXT NOT NULL,
    output_object_id TEXT NOT NULL, source_id TEXT NOT NULL, operation_id TEXT, request TEXT NOT NULL, expires_at BIGINT NOT NULL,
    source_expires_at BIGINT NOT NULL, control_epoch BIGINT NOT NULL CHECK (control_epoch > 0), authorization_revision INTEGER NOT NULL,
    policy_revision INTEGER NOT NULL, configuration_revision INTEGER NOT NULL,
    PRIMARY KEY (deployment, upload_id), UNIQUE (${scope}, upload_id), UNIQUE (${scope}, source_id),
    FOREIGN KEY (${scope}, intent_id) REFERENCES sr_dispatch_intent(${scope}, intent_id),
    FOREIGN KEY (${scope}, raw_object_id) REFERENCES sr_object(${scope}, object_id),
    FOREIGN KEY (${scope}, output_object_id) REFERENCES sr_object(${scope}, object_id))`,
  `CREATE TABLE sr_operation (${columns}, operation_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision > 0),
    kind TEXT NOT NULL CHECK (kind IN ('ingest','result')), state TEXT NOT NULL CHECK (state IN ('queued','running','completed','cancelled','expired','failed')),
    control_epoch BIGINT NOT NULL CHECK (control_epoch > 0), authorization_revision INTEGER NOT NULL, policy_revision INTEGER NOT NULL,
    configuration_revision INTEGER NOT NULL, upload_id TEXT, expires_at BIGINT NOT NULL, fence BIGINT NOT NULL CHECK (fence >= 0), attempt_id TEXT,
    error_code TEXT, result TEXT, PRIMARY KEY (deployment, operation_id), UNIQUE (${scope}, operation_id),
    FOREIGN KEY (${scope}, upload_id) REFERENCES sr_upload(${scope}, upload_id),
    FOREIGN KEY (deployment, attempt_id, tenant_id, namespace_id, owner_id) REFERENCES sr_admission(deployment, attempt_id, tenant_id, namespace_id, owner_id))`,
  `CREATE TABLE sr_result_chunk (${columns}, operation_id TEXT NOT NULL, chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0), object_id TEXT NOT NULL,
    PRIMARY KEY (${scope}, operation_id, chunk_index), FOREIGN KEY (${scope}, operation_id) REFERENCES sr_operation(${scope}, operation_id),
    FOREIGN KEY (${scope}, object_id) REFERENCES sr_object(${scope}, object_id))`,
];
export const operationChecksum = createHash('sha256').update(schema.join('\n')).digest('hex');
export async function migrateOperations(database: Database, deployment: string, maintenance: string | undefined,
  dialect: CoordinationDialect = 'postgres'): Promise<void> {
  coordinationDeployment(deployment);
  if (database.durable !== true || !['sqlite', 'postgres'].includes(dialect)) throw new MetadataError('OPERATION_CONFIG_INVALID', 503);
  if (maintenance !== 'frozen') throw new MetadataError('WORKSPACE_MAINTENANCE_REQUIRED', 503);
  await database.transaction(async c => {
    const lock = dialect === 'postgres' ? ' FOR UPDATE' : '';
    if (dialect === 'postgres' && !(await c.query("SELECT pg_try_advisory_xact_lock(hashtext(current_database()), hashtext(current_schema() || ':opensight-h8-reference')) AS acquired"))[0]?.acquired) throw new MetadataError('MIGRATION_BUSY', 503);
    const control = (await c.query(`SELECT * FROM sr_control WHERE deployment = ?${lock}`, [deployment]))[0];
    if (control?.state !== 'maintenance') throw new MetadataError('WORKSPACE_MAINTENANCE_REQUIRED', 503);
    if (!['schema_min', 'schema_max', 'protocol_min', 'protocol_max'].every(k => Number(control[k]) === 1)) throw new MetadataError('MIGRATION_SCHEMA_INCOMPATIBLE', 503);
    const marker = (await c.query('SELECT version, checksum FROM sr_object_schema WHERE deployment = ?', [deployment]))[0];
    if (Number(marker?.version) !== 1 || marker?.checksum !== objectChecksum) throw new MetadataError('OBJECT_SCHEMA_REQUIRED', 503);
    if ((await c.query("SELECT attempt_id FROM sr_admission WHERE deployment = ? AND state = 'held' AND hold_until > ? LIMIT 1", [deployment, await coordinationNow(c, dialect)])).length) throw new MetadataError('WORKSPACE_DRAIN_REQUIRED', 503);
    const existing = await c.query(dialect === 'postgres'
      ? "SELECT c.relname AS name, CASE WHEN c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) THEN 1 ELSE 0 END AS owned FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relkind IN ('r','p')"
      : "SELECT name, 1 AS owned FROM sqlite_master WHERE type = 'table'");
    const found = existing.filter(r => operationTables.includes(String(r.name) as typeof operationTables[number]));
    if (found.length) {
      const row = found.length === operationTables.length && found.every(r => Number(r.owned) === 1)
        ? (await c.query('SELECT version, checksum FROM sr_operation_schema WHERE deployment = ?', [deployment]))[0] : undefined;
      if (Number(row?.version) !== 1 || row?.checksum !== operationChecksum) throw new MetadataError('OPERATION_FOREIGN_SCHEMA', 503);
      return;
    }
    for (const sql of schema) await c.query(sql);
    if (dialect === 'postgres') for (const table of ['sr_upload', 'sr_operation', 'sr_result_chunk']) {
      await c.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await c.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await c.query(`CREATE POLICY sr_scope ON ${table} USING (tenant_id = current_setting('opensight.tenant_id', true) AND namespace_id = current_setting('opensight.namespace_id', true)) WITH CHECK (tenant_id = current_setting('opensight.tenant_id', true) AND namespace_id = current_setting('opensight.namespace_id', true))`);
    }
    await c.query('INSERT INTO sr_operation_schema VALUES (?,1,?)', [deployment, operationChecksum]);
  }).catch(coordinationFailure);
}
