import { createHash } from 'node:crypto';
import { MetadataError, type Database, type SqlConnection } from './metadata-db.js';
import { validateBudgets } from './budgets.js';
import { entitlementConfig, type Entitlements } from './hosted-usage.js';

export type CoordinationDialect = 'sqlite' | 'postgres';
export const coordinationTables = ['sr_coordination_schema', 'sr_limits', 'sr_admission', 'sr_claim'] as const;
const schema = [
  `CREATE TABLE sr_coordination_schema (
    deployment TEXT PRIMARY KEY REFERENCES sr_control(deployment), version INTEGER NOT NULL CHECK (version = 1), checksum TEXT NOT NULL)`,
  `CREATE TABLE sr_limits (
    deployment TEXT PRIMARY KEY REFERENCES sr_control(deployment), revision INTEGER NOT NULL CHECK (revision > 0),
    budget_version INTEGER NOT NULL CHECK (budget_version > 0), entitlements TEXT NOT NULL)`,
  `CREATE TABLE sr_admission (
    deployment TEXT NOT NULL REFERENCES sr_control(deployment), attempt_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
    tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, owner_id TEXT NOT NULL,
    class TEXT NOT NULL CHECK (class IN ('query','refresh')), control_epoch BIGINT NOT NULL CHECK (control_epoch > 0),
    limits_revision INTEGER NOT NULL, authorization_revision INTEGER NOT NULL, policy_revision INTEGER NOT NULL, configuration_revision INTEGER NOT NULL,
    working_bytes BIGINT NOT NULL CHECK (working_bytes > 0), rss_bytes BIGINT NOT NULL CHECK (rss_bytes > 0),
    execution_deadline BIGINT NOT NULL, hold_until BIGINT NOT NULL, lease_until BIGINT NOT NULL, next_renew BIGINT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('held','released')), revoked INTEGER NOT NULL CHECK (revoked IN (0,1)),
    PRIMARY KEY (deployment, attempt_id), FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id),
    CHECK (hold_until > execution_deadline AND lease_until <= execution_deadline))`,
  `CREATE INDEX sr_admission_capacity ON sr_admission(deployment, state, hold_until)`,
  `CREATE TABLE sr_claim (
    deployment TEXT NOT NULL REFERENCES sr_control(deployment), tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, owner_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('source','prepared-dataset')), resource_id TEXT NOT NULL,
    fence BIGINT NOT NULL CHECK (fence > 0), generation BIGINT NOT NULL CHECK (generation > 0),
    resource_version INTEGER NOT NULL CHECK (resource_version > 0), attempt_id TEXT,
    PRIMARY KEY (deployment, tenant_id, namespace_id, owner_id, kind, resource_id),
    FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id),
    FOREIGN KEY (deployment, attempt_id) REFERENCES sr_admission(deployment, attempt_id))`,
];
export const coordinationChecksum = createHash('sha256').update(schema.join('\n')).digest('hex');
export function coordinationDeployment(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new MetadataError('COORDINATION_CONFIG_INVALID', 503);
  return value;
}
export async function coordinationNow(c: SqlConnection, dialect: CoordinationDialect): Promise<number> {
  const row = (await c.query(dialect === 'postgres'
    ? 'SELECT CAST(EXTRACT(EPOCH FROM clock_timestamp()) * 1000 AS BIGINT) AS now_ms'
    : "SELECT CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) AS now_ms"))[0];
  const now = Number(row?.now_ms);
  if (!Number.isSafeInteger(now) || now <= 0) throw new MetadataError('COORDINATION_UNAVAILABLE', 503);
  return now;
}
export function coordinationFailure(error: unknown): never {
  if (error instanceof MetadataError) throw error;
  throw new MetadataError('COORDINATION_UNAVAILABLE', 503);
}

