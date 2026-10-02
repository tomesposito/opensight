import { migrateReference } from './reference-schema.js';
import { assertEncryptionKey } from './hosted-key-rotation.js';
import { Pool, escapeIdentifier, type PoolClient } from 'pg';
import { MetadataError, PostgresMetadataDatabase } from './metadata-db.js';
import { metadataTables } from './metadata-schema.js';
import { budgetEnvironment } from './budget-store.js';

export function referenceEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.OPENSIGHT_MODE !== 'hosted' || env.OPENSIGHT_WORKER_ROLE !== 'api-query-scheduler'
    || !env.OPENSIGHT_METADATA_URL || !env.OPENSIGHT_TENANT_METADATA_URL
    || env.OPENSIGHT_METADATA_URL === env.OPENSIGHT_TENANT_METADATA_URL) throw new MetadataError('REFERENCE_CONFIG_INVALID', 503);
  for (const name of ['OPENSIGHT_METADATA_URL', 'OPENSIGHT_TENANT_METADATA_URL']) {
    try { if (!['postgres:', 'postgresql:'].includes(new URL(env[name]!).protocol)) throw new Error(); }
    catch { throw new MetadataError('REFERENCE_CONFIG_INVALID', 503); }
  }
}
/** Session lock prevents a second reference node or maintenance writer. This is
 * single-host exclusion, not distributed publication fencing or an HA lease. */
export async function referenceDatabase(env: NodeJS.ProcessEnv, lost: () => void) {
  referenceEnvironment(env);
  const options = { max: 8, connectionTimeoutMillis: 3000, statement_timeout: 10000, idle_in_transaction_session_timeout: 15000 };
  const owner = new Pool({ ...options, connectionString: env.OPENSIGHT_METADATA_URL });
  const tenant = new Pool({ ...options, connectionString: env.OPENSIGHT_TENANT_METADATA_URL });
  owner.on('error', lost); tenant.on('error', lost);
  let lock: PoolClient | undefined;
  let closed = false;
  try {
    lock = await owner.connect(); lock.on('error', lost);
    const result = await lock.query('SELECT pg_try_advisory_lock(8037, 1) AS held');
    if (result.rows[0]?.held !== true) throw new MetadataError('REFERENCE_ALREADY_RUNNING', 503);
    const membershipDatabase = new PostgresMetadataDatabase(owner), tenantDatabase = new PostgresMetadataDatabase(tenant, true);
    return { membershipDatabase, tenantDatabase,
      async probe() { await lock!.query('SELECT 1'); },
      async close() { if (closed) return; closed = true; lock?.release(true); lock = undefined; await Promise.all([owner.end(), tenant.end()]); },
      async initialize() {
        if (env.OPENSIGHT_MAINTENANCE !== 'frozen') throw new MetadataError('REFERENCE_MAINTENANCE_REQUIRED', 503);
        await migrateReference(membershipDatabase, 'postgres', budgetEnvironment(env));
        await assertEncryptionKey(membershipDatabase, env.OPENSIGHT_AUTH_ENCRYPTION_KEY!);
        const role = String((await tenant.query('SELECT current_user AS role')).rows[0]?.role);
        for (const table of metadataTables.filter(t => t !== 'migrations')) {
          await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON h1_${table} TO ${escapeIdentifier(role)}`);
        }
        await tenantDatabase.transaction(async c => { await c.query('SELECT tenant_id FROM h1_tenants WHERE 1 = 0'); }, { tenantId: 'health', namespaceId: 'health' });
      },
    };
  } catch (error) { lock?.release(true); await Promise.all([owner.end(), tenant.end()]); throw error; }
}
