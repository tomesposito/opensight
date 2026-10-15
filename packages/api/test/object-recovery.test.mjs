import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ObjectCollector } from '../dist/object-collector.js';
import { ObjectRecovery } from '../dist/object-recovery.js';
import { MetadataError } from '../dist/metadata-db.js';
import { uploadFixture, directRequest } from './serverless-upload-helpers.mjs';

async function fixture(t, deletion) {
  const f = await uploadFixture(t), ctx = f.contexts[0];
  await f.uploads.reserve(ctx, directRequest(), randomUUID(), async () => {});
  const raw = (await f.rows('sr_object')).find(r => r.purpose === 'raw-upload');
  const event = (await f.rows('sr_outbox')).find(e => e.aggregate_id === raw.object_id);
  const now = Date.now();
  await f.db.transaction(async c => {
    await c.query('UPDATE sr_object SET created_at = ?, retention_until = ?, signature_until = ? WHERE object_id = ?', [now - 90000000, now - 1000, now - 90000000, raw.object_id]);
    // The stranded state from #96: the cleanup event expired and was terminalized.
    await c.query("UPDATE sr_outbox SET due_at = ?, expires_at = ?, state = 'terminal' WHERE event_id = ?", [now - 7200000, now - 3600000, event.event_id]);
  });
  const calls = [];
  const objects = deletion ?? { latest: async key => { calls.push(['head', key]); return undefined; }, remove: async (key, version) => { calls.push(['delete', key, version]); } };
  const collector = new ObjectCollector(f.db, f.dispatch, objects, 'sqlite');
  const recovery = new ObjectRecovery(f.db, f.dispatch, collector);
  const scope = { tenantId: ctx.tenantId, namespaceId: ctx.namespaceId, userId: ctx.userId };
  const gauge = async () => (await f.rows('sr_storage_usage'))[0].reserved_bytes;
  const objectState = async () => (await f.rows('sr_object')).find(r => r.object_id === raw.object_id).state;
  const obligations = async () => (await f.rows('sr_outbox')).filter(e => e.aggregate_id === raw.object_id);
  return { ...f, raw, event, scope, ctx, collector, recovery, calls, objects, gauge, objectState, obligations };
}

test('SR96 recovery replaces an expired obligation with exact-version proof; duplicate is a no-op', async t => {
  const f = await fixture(t), before = await f.gauge();
  const report = await f.recovery.recover(f.scope, [f.raw.object_id]);
  assert.equal(report.dryRun, false);
  const entry = report.objects[0];
  assert.equal(entry.decision, 'recovered');
  assert.deepEqual(entry.supersededEventIds, [f.event.event_id]);
  assert.ok(entry.newEventId && entry.newEventId !== f.event.event_id);
  assert.equal(entry.aggregateRevision, 2);
  assert.equal(await f.objectState(), 'deleted');
  assert.equal(await f.gauge(), before - Number(f.raw.capacity_bytes));
  // The already-absent key needed no DELETE: HEAD proved absence, the atomic
  // ledger/gauge update released the reservation.
  assert.deepEqual(f.calls, [['head', f.raw.object_key]]);
  const events = await f.obligations();
  assert.equal(events.length, 2);
  assert.ok(events.every(e => e.state === 'terminal'));
  const again = await f.recovery.recover(f.scope, [f.raw.object_id]);
  assert.equal(again.objects[0].decision, 'already-complete');
  assert.equal((await f.obligations()).length, 2, 'no new obligation prearmed');
  assert.equal(await f.gauge(), before - Number(f.raw.capacity_bytes), 'no double release');
});

