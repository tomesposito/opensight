import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { manifestFixture } from './manifest-helpers.mjs';
import { migrateDispatch, dispatchChecksum } from '../dist/dispatch-schema.js';
import { DurableDispatch } from '../dist/dispatch.js';

async function fixture(t) {
  const f = await manifestFixture(t); await migrateDispatch(f.db, 'test', 'frozen', 'sqlite');
  const calls = [], transport = { recover: async envelope => { calls.push(['recover', envelope]); }, dispatch: async (envelope, event) => { calls.push(['dispatch', envelope, event]); } };
  const dispatch = new DurableDispatch(f.db, f.metadata, 'test', transport, 'sqlite');
  await f.db.transaction(c => c.query('CREATE TABLE synthetic_business (id TEXT PRIMARY KEY)')); await f.open();
  return { ...f, calls, transport, dispatch,
    request: async (index = 0) => ({ kind: 'upload-complete', requestDigest: 'a'.repeat(64), idempotencyKey: randomUUID(), revisions: await f.metadata.revisions(f.contexts[index]) }),
    async business(c, now) { const id = randomUUID(); await c.query('INSERT INTO synthetic_business VALUES (?)', [id]); return { receipt: { id, revision: 1 }, events: [{ aggregateId: id, aggregateRevision: 1, kind: 'ingest', dueAt: now, expiresAt: now + 86400000 }] }; },
  };
}

test('SR2d recovery is acknowledged before a branded business commit and duplicates run once', async t => {
  const f = await fixture(t), input = await f.request(), handle = await f.dispatch.prepare(f.contexts[0], input);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], 'recover');
  assert.deepEqual(Object.keys(f.calls[0][1]).sort(), ['deploymentEpoch', 'eventId', 'kind', 'version']);
  assert.equal((await f.rows('synthetic_business')).length, 0);
  const receipt = await f.dispatch.commit(handle, f.business);
  assert.deepEqual(await f.dispatch.commit(handle, () => assert.fail('duplicate commit')), receipt);
  const retry = await f.dispatch.prepare(f.contexts[0], input);
  assert.equal(f.calls.length, 1, 'committed replay needs no new external obligation');
  assert.deepEqual(await f.dispatch.commit(retry, () => assert.fail('replay')), receipt);
  assert.equal((await f.rows('synthetic_business')).length, 1);
  await f.dispatch.dispatch(handle); await f.dispatch.recover(f.calls[0][1]);
  assert.equal(f.calls.filter(c => c[0] === 'dispatch').length, 1);
  const event = f.calls.find(c => c[0] === 'dispatch')[1], inspected = await f.dispatch.inspect(event);
  assert.equal(inspected.aggregateId, receipt.id); assert.equal(inspected.scope.userId, 'admin');
  await f.db.transaction(c => f.dispatch.terminal(c, event.eventId, event.deploymentEpoch));
  assert.equal(await f.dispatch.inspect(event), undefined);
});

test('SR2d ambiguous recovery sends cannot mint publication rights; early/absent recovery retries', async t => {
  const f = await fixture(t), input = await f.request();
  f.transport.recover = async event => { f.calls.push(['recover', event]); throw Error('ambiguous receipt'); };
  await assert.rejects(f.dispatch.prepare(f.contexts[0], input));
  const envelope = f.calls[0][1];
  await assert.rejects(f.dispatch.commit({ intentId: envelope.eventId }, f.business), { code: 'DISPATCH_PREPARATION_REQUIRED' });
  await assert.rejects(f.dispatch.recover(envelope), { code: 'DISPATCH_RECOVERY_EARLY' });
  await assert.rejects(f.dispatch.recover({ ...envelope, eventId: randomUUID() }), { code: 'DISPATCH_INTENT_UNAVAILABLE' });
  await f.db.transaction(c => c.query('UPDATE sr_dispatch_intent SET commit_until = 1'));
  await f.dispatch.recover(envelope); await f.dispatch.recover(envelope);
  assert.equal((await f.rows('sr_dispatch_intent'))[0].state, 'aborted');
  assert.deepEqual(await f.rows('synthetic_business'), []); assert.deepEqual(await f.rows('sr_outbox'), []);
});

test('SR2d crashed dispatch and lost send receipt retain pending work for durable recovery', async t => {
  const f = await fixture(t), input = await f.request(), handle = await f.dispatch.prepare(f.contexts[0], input);
  await f.dispatch.commit(handle, f.business);
  f.transport.dispatch = async (envelope, event) => { f.calls.push(['uncertain', envelope, event]); throw Error('lost send receipt'); };
  await assert.rejects(f.dispatch.dispatch(handle)); assert.equal((await f.rows('sr_outbox'))[0].state, 'pending');
  f.transport.dispatch = async (envelope, event) => { f.calls.push(['resent', envelope, event]); };
  await f.dispatch.recover(f.calls[0][1]);
  assert.deepEqual(f.calls[1].slice(1), f.calls[2].slice(1));
  assert.equal((await f.rows('sr_outbox'))[0].state, 'dispatched'); assert.equal((await f.rows('synthetic_business')).length, 1);
});

