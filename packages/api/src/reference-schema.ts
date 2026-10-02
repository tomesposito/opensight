import { MetadataError, type Database } from './metadata-db.js';
import { initializeMetadata } from './metadata-schema.js';
import { initializeAuth } from './auth-schema.js';
import { initializeEmbedding } from './embedding-config.js';
import { initializeEmbedSessions } from './embed-sessions.js';
import { initializeObservability } from './hosted-observability.js';
import { migrateBudgets } from './budget-store.js';
import type { BudgetConfig } from './budgets.js';

export const referenceSchemaVersion = 1;
export async function initializeRecovery(db: Database): Promise<void> {
  await db.transaction(c => c.query('CREATE TABLE IF NOT EXISTS h8_restore_holds (tenant_id TEXT PRIMARY KEY, restored_at TEXT NOT NULL, backup_id TEXT NOT NULL)'));
}
/** Frozen, staged DDL: no partial schema is visible and interrupted attempts roll back. */
export async function migrateReference(db: Database, dialect: 'sqlite' | 'postgres', budgets: BudgetConfig, checkpoint: () => Promise<void> = async () => {}): Promise<void> {
  await db.transaction(async c => {
    const transaction: Database = { durable: true, transaction: work => work(c), close: async () => {} };
    await c.query("CREATE TABLE IF NOT EXISTS h8_schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, state TEXT NOT NULL)");
    const prior = (await c.query('SELECT * FROM h8_schema WHERE id = 1'))[0];
    if (prior && Number(prior.version) !== referenceSchemaVersion) throw new MetadataError('REFERENCE_SCHEMA_INCOMPATIBLE', 503);
    await c.query("INSERT INTO h8_schema VALUES (1,?,'staging') ON CONFLICT (id) DO UPDATE SET state = 'staging'", [referenceSchemaVersion]);
    await initializeMetadata(transaction, dialect); await initializeAuth(transaction); await checkpoint();
    await initializeEmbedding(transaction); await initializeEmbedSessions(transaction); await initializeObservability(transaction); await initializeRecovery(transaction);
    await migrateBudgets(transaction, budgets, 'frozen');
    await c.query("UPDATE h8_schema SET state = 'ready' WHERE id = 1");
  });
}
export async function assertReferenceSchema(db: Database): Promise<void> {
  try {
    const row = (await db.transaction(c => c.query('SELECT * FROM h8_schema WHERE id = 1')))[0];
    if (!row || row.version !== referenceSchemaVersion || row.state !== 'ready') throw new Error();
  } catch { throw new MetadataError('REFERENCE_SCHEMA_INCOMPATIBLE', 503); }
}
