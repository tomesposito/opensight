import { createHash } from 'node:crypto';
import { MetadataError, type Database } from './metadata-db.js';
import { coordinationDeployment, coordinationFailure, coordinationNow, type CoordinationDialect } from './coordination-schema.js';
import { manifestChecksum } from './manifest-schema.js';

export const dispatchTables = ['sr_dispatch_schema', 'sr_dispatch_intent', 'sr_outbox'] as const;
const scope = 'deployment, tenant_id, namespace_id, owner_id';
const columns = 'deployment TEXT NOT NULL REFERENCES sr_control(deployment), tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, owner_id TEXT NOT NULL';
const schema = [
  'CREATE TABLE sr_dispatch_schema (deployment TEXT PRIMARY KEY REFERENCES sr_control(deployment), version INTEGER NOT NULL CHECK (version = 1), checksum TEXT NOT NULL)',
  `CREATE TABLE sr_dispatch_intent (${columns}, intent_id TEXT NOT NULL, kind TEXT NOT NULL,
    request_digest TEXT NOT NULL, idempotency_digest TEXT NOT NULL, control_epoch BIGINT NOT NULL CHECK (control_epoch > 0),
    authorization_revision INTEGER NOT NULL, policy_revision INTEGER NOT NULL, configuration_revision INTEGER NOT NULL,
    commit_until BIGINT NOT NULL, state TEXT NOT NULL CHECK (state IN ('prepared','committed','aborted')), receipt TEXT,
    PRIMARY KEY (deployment, intent_id), UNIQUE (${scope}, intent_id), UNIQUE (${scope}, kind, idempotency_digest),
    FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id),
    CHECK ((state = 'committed' AND receipt IS NOT NULL) OR (state <> 'committed' AND receipt IS NULL)))`,
  `CREATE TABLE sr_outbox (${columns}, event_id TEXT NOT NULL, intent_id TEXT NOT NULL, aggregate_id TEXT NOT NULL,
    aggregate_revision INTEGER NOT NULL CHECK (aggregate_revision > 0), kind TEXT NOT NULL, version INTEGER NOT NULL CHECK (version = 1),
    control_epoch BIGINT NOT NULL CHECK (control_epoch > 0), due_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending','dispatched','terminal')),
    PRIMARY KEY (deployment, event_id), UNIQUE (${scope}, aggregate_id, aggregate_revision, kind),
    FOREIGN KEY (${scope}, intent_id) REFERENCES sr_dispatch_intent(${scope}, intent_id), CHECK (expires_at > due_at))`,
  'CREATE INDEX sr_outbox_pending ON sr_outbox(deployment, intent_id, state)',
];
export const dispatchChecksum = createHash('sha256').update(schema.join('\n')).digest('hex');
export async function migrateDispatch(database: Database, deployment: string, maintenance: string | undefined,
  dialect: CoordinationDialect = 'postgres'): Promise<void> {
  coordinationDeployment(deployment);
  if (database.durable !== true || !['sqlite', 'postgres'].includes(dialect)) throw new MetadataError('DISPATCH_CONFIG_INVALID', 503);
  if (maintenance !== 'frozen') throw new MetadataError('WORKSPACE_MAINTENANCE_REQUIRED', 503);
  await database.transaction(async c => {
    const lock = dialect === 'postgres' ? ' FOR UPDATE' : '';
    if (dialect === 'postgres' && !(await c.query("SELECT pg_try_advisory_xact_lock(hashtext(current_database()), hashtext(current_schema() || ':opensight-h8-reference')) AS acquired"))[0]?.acquired) throw new MetadataError('MIGRATION_BUSY', 503);
    const control = (await c.query(`SELECT * FROM sr_control WHERE deployment = ?${lock}`, [deployment]))[0];
    if (control?.state !== 'maintenance') throw new MetadataError('WORKSPACE_MAINTENANCE_REQUIRED', 503);
    if (!['schema_min', 'schema_max', 'protocol_min', 'protocol_max'].every(k => Number(control[k]) === 1)) throw new MetadataError('MIGRATION_SCHEMA_INCOMPATIBLE', 503);
    const marker = (await c.query('SELECT version, checksum FROM sr_manifest_schema WHERE deployment = ?', [deployment]))[0];
    if (Number(marker?.version) !== 1 || marker?.checksum !== manifestChecksum) throw new MetadataError('MANIFEST_SCHEMA_REQUIRED', 503);
    if ((await c.query("SELECT attempt_id FROM sr_admission WHERE deployment = ? AND state = 'held' AND hold_until > ? LIMIT 1", [deployment, await coordinationNow(c, dialect)])).length) throw new MetadataError('WORKSPACE_DRAIN_REQUIRED', 503);
    const existing = await c.query(dialect === 'postgres'
      ? "SELECT c.relname AS name, CASE WHEN c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) THEN 1 ELSE 0 END AS owned FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relkind IN ('r','p')"
      : "SELECT name, 1 AS owned FROM sqlite_master WHERE type = 'table'");
    const found = existing.filter(r => dispatchTables.includes(String(r.name) as typeof dispatchTables[number]));
    if (found.length) {
      const row = found.length === dispatchTables.length && found.every(r => Number(r.owned) === 1)
        ? (await c.query('SELECT version, checksum FROM sr_dispatch_schema WHERE deployment = ?', [deployment]))[0] : undefined;
      if (Number(row?.version) !== 1 || row?.checksum !== dispatchChecksum) throw new MetadataError('DISPATCH_FOREIGN_SCHEMA', 503);
      return;
    }
    for (const sql of schema) await c.query(sql);
    if (dialect === 'postgres') for (const table of ['sr_dispatch_intent', 'sr_outbox']) {
      await c.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await c.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await c.query(`CREATE POLICY sr_scope ON ${table} USING (tenant_id = current_setting('opensight.tenant_id', true) AND namespace_id = current_setting('opensight.namespace_id', true)) WITH CHECK (tenant_id = current_setting('opensight.tenant_id', true) AND namespace_id = current_setting('opensight.namespace_id', true))`);
    }
    await c.query('INSERT INTO sr_dispatch_schema VALUES (?,1,?)', [deployment, dispatchChecksum]);
  }).catch(coordinationFailure);
}