/** Explicit schema-only checkpoint. Neither runtime composition nor bootstrap calls it. */
export async function migrateCoordination(database: Database, deployment: string, entitlements: Entitlements,
  maintenance: string | undefined, dialect: CoordinationDialect = 'postgres'): Promise<void> {
  coordinationDeployment(deployment);
  if (database.durable !== true || !['sqlite', 'postgres'].includes(dialect)) throw new MetadataError('COORDINATION_CONFIG_INVALID', 503);
  if (maintenance !== 'frozen') throw new MetadataError('WORKSPACE_MAINTENANCE_REQUIRED', 503);
  const limits = entitlementConfig(JSON.stringify(entitlements)), serialized = JSON.stringify(limits);
  await database.transaction(async c => {
    const lock = dialect === 'postgres' ? ' FOR UPDATE' : '';
    if (dialect === 'postgres' && !(await c.query("SELECT pg_try_advisory_xact_lock(hashtext(current_database()), hashtext(current_schema() || ':opensight-h8-reference')) AS acquired"))[0]?.acquired) throw new MetadataError('MIGRATION_BUSY', 503);
    const control = (await c.query(`SELECT * FROM sr_control WHERE deployment = ?${lock}`, [deployment]))[0];
    if (control?.state !== 'maintenance') throw new MetadataError('WORKSPACE_MAINTENANCE_REQUIRED', 503);
    if (!['schema_min', 'schema_max', 'protocol_min', 'protocol_max'].every(k => Number(control[k]) === 1)
      || Number((await c.query('SELECT version FROM h8_schema WHERE id = 1'))[0]?.version) !== 1) throw new MetadataError('MIGRATION_SCHEMA_INCOMPATIBLE', 503);
    const budgets = (await c.query(`SELECT version, body FROM h4_budget_config WHERE id = 1${lock}`))[0];
    if (!budgets || !Number.isSafeInteger(Number(budgets.version)) || Number(budgets.version) < 1) throw new MetadataError('BUDGET_MIGRATION_REQUIRED', 503);
    validateBudgets(JSON.parse(String(budgets.body)));
    const tenants = await c.query('SELECT tenant_id FROM h1_tenants');
    if (Object.keys(limits.tenants).some(id => !tenants.some(t => t.tenant_id === id))) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
    const existing = await c.query(dialect === 'postgres'
      ? "SELECT c.relname AS name, CASE WHEN c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) THEN 1 ELSE 0 END AS owned FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relkind IN ('r','p')"
      : "SELECT name, 1 AS owned FROM sqlite_master WHERE type = 'table'");
    const found = existing.filter(r => coordinationTables.includes(String(r.name) as typeof coordinationTables[number]));
    if (found.length) {
      if (found.length !== coordinationTables.length || found.some(r => Number(r.owned) !== 1)) throw new MetadataError('COORDINATION_FOREIGN_SCHEMA', 503);
      const marker = (await c.query('SELECT version, checksum FROM sr_coordination_schema WHERE deployment = ?', [deployment]))[0];
      const configured = (await c.query('SELECT revision, budget_version, entitlements FROM sr_limits WHERE deployment = ?', [deployment]))[0];
      if (Number(marker?.version) !== 1 || marker?.checksum !== coordinationChecksum) throw new MetadataError('COORDINATION_FOREIGN_SCHEMA', 503);
      if (Number(configured?.revision) !== 1 || Number(configured?.budget_version) !== Number(budgets.version) || configured?.entitlements !== serialized) throw new MetadataError('COORDINATION_CONFIG_CHANGED', 503);
      return;
    }
    for (const sql of schema) await c.query(sql);
    if (dialect === 'postgres') for (const table of ['sr_admission', 'sr_claim']) {
      await c.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await c.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await c.query(`CREATE POLICY sr_scope ON ${table} USING (tenant_id = current_setting('opensight.tenant_id', true) AND namespace_id = current_setting('opensight.namespace_id', true)) WITH CHECK (tenant_id = current_setting('opensight.tenant_id', true) AND namespace_id = current_setting('opensight.namespace_id', true))`);
    }
    await c.query('INSERT INTO sr_coordination_schema VALUES (?,1,?)', [deployment, coordinationChecksum]);
    await c.query('INSERT INTO sr_limits VALUES (?,1,?,?)', [deployment, Number(budgets.version), serialized]);
  }).catch(coordinationFailure);
}
