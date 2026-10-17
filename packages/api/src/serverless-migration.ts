import { MetadataError, type Database, type SqlConnection } from './metadata-db.js';
import { migrateRuntime } from './runtime-migration.js';
import { deploymentId } from './runtime-startup.js';
import { budgetEnvironment } from './budget-store.js';
import { entitlementConfig } from './hosted-usage.js';
import { appendOperatorAudit } from './operator-audit.js';
import { migrateCoordination, coordinationTables, coordinationNow, type CoordinationDialect } from './coordination-schema.js';
import { migrateManifests, manifestTables } from './manifest-schema.js';
import { migrateDispatch, dispatchTables } from './dispatch-schema.js';
import { migrateObjects, objectTables } from './object-schema.js';
import { migrateOperations, operationTables } from './operation-schema.js';
import { installRuntimeLocks } from './runtime-row-locks.js';
import { migrateExecutions, executionTables } from './execution-schema.js';

const baseTables = ['sr_control', 'h1_tenants', 'h1_namespaces', 'h1_revisions', 'h1_resources', 'h1_links', 'h1_operations', 'h1_outbox', 'h1_migrations',
  'h2_control', 'h2_identities', 'h2_memberships', 'h2_invitations', 'h2_keys', 'h2_sessions', 'h2_attempts', 'h2_onboarding', 'h2_requests',
  'h4_budget_config', 'h5_embedding_config', 'h6_keys', 'h6_sessions', 'h7_jobs', 'h7_occurrences', 'h7_deliveries', 'h7_migrations',
  'h8_usage', 'h8_usage_events', 'h8_audit', 'h8_recovery', 'h8_schema'];
