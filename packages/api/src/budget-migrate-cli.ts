import { SqliteMetadataDatabase, MetadataError } from './metadata-db.js';
import { maintenanceLock } from './metadata-maintenance.js';
import { budgetEnvironment, migrateBudgets } from './budget-store.js';
try {
  const path = process.env.OPENSIGHT_METADATA_DATABASE;
  if (!path || path === ':memory:' || process.argv.length !== 2) throw new MetadataError('BUDGET_CONFIG_INVALID');
  await maintenanceLock(`${path}.h4`, async () => {
    const database = new SqliteMetadataDatabase(path);
    try { await migrateBudgets(database, budgetEnvironment(), process.env.OPENSIGHT_MAINTENANCE); }
    finally { await database.close(); }
  });
  console.log('BUDGET_MIGRATION_COMMITTED');
} catch (error) { console.error(error instanceof MetadataError ? error.code : 'BUDGET_MIGRATION_FAILED'); process.exitCode = 1; }
