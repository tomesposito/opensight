import test from 'node:test';
import assert from 'node:assert/strict';
import { guard } from '../ops/serverless/release-watchdog.mjs';
const operationId = '00000000-0000-0000-0000-000000000001', config = { functions: ['request', 'work', 'recovery', 'ingress'], mappings: ['work', 'recovery'] };
test('SR4c watchdog ignores completed, missing and unrelated operation records', async () => {
  for (const record of [null, { operationId: 'other', phase: 'verifying' }, ...['complete', 'rolled-back'].map(phase => ({ operationId, phase }))]) {
    assert.deepEqual(await guard({ operationId }, { read: async () => record, stop: () => assert.fail('unexpected stop'), disable: () => assert.fail('unexpected disable') }, config), { stopped: false });
  }
});
test('SR4c abandoned promotion stops every admission path despite one failed call', async () => {
  const calls = [];
  await assert.rejects(guard({ operationId }, { read: async () => ({ operationId, phase: 'verifying' }),
    stop: async name => { calls.push(name); if (name === 'request') throw Error('synthetic'); }, disable: async id => calls.push('mapping-' + id) }, config), /WATCHDOG_STOP_INCOMPLETE/);
  assert.equal(calls.length, 6);
  await assert.rejects(guard({ operationId: '../invalid' }, {}, config), /WATCHDOG_OPERATION_INVALID/);
});
