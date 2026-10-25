import { readFile } from 'node:fs/promises';
import { GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { ListSecretVersionIdsCommand } from '@aws-sdk/client-secrets-manager';
import { MetadataError } from './metadata-db.js';
import { checksum } from './metadata-operator.js';
import { InvocationScope, invocationDeadline, type InvocationContext } from './runtime-scope.js';
import { InvocationAws, awsEnvironment } from './runtime-aws.js';
import { invocationDatabases } from './runtime-postgres.js';
import { snapshotServerless, restoreServerless, migrateRegistered, validateRecovery, type CloudSnapshot, type RecoveryRegistry } from './serverless-backup.js';

interface BackupPlan {
  version: 1; operationId: string; deployment: string; mode: 'snapshot' | 'restore' | 'migrate'; backupId: string;
  sourceDatabase: string; targetDatabase: string; expiresAt: number; epoch: number;
  keyVersions: string[]; snapshotVersion: string | null; snapshotDigest: string | null;
}
/** SQL's replay observation is not part of the durable receipt identity. A
 * lost response can be retried without replacing the original S3 evidence. */
export async function recordMaintenanceReceipt(expected: Record<string, unknown>, io: {
  read(): Promise<unknown>;
  create(value: Record<string, unknown>): Promise<unknown>;
}): Promise<void> {
  const canonical = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { replayed: _replayed, ...identity } = value as Record<string, unknown>;
    if (_replayed !== undefined && typeof _replayed !== 'boolean') return null;
    return checksum(identity);
  };
  const matches = (actual: unknown) => {
    if (canonical(actual) !== canonical(expected)) throw new MetadataError('BACKUP_RECEIPT_CONFLICT', 503);
  };
  // Create first: the invocation adapter normalizes SDK errors, and an absent
  // key can return AccessDenied without ListBucket. Neither proves absence.
  try { await io.create(expected); }
  catch (error) {
    // A successful conditional write can have a lost response. Read back the
    // exact evidence once; uncertainty or different evidence still fails closed.
    let actual: unknown;
    try { actual = await io.read(); } catch { throw error; }
    matches(actual);
  }
}
export function backupPlan(raw: unknown, env: NodeJS.ProcessEnv, now = Date.now()): BackupPlan {
  const p = raw as BackupPlan;
  if (!p || Object.keys(p).sort().join() !== 'backupId,deployment,epoch,expiresAt,keyVersions,mode,operationId,snapshotDigest,snapshotVersion,sourceDatabase,targetDatabase,version'
    || p.version !== 1 || !['snapshot', 'restore', 'migrate'].includes(p.mode) || ![p.operationId, p.backupId].every(v => /^[a-f0-9-]{36}$/.test(v))
    || p.deployment !== env.OPENSIGHT_DEPLOYMENT || !/^[a-z][a-z0-9-]{0,62}$/.test(p.deployment)
    || ![p.sourceDatabase, p.targetDatabase].every(v => /^[a-z][a-z0-9_]{0,62}$/.test(v))
    || !Number.isSafeInteger(p.epoch) || p.epoch < 2 || !Number.isSafeInteger(p.expiresAt) || p.expiresAt <= now || p.expiresAt > now + 86400000
    || !Array.isArray(p.keyVersions) || !p.keyVersions.length || p.keyVersions.some(v => !/^[a-f0-9-]{32,64}$/.test(v))) throw new MetadataError('BACKUP_PLAN_INVALID', 503);
  if (p.mode === 'restore' && (p.sourceDatabase === p.targetDatabase || !p.targetDatabase.startsWith('os_restore_') || env.OPENSIGHT_DB_NAME !== p.targetDatabase
      || !p.snapshotVersion || !/^[a-f0-9]{64}$/.test(p.snapshotDigest ?? ''))
    || p.mode === 'migrate' && (env.OPENSIGHT_DB_NAME !== p.sourceDatabase || p.targetDatabase !== p.sourceDatabase || !p.snapshotVersion || !/^[a-f0-9]{64}$/.test(p.snapshotDigest ?? ''))
    || p.mode === 'snapshot' && (env.OPENSIGHT_DB_NAME !== p.sourceDatabase || p.snapshotVersion !== null || p.snapshotDigest !== null)) throw new MetadataError('RESTORE_TARGET_INVALID', 503);
  return p;
}
/** Temporary version-pinned IAM function. Fixed plan only; no public route,
 * arbitrary snapshot names, SQL or production reopen command. */
