import { Analytics, analyticsFromEnvironment } from './analytics.js';
import { AnalyticsStore } from './analytics-store.js';
import { MetadataError } from './metadata-db.js';
import { TenantMetadata } from './metadata.js';
import { InvocationAws } from './runtime-aws.js';
import type { InvocationScope } from './runtime-scope.js';
import type { InvocationDatabases } from './runtime-postgres.js';
import type { ScheduledEvent } from './runtime-private.js';
import { deploymentId } from './runtime-startup.js';
import { serverlessAdapters, serverlessTransport, serverlessUsage } from './serverless-application.js';
import { DurableDispatch, type DispatchEnvelope } from './dispatch.js';
import { DurableCoordinator } from './coordination.js';
import { ObjectLedger } from './object-ledger.js';
import { ArtifactTransfer } from './artifact-transfer.js';
import { UploadObjects } from './upload-objects.js';
import { IngestionWorker } from './ingestion-worker.js';
import { ObjectCollector, AwsObjectDeletion } from './object-collector.js';
import { loadBudgets } from './budget-store.js';
import { DurableExecution } from './durable-execution.js';
import { DurableJobs } from './durable-jobs.js';
import { JobRenderer } from './job-renderer.js';
import { currentAuthority } from './serverless-authority.js';
import { expireResultOperation } from './durable-results.js';
import { DurableInvitations } from './durable-invitations.js';
import { hostedConfig } from './hosted-config.js';
import { serverlessMail } from './serverless-mail.js';

/** Event envelopes carry identifiers only; each service reclaims current SQL authority. */
export async function runServerlessEvent(raw: ScheduledEvent, db: InvocationDatabases, scope: InvocationScope, env: NodeJS.ProcessEnv): Promise<void> {
  if (!['execute', 'due', 'recover'].includes(raw.kind)) throw new MetadataError('SERVERLESS_DISPATCH_REQUIRED', 503);
  const event = raw as DispatchEnvelope, deployment = deploymentId(env), bucket = env.OPENSIGHT_ARTIFACT_BUCKET;
  if (!bucket) throw new MetadataError('ARTIFACT_CONFIG_INVALID', 503);
  await db.prepare?.();
  const aws = new InvocationAws(scope, env), usage = await serverlessUsage(db.membership, deployment);
  const metadata = new TenantMetadata(db.tenant, db.membership, usage), dispatch = new DurableDispatch(db.membership, metadata, deployment, serverlessTransport(aws, env));
  if (event.kind === 'recover') { await dispatch.recover(event); return; }
  const inspected = await dispatch.inspect(event, true);
  if (!inspected) { await dispatch.flushEvent(event); return; }
  if (inspected.kind === 'invitation-deliver') {
    await new DurableInvitations(dispatch, metadata, hostedConfig(env), serverlessMail(aws, env)).run(event, scope.remaining()); return;
  }
  if (inspected.kind.startsWith('job-')) {
    const budgets = await loadBudgets(db.membership, metadata); scope.own({ close: () => budgets.shutdown(), force: () => budgets.close() });
    const adapters = serverlessAdapters(db.membership, metadata, budgets, aws, env);
    const jobs = new DurableJobs(adapters.jobs!, new JobRenderer(adapters.data.data, adapters.embedContent), adapters.mail!);
    try { await jobs.run(event, scope.remaining()); } finally { await adapters.finish(); }
    return;
  }
  const execution = new DurableExecution(dispatch, async (c, target, code) => {
    if (target.kind !== 'ingest' && target.kind !== 'result-expire') return;
    const args = [deployment, target.scope.tenantId, target.scope.namespaceId, target.scope.userId, target.aggregateId];
    await c.query("UPDATE sr_operation SET state = 'failed', revision = revision + 1, error_code = ? WHERE deployment = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ? AND operation_id = ? AND state IN ('queued','running')", [code, ...args]);
    await c.query("UPDATE sr_upload SET state = 'failed', revision = revision + 1 WHERE deployment = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ? AND operation_id = ? AND state = 'accepted'", args);
  });
  const handle = await execution.claim(event, scope.remaining());
  if (!handle) { await dispatch.flushEvent(event); return; }
  try {
    if (['object-cleanup', 'artifact-cleanup'].includes(inspected.kind)) {
      await new ObjectCollector(db.membership, dispatch, new AwsObjectDeletion(aws, bucket)).run(event);
    } else if (inspected.kind === 'result-expire') {
      await execution.checked(handle, (c, now) => expireResultOperation(c, deployment, inspected, now));
    } else if (inspected.kind === 'ingest') {
      const budgets = await loadBudgets(db.membership, metadata); scope.own({ close: () => budgets.shutdown(), force: () => budgets.close() });
      const analytics = new Analytics(new AnalyticsStore(db.membership), analyticsFromEnvironment(env));
      const worker = new IngestionWorker(db.membership, metadata, new DurableCoordinator(db.membership, metadata, deployment), dispatch,
        new ObjectLedger(metadata, deployment), new UploadObjects(aws, bucket), new ArtifactTransfer(aws, { bucket, prefix: 'artifacts/v1' }), budgets, () => aws.close(), 'postgres', analytics);
      try { await worker.run(event, scope.remaining()); } finally { await analytics.close(); await budgets.shutdown(); }
    } else throw new MetadataError('SERVERLESS_DISPATCH_REQUIRED', 503);
    await execution.complete(handle);
  } catch (error) { if (!await execution.failed(handle, error)) throw error; }
  await dispatch.flushEvent(event);
}

