import { AwsDispatch } from './dispatch-aws.js';
import type { DispatchEnvelope, DispatchTransport, DurableEvent } from './dispatch.js';
import { MetadataError } from './metadata-db.js';
import type { InvocationAws } from './runtime-aws.js';

export interface RecoveryTransportEntry {
  type: 'recover' | 'dispatch'; envelope: DispatchEnvelope; event?: DurableEvent;
}

/** Audit only deliveries acknowledged by the external transport. */
export function recordingTransport(base: DispatchTransport, log: RecoveryTransportEntry[]): DispatchTransport {
  return {
    async recover(envelope) {
      await base.recover(envelope);
      log.push({ type: 'recover', envelope });
    },
    async dispatch(envelope, event) {
      await base.dispatch(envelope, event);
      log.push({ type: 'dispatch', envelope, event });
    },
  };
}

/** Planning must never acknowledge a recovery message or cleanup continuation. */
export function dryRunTransport(): DispatchTransport {
  const reject = async (): Promise<void> => { throw new MetadataError('STORAGE_RECOVER_DRY_RUN', 503); };
  return { recover: reject, dispatch: reject };
}

export function storageRecoverTransport(aws: InvocationAws, env: NodeJS.ProcessEnv, deployment: string,
  log: RecoveryTransportEntry[]): DispatchTransport {
  const required = (key: string): string => {
    const value = env[key];
    if (!value) throw new MetadataError('DISPATCH_CONFIG_INVALID', 503);
    return value;
  };
  // AwsDispatch cross-validates queue URLs, ARNs, region and scheduler identity.
  return recordingTransport(new AwsDispatch(aws, {
    deployment,
    workQueueUrl: required('OPENSIGHT_WORK_QUEUE_URL'), workQueueArn: required('OPENSIGHT_WORK_QUEUE_ARN'),
    recoveryQueueUrl: required('OPENSIGHT_RECOVERY_QUEUE_URL'), recoveryQueueArn: required('OPENSIGHT_RECOVERY_QUEUE_ARN'),
    schedulerGroup: required('OPENSIGHT_SCHEDULER_GROUP'), schedulerRoleArn: required('OPENSIGHT_SCHEDULER_ROLE_ARN'),
    schedulerDlqArn: required('OPENSIGHT_SCHEDULER_DLQ_ARN'),
  }), log);
}
