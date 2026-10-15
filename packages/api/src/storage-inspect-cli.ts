import { DatabaseSync } from 'node:sqlite';
import { MetadataError, type SqlConnection, type SqlRow, type SqlValue } from './metadata-db.js';
import { describeStorage } from './storage-breakdown.js';

/** Read-only operator diagnostic: inspect a namespace's retained object reservations, pending cleanup
 * and overdue reclamation obligations. Prints the usage breakdown as JSON on stdout.
 * Usage: node dist/storage-inspect-cli.js --tenant <id> --namespace <id> [--deployment <name>]
 * Database from OPENSIGHT_METADATA_DATABASE (sqlite file, opened read-only) or
 * OPENSIGHT_METADATA_POSTGRES (postgres connection string, read-only transaction guard). */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || i + 1 >= process.argv.length ? undefined : process.argv[i + 1];
}
function asValues(values: readonly SqlValue[]): unknown[] { return values as unknown[]; }
async function main(): Promise<void> {
  const tenantId = arg('tenant'), namespaceId = arg('namespace'), deployment = arg('deployment') ?? 'default';
  if (!tenantId || !namespaceId) throw new MetadataError('STORAGE_INSPECT_USAGE', 400);
  const sqlitePath = process.env.OPENSIGHT_METADATA_DATABASE, postgresUrl = process.env.OPENSIGHT_METADATA_POSTGRES;
  let close: () => Promise<void>;
  let connection: SqlConnection;
  if (sqlitePath && sqlitePath !== ':memory:' && !sqlitePath.includes('mode=memory')) {
    // Read-only URI: any write attempt fails with "attempt to write a readonly database".
    const db = new DatabaseSync(`file:${sqlitePath}?mode=ro`);
    let closed = false;
    connection = { query: async (sql, values = []) => { if (closed) throw new MetadataError('METADATA_TRANSACTION_CLOSED'); return db.prepare(sql).all(...values) as SqlRow[]; } };
    close = async () => { closed = true; db.close(); };
  } else if (postgresUrl) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: postgresUrl, max: 1, connectionTimeoutMillis: 10000,
      options: '-c default_transaction_read_only=on', application_name: 'opensight-storage-inspect' });
    const client = await pool.connect();
    try { await client.query('SELECT 1'); } finally { client.release(); }
    connection = { query: async (sql, values = []) => (await pool.query(sql, asValues(values))).rows as SqlRow[] };
    close = async () => { await pool.end(); };
  } else throw new MetadataError('STORAGE_INSPECT_CONFIG_INVALID', 503);
  try {
    const breakdown = await describeStorage(connection, { deployment, tenantId, namespaceId });
    console.log(JSON.stringify(breakdown, null, 2));
  } finally { await close(); }
}
main().then(() => { process.exitCode = 0; }, (error: unknown) => {
  console.error(error instanceof MetadataError ? error.code : 'STORAGE_INSPECTION_FAILED');
  process.exitCode = 1;
});
