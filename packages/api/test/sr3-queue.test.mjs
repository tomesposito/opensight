import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPrivateRuntime } from '../dist/runtime-private.js';
import { runtimeEnv, context } from './runtime-helpers.mjs';
import { environment } from './hosted-helpers.mjs';

const env = () => ({ ...environment(), ...runtimeEnv(), OPENSIGHT_WORK_QUEUE_ARN: 'synthetic-work', OPENSIGHT_RECOVERY_QUEUE_ARN: 'synthetic-recovery' });
const record = (kind = 'execute') => ({ messageId: 'synthetic-message', eventSource: 'aws:sqs', eventSourceARN: kind === 'recover' ? 'synthetic-recovery' : 'synthetic-work', body: JSON.stringify({ version: 1, deploymentEpoch: 1, eventId: 'synthetic-event', kind }) });

test('SR3 local broker model routes failed/poisoned records to the source DLQ after five receives, never acking failed work', async () => {
  let calls = 0;
  const runtime = createPrivateRuntime(env, { databases: () => ({}), scheduled: async () => { calls++; throw Error('injected failure'); } });
  for (const kind of ['execute', 'recover']) {
    const source = [record(kind)], dlq = [];
    for (let receive = 1; receive <= 5; receive++) {
      const result = await runtime.scheduler({ Records: source }, context);
      assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: source[0].messageId }]);
      if (receive === 5) dlq.push(source.shift());
    }
    assert.equal(source.length, 0); assert.equal(dlq.length, 1);
  }
  assert.equal(calls, 10);
  const poison = record(); poison.body = '{';
  assert.equal((await runtime.scheduler({ Records: [poison] }, context)).batchItemFailures.length, 1); assert.equal(calls, 10);
});
test('SR3 single-record source binding rejects batches, wrong queues, unknown envelope fields/versions and unsupported deliver kind before SQL', async () => {
  const runtime = createPrivateRuntime(env, { databases: () => assert.fail('must validate before SQL'), scheduled: async () => {} });
  for (const records of [[], [record(), record()], [{ ...record(), eventSourceARN: 'synthetic-dlq' }]]) await assert.rejects(runtime.scheduler({ Records: records }, context));
  for (const patch of [{ kind: 'deliver' }, { version: 2 }, { deploymentEpoch: 0 }, { scope: 'forged' }, { recipients: ['private@example.test'] }]) {
    const r = record(); r.body = JSON.stringify({ ...JSON.parse(r.body), ...patch });
    assert.equal((await runtime.scheduler({ Records: [r] }, context)).batchItemFailures.length, 1);
  }
});
test('SR3 operator replay requires explicit scoped command, operator authentication and ambiguity choice before SQL', async () => {
  const e = { ...env(), OPENSIGHT_SERVERLESS_DATA: 'durable' }; let replays = 0;
  const runtime = createPrivateRuntime(() => e, { databases: () => ({}), replay: async (_event, _db, _scope, _env, accept) => { assert.equal(accept, false); replays++; } });
  const command = { command: 'replay-event', authorization: `Operator ${Buffer.from(e.OPENSIGHT_OPERATOR_KEY, 'base64').toString('base64url')}`, event: JSON.parse(record().body), acceptAmbiguous: false };
  for (const patch of [{ authorization: 'Operator forged' }, { acceptAmbiguous: undefined }, { event: JSON.parse(record('recover').body) }, { all: true }]) await assert.rejects(runtime.administration({ ...command, ...patch }, context));
  assert.equal(replays, 0); assert.deepEqual(await runtime.administration(command, context), { state: 'replayed' }); assert.equal(replays, 1);
});
test('SR3 Terraform keeps work/recovery DLQs, retention, visibility, single-record partial failures and one-shot group definitions', async () => {
  const source = await readFile(new URL('../../../ops/serverless/validation/pilot.tf', import.meta.url), 'utf8');
  for (const pattern of [/\["work", "recovery", "scheduler"\]/, /message_retention_seconds\s*=\s*1209600/, /message_retention_seconds\s*=\s*345600/, /visibility_timeout_seconds\s*=\s*720/, /maxReceiveCount\s*=\s*5/, /batch_size\s*=\s*1/, /ReportBatchItemFailures/]) assert.match(source, pattern);
  assert.doesNotMatch(source, /schedule_expression\s*=\s*"(?:rate|cron)\(/);
});
