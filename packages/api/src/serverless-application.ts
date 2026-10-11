import { createBuiltinHostedServer, type HostedInvocationAdapters } from './hosted-server.js';
import { MetadataError, type Database } from './metadata-db.js';
import { TenantMetadata } from './metadata.js';
import { TenantBudgets } from './budgets.js';
import { HostedUsage, entitlementConfig } from './hosted-usage.js';
import { InvocationScope } from './runtime-scope.js';
import { InvocationAws } from './runtime-aws.js';
import type { InvocationDatabases } from './runtime-postgres.js';
import { deploymentId } from './runtime-startup.js';
import { hostedConfig } from './hosted-config.js';
import { sourceEndpoints } from './source-schema.js';
import { HostedSources } from './hosted-sources.js';
import { EmbedSources } from './embed-sources.js';
import { HostedData } from './hosted-data.js';
import { HostedDataRoutes } from './hosted-data-routes.js';
import { EmbedContent } from './embed-content.js';
import { DurableCoordinator } from './coordination.js';
import { ManifestStore } from './manifests.js';
import { ArtifactTransfer } from './artifact-transfer.js';
import { SourceArtifacts } from './source-artifacts.js';
import { ObjectLedger } from './object-ledger.js';
import { DurableDispatch } from './dispatch.js';
import { AwsDispatch } from './dispatch-aws.js';
import { UploadObjects } from './upload-objects.js';
import { DurableUploads } from './durable-uploads.js';
import { DurableUploadRoutes } from './upload-routes.js';
import { ServerlessWork } from './serverless-work.js';
import type { HostedAuth } from './hosted-auth.js';
import { ResultObjects } from './result-objects.js';
import { DurableResults } from './durable-results.js';
import { method, send } from './automation-routes.js';

