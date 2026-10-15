import { writeFile } from 'node:fs/promises';
import { MetadataError, PostgresMetadataDatabase, SqliteMetadataDatabase, type Database } from './metadata-db.js';
import { TenantMetadata } from './metadata.js';
import { DurableDispatch, type DispatchEnvelope, type DurableEvent } from './dispatch.js';
import { ObjectCollector, AwsObjectDeletion } from './object-collector.js';
import { ObjectRecovery, type RecoveryReport } from './object-recovery.js';
import { InvocationScope } from './runtime-scope.js';
import { InvocationAws } from './runtime-aws.js';

/** Operator-only recovery for expired object-cleanup obligations (issue #96).
 * Prearms fresh cleanup envelopes for an explicitly selected scope and reviewed
 * object set, collects each with exact-version proof, and writes an audit report
 * to a private operator-chosen path. Never replays expired envelopes.
 * Usage: node dist/storage-recover-cli.js --tenant <id> --namespace <id> --owner <id>
 *   --objects <id1,id2,...> --audit-path <file> [--deployment <name>] [--dry-run]
 *   [--window-ms <ms>]
 * Database from OPENSIGHT_METADATA_DATABASE (sqlite file, read-write) or
 * OPENSIGHT_METADATA_POSTGRES (postgres connection string; OPENSIGHT_METADATA_POSTGRES_CA
 * with the PEM CA is required, TLS verified). S3 deletion uses the invocation's
 * AWS credentials (AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY/SESSION_TOKEN, AWS_REGION)
 * and OPENSIGHT_ARTIFACT_BUCKET. */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || i + 1 >= process.argv.length ? undefined : process.argv[i + 1];
}
const SUCCESS = new Set(['recovered', 'already-complete', 'protected-pin', 'protected-retention', 'protected-continued', 'protected-manifest']);
async function main(): Promise<void> {
  const tenantId = arg('tenant'), namespaceId = arg('namespace'), userId = arg('owner'), objects = arg('objects');
  const auditPath = arg('audit-path'), deployment = arg('deployment') ?? 'default';
  const dryRun = process.argv.includes('--dry-run'), windowMs = Number(arg('window-ms') ?? '3600000');
  if (!tenantId || !namespaceId || !userId || !objects || !auditPath) throw new MetadataError('STORAGE_RECOVER_USAGE', 400);
  const objectIds = objects.split(',').map(s => s.trim()).filter(Boolean);
  const sqlitePath = process.env.OPENSIGHT_METADATA_DATABASE, postgresUrl = process.env.OPENSIGHT_METADATA_POSTGRES;
  let database: Database, dialect: 'sqlite' | 'postgres', release: () => Promise<void>;
  if (sqlitePath && sqlitePath !== ':memory:' && !sqlitePath.includes('mode=memory')) {
    const db = new SqliteMetadataDatabase(sqlitePath); dialect = 'sqlite';
    database = db; release = () => db.close();
  } else if (postgresUrl) {
    const ca = process.env.OPENSIGHT_METADATA_POSTGRES_CA;
    if (!ca) throw new MetadataError('STORAGE_RECOVER_TLS_REQUIRED', 503);
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: postgresUrl, max: 1, connectionTimeoutMillis: 10000,
      ssl: { ca, rejectUnauthorized: true }, application_name: 'opensight-storage-recover' });
    database = new PostgresMetadataDatabase(pool); dialect = 'postgres';
    release = () => pool.end();
  } else throw new MetadataError('STORAGE_RECOVER_CONFIG_INVALID', 503);
  // Recorded transport: the CLI runs the collector in-process, so dispatch only
  // fires for continuations the collector prearms; those are audit evidence.
  const transportLog: Array<{ type: string; envelope: DispatchEnvelope; event?: DurableEvent }> = [];
  const transport = {
    recover: async (envelope: DispatchEnvelope) => { transportLog.push({ type: 'recover', envelope }); },
    dispatch: async (envelope: DispatchEnvelope, event: DurableEvent) => { transportLog.push({ type: 'dispatch', envelope, event }); },
  };
  const scope = new InvocationScope(Date.now() + 15 * 60 * 1000, 3000);
  try {
    const metadata = new TenantMetadata(database, database);
    const dispatch = new DurableDispatch(database, metadata, deployment, transport, dialect);
    // Dry-run never touches S3, so it must not require AWS credentials.
    const deletion = dryRun
      ? { latest: async (): Promise<string | undefined> => { throw new MetadataError('STORAGE_RECOVER_DRY_RUN', 503); },
          remove: async (): Promise<void> => { throw new MetadataError('STORAGE_RECOVER_DRY_RUN', 503); } }
      : new AwsObjectDeletion(new InvocationAws(scope, process.env), process.env.OPENSIGHT_ARTIFACT_BUCKET ?? '');
    const collector = new ObjectCollector(database, dispatch, deletion, dialect);
    const recovery = new ObjectRecovery(database, dispatch, collector);
    const report: RecoveryReport = await recovery.recover({ tenantId, namespaceId, userId }, objectIds, { dryRun, windowMs });
    const audit = { generatedAt: new Date().toISOString(), dryRun, report, transport: transportLog };
    await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
    if (!dryRun && report.objects.some(o => !SUCCESS.has(o.decision))) throw new MetadataError('STORAGE_RECOVER_INCOMPLETE', 500);
  } finally {
    await scope.close().catch(() => {});
    await release();
  }
}
main().then(() => { process.exitCode = 0; }, (error: unknown) => {
  console.error(error instanceof MetadataError ? error.code : 'STORAGE_RECOVERY_FAILED');
  process.exitCode = 1;
});
