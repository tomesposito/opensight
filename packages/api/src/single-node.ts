import { Pool, type PoolClient } from 'pg';
import { MetadataError, PostgresMetadataDatabase, type Database } from './metadata-db.js';
import { initializeMetadata, metadataTables } from './metadata-schema.js';
import { initializeAuth } from './auth-schema.js';
import { initializeEmbedding } from './embedding-config.js';
import { initializeEmbedSessions } from './embed-sessions.js';
import { initializeUsage, appendOperatorAudit } from './hosted-usage.js';
import { budgetEnvironment, migrateBudgets } from './budget-store.js';
import { referenceConfig, type ReferenceConfig } from './single-node-config.js';
import { hostedReadiness } from './hosted-health.js';

export async function migrateReference(db: Database, env: NodeJS.ProcessEnv, dialect: 'postgres' | 'sqlite' = 'postgres'): Promise<void> {
  if (env.OPENSIGHT_MAINTENANCE !== 'frozen') throw new MetadataError('REFERENCE_MAINTENANCE_REQUIRED', 503);
  referenceConfig(env);
  await initializeMetadata(db, dialect); await initializeAuth(db); await initializeEmbedding(db); await initializeEmbedSessions(db);
  await migrateBudgets(db, budgetEnvironment(env), 'frozen'); await initializeUsage(db);
  await db.transaction(c => appendOperatorAudit(c, 'reference.migrated'));
}
/** Shared lifetime lock prevents a second scheduler, maintenance while serving,
 * and backup/restore/deletion overlap. Connection loss terminates the launcher. */
export class ReferencePostgres {
  readonly operatorPool: Pool; readonly tenantPool: Pool;
  readonly operator: Database; readonly tenant: Database;
  private client?: PoolClient;
  readonly config: ReferenceConfig;
  constructor(readonly env: NodeJS.ProcessEnv) {
    const config = referenceConfig(env);
    if (!config || !env.OPENSIGHT_POSTGRES_OPERATOR_URL || !env.OPENSIGHT_POSTGRES_TENANT_URL || env.OPENSIGHT_POSTGRES_OPERATOR_URL === env.OPENSIGHT_POSTGRES_TENANT_URL) throw new MetadataError('REFERENCE_CONFIG_INVALID', 503);
    try {
      const operator = new URL(env.OPENSIGHT_POSTGRES_OPERATOR_URL), tenant = new URL(env.OPENSIGHT_POSTGRES_TENANT_URL);
      if (!['postgres:', 'postgresql:'].includes(operator.protocol) || !['postgres:', 'postgresql:'].includes(tenant.protocol)
        || operator.host !== tenant.host || operator.pathname !== tenant.pathname || operator.search !== tenant.search) throw Error();
    } catch { throw new MetadataError('REFERENCE_CONFIG_INVALID', 503); }
    this.config = config;
    this.operatorPool = new Pool({ connectionString: env.OPENSIGHT_POSTGRES_OPERATOR_URL, max: 6, connectionTimeoutMillis: 5000, statement_timeout: 15000, application_name: 'opensight-reference-operator' });
    this.tenantPool = new Pool({ connectionString: env.OPENSIGHT_POSTGRES_TENANT_URL, max: 6, connectionTimeoutMillis: 5000, statement_timeout: 15000, application_name: 'opensight-reference-tenant' });
    this.operator = new PostgresMetadataDatabase(this.operatorPool); this.tenant = new PostgresMetadataDatabase(this.tenantPool, true);
  }
  async lock(onLost: () => void): Promise<void> {
    this.operatorPool.on('error', onLost); this.tenantPool.on('error', onLost);
    this.client = await this.operatorPool.connect(); this.client.on('error', onLost);
    const result = await this.client.query("SELECT pg_try_advisory_lock(hashtext(current_database()), hashtext(current_schema() || ':opensight-h8-reference')) AS acquired");
    if (result.rows[0]?.acquired !== true) throw new MetadataError('REFERENCE_ALREADY_RUNNING', 503);
  }
  async grantTenant(): Promise<void> {
    const identity = await this.tenantPool.query('SELECT current_user AS name, current_schema() AS schema');
    const role = String(identity.rows[0]?.name);
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new MetadataError('REFERENCE_TENANT_ROLE_INVALID', 503);
    const schema = String(identity.rows[0]?.schema);
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new MetadataError('REFERENCE_TENANT_ROLE_INVALID', 503);
    // Operator has to create the restricted login separately; no password appears in SQL here.
    await this.operatorPool.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
    for (const table of metadataTables.filter(t => t !== 'migrations')) {
      await this.operatorPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON h1_${table} TO "${role}"`);
    }
    await this.operatorPool.query(`REVOKE UPDATE, DELETE ON h1_outbox FROM "${role}"`);
    await hostedReadiness(this.operator, this.tenant);
  }
  async close(): Promise<void> {
    if (this.client) {
      try { await this.client.query("SELECT pg_advisory_unlock(hashtext(current_database()), hashtext(current_schema() || ':opensight-h8-reference'))"); } catch { /* A lost connection already released its session lock. */ } finally { this.client.release(); this.client = undefined; }
    }
    await Promise.all([this.operatorPool.end(), this.tenantPool.end()]);
  }
}
