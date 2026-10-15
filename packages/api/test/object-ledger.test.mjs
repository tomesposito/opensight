import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { manifestFixture } from './manifest-helpers.mjs';
import { migrateDispatch } from '../dist/dispatch-schema.js';
import { migrateObjects } from '../dist/object-schema.js';
import { migrateOperations } from '../dist/operation-schema.js';
import { DurableDispatch } from '../dist/dispatch.js';
import { ObjectLedger } from '../dist/object-ledger.js';
import { TenantMetadata } from '../dist/metadata.js';
import { HostedUsage, resourceBytes } from '../dist/hosted-usage.js';

const digest = Buffer.alloc(32, 1).toString('base64');
async function fixture(t) {
  const f = await manifestFixture(t);
  await migrateDispatch(f.db, 'test', 'frozen', 'sqlite'); await migrateObjects(f.db, 'test', 'frozen', 'sqlite');
  await migrateOperations(f.db, 'test', 'frozen', 'sqlite');
  const usage = new HostedUsage(f.db, f.entitlements, Date.now, 'test'), metadata = new TenantMetadata(f.db, f.db, usage);
  const contexts = await Promise.all(['one', 'two'].map(namespaceId => metadata.authenticate(null, async () => ({ namespaceId, userId: 'admin' }))));
  const dispatch = new DurableDispatch(f.db, metadata, 'test', { recover: async () => {}, dispatch: async () => {} }, 'sqlite'), ledger = new ObjectLedger(metadata, 'test');
  await f.open();
  return { ...f, metadata, contexts, usage, dispatch, ledger,
    plan: (capacityBytes = 200000, index = 0) => ledger.plan(contexts[index], { capacityBytes, purpose: 'raw-upload', mediaType: 'text/csv', checksum: digest }),
    async reserve(plans, index = 0) {
      const ctx = contexts[index], revisions = await metadata.revisions(ctx), handle = await dispatch.prepare(ctx, { kind: 'upload-reserve', revisions, requestDigest: 'a'.repeat(64), idempotencyKey: randomUUID() });
      await dispatch.commit(handle, async (c, now) => {
        await ledger.reserve(c, ctx, revisions, handle.intentId, plans, now, now + 600000, now + 60000);
        return { receipt: { id: plans[0].id, revision: 1 }, events: plans.map(p => ({ aggregateId: p.id, aggregateRevision: 1, kind: 'object-cleanup', dueAt: now + 86400000, expiresAt: now + 172800000 })) };
      }); return handle;
    },
    gauge: () => f.db.transaction(async c => (await c.query("SELECT reserved_bytes, live_bytes FROM sr_storage_usage WHERE namespace_id = 'one'")).map(r => ({ ...r }))),
  };
}

test('SR2d object reservations and H1 logical bytes share the namespace quota and committed gauge', async t => {
  const f = await fixture(t), first = f.plan(600000), second = f.plan(600000);
  const results = await Promise.allSettled([f.reserve([first]), f.reserve([second])]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'USAGE_LIMIT_EXCEEDED');
  assert.deepEqual(await f.gauge(), [{ reserved_bytes: 600000, live_bytes: 0 }]);
  assert.equal((await f.rows('sr_object')).length, 1); assert.equal((await f.rows('sr_outbox')).length, 1);
  await f.db.transaction(async c => assert.equal(await f.usage.storageBytes(c, f.contexts[0]), await resourceBytes(c, f.contexts[0]) + 600000));
  await f.reserve([f.plan(600000, 1)], 1); assert.equal((await f.rows('sr_object')).length, 2, 'preserves H8 namespace accounting');
});

test('SR2d exact-version binding atomically converts capacity; inconsistent retries and foreign scope fail closed', async t => {
  const f = await fixture(t), plan = f.plan(); await f.reserve([plan]);
  const verified = { version: 'exact-version', bytes: 12000, checksum: digest };
  for (const changed of [{ ...verified, bytes: 200001 }, { ...verified, checksum: Buffer.alloc(32, 2).toString('base64') }, { ...verified, version: 'null' }]) {
    await assert.rejects(f.db.transaction(c => f.ledger.bind(c, f.contexts[0], plan.id, changed)), { code: 'OBJECT_INVALID' });
  }
  await assert.rejects(f.db.transaction(c => f.ledger.read(c, f.contexts[1], plan.id)), { code: 'RESOURCE_NOT_FOUND' });
  await assert.rejects(f.db.transaction(async c => { await f.ledger.bind(c, f.contexts[0], plan.id, verified); throw Error('source publication failed'); }));
  assert.deepEqual(await f.gauge(), [{ reserved_bytes: 200000, live_bytes: 0 }]);
  await f.db.transaction(c => f.ledger.bind(c, f.contexts[0], plan.id, verified)); await f.db.transaction(c => f.ledger.bind(c, f.contexts[0], plan.id, verified));
  assert.deepEqual(await f.gauge(), [{ reserved_bytes: 0, live_bytes: 12000 }]);
  await assert.rejects(f.db.transaction(c => f.ledger.bind(c, f.contexts[0], plan.id, { ...verified, version: 'replacement' })), { code: 'OBJECT_BINDING_CONFLICT' });
});

