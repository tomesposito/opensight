import { readFile } from 'node:fs/promises';
import type { Database } from './metadata-db.js';
import { MetadataError } from './metadata-db.js';
import { MetadataMigration, type LegacyMigrationConfig } from './metadata-migration.js';
import { SourceMigration, type SourceMigrationConfig } from './source-migration.js';
import { budgetEnvironment, migrateBudgets, loadBudgets } from './budget-store.js';
import { hostedConfig } from './hosted-config.js';
import { sourceEndpoints } from './source-schema.js';
import { object, identifier } from './metadata-resources.js';
import { TenantMetadata } from './metadata.js';
import { JobStore } from './job-store.js';
import { JobRenderer } from './job-renderer.js';
import { migrateJobs } from './job-migration.js';
import { HostedData } from './hosted-data.js';
import { HostedSources } from './hosted-sources.js';
import { EmbedSources } from './embed-sources.js';
import { EmbedContent } from './embed-content.js';
export const migrationCommands = ['metadata-migrate', 'metadata-seal', 'metadata-rollback', 'sources-migrate', 'sources-seal', 'sources-rollback', 'budgets-migrate', 'jobs-migrate'];
/** Runs under the same reference maintenance lock as serving and recovery. */
export async function referenceMigration(db: Database, tenantDb: Database, env: NodeJS.ProcessEnv, command: string): Promise<void> {
  if (env.OPENSIGHT_MAINTENANCE !== 'frozen') throw new MetadataError('REFERENCE_MAINTENANCE_REQUIRED');
  const config = hostedConfig(env);
  const manifest = async (name: string): Promise<unknown> => { if (!env[name]) throw new MetadataError('MIGRATION_CONFIG_REQUIRED'); return JSON.parse(await readFile(env[name]!, 'utf8')) as unknown; };
  if (command.startsWith('metadata-')) {
    if (env.OPENSIGHT_AI_ENCRYPTION_KEY && env.OPENSIGHT_AI_ENCRYPTION_KEY !== env.OPENSIGHT_AUTH_ENCRYPTION_KEY) throw new MetadataError('MIGRATION_KEY_REPAIR_REQUIRED');
    const input = await manifest('OPENSIGHT_METADATA_MIGRATION_CONFIG') as LegacyMigrationConfig, migration = new MetadataMigration(db);
    if (command === 'metadata-migrate') await migration.migrate(input, env.OPENSIGHT_AUTH_ENCRYPTION_KEY);
    else if (command === 'metadata-seal') await migration.seal(input);
    else await migration.rollback(input);
  } else if (command.startsWith('sources-')) {
    const input = await manifest('OPENSIGHT_SOURCE_MIGRATION_CONFIG') as SourceMigrationConfig;
    const migration = new SourceMigration(db, config.encryptionKey.toString('base64'), sourceEndpoints(env));
    if (command === 'sources-migrate') await migration.migrate(input);
    else if (command === 'sources-seal') await migration.seal(input);
    else await migration.rollback(input);
  } else if (command === 'budgets-migrate') await migrateBudgets(db, budgetEnvironment(env), 'frozen');
  else if (command === 'jobs-migrate') {
    const input = object(await manifest('OPENSIGHT_JOB_MIGRATION_CONFIG'), ['tenantId', 'namespaceId', 'defaultOwner']);
    const metadata = new TenantMetadata(tenantDb, db), budgets = await loadBudgets(db, metadata), key = config.encryptionKey.toString('base64'), endpoints = sourceEndpoints(env);
    try {
      const renderer = new JobRenderer(new HostedData(new HostedSources(metadata, key, endpoints), undefined, budgets), new EmbedContent(new HostedData(new EmbedSources(metadata, key, endpoints), undefined, budgets)));
      await migrateJobs(new JobStore(db, metadata), renderer, { tenantId: identifier(input.tenantId), namespaceId: identifier(input.namespaceId) }, identifier(input.defaultOwner), 'frozen');
    } finally { await budgets.shutdown(); }
  } else throw new MetadataError('REFERENCE_COMMAND_INVALID');
}