test('SR2d business and outbox rollback together; a failed callback never acknowledges accepted work', async t => {
  const f = await fixture(t), handle = await f.dispatch.prepare(f.contexts[0], await f.request());
  for (const change of [result => { result.events[0].expiresAt = 1; }, result => { result.events.push(result.events[0]); }, result => { result.receipt.revision = 0; }]) {
    await assert.rejects(f.dispatch.commit(handle, async (c, now) => { const result = await f.business(c, now); change(result); return result; }));
    assert.deepEqual(await f.rows('synthetic_business'), []); assert.deepEqual(await f.rows('sr_outbox'), []);
    assert.equal((await f.rows('sr_dispatch_intent'))[0].state, 'prepared');
  }
  await f.dispatch.commit(handle, f.business); assert.equal((await f.rows('synthetic_business')).length, 1);
});

test('SR2d idempotency is scoped, digest-bound and reauthorized on every replay', async t => {
  const f = await fixture(t), input = await f.request(), handle = await f.dispatch.prepare(f.contexts[0], input);
  await assert.rejects(f.dispatch.prepare(f.contexts[0], { ...input, requestDigest: 'b'.repeat(64) }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(f.dispatch.prepare({ ...f.contexts[0] }, input), { code: 'TENANT_CONTEXT_REQUIRED' });
  const other = await f.dispatch.prepare(f.contexts[1], { ...input, revisions: await f.metadata.revisions(f.contexts[1]) });
  assert.notEqual(other.intentId, handle.intentId);
  await f.dispatch.commit(handle, f.business);
  await f.db.transaction(c => c.query("UPDATE h2_memberships SET status = 'removed' WHERE namespace_id = 'one'"));
  await assert.rejects(f.dispatch.commit(handle, f.business), { code: 'UNKNOWN_PRINCIPAL' });
  await assert.rejects(f.dispatch.prepare(f.contexts[0], input), { code: 'UNKNOWN_PRINCIPAL' });
  await f.dispatch.commit(other, f.business); assert.equal((await f.rows('synthetic_business')).length, 2);
});

test('SR2d expiry, epoch changes, roles, current revisions and local brands fence commit', async t => {
  for (const [sql, code] of [["UPDATE sr_dispatch_intent SET commit_until = 1", 'DISPATCH_INTENT_EXPIRED'], ["UPDATE sr_control SET epoch = epoch + 1", 'WORKSPACE_MAINTENANCE'],
    ["UPDATE h1_revisions SET policy = policy + 1 WHERE namespace_id = 'one'", 'METADATA_REVISED'], ["UPDATE h1_tenants SET state = 'suspended'", 'TENANT_UNAVAILABLE']]) {
    const f = await fixture(t), handle = await f.dispatch.prepare(f.contexts[0], await f.request());
    await f.db.transaction(c => c.query(sql)); await assert.rejects(f.dispatch.commit(handle, f.business), { code }); assert.deepEqual(await f.rows('synthetic_business'), []);
  }
  const f = await fixture(t), handle = await f.dispatch.prepare(f.contexts[0], await f.request());
  const otherProcess = new DurableDispatch(f.db, f.metadata, 'test', f.transport, 'sqlite');
  await assert.rejects(otherProcess.commit(handle, f.business), { code: 'DISPATCH_PREPARATION_REQUIRED' });
});

test('SR2d prepared-intent capacity bounds unaccepted work and scoped activity reclaims expired slots', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 8; i++) await f.dispatch.prepare(f.contexts[0], await f.request());
  await assert.rejects(f.dispatch.prepare(f.contexts[0], await f.request()), { code: 'DISPATCH_ADMISSION_REFUSED' }); assert.equal(f.calls.length, 8);
  await f.db.transaction(c => c.query('UPDATE sr_dispatch_intent SET commit_until = 1'));
  await f.dispatch.prepare(f.contexts[0], await f.request());
  assert.equal((await f.rows('sr_dispatch_intent')).filter(r => r.state === 'aborted').length, 8);
});

test('SR2d migration requires frozen drained exact predecessor schemas and refuses partial tables', async t => {
  const f = await fixture(t);
  await assert.rejects(migrateDispatch(f.db, 'test', 'frozen', 'sqlite'), { code: 'WORKSPACE_MAINTENANCE_REQUIRED' });
  await f.db.transaction(c => c.query("UPDATE sr_control SET state = 'maintenance'"));
  await migrateDispatch(f.db, 'test', 'frozen', 'sqlite');
  assert.equal((await f.rows('sr_dispatch_schema'))[0].checksum, dispatchChecksum);
  await f.db.transaction(c => c.query("UPDATE sr_dispatch_schema SET checksum = 'wrong'"));
  await assert.rejects(migrateDispatch(f.db, 'test', 'frozen', 'sqlite'), { code: 'DISPATCH_FOREIGN_SCHEMA' });
  await f.db.transaction(c => c.query('DROP TABLE sr_outbox'));
  await assert.rejects(migrateDispatch(f.db, 'test', 'frozen', 'sqlite'), { code: 'DISPATCH_FOREIGN_SCHEMA' });
});
