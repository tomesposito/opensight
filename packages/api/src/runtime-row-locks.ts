import { MetadataError, type SqlConnection } from './metadata-db.js';

const tables = ['sr_control', 'sr_limits', 'h4_budget_config'] as const;
function roles(env: NodeJS.ProcessEnv): [string, string] {
  const operator = env.OPENSIGHT_RUNTIME_OPERATOR_ROLE, tenant = env.OPENSIGHT_RUNTIME_TENANT_ROLE;
  if (!operator || !tenant || operator === tenant || ![operator, tenant].every(r => /^[a-z][a-z0-9_]{0,62}$/.test(r))) throw new MetadataError('RUNTIME_ROLE_INVALID', 503);
  return [operator, tenant];
}
const fail = (): never => { throw new MetadataError('RUNTIME_LOCK_SCHEMA_INVALID', 503); };
async function column(c: SqlConnection, table: string): Promise<boolean> {
  const rows = await c.query(`SELECT a.attnotnull, a.attidentity, a.attgenerated, format_type(a.atttypid,a.atttypmod) AS type,
    pg_get_expr(d.adbin,d.adrelid) AS default_value, t.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) AS owned
    FROM pg_attribute a JOIN pg_class t ON t.oid = a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = ?::regclass AND a.attname = 'runtime_lock' AND NOT a.attisdropped`, [table]);
  if (!rows.length) return false;
  const row = rows[0];
  if (rows.length !== 1 || !row?.owned || !row.attnotnull || row.attidentity !== '' || row.attgenerated !== '' || row.type !== 'integer' || row.default_value !== '0') fail();
  const checks = await c.query(`SELECT convalidated, connoinherit, pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid = ?::regclass AND conname = ? AND contype = 'c'`, [table, `${table}_runtime_lock_zero`]);
  if (checks.length !== 1 || !checks[0]?.convalidated || checks[0].connoinherit || checks[0].definition !== 'CHECK ((runtime_lock = 0))') fail();
  return true;
}
/** A constant column permits PostgreSQL row locks without writable application configuration. */
export async function verifyRuntimeLocks(c: SqlConnection, env: NodeJS.ProcessEnv): Promise<void> {
  const [operator, tenant] = roles(env);
  for (const table of tables) {
    if (!await column(c, table)) fail();
    for (const role of [operator, tenant]) {
      const broad = (await c.query("SELECT has_table_privilege(?, ?::regclass, 'UPDATE,INSERT,DELETE,TRUNCATE') AS writable", [role, table]))[0];
      if (broad?.writable) fail();
      const columns = await c.query(`SELECT attname, has_column_privilege(?, attrelid, attnum, 'UPDATE') AS writable,
        has_column_privilege(?, attrelid, attnum, 'INSERT') AS insertable FROM pg_attribute WHERE attrelid = ?::regclass AND attnum > 0 AND NOT attisdropped`, [role, role, table]);
      if (columns.some(a => a.insertable || Boolean(a.writable) !== (role === operator && a.attname === 'runtime_lock'))) fail();
    }
  }
}
/** Caller owns the schema and transaction, and has validated the two deployment roles. */
export async function installRuntimeLocks(c: SqlConnection, env: NodeJS.ProcessEnv): Promise<void> {
  const [operator, tenant] = roles(env);
  for (const table of tables) {
    if (!await column(c, table)) await c.query(`ALTER TABLE ${table} ADD COLUMN runtime_lock INTEGER NOT NULL DEFAULT 0 CONSTRAINT ${table}_runtime_lock_zero CHECK (runtime_lock = 0)`);
    await c.query(`REVOKE ALL (runtime_lock) ON ${table} FROM "${operator}", "${tenant}"`);
    await c.query(`GRANT UPDATE (runtime_lock) ON ${table} TO "${operator}"`);
  }
  await verifyRuntimeLocks(c, env);
}
