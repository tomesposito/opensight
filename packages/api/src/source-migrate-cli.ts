import { readFile } from 'node:fs/promises';
import { SqliteMetadataDatabase, MetadataError } from './metadata-db.js';
import { SourceMigration, type SourceMigrationConfig } from './source-migration.js';
import { sourceEndpoints } from './source-schema.js';
import { secretKey } from './hosted-config.js';
let database: SqliteMetadataDatabase | undefined;
try {
  const action = process.argv[2], path = process.env.OPENSIGHT_METADATA_DATABASE, manifest = process.env.OPENSIGHT_SOURCE_MIGRATION_CONFIG;
  if (!['migrate', 'seal', 'rollback'].includes(action ?? '') || process.argv.length !== 3 || !path || path === ':memory:' || !manifest) throw new MetadataError('MIGRATION_CONFIG_REQUIRED');
  database = new SqliteMetadataDatabase(path);
  const config = JSON.parse(await readFile(manifest, 'utf8')) as SourceMigrationConfig;
  const migration = new SourceMigration(database, secretKey(process.env.OPENSIGHT_AUTH_ENCRYPTION_KEY).toString('base64'), sourceEndpoints());
  const result = action === 'migrate' ? await migration.migrate(config) : action === 'seal' ? await migration.seal(config) : await migration.rollback(config);
  console.log(JSON.stringify(result ?? { state: action }));
} catch (error) {
  console.error(error instanceof MetadataError ? error.code : 'SOURCE_MIGRATION_FAILED'); process.exitCode = 1;
} finally { await database?.close(); }
