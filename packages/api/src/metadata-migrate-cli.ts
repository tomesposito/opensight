import { readFile } from 'node:fs/promises';
import { MetadataMigration, type LegacyMigrationConfig } from './metadata-migration.js';
import { MetadataError, SqliteMetadataDatabase } from './metadata-db.js';
import { initializeMetadata } from './metadata-schema.js';

/** Offline single-node command. Configuration and encryption keys come only from environment. */
async function main(): Promise<void> {
  const action = process.argv[2], path = process.env.OPENSIGHT_METADATA_DATABASE;
  const configuration = process.env.OPENSIGHT_METADATA_MIGRATION_CONFIG;
  if (!['migrate', 'seal', 'rollback'].includes(action ?? '') || !path || !configuration) throw new MetadataError('MIGRATION_CONFIGURATION_REQUIRED');
  const config = JSON.parse(await readFile(configuration, 'utf8')) as LegacyMigrationConfig;
  const database = new SqliteMetadataDatabase(path);
  try {
    await initializeMetadata(database);
    const migration = new MetadataMigration(database);
    if (action === 'rollback') {
      await migration.rollback(config); console.log(JSON.stringify({ migrationId: config.migrationId, state: 'rolled-back' }));
    } else {
      const report = action === 'seal' ? await migration.seal(config) : await migration.migrate(config, process.env.OPENSIGHT_AI_ENCRYPTION_KEY);
      console.log(JSON.stringify(report));
    }
  } finally { await database.close(); }
}
await main().catch((error: unknown) => {
  // Validation/IO/JSON errors can contain legacy data or paths. Print only safe codes.
  console.error(error instanceof MetadataError ? error.code : 'MIGRATION_FAILED'); process.exitCode = 1;
});
