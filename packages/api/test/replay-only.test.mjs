import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateRuntime } from '../dist/runtime-private.js';
import { handler } from '../dist/replay-lambda.js';
import { runtimeEnv, context } from './runtime-helpers.mjs';

const input = () => ({ version: 1, event: { version: 1, deploymentEpoch: 1, eventId: 'synthetic-event', kind: 'execute' }, acceptAmbiguous: false });
test('replay-only handler rejects administrative commands and extra fields before AWS or SQL', async () => {
  const runtime = createPrivateRuntime(() => ({ ...runtimeEnv(), OPENSIGHT_SERVERLESS_DATA: 'durable' }), { databases: () => assert.fail('invalid replay opened SQL') });
  for (const value of [null, [], {}, { command: 'migrate' }, { ...input(), sql: 'SELECT 1' }, { ...input(), authorization: 'Operator x' },
    { ...input(), acceptAmbiguous: 'true' }, { ...input(), event: { ...input().event, kind: 'recover' } },
    { ...input(), event: { ...input().event, deploymentEpoch: 0 } }, { ...input(), event: { ...input().event, recipient: 'injected' } }]) {
    await assert.rejects(runtime.replay(value, context)); await assert.rejects(handler(value, context));
  }
});
test('replay-only handler preserves exact current-authority envelope and explicit ambiguity decision', async () => {
  let opened = 0, closed = 0;
  const runtime = createPrivateRuntime(() => ({ ...runtimeEnv(), OPENSIGHT_SERVERLESS_DATA: 'durable' }), {
    databases(scope) { opened++; scope.own({ close: async () => closed++, force() {} }); return {}; },
    replay: async (event, _db, scope, _env, accept) => { scope.check(); assert.deepEqual(event, input().event); assert.equal(accept, true); },
    migrate: async () => assert.fail('replay reached migration'), initial: async () => assert.fail('replay reached activation'),
  });
  assert.deepEqual(await runtime.replay({ ...input(), acceptAmbiguous: true }, context), { state: 'replayed' });
  assert.equal(opened, 1); assert.equal(closed, 1);
});