const durableTables = [...coordinationTables, ...manifestTables, ...dispatchTables, ...objectTables, ...operationTables, ...executionTables];
export const serverlessTables = [...baseTables, ...durableTables];
export async function grantServerlessRuntime(c: SqlConnection, env: NodeJS.ProcessEnv): Promise<void> {
  const schema = String((await c.query('SELECT current_schema() AS schema'))[0]?.schema);
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new MetadataError('RUNTIME_SCHEMA_INVALID', 503);
  const roles = { operator: env.OPENSIGHT_RUNTIME_OPERATOR_ROLE, tenant: env.OPENSIGHT_RUNTIME_TENANT_ROLE };
  if (!roles.operator || !roles.tenant || roles.operator === roles.tenant || !Object.values(roles).every(r => /^[a-z][a-z0-9_]{0,62}$/.test(r!))) throw new MetadataError('RUNTIME_ROLE_INVALID', 503);
  for (const [kind, name] of Object.entries(roles)) {
    const row = (await c.query("SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit, shobj_description(oid, 'pg_authid') AS marker FROM pg_roles WHERE rolname = ?", [name!]))[0];
    if (!row || !row.rolcanlogin || row.rolsuper || row.rolcreatedb || row.rolcreaterole || row.rolreplication || row.rolinherit || Boolean(row.rolbypassrls) !== (kind === 'operator')
      || row.marker !== `opensight:${deploymentId(env)}:${kind}` || (await c.query('SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = ?', [name!])).length
      || (await c.query('SELECT 1 FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = ?) AND relnamespace = current_schema()::regnamespace', [name!])).length) throw new MetadataError('RUNTIME_ROLE_UNSAFE', 503);
    await c.query(`REVOKE CREATE ON SCHEMA "${schema}" FROM "${name}"`);
    await c.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${name}"`);
    await c.query(`REVOKE ALL ON ${[...baseTables, ...durableTables].join(', ')} FROM "${name}"`);
  }
  await c.query(`REVOKE CREATE ON SCHEMA "${schema}" FROM PUBLIC`);
  const readOnly = ['sr_control', 'sr_limits', 'h4_budget_config', 'h8_schema', 'h1_migrations', 'h7_migrations', ...durableTables.filter(t => t.endsWith('_schema'))];
  const writable = [...baseTables, ...durableTables].filter(t => !readOnly.includes(t));
  await c.query(`GRANT SELECT ON ${readOnly.join(', ')} TO "${roles.operator}"`);
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${writable.join(', ')} TO "${roles.operator}"`);
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON h1_tenants, h1_namespaces, h1_revisions, h1_resources, h1_links, h1_operations, h1_outbox TO "${roles.tenant}"`);
  await c.query(`GRANT SELECT ON sr_control, sr_storage_usage TO "${roles.tenant}"`);
  await installRuntimeLocks(c, env);
}
/** Schema owner only, one frozen/drained transaction, with no runtime bootstrap or reopening. */
export async function migrateServerless(database: Database, env: NodeJS.ProcessEnv, dialect: CoordinationDialect = 'postgres'): Promise<void> {
  if (env.OPENSIGHT_MAINTENANCE !== 'frozen') throw new MetadataError('WORKSPACE_MAINTENANCE_REQUIRED', 503);
  const deployment = deploymentId(env), budgets = budgetEnvironment(env), entitlements = entitlementConfig(env.OPENSIGHT_ENTITLEMENTS);
  await database.transaction(async c => {
    if (dialect === 'postgres' && !(await c.query("SELECT pg_try_advisory_xact_lock(hashtext(current_database()), hashtext(current_schema() || ':opensight-h8-reference')) AS acquired"))[0]?.acquired) throw new MetadataError('MIGRATION_BUSY', 503);
    const tables = await c.query(dialect === 'postgres'
      ? "SELECT c.relname AS name, CASE WHEN c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) THEN 1 ELSE 0 END AS owned FROM pg_class c WHERE c.relnamespace = current_schema()::regnamespace AND c.relkind IN ('r','p')"
      : "SELECT name, 1 AS owned FROM sqlite_master WHERE type = 'table'");
    const nested: Database = { durable: true, transaction: work => work(c), close: async () => {} };
    if (!tables.some(r => r.name === 'sr_control')) {
      if (tables.length) throw new MetadataError('MIGRATION_FOREIGN_DATABASE', 503);
      await migrateRuntime(nested, env, dialect);
    } else {
      if (baseTables.some(name => !tables.some(row => row.name === name && Number(row.owned) === 1))) throw new MetadataError('MIGRATION_FOREIGN_DATABASE', 503);
      const control = (await c.query(`SELECT * FROM sr_control WHERE deployment = ?${dialect === 'postgres' ? ' FOR UPDATE' : ''}`, [deployment]))[0];
      if (control?.state !== 'maintenance') throw new MetadataError('WORKSPACE_MAINTENANCE_REQUIRED', 503);
      if (!['schema_min', 'schema_max', 'protocol_min', 'protocol_max'].every(k => Number(control[k]) === 1)
        || Number((await c.query('SELECT version FROM h8_schema WHERE id = 1'))[0]?.version) !== 1) throw new MetadataError('MIGRATION_SCHEMA_INCOMPATIBLE', 503);
      const saved = (await c.query('SELECT body FROM h4_budget_config WHERE id = 1'))[0];
      if (!saved || JSON.stringify(JSON.parse(String(saved.body))) !== JSON.stringify(budgets)) throw new MetadataError('COORDINATION_CONFIG_CHANGED', 503);
    }
    if (tables.some(r => r.name === 'sr_admission') && (await c.query("SELECT attempt_id FROM sr_admission WHERE deployment = ? AND state = 'held' AND hold_until > ? LIMIT 1", [deployment, await coordinationNow(c, dialect)])).length) throw new MetadataError('WORKSPACE_DRAIN_REQUIRED', 503);
    await migrateCoordination(nested, deployment, entitlements, 'frozen', dialect);
    await migrateManifests(nested, deployment, 'frozen', dialect);
    await migrateDispatch(nested, deployment, 'frozen', dialect);
    await migrateObjects(nested, deployment, 'frozen', dialect);
    await migrateOperations(nested, deployment, 'frozen', dialect);
    await migrateExecutions(nested, deployment, 'frozen', dialect);
    if (dialect === 'postgres') await grantServerlessRuntime(c, env);
    await appendOperatorAudit(c, { action: 'serverless.migrated' });
  });
}
