import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';
import { MetadataError, type SqlConnection } from './metadata-db.js';
import { identifier } from './metadata-resources.js';
import { describeStorage } from './storage-breakdown.js';

export interface StorageScope { deployment: string; tenantId: string; namespaceId: string }
export function storageScope(input: StorageScope): StorageScope {
  return { deployment: identifier(input.deployment), tenantId: identifier(input.tenantId), namespaceId: identifier(input.namespaceId) };
}
export async function inspectStorage(c: SqlConnection, raw: StorageScope) {
  const input = storageScope(raw);
  let queries = 0;
  const bounded: SqlConnection = { query: async (sql, values) => {
    if (++queries > 2048) throw new MetadataError('STORAGE_INSPECT_LIMIT', 503);
    const rows = await c.query(sql, values);
    if (rows.length > 1024) throw new MetadataError('STORAGE_INSPECT_LIMIT', 503);
    return rows;
  } };
  const result = await describeStorage(bounded, input);
  const cleanupEvents = await bounded.query(`SELECT event_id, aggregate_id, kind, state, due_at, expires_at, control_epoch
    FROM sr_outbox WHERE deployment = ? AND tenant_id = ? AND namespace_id = ? AND kind IN ('object-cleanup','artifact-cleanup')
    ORDER BY due_at LIMIT 513`, [input.deployment, input.tenantId, input.namespaceId]);
  if (cleanupEvents.length > 512) throw new MetadataError('STORAGE_INSPECT_LIMIT', 503);
  const objects = await bounded.query(`SELECT object_id, object_key, object_version, state FROM sr_object
    WHERE deployment = ? AND tenant_id = ? AND namespace_id = ? ORDER BY created_at LIMIT 257`, [input.deployment, input.tenantId, input.namespaceId]);
  if (objects.length > 256) throw new MetadataError('STORAGE_INSPECT_LIMIT', 503);
  const all = [...result.pendingCleanup, ...result.protectedObjects];
  const ledgerReservedBytes = all.reduce((n, o) => n + (o.bytes === undefined ? o.capacityBytes : 0), 0);
  const ledgerLiveBytes = all.reduce((n, o) => n + (o.bytes ?? 0), 0);
  const report = { ...result, objects, cleanupEvents, ledgerReservedBytes, ledgerLiveBytes,
    gaugeMatchesLedger: ledgerReservedBytes === result.reservedBytes && ledgerLiveBytes === result.liveBytes };
  if (Buffer.byteLength(JSON.stringify(report)) > 256 * 1024) throw new MetadataError('STORAGE_INSPECT_LIMIT', 503);
  return report;
}

/** A single repeatable-read transaction. No RESET ALL, migrations, or write-capable callback. */
export async function inspectPostgres(connectionString: string, ca: string, scope: StorageScope) {
  storageScope(scope);
  let url: URL;
  try { url = new URL(connectionString); } catch { throw new MetadataError('STORAGE_INSPECT_CONFIG_INVALID', 503); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash || !url.username
    || !ca.includes('-----BEGIN CERTIFICATE-----') || Buffer.byteLength(ca) > 256 * 1024) throw new MetadataError('STORAGE_INSPECT_CONFIG_INVALID', 503);
  const pool = new Pool({ connectionString, ssl: { ca, rejectUnauthorized: true }, max: 1,
    connectionTimeoutMillis: 20000, statement_timeout: 3000, query_timeout: 4000, lock_timeout: 500,
    idle_in_transaction_session_timeout: 5000, options: '-c default_transaction_read_only=on', application_name: 'opensight-storage-inspect' });
  pool.on('error', () => { /* Queries fail closed; finally disposes the pool. No credential-bearing logs. */ });
  try {
    const client = await pool.connect();
    const deadline = setTimeout(() => { void client.end().catch(() => {}); }, 25000);
    deadline.unref();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SELECT set_config('opensight.tenant_id', $1, true), set_config('opensight.namespace_id', $2, true)", [scope.tenantId, scope.namespaceId]);
      const readOnly = await client.query('SHOW transaction_read_only');
      if (readOnly.rows[0]?.transaction_read_only !== 'on') throw new MetadataError('STORAGE_INSPECT_READ_ONLY_REQUIRED', 503);
      const result = await inspectStorage({ query: async (sql, values = []) => {
        let position = 0;
        return (await client.query(sql.replace(/\?/g, () => `$${++position}`), [...values])).rows;
      } }, scope);
      await client.query('ROLLBACK');
      return result;
    } finally { clearTimeout(deadline); client.release(true); }
  } finally { await pool.end(); }
}

export async function inspectSqlite(path: string, scope: StorageScope) {
  storageScope(scope);
  if (!path || path === ':memory:' || path.startsWith('file:')) throw new MetadataError('STORAGE_INSPECT_CONFIG_INVALID', 503);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('PRAGMA query_only = ON; BEGIN');
    return await inspectStorage({ query: async (sql, values = []) => db.prepare(sql).all(...values) as Awaited<ReturnType<SqlConnection['query']>> }, scope);
  } finally { db.close(); }
}
