import { createHash } from 'node:crypto';
import { MetadataError, type Database } from './metadata-db.js';
import { coordinationDeployment, coordinationFailure, coordinationNow, type CoordinationDialect } from './coordination-schema.js';
import { dispatchChecksum } from './dispatch-schema.js';

export const executionTables = ['sr_execution_schema', 'sr_execution', 'sr_job_due'] as const;
const schema = [
  'CREATE TABLE sr_execution_schema (deployment TEXT PRIMARY KEY REFERENCES sr_control(deployment), version INTEGER NOT NULL CHECK (version = 1), checksum TEXT NOT NULL)',
  `CREATE TABLE sr_execution (deployment TEXT NOT NULL, event_id TEXT NOT NULL,
    fence BIGINT NOT NULL CHECK (fence > 0), token TEXT NOT NULL, attempts INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 5),
    lease_until BIGINT NOT NULL, state TEXT NOT NULL CHECK (state IN ('running','sending','retry','ambiguous','completed','failed','cancelled')),
    error_code TEXT, PRIMARY KEY (deployment, event_id),
    FOREIGN KEY (deployment, event_id) REFERENCES sr_outbox(deployment, event_id))`,
  `CREATE TABLE sr_job_due (deployment TEXT NOT NULL REFERENCES sr_control(deployment), due_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, owner_id TEXT NOT NULL, job_id TEXT NOT NULL,
    job_version INTEGER NOT NULL CHECK (job_version > 0), due_at BIGINT NOT NULL,
    PRIMARY KEY (deployment, due_id), UNIQUE (deployment, tenant_id, namespace_id, job_id, job_version, due_at),
    FOREIGN KEY (tenant_id, namespace_id, job_id) REFERENCES h7_jobs(tenant_id, namespace_id, job_id))`,
];
export const executionChecksum = createHash('sha256').update(schema.join('\n')).digest('hex');
export async function migrateExecutions(database: Database, deployment: string, maintenance: string | undefined,
  dialect: CoordinationDialect = 'postgres'): Promise<void> {
  coordinationDeployment(deployment);
  if (database.durable !== true || !['sqlite', 'postgres'].includes(dialect)) throw new MetadataError('EXECUTION_CONFIG_INVALID', 503);
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
    const found = existing.filter(r => executionTables.includes(String(r.name) as typeof executionTables[number]));
    if (found.length) {
      const row = found.length === executionTables.length && found.every(r => Number(r.owned) === 1)
        ? (await c.query('SELECT version, checksum FROM sr_execution_schema WHERE deployment = ?', [deployment]))[0] : undefined;
      if (Number(row?.version) !== 1 || row?.checksum !== executionChecksum) throw new MetadataError('EXECUTION_FOREIGN_SCHEMA', 503);
      return;
    }
    for (const sql of schema) await c.query(sql);
    // Operator-only coordination rows. Tenant SQL receives no grants.
    if (dialect === 'postgres') await c.query('REVOKE ALL ON sr_execution FROM PUBLIC');
    await c.query('INSERT INTO sr_execution_schema VALUES (?,1,?)', [deployment, executionChecksum]);
  }).catch(coordinationFailure);
}
