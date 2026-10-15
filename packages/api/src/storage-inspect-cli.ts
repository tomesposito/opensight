import { readFile } from 'node:fs/promises';
import { MetadataError } from './metadata-db.js';
import { inspectPostgres, inspectSqlite, storageScope } from './storage-inspection.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2), values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!, value = args[i + 1];
    if (!['--tenant', '--namespace', '--deployment'].includes(key) || !value || values.has(key)) throw new MetadataError('STORAGE_INSPECT_USAGE', 400);
    values.set(key, value);
  }
  if (!values.has('--tenant') || !values.has('--namespace')) throw new MetadataError('STORAGE_INSPECT_USAGE', 400);
  const scope = storageScope({ tenantId: values.get('--tenant')!, namespaceId: values.get('--namespace')!, deployment: values.get('--deployment') ?? 'default' });
  const sqlite = process.env.OPENSIGHT_METADATA_DATABASE, postgres = process.env.OPENSIGHT_METADATA_POSTGRES;
  if (!!sqlite === !!postgres) throw new MetadataError('STORAGE_INSPECT_CONFIG_INVALID', 503);
  const ca = process.env.OPENSIGHT_POSTGRES_CA ?? (process.env.OPENSIGHT_POSTGRES_CA_FILE ? await readFile(process.env.OPENSIGHT_POSTGRES_CA_FILE, 'utf8') : '');
  console.log(JSON.stringify(sqlite ? await inspectSqlite(sqlite, scope) : await inspectPostgres(postgres!, ca, scope), null, 2));
}
main().catch((error: unknown) => {
  console.error(error instanceof MetadataError ? error.code : 'STORAGE_INSPECTION_FAILED');
  process.exitCode = 1;
});