export async function handler(event: unknown, context: InvocationContext) {
  const plan = backupPlan(JSON.parse(process.env.OPENSIGHT_BACKUP_PLAN ?? '{}'), process.env);
  if (!event || typeof event !== 'object' || Array.isArray(event) || Object.keys(event).join() !== 'command'
    || (event as { command?: string }).command !== plan.mode) throw new MetadataError('BACKUP_COMMAND_INVALID', 503);
  try {
    return await new InvocationScope(invocationDeadline(context, Date.now(), 110000)).run(async scope => {
      const aws = new InvocationAws(scope, process.env), bucket = process.env.OPENSIGHT_OPERATIONS_BUCKET, kms = process.env.OPENSIGHT_OPERATIONS_KMS_KEY;
      if (!bucket || !kms) throw new MetadataError('BACKUP_CONFIG_INVALID', 503);
      const get = async (Key: string, VersionId?: string) => aws.call(async signal => {
        const response = await aws.s3.send(new GetObjectCommand({ Bucket: bucket, Key, VersionId }), { abortSignal: signal });
        if (response.ServerSideEncryption !== 'aws:kms' || response.SSEKMSKeyId !== kms || !response.VersionId || !response.ETag || Number(response.ContentLength) > 64 * 1024 * 1024) throw new MetadataError('BACKUP_OBJECT_INVALID', 503);
        return { value: JSON.parse(await response.Body!.transformToString()) as unknown, etag: response.ETag, version: response.VersionId };
      }, 15000);
      const put = async (Key: string, value: unknown, condition: { IfMatch: string } | { IfNoneMatch: '*' }) => aws.call(signal => aws.s3.send(new PutObjectCommand({
        Bucket: bucket, Key, Body: JSON.stringify(value), ServerSideEncryption: 'aws:kms', SSEKMSKeyId: kms, BucketKeyEnabled: true, ...condition,
      }), { abortSignal: signal }), 15000);
      const lock = (await get('ci/operations/active.json')).value as { operationId?: string; planDigest?: string; phase?: string };
      if (lock.operationId !== plan.operationId || lock.planDigest !== checksum(plan) || lock.phase !== 'quiescent') throw new MetadataError('BACKUP_OPERATION_REQUIRED', 503);
      const head = await get('maintenance/registry/head.json'), registry = head.value as RecoveryRegistry;
      if (registry.epoch !== plan.epoch || !Number.isSafeInteger(registry.revision) || registry.revision < 1) throw new MetadataError('RESTORE_AUTHORITY_UNAVAILABLE', 503);
      const env = await awsEnvironment(aws, { ...process.env, OPENSIGHT_POSTGRES_CA: await readFile('/var/task/ops/serverless/rds-ca.pem', 'utf8') }, true);
      const db = invocationDatabases(scope, env, 20000).membership;
      const keySecret = env.OPENSIGHT_BACKUP_KEY_SECRET_ARN;
      if (!keySecret) throw new MetadataError('RESTORE_KEY_UNAVAILABLE', 503);
      const versions = await aws.call(signal => aws.secrets.send(new ListSecretVersionIdsCommand({ SecretId: keySecret, IncludeDeprecated: true, MaxResults: 100 }), { abortSignal: signal }));
      if (versions.NextToken || plan.keyVersions.some(id => !versions.Versions?.some(v => v.VersionId === id))) throw new MetadataError('RESTORE_KEY_UNAVAILABLE', 503);
      const key = `maintenance/backups/${plan.backupId}/snapshot.json`;
      const verifyObjects = async (snapshot: CloudSnapshot) => {
        for (const object of snapshot.objects) {
          const result = await aws.call(signal => aws.s3.send(new HeadObjectCommand({ Bucket: env.OPENSIGHT_ARTIFACT_BUCKET, Key: object.key, VersionId: object.version, ChecksumMode: 'ENABLED' }), { abortSignal: signal }));
          if (result.VersionId !== object.version || result.ContentLength !== object.bytes || result.ChecksumSHA256 !== object.checksum) throw new MetadataError('RESTORE_OBJECT_UNAVAILABLE', 503);
        }
      };
      if (plan.mode === 'snapshot') {
        const snapshot = await snapshotServerless(db, plan.deployment, plan.backupId, plan.expiresAt, plan.keyVersions);
        if (snapshot.epoch !== plan.epoch || registry.completeThroughEpoch < snapshot.epoch) throw new MetadataError('RESTORE_AUTHORITY_UNAVAILABLE', 503);
        await verifyObjects(snapshot);
        const result = await put(key, snapshot, { IfNoneMatch: '*' });
        if (!result.VersionId) throw new MetadataError('BACKUP_VERSION_REQUIRED', 503);
        const next = { ...registry, revision: registry.revision + 1, fence: Math.max(registry.fence, snapshot.fence), backups: { ...registry.backups, [snapshot.id]: checksum(snapshot) } };
        await put(`maintenance/registry/entries/${checksum(next)}.json`, next, { IfNoneMatch: '*' });
        await put('maintenance/registry/head.json', next, { IfMatch: head.etag });
        return { state: 'registered', id: snapshot.id, digest: checksum(snapshot), version: result.VersionId, registry: checksum(next), objects: snapshot.objects.length };
      }
      const snapshot = (await get(key, plan.snapshotVersion!)).value as CloudSnapshot;
      if (checksum(snapshot) !== plan.snapshotDigest || snapshot.id !== plan.backupId || snapshot.deployment !== plan.deployment) throw new MetadataError('BACKUP_UNREGISTERED', 503);
      if (plan.mode === 'restore') validateRecovery(snapshot, registry);
      await verifyObjects(snapshot);
      // Head is checked again after object I/O; operation CAS excludes concurrent
      // authorized lifecycle/restore writers throughout the SQL transaction.
      if ((await get('maintenance/registry/head.json')).etag !== head.etag) throw new MetadataError('RESTORE_AUTHORITY_CHANGED', 503);
      const result = plan.mode === 'restore' ? await restoreServerless(db, snapshot, registry) : await migrateRegistered(db, env, snapshot, registry, plan.operationId);
      const receiptKey = `maintenance/receipts/${plan.operationId}.json`;
      await recordMaintenanceReceipt({ ...result, plan: checksum(plan), registry: checksum(registry), backup: plan.snapshotDigest }, {
        read: async () => (await get(receiptKey)).value,
        create: value => put(receiptKey, value, { IfNoneMatch: '*' }),
      });
      return result;
    });
  } catch (error) { throw new MetadataError(error instanceof MetadataError ? error.code : 'BACKUP_OPERATION_FAILED', 503); }
}
