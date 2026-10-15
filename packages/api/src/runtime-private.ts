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
import { initialCommand, initialMigrationCommand, initialAdministration, prepareInitial, type InitialResult, type InitialCommand } from './runtime-initial.js';
import { runServerlessEvent, replayServerlessEvent } from './serverless-worker.js';
import { dispatchEnvelope } from './dispatch.js';
import { replayCommand } from './replay-command.js';

export interface ScheduledEvent { version: 1; deploymentEpoch: number; eventId: string; kind: 'due' | 'execute' | 'recover' }
export interface PrivateRuntimeDependencies extends Pick<RuntimeDependencies, 'databases'> {
  /** SR3 must authorize/claim/fence the referenced durable event before doing work. */
  scheduled?(event: ScheduledEvent, db: InvocationDatabases, scope: InvocationScope, env: NodeJS.ProcessEnv): Promise<void>;
  replay?(event: ScheduledEvent, db: InvocationDatabases, scope: InvocationScope, env: NodeJS.ProcessEnv, acceptAmbiguous: boolean): Promise<void>;
  prepareInitial?(db: InvocationDatabases, env: NodeJS.ProcessEnv): Promise<void>;
  initial?(db: InvocationDatabases, env: NodeJS.ProcessEnv, input: InitialCommand): Promise<InitialResult>;
  migrate?(db: InvocationDatabases, scope: InvocationScope, env: NodeJS.ProcessEnv): Promise<void>;
}
export function createPrivateRuntime(environment: () => NodeJS.ProcessEnv = () => process.env, dependencies: PrivateRuntimeDependencies = {}) {
  const configured = () => { const env = environment(); if (runtimeMode(env) !== 'lambda') throw new MetadataError('LAMBDA_MODE_REQUIRED', 503); deploymentId(env); return env; };
  const invoke = <T>(env: NodeJS.ProcessEnv, context: InvocationContext, work: (db: InvocationDatabases, scope: InvocationScope) => Promise<T>) =>
    new InvocationScope(invocationDeadline(context, Date.now(), 110000)).run(scope => work((dependencies.databases ?? invocationDatabases)(scope, env, 20000), scope));
  return {
    /** Only the separately published IAM-only replay function exports this method. */
    async replay(raw: unknown, context: InvocationContext): Promise<{ state: 'replayed' }> {
      const input = replayCommand(raw), env = configured();
      if (env.OPENSIGHT_SERVERLESS_DATA !== 'durable') throw new MetadataError('DISPATCH_REPLAY_DENIED', 409);
      await invoke(env, context, (db, scope) => (dependencies.replay ?? replayServerlessEvent)(input.event, db, scope, env, input.acceptAmbiguous));
      return { state: 'replayed' };
    },
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
    async administration(raw: unknown, context: InvocationContext): Promise<InitialResult | { state: 'migrated'; maintenance: true } | { state: 'replayed' }> {
      const env = configured();
      if (raw && typeof raw === 'object' && 'command' in raw && raw.command === 'replay-event') {
        const input = object(raw, ['command', 'authorization', 'event', 'acceptAmbiguous']);
        if (typeof input.authorization !== 'string' || !equal(input.authorization, `Operator ${secretKey(env.OPENSIGHT_OPERATOR_KEY).toString('base64url')}`)) throw new MetadataError('OPERATOR_REQUIRED', 403);
        if (typeof input.acceptAmbiguous !== 'boolean') throw new MetadataError('SCHEDULE_EVENT_INVALID', 400);
        const event = dispatchEnvelope(input.event);
        if (event.kind === 'recover' || env.OPENSIGHT_SERVERLESS_DATA !== 'durable') throw new MetadataError('DISPATCH_REPLAY_DENIED', 409);
        await invoke(env, context, (db, scope) => (dependencies.replay ?? replayServerlessEvent)(event, db, scope, env, input.acceptAmbiguous as boolean));
        return { state: 'replayed' };
      }
      if (raw && typeof raw === 'object' && 'command' in raw && raw.command === 'migrate') {
        initialMigrationCommand(raw, env);
        try { return await invoke(env, context, async db => {
          await (dependencies.prepareInitial ?? ((db, env) => prepareInitial(db.membership, env)))(db, env);
          return { state: 'migrated', maintenance: true } as const;
        }); } catch (error) { throw error instanceof MetadataError ? error : new MetadataError('INITIAL_PREPARATION_FAILED', 503); }
      }
      const input = initialCommand(raw, env);
      try { return await invoke(env, context, db => (dependencies.initial ?? ((db, env, input) => initialAdministration(db.membership, env, input)))(db, env, input)); }
      catch (error) { throw error instanceof MetadataError ? error : new MetadataError('INITIAL_ACTIVATION_FAILED', 503); }
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
        if (body.version !== 1 || !Number.isSafeInteger(body.deploymentEpoch) || Number(body.deploymentEpoch) < 1 || !['due', 'execute', 'recover'].includes(String(body.kind))) throw new MetadataError('SCHEDULE_EVENT_INVALID', 400);
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
