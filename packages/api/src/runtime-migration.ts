import { MetadataError, type Database } from './metadata-db.js';
import { initializeMetadata } from './metadata-schema.js';
import { initializeAuth } from './auth-schema.js';
import { initializeEmbedding } from './embedding-config.js';
import { initializeEmbedSessions } from './embed-sessions.js';
import { initializeUsage, appendOperatorAudit } from './hosted-usage.js';
import { budgetEnvironment, migrateBudgets } from './budget-store.js';
import { deploymentId, runtimeProtocol } from './runtime-startup.js';

/** SR1 bootstrap only. Never reopens the gate or substitutes for SR2/SR4 drain. */
export async function migrateRuntime(db: Database, env: NodeJS.ProcessEnv, dialect: 'postgres' | 'sqlite' = 'postgres'): Promise<void> {
  if (env.OPENSIGHT_MAINTENANCE !== 'frozen') throw new MetadataError('WORKSPACE_MAINTENANCE_REQUIRED', 503);
  const deployment = deploymentId(env), budgets = budgetEnvironment(env);
  await db.transaction(async c => {
    if (dialect === 'postgres') {
      // Operation-scoped exclusion also refuses a live H8 node. No H8 launcher
      // or process-lifetime lock is constructed by an invocation.
      const lock = (await c.query("SELECT pg_try_advisory_xact_lock(hashtext(current_database()), hashtext(current_schema() || ':opensight-h8-reference')) AS acquired"))[0];
      if (!lock?.acquired) throw new MetadataError('MIGRATION_BUSY', 503);
      if ((await c.query("SELECT to_regclass('sr_admission') AS admission"))[0]?.admission) throw new MetadataError('SERVERLESS_MIGRATION_GATE_REQUIRED', 503);
    }
    await c.query(`CREATE TABLE IF NOT EXISTS sr_control (
      deployment TEXT PRIMARY KEY, epoch BIGINT NOT NULL CHECK (epoch > 0),
      schema_min INTEGER NOT NULL, schema_max INTEGER NOT NULL, protocol_min INTEGER NOT NULL, protocol_max INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('open','draining','maintenance')))`);
    await c.query("INSERT INTO sr_control VALUES (?,1,?,?,?,?, 'maintenance') ON CONFLICT (deployment) DO NOTHING", [deployment, runtimeProtocol, runtimeProtocol, runtimeProtocol, runtimeProtocol]);
    const row = (await c.query(`SELECT state, epoch, schema_min, schema_max, protocol_min, protocol_max FROM sr_control WHERE deployment = ?${dialect === 'postgres' ? ' FOR UPDATE' : ''}`, [deployment]))[0];
    if (row?.state !== 'maintenance') throw new MetadataError('WORKSPACE_MAINTENANCE_REQUIRED', 503);
    if (!['schema_min', 'schema_max', 'protocol_min', 'protocol_max'].every(k => Number(row[k]) === runtimeProtocol)) throw new MetadataError('MIGRATION_SCHEMA_INCOMPATIBLE', 503);
    // All initializers share this transaction: an exception rolls back the
    // schema and audit together, rather than leaving half-applied migrations.
    const transaction: Database = { durable: true, transaction: work => work(c), close: async () => {} };
    await initializeMetadata(transaction, dialect); await initializeAuth(transaction);
    await initializeEmbedding(transaction); await initializeEmbedSessions(transaction);
    await migrateBudgets(transaction, budgets, 'frozen'); await initializeUsage(transaction);
    await appendOperatorAudit(c, 'runtime.migrated');
    await c.query('UPDATE sr_control SET schema_min = ?, schema_max = ?, protocol_min = ?, protocol_max = ? WHERE deployment = ?', [runtimeProtocol, runtimeProtocol, runtimeProtocol, runtimeProtocol, deployment]);
  });
}