test('SR96 partial completion resumes the pending obligation without double-release', async t => {
  const f = await fixture(t), before = await f.gauge();
  const crashing = { latest: async () => 'v1', remove: async () => { throw new MetadataError('WORKER_CRASH', 503); } };
  const interrupted = new ObjectRecovery(f.db, f.dispatch, new ObjectCollector(f.db, f.dispatch, crashing, 'sqlite'));
  const first = await interrupted.recover(f.scope, [f.raw.object_id]);
  assert.equal(first.objects[0].decision, 'failed');
  assert.equal(first.objects[0].error, 'WORKER_CRASH');
  assert.equal(await f.objectState(), 'retiring');
  assert.equal(await f.gauge(), before, 'no gauge release on failure');
  const pending = (await f.obligations()).filter(e => e.state !== 'terminal');
  assert.equal(pending.length, 1, 'the prearmed obligation stays pending');
  // A later run resumes that same obligation instead of prearming another.
  const resumed = new ObjectRecovery(f.db, f.dispatch, new ObjectCollector(f.db, f.dispatch, { latest: async () => 'v1', remove: async () => {} }, 'sqlite'));
  const second = await resumed.recover(f.scope, [f.raw.object_id]);
  assert.equal(second.objects[0].decision, 'recovered');
  assert.equal(second.objects[0].newEventId, pending[0].event_id, 'resumed, not duplicated');
  assert.equal((await f.obligations()).length, 2, 'original terminal + the one resumed obligation');
  assert.equal(await f.gauge(), before - Number(f.raw.capacity_bytes), 'released exactly once');
});

test('SR96 an expired fresh envelope is superseded, never replayed', async t => {
  const f = await fixture(t), before = await f.gauge();
  const crashing = { latest: async () => 'v1', remove: async () => { throw new MetadataError('WORKER_CRASH', 503); } };
  const interrupted = new ObjectRecovery(f.db, f.dispatch, new ObjectCollector(f.db, f.dispatch, crashing, 'sqlite'));
  await interrupted.recover(f.scope, [f.raw.object_id]);
  const pending = (await f.obligations()).find(e => e.state !== 'terminal');
  const past = Date.now();
  await f.db.transaction(c => c.query('UPDATE sr_outbox SET due_at = ?, expires_at = ? WHERE event_id = ?', [past - 2000, past - 1000, pending.event_id]));
  const second = await f.recovery.recover(f.scope, [f.raw.object_id]);
  const entry = second.objects[0];
  assert.equal(entry.decision, 'recovered');
  assert.deepEqual(new Set(entry.supersededEventIds), new Set([f.event.event_id, pending.event_id]));
  assert.equal(entry.aggregateRevision, 3, 'a fresh revision replaces the expired envelope');
  assert.notEqual(entry.newEventId, pending.event_id, 'expired envelopes are never replayed');
  assert.equal((await f.rows('sr_outbox')).find(e => e.event_id === pending.event_id).state, 'terminal', 'expired pending row terminalized as inspect() would');
  assert.equal(await f.gauge(), before - Number(f.raw.capacity_bytes));
});

test('SR96 epoch change aborts the run with no writes', async t => {
  const f = await fixture(t), before = await f.gauge(), outboxBefore = (await f.rows('sr_outbox')).length;
  let calls = 0;
  const dispatch = new Proxy(f.dispatch, { get: (target, property, receiver) => property === 'system'
    ? async work => { const result = await target.system(work); if (++calls === 1) await f.db.transaction(c => c.query("UPDATE sr_control SET epoch = epoch + 1 WHERE deployment = 'test'")); return result; }
    : Reflect.get(target, property, receiver) });
  const recovery = new ObjectRecovery(f.db, dispatch, f.collector);
  const report = await recovery.recover(f.scope, [f.raw.object_id]);
  assert.equal(report.objects[0].decision, 'epoch-changed');
  assert.equal((await f.rows('sr_outbox')).length, outboxBefore, 'no obligation prearmed');
  assert.equal(await f.objectState(), 'reserved', 'object untouched');
  assert.equal(await f.gauge(), before, 'gauge untouched');
});

