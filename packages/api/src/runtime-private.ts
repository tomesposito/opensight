import { equal } from './auth-crypto.js';
import { secretKey } from './hosted-config.js';
import { MetadataError } from './metadata-db.js';
import { object, identifier } from './metadata-resources.js';
import { InvocationScope, invocationDeadline, type InvocationContext } from './runtime-scope.js';
import { invocationDatabases, type InvocationDatabases } from './runtime-postgres.js';
import { runtimeMode, type RuntimeDependencies } from './runtime.js';
import { migrateRuntime } from './runtime-migration.js';
import { deploymentId } from './runtime-startup.js';
import { migrateServerless } from './serverless-migration.js';
import { runServerlessEvent } from './serverless-worker.js';

export interface ScheduledEvent { version: 1; deploymentEpoch: number; eventId: string; kind: 'due' | 'execute' | 'recover' | 'deliver' }
export interface PrivateRuntimeDependencies extends Pick<RuntimeDependencies, 'databases'> {
  /** SR3 must authorize/claim/fence the referenced durable event before doing work. */
  scheduled?(event: ScheduledEvent, db: InvocationDatabases, scope: InvocationScope, env: NodeJS.ProcessEnv): Promise<void>;
  migrate?(db: InvocationDatabases, scope: InvocationScope, env: NodeJS.ProcessEnv): Promise<void>;
}
export function createPrivateRuntime(environment: () => NodeJS.ProcessEnv = () => process.env, dependencies: PrivateRuntimeDependencies = {}) {
  const configured = () => { const env = environment(); if (runtimeMode(env) !== 'lambda') throw new MetadataError('LAMBDA_MODE_REQUIRED', 503); deploymentId(env); return env; };
  const invoke = <T>(env: NodeJS.ProcessEnv, context: InvocationContext, work: (db: InvocationDatabases, scope: InvocationScope) => Promise<T>) =>
    new InvocationScope(invocationDeadline(context, Date.now(), 110000)).run(scope => work((dependencies.databases ?? invocationDatabases)(scope, env, 20000), scope));
  return {
    /** Private IAM invocation only; not an HTTP route. Keep the existing operator check. */
    async migration(raw: unknown, context: InvocationContext): Promise<{ state: 'migrated'; maintenance: true }> {
      const env = configured(), input = object(raw, ['command', 'authorization']);
      if (input.command !== 'migrate' || typeof input.authorization !== 'string'
        || !equal(input.authorization, `Operator ${secretKey(env.OPENSIGHT_OPERATOR_KEY).toString('base64url')}`)) throw new MetadataError('OPERATOR_REQUIRED', 403);
      if (env.OPENSIGHT_MAINTENANCE !== 'frozen') throw new MetadataError('WORKSPACE_MAINTENANCE_REQUIRED', 503);
      try { return await invoke(env, context, async (db, scope) => {
        await (dependencies.migrate ?? ((db, _scope, env) => env.OPENSIGHT_SERVERLESS_DATA === 'durable' ? migrateServerless(db.membership, env) : migrateRuntime(db.membership, env)))(db, scope, env);
        return { state: 'migrated', maintenance: true };
      }); } catch (error) { throw error instanceof MetadataError ? error : new MetadataError('RUNTIME_MIGRATION_FAILED', 503); }
    },
    /** One SQS event per invocation; failures remain retryable, never acknowledged as success. */
    async scheduler(raw: unknown, context: InvocationContext): Promise<{ batchItemFailures: { itemIdentifier: string }[] }> {
      const env = configured(), envelope = object(raw, ['Records']);
      if (!Array.isArray(envelope.Records) || envelope.Records.length !== 1) throw new MetadataError('SCHEDULE_EVENT_INVALID', 400);
      const record = object(envelope.Records[0]), id = identifier(record.messageId);
      const recovery = !!env.OPENSIGHT_RECOVERY_QUEUE_ARN && record.eventSourceARN === env.OPENSIGHT_RECOVERY_QUEUE_ARN;
      if (!env.OPENSIGHT_WORK_QUEUE_ARN || env.OPENSIGHT_WORK_QUEUE_ARN === env.OPENSIGHT_RECOVERY_QUEUE_ARN || record.eventSource !== 'aws:sqs' || !recovery && record.eventSourceARN !== env.OPENSIGHT_WORK_QUEUE_ARN
        || typeof record.body !== 'string' || Buffer.byteLength(record.body) > 4096) throw new MetadataError('SCHEDULE_EVENT_INVALID', 400);
      try {
        const body = object(JSON.parse(record.body) as unknown, ['version', 'deploymentEpoch', 'eventId', 'kind']);
        if (body.version !== 1 || !Number.isSafeInteger(body.deploymentEpoch) || Number(body.deploymentEpoch) < 1 || !['due', 'execute', 'recover', 'deliver'].includes(String(body.kind))) throw new MetadataError('SCHEDULE_EVENT_INVALID', 400);
        const event: ScheduledEvent = { version: 1, deploymentEpoch: Number(body.deploymentEpoch), eventId: identifier(body.eventId), kind: body.kind as ScheduledEvent['kind'] };
        if (recovery !== (event.kind === 'recover')) throw new MetadataError('SCHEDULE_EVENT_INVALID', 400);
        const scheduled = dependencies.scheduled ?? (env.OPENSIGHT_SERVERLESS_DATA === 'durable' ? runServerlessEvent : undefined);
        if (!scheduled) throw new MetadataError('SERVERLESS_DISPATCH_REQUIRED', 503);
        await invoke(env, context, (db, scope) => scheduled(event, db, scope, env));
        return { batchItemFailures: [] };
      } catch (error) {
        if (error instanceof MetadataError && ['INVOCATION_CLEANUP_FAILED', 'RUNTIME_QUARANTINED'].includes(error.code)) throw error;
        return { batchItemFailures: [{ itemIdentifier: id }] };
      }
    },
  };
}
