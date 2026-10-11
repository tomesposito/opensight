import { MetadataError } from './metadata-db.js';
import { TenantMetadata } from './metadata.js';
import { InvocationAws } from './runtime-aws.js';
import type { InvocationScope } from './runtime-scope.js';
import type { InvocationDatabases } from './runtime-postgres.js';
import type { ScheduledEvent } from './runtime-private.js';
import { deploymentId } from './runtime-startup.js';
import { serverlessTransport, serverlessUsage } from './serverless-application.js';
import { DurableDispatch, type DispatchEnvelope } from './dispatch.js';
import { DurableCoordinator } from './coordination.js';
import { ObjectLedger } from './object-ledger.js';
import { ArtifactTransfer } from './artifact-transfer.js';
import { UploadObjects } from './upload-objects.js';
import { IngestionWorker } from './ingestion-worker.js';
import { ObjectCollector, AwsObjectDeletion } from './object-collector.js';
import { loadBudgets } from './budget-store.js';

/** Event envelopes carry identifiers only; each service reclaims current SQL authority. */
export async function runServerlessEvent(raw: ScheduledEvent, db: InvocationDatabases, scope: InvocationScope, env: NodeJS.ProcessEnv): Promise<void> {
  if (!['execute', 'due', 'recover'].includes(raw.kind)) throw new MetadataError('SERVERLESS_DISPATCH_REQUIRED', 503);
  const event = raw as DispatchEnvelope, deployment = deploymentId(env), bucket = env.OPENSIGHT_ARTIFACT_BUCKET;
  if (!bucket) throw new MetadataError('ARTIFACT_CONFIG_INVALID', 503);
  await db.prepare?.();
  const aws = new InvocationAws(scope, env), usage = await serverlessUsage(db.membership, deployment);
  const metadata = new TenantMetadata(db.tenant, db.membership, usage), dispatch = new DurableDispatch(db.membership, metadata, deployment, serverlessTransport(aws, env));
  if (event.kind === 'recover') { await dispatch.recover(event); return; }
  const inspected = await dispatch.inspect(event); if (!inspected) return;
  if (['object-cleanup', 'artifact-cleanup'].includes(inspected.kind)) {
    await new ObjectCollector(db.membership, dispatch, new AwsObjectDeletion(aws, bucket)).run(event); return;
  }
  if (inspected.kind !== 'ingest') throw new MetadataError('SERVERLESS_DISPATCH_REQUIRED', 503);
  const budgets = await loadBudgets(db.membership, metadata); scope.own({ close: () => budgets.shutdown(), force: () => budgets.close() });
  const worker = new IngestionWorker(db.membership, metadata, new DurableCoordinator(db.membership, metadata, deployment), dispatch,
    new ObjectLedger(metadata, deployment), new UploadObjects(aws, bucket), new ArtifactTransfer(aws, { bucket, prefix: 'artifacts/v1' }), budgets, () => aws.close());
  try { await worker.run(event, Math.min(120000, Math.floor(scope.deadline - Date.now()))); }
  finally { await budgets.shutdown(); }
}