test('SR96 protected objects stay deferred: pin and minimum retention', async t => {
  const f = await fixture(t), before = await f.gauge(), outboxBefore = (await f.rows('sr_outbox')).length;
  await f.db.transaction(c => c.query('INSERT INTO sr_object_pin VALUES (?,?,?,?,?,?,?)',
    ['test', f.ctx.tenantId, f.ctx.namespaceId, f.ctx.userId, f.raw.object_id, 'backup', Date.now() + 3600000]));
  const pinned = await f.recovery.recover(f.scope, [f.raw.object_id]);
  assert.equal(pinned.objects[0].decision, 'protected-pin');
  assert.equal((await f.rows('sr_outbox')).length, outboxBefore, 'no obligation prearmed for a pinned object');
  assert.equal(await f.gauge(), before);

  const g = await fixture(t), gBefore = await g.gauge(), gOutbox = (await g.rows('sr_outbox')).length;
  await g.db.transaction(c => c.query('UPDATE sr_object SET retention_until = ? WHERE object_id = ?', [Date.now() + 3600000, g.raw.object_id]));
  const retained = await g.recovery.recover(g.scope, [g.raw.object_id]);
  assert.equal(retained.objects[0].decision, 'protected-retention');
  assert.equal((await g.rows('sr_outbox')).length, gOutbox);
  assert.equal(await g.gauge(), gBefore);
});

test('SR96 a live upload reference prearms a continuation instead of deleting', async t => {
  const f = await fixture(t), before = await f.gauge();
  const upload = (await f.rows('sr_upload')).find(r => r.raw_object_id === f.raw.object_id);
  const operationId = randomUUID(), epoch = (await f.db.transaction(c => c.query("SELECT epoch FROM sr_control WHERE deployment = 'test'")))[0].epoch;
  await f.db.transaction(async c => {
    await c.query(`INSERT INTO sr_operation (deployment, tenant_id, namespace_id, owner_id, operation_id, revision, kind, state,
      control_epoch, authorization_revision, policy_revision, configuration_revision, upload_id, expires_at, fence, attempt_id, error_code, result)
      VALUES (?,?,?,?,?,1,'ingest','queued',?,?,?,?,?,?,0,NULL,NULL,NULL)`,
      ['test', f.ctx.tenantId, f.ctx.namespaceId, f.ctx.userId, operationId, Number(epoch), 1, 1, 1, upload.upload_id, Date.now() + 3600000]);
    await c.query("UPDATE sr_upload SET state = 'accepted', operation_id = ? WHERE upload_id = ?", [operationId, upload.upload_id]);
  });
  const report = await f.recovery.recover(f.scope, [f.raw.object_id]);
  const entry = report.objects[0];
  assert.equal(entry.decision, 'protected-continued');
  assert.equal(await f.objectState(), 'reserved', 'untouched: the continuation defers the retiring transition');
  assert.equal(await f.gauge(), before, 'gauge retained');
  const continuation = (await f.obligations()).find(e => e.state === 'dispatched' && Number(e.aggregate_revision) === 3);
  assert.ok(continuation, 'continuation obligation prearmed for the next eligible window');
  const dispatches = f.events.filter(e => e[0] === 'dispatch');
  assert.ok(dispatches.some(e => e[2].aggregateId === f.raw.object_id && e[2].aggregateRevision === 3), 'continuation externally dispatched through the prearmed path');
});

test('SR96 403 and timeouts retain the obligation without releasing the gauge', async t => {
  const f = await fixture(t), before = await f.gauge();
  const deny = code => ({ latest: async () => 'v1', remove: async () => { throw new MetadataError(code, code === 'S3_FORBIDDEN' ? 403 : 503); } });
  for (const code of ['S3_FORBIDDEN', 'DELETE_TIMEOUT']) {
    const recovery = new ObjectRecovery(f.db, f.dispatch, new ObjectCollector(f.db, f.dispatch, deny(code), 'sqlite'));
    const report = await recovery.recover(f.scope, [f.raw.object_id]);
    assert.equal(report.objects[0].decision, 'failed');
    assert.equal(report.objects[0].error, code);
  }
  assert.equal(await f.objectState(), 'retiring');
  assert.equal(await f.gauge(), before, 'quota never released on unproven deletion');
  assert.equal((await f.obligations()).filter(e => e.state !== 'terminal').length, 1, 'one pending obligation retained');
  const report = await f.recovery.recover(f.scope, [f.raw.object_id]);
  assert.equal(report.objects[0].decision, 'recovered', 'a later run resumes and completes');
  assert.equal(await f.gauge(), before - Number(f.raw.capacity_bytes));
});