test('SR2d retention, pins and ambiguous deletion keep storage charged until confirmed exact absence', async t => {
  for (const bound of [false, true]) {
    const f = await fixture(t), ctx = f.contexts[0], plan = f.plan(); await f.reserve([plan]);
    if (bound) await f.db.transaction(c => f.ledger.bind(c, ctx, plan.id, { version: 'exact-version', bytes: 10000, checksum: digest }));
    await assert.rejects(f.db.transaction(c => f.ledger.retire(c, ctx, plan.id, Date.now())), { code: 'OBJECT_RETENTION_REQUIRED' });
    await assert.rejects(f.db.transaction(c => f.ledger.deleted(c, ctx, plan.id, bound ? 'exact-version' : undefined)), { code: 'OBJECT_BINDING_CONFLICT' });
    const later = Date.now() + 86500000;
    await f.db.transaction(c => c.query('INSERT INTO sr_object_pin VALUES (?,?,?,?,?,?,?)', ['test', ctx.tenantId, ctx.namespaceId, ctx.userId, plan.id, 'backup', later + 100000]));
    await assert.rejects(f.db.transaction(c => f.ledger.retire(c, ctx, plan.id, later)), { code: 'OBJECT_RETENTION_REQUIRED' });
    await f.db.transaction(c => c.query('DELETE FROM sr_object_pin'));
    await f.db.transaction(c => f.ledger.retire(c, ctx, plan.id, later));
    await assert.rejects(f.db.transaction(c => f.ledger.bind(c, ctx, plan.id, { version: 'exact-version', bytes: 10000, checksum: digest })), { code: 'OBJECT_BINDING_CONFLICT' });
    if (!bound) await f.db.transaction(c => f.ledger.retiringVersion(c, ctx, plan.id, 'exact-version'));
    await assert.rejects(f.db.transaction(c => f.ledger.deleted(c, ctx, plan.id, 'wrong-version')), { code: 'OBJECT_BINDING_CONFLICT' });
    assert.deepEqual(await f.gauge(), [{ reserved_bytes: bound ? 0 : 200000, live_bytes: bound ? 10000 : 0 }], 'uncertain external delete has no SQL receipt');
    await f.db.transaction(c => f.ledger.deleted(c, ctx, plan.id, 'exact-version')); await f.db.transaction(c => f.ledger.deleted(c, ctx, plan.id, 'exact-version'));
    assert.deepEqual(await f.gauge(), [{ reserved_bytes: 0, live_bytes: 0 }]); assert.equal((await f.rows('sr_object'))[0].state, 'deleted');
    assert.equal((await f.rows('sr_dispatch_intent')).length, 1, 'idempotency tombstone retained');
  }
});

test('SR2d object plans are local, owner-bound and cannot create storage outside an armed intent', async t => {
  const f = await fixture(t), plan = f.plan();
  await assert.rejects(f.reserve([{ ...plan }]), { code: 'OBJECT_PLAN_REQUIRED' });
  await assert.rejects(f.reserve([plan], 1), { code: 'OBJECT_PLAN_REQUIRED' });
  const revisions = await f.metadata.revisions(f.contexts[0]);
  await assert.rejects(f.db.transaction(c => f.ledger.reserve(c, f.contexts[0], revisions, randomUUID(), [plan], Date.now(), Date.now() + 600000)), { code: 'DISPATCH_PREPARATION_REQUIRED' });
  assert.deepEqual(await f.rows('sr_object'), []); assert.deepEqual(await f.rows('sr_storage_usage'), []);
});

test('SR2d H1 edits account object storage without exposing object keys to the tenant role', async t => {
  const f = await fixture(t), plan = f.plan(995000); await f.reserve([plan]);
  const context = f.contexts[0];
  await assert.rejects(f.db.transaction(async c => {
    const before = await f.usage.storageBytes(c, context);
    await c.query("UPDATE h1_resources SET body = ? WHERE namespace_id = ? AND kind = 'source'", [JSON.stringify({ synthetic: 'x'.repeat(10000) }), context.namespaceId]);
    await f.usage.storage(c, context, before);
  }), { code: 'USAGE_LIMIT_EXCEEDED' });
  const row = (await f.rows('sr_storage_usage'))[0]; assert.deepEqual(Object.keys(row).sort(), ['deployment', 'live_bytes', 'namespace_id', 'reserved_bytes', 'tenant_id']);
});
