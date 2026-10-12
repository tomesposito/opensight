import test from 'node:test';
import assert from 'node:assert/strict';
import { sr3Fixture } from './sr3-helpers.mjs';
import { DurableExecution } from '../dist/durable-execution.js';
import { MetadataError } from '../dist/metadata-db.js';
import { migrateExecutions } from '../dist/execution-schema.js';

async function ready(t) {
  const f = await sr3Fixture(t); await f.put(); await f.store.enqueue(f.contexts[0], 'report');
  return { ...f, envelope: await f.event('job-execute') };
}
test('SR3 claim overlap, crash expiry, token branding and monotonic fences reject obsolete publishers', async t => {
  const f = await ready(t), first = await f.execution.claim(f.envelope), secondProcess = new DurableExecution(f.dispatch);
  await assert.rejects(secondProcess.claim(f.envelope), { code: 'DISPATCH_EXECUTION_BUSY' });
  await assert.rejects(f.execution.complete({ ...first }), { code: 'EXECUTION_HANDLE_REQUIRED' });
  f.time.now += 110001;
  const second = await secondProcess.claim(f.envelope);
  assert.equal(BigInt(second.fence), BigInt(first.fence) + 1n); assert.equal(second.attempts, 2);
  await assert.rejects(f.execution.complete(first), { code: 'DISPATCH_CLAIM_LOST' });
  await secondProcess.complete(second);
  assert.equal(await f.execution.claim(f.envelope), undefined);
});
test('SR3 five execution attempts are bounded across replay, duplicate receipt and worker replacement', async t => {
  const f = await ready(t);
  for (let i = 1; i <= 5; i++) {
    const handle = await f.execution.claim(f.envelope); assert.equal(handle.attempts, i);
    await f.execution.failed(handle, new MetadataError('STORE_UNAVAILABLE', 503));
  }
  assert.equal(await f.execution.claim(f.envelope), undefined);
  assert.equal((await f.rows('sr_execution'))[0].state, 'failed');
  await assert.rejects(f.execution.replay(f.envelope, async () => {}), { code: 'DISPATCH_REPLAY_DENIED' });
});
test('SR3 event expiry and deployment epoch changes never restore authority', async t => {
  const f = await ready(t); f.time.now += 86400001;
  assert.equal(await f.execution.claim(f.envelope), undefined);
  await assert.rejects(f.execution.replay(f.envelope, async () => {}), { code: 'DISPATCH_REPLAY_DENIED' });
  await f.sql('UPDATE sr_control SET epoch = epoch + 1');
  assert.equal(await f.execution.claim(f.envelope), undefined);
});
test('SR3 private replay checks current domain authority before reissuing and preserves attempts', async t => {
  const f = await ready(t), handle = await f.execution.claim(f.envelope);
  await f.execution.failed(handle, new MetadataError('STORE_UNAVAILABLE', 503));
  const count = f.calls.length;
  await assert.rejects(f.execution.replay(f.envelope, async () => { throw new MetadataError('JOB_REVISED', 403); }), { code: 'JOB_REVISED' });
  assert.equal(f.calls.length, count);
  await f.execution.replay(f.envelope, async () => {});
  assert.equal((await f.rows('sr_execution'))[0].attempts, 1);
  assert.equal((await f.execution.claim(f.envelope)).attempts, 2);
});
test('SR3 execution migration requires frozen drained state and exact complete schema', async t => {
  const f = await sr3Fixture(t);
  await assert.rejects(migrateExecutions(f.db, 'test', 'frozen', 'sqlite'), { code: 'WORKSPACE_MAINTENANCE_REQUIRED' });
  await f.sql("UPDATE sr_control SET state = 'maintenance'");
  await migrateExecutions(f.db, 'test', 'frozen', 'sqlite');
  await f.sql('DROP TABLE sr_job_due');
  await assert.rejects(migrateExecutions(f.db, 'test', 'frozen', 'sqlite'), { code: 'EXECUTION_FOREIGN_SCHEMA' });
});