/** Only createPrivateRuntime's authenticated operator entrypoint calls this. */
export async function replayServerlessEvent(event: DispatchEnvelope, db: InvocationDatabases, scope: InvocationScope, env: NodeJS.ProcessEnv, acceptAmbiguous: boolean): Promise<void> {
  await db.prepare?.();
  const deployment = deploymentId(env), aws = new InvocationAws(scope, env);
  const metadata = new TenantMetadata(db.tenant, db.membership, await serverlessUsage(db.membership, deployment));
  const dispatch = new DurableDispatch(db.membership, metadata, deployment, serverlessTransport(aws, env));
  const target = await dispatch.inspect(event, true);
  if (!target) throw new MetadataError('DISPATCH_REPLAY_DENIED', 409);
  if (target.kind === 'invitation-deliver') {
    await new DurableInvitations(dispatch, metadata, hostedConfig(env), serverlessMail(aws, env)).replay(event, acceptAmbiguous); return;
  }
  if (target.kind.startsWith('job-')) {
    const budgets = await loadBudgets(db.membership, metadata); scope.own({ close: () => budgets.shutdown(), force: () => budgets.close() });
    const adapters = serverlessAdapters(db.membership, metadata, budgets, aws, env);
    try { await new DurableJobs(adapters.jobs!, new JobRenderer(adapters.data.data, adapters.embedContent), adapters.mail!).replay(event, acceptAmbiguous); }
    finally { await adapters.finish(); }
    return;
  }
  const context = await metadata.authenticate(null, async () => ({ namespaceId: target.scope.namespaceId, userId: target.scope.userId }));
  if (context.tenantId !== target.scope.tenantId) throw new MetadataError('DISPATCH_REPLAY_DENIED', 409);
  const revisions = await metadata.revisions(context);
  await new DurableExecution(dispatch).replay(event, async c => {
    await currentAuthority(c, metadata, context, revisions, target.kind === 'ingest');
    if (target.kind === 'ingest') {
      const op = (await c.query('SELECT * FROM sr_operation WHERE deployment = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ? AND operation_id = ?',
        [deployment, context.tenantId, context.namespaceId, context.userId, target.aggregateId]))[0];
      if (!op || !['queued', 'running'].includes(String(op.state)) || Number(op.control_epoch) !== target.epoch
        || Number(op.expires_at) <= await dispatch.time(c)
        || (['authorization', 'policy', 'configuration'] as const).some(k => Number(op[`${k}_revision`]) !== revisions[k])) throw new MetadataError('DISPATCH_REPLAY_DENIED', 409);
    }
  }, acceptAmbiguous);
}
