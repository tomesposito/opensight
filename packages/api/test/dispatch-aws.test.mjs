import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AwsDispatch } from '../dist/dispatch-aws.js';

const account = '0'.repeat(12), region = 'us-east-1';
const config = () => ({ deployment: 'synthetic', workQueueUrl: `https://sqs.${region}.amazonaws.com/${account}/work`, workQueueArn: `arn:aws:sqs:${region}:${account}:work`,
  recoveryQueueUrl: `https://sqs.${region}.amazonaws.com/${account}/recovery`, recoveryQueueArn: `arn:aws:sqs:${region}:${account}:recovery`,
  schedulerGroup: 'synthetic', schedulerRoleArn: `arn:aws:iam::${account}:role/scheduler`, schedulerDlqArn: `arn:aws:sqs:${region}:${account}:scheduler-dlq` });
const envelope = { version: 1, deploymentEpoch: 1, eventId: 'synthetic-event', kind: 'execute' };
const event = { eventId: envelope.eventId, epoch: 1, aggregateId: 'synthetic-object', aggregateRevision: 1, kind: 'object-cleanup', dueAt: 10000, expiresAt: 100000 };
function fixture() {
  const sent = [], schedules = new Map();
  const aws = { region, call: work => work(new AbortController().signal), sqs: { send: async command => {
    sent.push(command); return { MessageId: 'synthetic-message', MD5OfMessageBody: createHash('md5').update(command.input.MessageBody).digest('hex') };
  } }, scheduler: { send: async command => {
    sent.push(command); const p = command.input;
    if (command.constructor.name === 'GetScheduleCommand') return schedules.get(p.Name);
    if (schedules.has(p.Name)) { const e = Error(); e.name = 'ConflictException'; throw e; }
    schedules.set(p.Name, structuredClone(p)); return { ScheduleArn: 'synthetic-schedule' };
  } } };
  return { aws, sent, schedules, dispatch: new AwsDispatch(aws, config(), () => 10000) };
}

test('SR2d queue dispatch requires an acknowledged exact body and prearms recovery with 60-second delay', async () => {
  const f = fixture(); await f.dispatch.recover({ ...envelope, kind: 'recover' });
  await f.dispatch.dispatch(envelope, event);
  assert.equal(f.sent[0].input.DelaySeconds, 60); assert.equal(f.sent[0].input.QueueUrl, config().recoveryQueueUrl);
  assert.equal(f.sent[1].input.DelaySeconds, 0); assert.equal(f.sent[1].input.QueueUrl, config().workQueueUrl);
  assert.deepEqual(JSON.parse(f.sent[1].input.MessageBody), envelope);
  f.aws.sqs.send = async () => ({ MessageId: 'message', MD5OfMessageBody: 'wrong' });
  await assert.rejects(f.dispatch.recover({ ...envelope, kind: 'recover' }), { code: 'DISPATCH_ACKNOWLEDGEMENT_REQUIRED' });
  await assert.rejects(f.dispatch.recover(envelope), { code: 'SCHEDULE_EVENT_INVALID' });
});

test('SR2d future obligations create deterministic one-time schedules; conflicts must match the entire target', async () => {
  const f = fixture(), future = { ...event, dueAt: 20001 };
  await f.dispatch.dispatch(envelope, future); await f.dispatch.dispatch(envelope, future);
  assert.deepEqual(f.sent.map(c => c.constructor.name), ['CreateScheduleCommand', 'CreateScheduleCommand', 'GetScheduleCommand']);
  assert.deepEqual(f.sent[0].input, f.sent[1].input);
  const desired = f.sent[0].input;
  assert.equal(desired.ScheduleExpression, 'at(1970-01-01T00:00:21)');
  assert.deepEqual(desired.FlexibleTimeWindow, { Mode: 'OFF' }); assert.equal(desired.ActionAfterCompletion, 'DELETE');
  assert.deepEqual(desired.Target.RetryPolicy, { MaximumRetryAttempts: 5, MaximumEventAgeInSeconds: 3600 });
  assert.equal(JSON.parse(desired.Target.Input).kind, 'due');
  for (const change of [s => { s.Target.RoleArn += '-wrong'; }, s => { s.Target.Input = '{}'; }, s => { s.Target.RetryPolicy.MaximumRetryAttempts = 9; },
    s => { s.ScheduleExpression = 'rate(1 minute)'; }, s => { s.State = 'DISABLED'; }, s => { s.StartDate = new Date(); }]) {
    const altered = structuredClone(desired); change(altered); f.schedules.set(desired.Name, altered);
    await assert.rejects(f.dispatch.dispatch(envelope, future), { code: 'DISPATCH_SCHEDULE_CONFLICT' });
  }
});

test('SR2d queue and scheduler destinations are private operator configuration, never caller-selected endpoints', () => {
  for (const change of [c => { c.workQueueUrl = c.workQueueUrl.replace('amazonaws.com', 'example.test'); }, c => { c.recoveryQueueUrl += '?x=1'; },
    c => { c.recoveryQueueArn = c.workQueueArn; }, c => { c.schedulerRoleArn = 'role'; }, c => { c.schedulerDlqArn = c.workQueueArn; }]) {
    const c = config(); change(c); assert.throws(() => new AwsDispatch(fixture().aws, c), { code: 'DISPATCH_CONFIG_INVALID' });
  }
});
