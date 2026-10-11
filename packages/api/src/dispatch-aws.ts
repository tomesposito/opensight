import { createHash } from 'node:crypto';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { CreateScheduleCommand, GetScheduleCommand, type Target } from '@aws-sdk/client-scheduler';
import { MetadataError } from './metadata-db.js';
import type { InvocationAws } from './runtime-aws.js';
import type { DispatchEnvelope, DispatchTransport, DurableEvent } from './dispatch.js';

export interface DispatchAwsConfig {
  deployment: string; workQueueUrl: string; workQueueArn: string; recoveryQueueUrl: string; recoveryQueueArn: string;
  schedulerGroup: string; schedulerRoleArn: string; schedulerDlqArn: string;
}
const bad = (): never => { throw new MetadataError('DISPATCH_CONFIG_INVALID', 503); };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
function payload(envelope: DispatchEnvelope): string {
  if (envelope.version !== 1 || !Number.isSafeInteger(envelope.deploymentEpoch) || envelope.deploymentEpoch < 1
    || !/^[A-Za-z0-9_-]{1,200}$/.test(envelope.eventId) || !['recover', 'execute', 'due'].includes(envelope.kind)) throw new MetadataError('SCHEDULE_EVENT_INVALID', 400);
  return JSON.stringify({ version: 1, deploymentEpoch: envelope.deploymentEpoch, eventId: envelope.eventId, kind: envelope.kind });
}
/** No background interval: only an accepted obligation creates a queue message or schedule. */
export class AwsDispatch implements DispatchTransport {
  private readonly config: DispatchAwsConfig;
  constructor(private readonly aws: InvocationAws, config: DispatchAwsConfig, private readonly clock = Date.now) {
    this.config = { ...config };
    const queue = (url: string, arn: string): string => {
      try {
        const u = new URL(url), parts = /^\/(\d{12})\/([A-Za-z0-9_-]{1,80})$/.exec(u.pathname);
        if (u.protocol !== 'https:' || ![`sqs.${aws.region}.amazonaws.com`, `sqs.${aws.region}.api.aws`].includes(u.hostname)
          || u.port || u.username || u.password || u.search || u.hash || !parts || arn !== `arn:aws:sqs:${aws.region}:${parts[1]}:${parts[2]}`) return bad();
        return parts[1]!;
      } catch { return bad(); }
    };
    const account = queue(config.workQueueUrl, config.workQueueArn);
    if (queue(config.recoveryQueueUrl, config.recoveryQueueArn) !== account || config.workQueueArn === config.recoveryQueueArn
      || !/^[A-Za-z0-9_-]{1,80}$/.test(config.deployment) || !/^[A-Za-z0-9_.-]{1,64}$/.test(config.schedulerGroup)
      || !new RegExp(`^arn:aws:iam::${account}:role/[A-Za-z0-9_+=,.@/-]{1,512}$`).test(config.schedulerRoleArn)
      || !new RegExp(`^arn:aws:sqs:${aws.region}:${account}:[A-Za-z0-9_-]{1,80}$`).test(config.schedulerDlqArn)
      || [config.workQueueArn, config.recoveryQueueArn].includes(config.schedulerDlqArn)) bad();
  }
  private async send(url: string, envelope: DispatchEnvelope, delay = 0): Promise<void> {
    const body = payload(envelope);
    const result = await this.aws.call(signal => this.aws.sqs.send(new SendMessageCommand({ QueueUrl: url, MessageBody: body, DelaySeconds: delay }), { abortSignal: signal }));
    if (!result.MessageId || result.MD5OfMessageBody !== createHash('md5').update(body).digest('hex')) throw new MetadataError('DISPATCH_ACKNOWLEDGEMENT_REQUIRED', 503);
  }
  async recover(envelope: DispatchEnvelope): Promise<void> {
    if (envelope.kind !== 'recover') throw new MetadataError('SCHEDULE_EVENT_INVALID', 400);
    await this.send(this.config.recoveryQueueUrl, envelope, 60);
  }
  async dispatch(envelope: DispatchEnvelope, event: DurableEvent): Promise<void> {
    if (envelope.eventId !== event.eventId || envelope.deploymentEpoch !== event.epoch || envelope.kind !== 'execute'
      || !Number.isSafeInteger(event.dueAt) || !Number.isSafeInteger(event.expiresAt) || event.expiresAt <= event.dueAt) throw new MetadataError('SCHEDULE_EVENT_INVALID', 400);
    if (event.dueAt <= this.clock()) { await this.send(this.config.workQueueUrl, envelope); return; }
    const input = payload({ ...envelope, kind: 'due' });
    const identity = JSON.stringify([this.config.deployment, event.epoch, event.eventId, event.aggregateRevision, event.dueAt]);
    const token = createHash('sha256').update(identity).digest('hex'), name = `os-${token.slice(0, 48)}`;
    const expression = `at(${new Date(Math.ceil(event.dueAt / 1000) * 1000).toISOString().slice(0, 19)})`;
    const target: Target = { Arn: this.config.workQueueArn, RoleArn: this.config.schedulerRoleArn, Input: input,
      RetryPolicy: { MaximumRetryAttempts: 5, MaximumEventAgeInSeconds: 3600 }, DeadLetterConfig: { Arn: this.config.schedulerDlqArn } };
    await this.aws.call(async signal => {
      try {
        const result = await this.aws.scheduler.send(new CreateScheduleCommand({ Name: name, GroupName: this.config.schedulerGroup, ClientToken: token,
          ScheduleExpression: expression, ScheduleExpressionTimezone: 'UTC', FlexibleTimeWindow: { Mode: 'OFF' }, State: 'ENABLED', ActionAfterCompletion: 'DELETE', Target: target }), { abortSignal: signal });
        if (!result.ScheduleArn) throw new MetadataError('DISPATCH_ACKNOWLEDGEMENT_REQUIRED', 503);
      } catch (error) {
        if (!(error instanceof Error) || error.name !== 'ConflictException') throw error;
        const actual = await this.aws.scheduler.send(new GetScheduleCommand({ Name: name, GroupName: this.config.schedulerGroup }), { abortSignal: signal });
        if (actual.Name !== name || actual.GroupName !== this.config.schedulerGroup || actual.ScheduleExpression !== expression || actual.ScheduleExpressionTimezone !== 'UTC'
          || actual.State !== 'ENABLED' || actual.ActionAfterCompletion !== 'DELETE' || canonical(actual.FlexibleTimeWindow) !== canonical({ Mode: 'OFF' })
          || actual.StartDate !== undefined || actual.EndDate !== undefined || canonical(actual.Target) !== canonical(target)) throw new MetadataError('DISPATCH_SCHEDULE_CONFLICT', 503);
      }
    });
  }
}