export function serverlessTransport(aws: InvocationAws, env: NodeJS.ProcessEnv): AwsDispatch {
  const required = (key: string) => { const value = env[key]; if (!value) throw new MetadataError('DISPATCH_CONFIG_INVALID', 503); return value; };
  return new AwsDispatch(aws, { deployment: deploymentId(env), workQueueUrl: required('OPENSIGHT_WORK_QUEUE_URL'), workQueueArn: required('OPENSIGHT_WORK_QUEUE_ARN'),
    recoveryQueueUrl: required('OPENSIGHT_RECOVERY_QUEUE_URL'), recoveryQueueArn: required('OPENSIGHT_RECOVERY_QUEUE_ARN'),
    schedulerGroup: required('OPENSIGHT_SCHEDULER_GROUP'), schedulerRoleArn: required('OPENSIGHT_SCHEDULER_ROLE_ARN'), schedulerDlqArn: required('OPENSIGHT_SCHEDULER_DLQ_ARN') });
}
export async function serverlessUsage(database: Database, deployment: string): Promise<HostedUsage> {
  const config = await database.transaction(async c => {
    const row = (await c.query('SELECT entitlements FROM sr_limits WHERE deployment = ?', [deployment]))[0];
    if (!row) throw new MetadataError('COORDINATION_SCHEMA_REQUIRED', 503);
    return entitlementConfig(String(row.entitlements));
  });
  return new HostedUsage(database, config, Date.now, deployment);
}
/** Literal supported data routes. H7 and the legacy base64 upload remain gated. */
export function serverlessDataPath(raw: string): boolean {
  const path = raw.replace(/^\/api\/namespaces\/[A-Za-z0-9_-]+\//, '/api/');
  return /^\/api\/(?:session|namespaces|users|groups|connectors|sources|prep-sources|prep-datasets)$/.test(path)
    || /^\/api\/sources\/[A-Za-z0-9_-]+(?:\/(?:bind|rotate|preview|rows|output|query|refresh|policy))?$/.test(path)
    || /^\/api\/(?:ai\/sources(?:\/[A-Za-z0-9_-]+\/schema)?|prep-datasets\/import)$/.test(path)
    || /^\/api\/(?:uploads\/reservations(?:\/[A-Za-z0-9_-]+(?:\/complete)?)?|operations\/[A-Za-z0-9_-]+(?:\/result\/(?:0|[1-9]\d{0,5}))?)$/.test(path)
    || /^\/api\/datasets\/[A-Za-z0-9_-]+\/(?:prep(?:\/preview)?|execution|refresh|rows|query|share|permissions|embed)$/.test(path)
    || /^\/api\/embedding\/(?:config|sessions(?:\/[A-Za-z0-9_-]+(?:\/renew)?)?|GenerateEmbedUrlForRegisteredUser|GenerateEmbedUrlForAnonymousUser)$/.test(path)
    || /^\/api\/embed\/sessions\/[A-Za-z0-9_-]+\/(?:redeem|status|content|question|analysis|save)$/.test(path)
    || /^\/embed\/sessions\/[A-Za-z0-9_-]+$/.test(path);
}
export function serverlessAdapters(database: Database, metadata: TenantMetadata, budgets: TenantBudgets, aws: InvocationAws,
  env: NodeJS.ProcessEnv, auth?: HostedAuth): HostedInvocationAdapters {
  const deployment = deploymentId(env), config = hostedConfig(env), bucket = env.OPENSIGHT_ARTIFACT_BUCKET;
  if (!bucket) throw new MetadataError('ARTIFACT_CONFIG_INVALID', 503);
  const coordinator = new DurableCoordinator(database, metadata, deployment), manifests = new ManifestStore(coordinator);
  const transfer = new ArtifactTransfer(aws, { bucket, prefix: 'artifacts/v1' }), ledger = new ObjectLedger(metadata, deployment);
  const dispatch = new DurableDispatch(database, metadata, deployment, serverlessTransport(aws, env));
  const work = new ServerlessWork(coordinator, manifests, dispatch, ledger, transfer, budgets, aws.scope, () => aws.close());
  const sourceArtifacts = new SourceArtifacts(coordinator, context => work.attempt(context), transfer, budgets);
  const sources = new HostedSources(metadata, config.encryptionKey.toString('base64'), sourceEndpoints(env), Date.now, sourceArtifacts.read);
  const embedSources = new EmbedSources(metadata, config.encryptionKey.toString('base64'), sourceEndpoints(env), Date.now, sourceArtifacts.read);
  const results = new DurableResults(database, metadata, dispatch, ledger, new ResultObjects(aws, bucket), work, budgets);
  const authority = (request: Parameters<HostedAuth['resultSession']>[0]) => {
    if (!auth) throw new MetadataError('RESULT_SESSION_REQUIRED', 503); return auth.resultSession(request);
  };
  const data = new HostedDataRoutes(new HostedData(sources, undefined, budgets, work.cache, work), undefined, async (request, context, status, body, recheck) => {
    if (Buffer.byteLength(JSON.stringify(body)) <= 1024 * 1024) return { status, body };
    return results.publish(context, body, await authority(request), recheck);
  });
  const embedContent = new EmbedContent(new HostedData(embedSources, undefined, budgets, work.cache, work));
  const uploadService = new DurableUploads(metadata, dispatch, ledger, new UploadObjects(aws, bucket)), uploads = new DurableUploadRoutes(uploadService);
  return { data, embedContent, allows: serverlessDataPath, capabilities: { directUploads: { version: 1, maxBytes: 8 * 1024 * 1024 }, resultChunks: { version: 1, maxBytes: 1024 * 1024, maxResultBytes: budgets.config.node.resultBytes }, controlJsonBytes: 1024 * 1024 },
    resultMaxBytes: budgets.config.node.resultBytes,
    idleReconnect: true,
    embedResult: (context, session, body, recheck) => results.publish(context, body, { kind: 'embed', id: session.id, expiresAt: session.expiresAt }, recheck),
    embedOperation: async (request, response, path, sessions) => {
      const match = /^\/api\/operations\/([A-Za-z0-9_-]+)(?:\/result\/(0|[1-9]\d{0,5}))?$/.exec(path);
      if (!match || !request.headers.authorization?.startsWith('Embed ')) return false;
      method(request, response, ['GET']);
      const id = await results.embedSession(match[1]!), credential = request.headers.authorization.slice(6), { context, session } = await sessions.verify(id, credential);
      await metadata.usage?.consume(metadata, context, 'apiCalls');
      const recheck = async () => { await sessions.verify(id, credential); };
      const reader = { kind: 'embed' as const, id, expiresAt: session.expiresAt };
      send(response, 200, match[2] === undefined ? await uploadService.status(context, match[1]!, recheck) : await results.chunk(context, match[1]!, Number(match[2]), reader, recheck)); return true;
    },
    route: async (request, response, path, context, recheck) => {
      const match = /^\/api\/operations\/([A-Za-z0-9_-]+)\/result\/(0|[1-9]\d{0,5})$/.exec(path);
      if (match) {
        method(request, response, ['GET']); send(response, 200, await results.chunk(context, match[1]!, Number(match[2]), await authority(request), recheck)); return true;
      }
      return uploads.route(request, response, path, context, recheck);
    }, finish: () => work.finish() };
}
export async function createServerlessApplication(db: InvocationDatabases, scope: InvocationScope, env: NodeJS.ProcessEnv) {
  const aws = new InvocationAws(scope, env), usage = await serverlessUsage(db.membership, deploymentId(env));
  return createBuiltinHostedServer({ membershipDatabase: db.membership, tenantDatabase: db.tenant, env,
    invocation: { signal: scope.signal, usage, compose: (metadata, budgets, auth) => serverlessAdapters(db.membership, metadata, budgets, aws, env, auth) } });
}
