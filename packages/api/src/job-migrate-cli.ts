import { readFile } from 'node:fs/promises';
import { SqliteMetadataDatabase, MetadataError } from './metadata-db.js';
import { maintenanceLock } from './metadata-maintenance.js';
import { TenantMetadata } from './metadata.js';
import { identifier, object } from './metadata-resources.js';
import { JobStore } from './job-store.js';
import { JobRenderer } from './job-renderer.js';
import { migrateJobs } from './job-migration.js';
import { HostedSources } from './hosted-sources.js';
import { EmbedSources } from './embed-sources.js';
import { HostedData } from './hosted-data.js';
import { EmbedContent } from './embed-content.js';
import { hostedConfig } from './hosted-config.js';
import { sourceEndpoints } from './source-schema.js';
import { loadBudgets } from './budget-store.js';

let db: SqliteMetadataDatabase | undefined;
try {
  const path = process.env.OPENSIGHT_METADATA_DATABASE, manifest = process.env.OPENSIGHT_JOB_MIGRATION_CONFIG;
  if (process.argv.length !== 2 || !path || path === ':memory:' || !manifest) throw new MetadataError('MIGRATION_CONFIG_REQUIRED');
  const config = object(JSON.parse(await readFile(manifest, 'utf8')), ['tenantId', 'namespaceId', 'defaultOwner']);
  await maintenanceLock(`${path}.h4`, async () => {
    db = new SqliteMetadataDatabase(path);
    const metadata = new TenantMetadata(db, db), budgets = await loadBudgets(db, metadata), hosted = hostedConfig();
    try {
      const key = hosted.encryptionKey.toString('base64'), endpoints = sourceEndpoints();
      const renderer = new JobRenderer(new HostedData(new HostedSources(metadata, key, endpoints), undefined, budgets), new EmbedContent(new HostedData(new EmbedSources(metadata, key, endpoints), undefined, budgets)));
      console.log(JSON.stringify(await migrateJobs(new JobStore(db, metadata), renderer, { tenantId: identifier(config.tenantId), namespaceId: identifier(config.namespaceId) }, identifier(config.defaultOwner), 'frozen')));
    } finally { await budgets.shutdown(); }
  });
} catch (error) { console.error(error instanceof MetadataError ? error.code : 'JOB_MIGRATION_FAILED'); process.exitCode = 1; }
finally { await db?.close(); }