test('SR96 namespace isolation: foreign and unknown objects are never touched', async t => {
  const f = await fixture(t), ctx2 = f.contexts[1], before = await f.gauge();
  await f.uploads.reserve(ctx2, directRequest(), randomUUID(), async () => {});
  const foreign = (await f.rows('sr_object')).find(r => r.purpose === 'raw-upload' && r.namespace_id === ctx2.namespaceId);
  const outboxBefore = (await f.rows('sr_outbox')).length;
  const report = await f.recovery.recover(f.scope, [foreign.object_id]);
  assert.equal(report.objects[0].decision, 'scope-mismatch');
  assert.equal((await f.rows('sr_outbox')).length, outboxBefore, 'no obligation prearmed for a foreign object');
  assert.equal((await f.rows('sr_object')).find(r => r.object_id === foreign.object_id).state, 'reserved');
  assert.equal(await f.gauge(), before);
  const unknown = await f.recovery.recover(f.scope, [randomUUID()]);
  assert.equal(unknown.objects[0].decision, 'unknown-object');
  assert.equal((await f.rows('sr_outbox')).length, outboxBefore);
});

test('SR96 dry-run assesses without writing', async t => {
  const f = await fixture(t), before = await f.gauge(), outboxBefore = await f.rows('sr_outbox');
  const report = await f.recovery.recover(f.scope, [f.raw.object_id], { dryRun: true });
  assert.equal(report.dryRun, true);
  assert.equal(report.objects[0].decision, 'replace');
  assert.deepEqual(report.objects[0].supersededEventIds, [f.event.event_id]);
  assert.equal(report.objects[0].aggregateRevision, 2);
  assert.deepEqual(await f.rows('sr_outbox'), outboxBefore, 'dry-run writes nothing');
  assert.equal(await f.objectState(), 'reserved');
  assert.equal(await f.gauge(), before);
  // An already-deleted object plans as complete.
  await f.recovery.recover(f.scope, [f.raw.object_id]);
  const planned = await f.recovery.plan(f.scope, [f.raw.object_id]);
  assert.equal(planned.objects[0].decision, 'already-complete');
});

test('SR96 input validation rejects bad scopes, sets and windows', async t => {
  const f = await fixture(t);
  await assert.rejects(f.recovery.recover(f.scope, []), { code: 'RECOVERY_INPUT_INVALID' });
  await assert.rejects(f.recovery.recover(f.scope, Array.from({ length: 51 }, () => randomUUID())), { code: 'RECOVERY_INPUT_INVALID' });
  await assert.rejects(f.recovery.recover(f.scope, [f.raw.object_id, f.raw.object_id]), { code: 'RECOVERY_INPUT_INVALID' });
  await assert.rejects(f.recovery.recover(f.scope, [f.raw.object_id], { windowMs: 1000 }), { code: 'RECOVERY_INPUT_INVALID' });
  await assert.rejects(f.recovery.recover({ ...f.scope, tenantId: 'no spaces' }, [f.raw.object_id]), /./);
  await assert.rejects(f.recovery.recover(f.scope, ['not a uuid!!']), /./);
});

test('SR96 close() settles the database connection', async t => {
  const f = await fixture(t);
  let closed = false;
  const recovery = new ObjectRecovery({ close: async () => { closed = true; } }, f.dispatch, f.collector);
  await recovery.close();
  assert.equal(closed, true);
});
