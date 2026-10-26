import { writeFile } from 'node:fs/promises';
import { MetadataError, PostgresMetadataDatabase, SqliteMetadataDatabase, type Database } from './metadata-db.js';
import { TenantMetadata } from './metadata.js';
import { DurableDispatch } from './dispatch.js';
import { ObjectCollector, AwsObjectDeletion } from './object-collector.js';
import { ObjectRecovery, type RecoveryReport } from './object-recovery.js';
import { InvocationScope } from './runtime-scope.js';
import { InvocationAws } from './runtime-aws.js';
import { dryRunTransport, storageRecoverTransport, type RecoveryTransportEntry } from './storage-recover-transport.js';

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
 * and OPENSIGHT_ARTIFACT_BUCKET. Non-dry runs also require
 * OPENSIGHT_WORK_QUEUE_URL, OPENSIGHT_WORK_QUEUE_ARN, OPENSIGHT_RECOVERY_QUEUE_URL,
 * OPENSIGHT_RECOVERY_QUEUE_ARN, OPENSIGHT_SCHEDULER_GROUP,
 * OPENSIGHT_SCHEDULER_ROLE_ARN and OPENSIGHT_SCHEDULER_DLQ_ARN, validated before
 * opening the database. Continuations use the real durable transport: SQS or
 * Scheduler must acknowledge delivery before the collector acknowledges them.
 * Dry runs require neither AWS credentials nor dispatch config and acknowledge nothing. */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || i + 1 >= process.argv.length ? undefined : process.argv[i + 1];
}
const SUCCESS = new Set(['recovered', 'already-complete', 'protected-pin', 'protected-retention', 'protected-reference', 'protected-continued', 'protected-manifest']);
async function main(): Promise<void> {
  const tenantId = arg('tenant'), namespaceId = arg('namespace'), userId = arg('owner'), objects = arg('objects');
  const auditPath = arg('audit-path'), deployment = arg('deployment') ?? 'default';
  const dryRun = process.argv.includes('--dry-run'), windowMs = Number(arg('window-ms') ?? '3600000');
  if (!tenantId || !namespaceId || !userId || !objects || !auditPath) throw new MetadataError('STORAGE_RECOVER_USAGE', 400);
  const objectIds = objects.split(',').map(s => s.trim()).filter(Boolean);
  const sqlitePath = process.env.OPENSIGHT_METADATA_DATABASE, postgresUrl = process.env.OPENSIGHT_METADATA_POSTGRES;
  let release: (() => Promise<void>) | undefined;
  const transportLog: RecoveryTransportEntry[] = [];
  const scope = new InvocationScope(Date.now() + 15 * 60 * 1000, 3000);
  try {
    // Validate dispatch before opening either database; dry-run owns no AWS clients.
    const aws = dryRun ? undefined : new InvocationAws(scope, process.env);
    const transport = aws ? storageRecoverTransport(aws, process.env, deployment, transportLog) : dryRunTransport();
    const deletion = aws
      ? new AwsObjectDeletion(aws, process.env.OPENSIGHT_ARTIFACT_BUCKET ?? '')
      : { latest: async (): Promise<string | undefined> => { throw new MetadataError('STORAGE_RECOVER_DRY_RUN', 503); },
          remove: async (): Promise<void> => { throw new MetadataError('STORAGE_RECOVER_DRY_RUN', 503); } };
    let database: Database, dialect: 'sqlite' | 'postgres';
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
    const metadata = new TenantMetadata(database, database);
    const dispatch = new DurableDispatch(database, metadata, deployment, transport, dialect);
    const collector = new ObjectCollector(database, dispatch, deletion, dialect);
    const recovery = new ObjectRecovery(database, dispatch, collector);
    const report: RecoveryReport = await recovery.recover({ tenantId, namespaceId, userId }, objectIds, { dryRun, windowMs });
    const audit = { generatedAt: new Date().toISOString(), dryRun, report, transport: transportLog };
    await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
    if (!dryRun && report.objects.some(o => !SUCCESS.has(o.decision))) throw new MetadataError('STORAGE_RECOVER_INCOMPLETE', 500);
  } finally {
    await scope.close().catch(() => {});
    await release?.();
  }
}
main().then(() => { process.exitCode = 0; }, (error: unknown) => {
  console.error(error instanceof MetadataError ? error.code : 'STORAGE_RECOVERY_FAILED');
  process.exitCode = 1;
});
