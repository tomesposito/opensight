import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableCoordinator } from '../dist/coordination.js';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { TenantMetadata } from '../dist/metadata.js';
import { coordinationFixture } from './coordination-helpers.mjs';
import { budgetConfig } from './budget-helpers.mjs';

const coordinator = (f, db = f.db, metadata = f.metadata) => new DurableCoordinator(db, metadata, 'test', 'sqlite');
const rows = (f, table) => f.db.transaction(c => c.query(`SELECT * FROM ${table}`));

test('SR2a overlapping coordinator instances serialize tenant capacity and queries do not consume refresh units', async t => {
  const f = await coordinationFixture(t); await f.open();
  const a = coordinator(f), b = coordinator(f), inputs = [await f.input(), await f.input()];
  const results = await Promise.allSettled([a.admit(f.contexts[0], inputs[0]), b.admit(f.contexts[0], inputs[1])]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'TENANT_BUDGET_EXCEEDED');
  assert.equal((await rows(f, 'sr_admission')).length, 1); assert.deepEqual(await rows(f, 'h8_usage'), []);
  const winner = results[0].status === 'fulfilled' ? [a, results[0].value] : [b, results[1].value];
  await winner[0].release(winner[1]); await winner[0].release(winner[1]);
  await b.admit(f.contexts[0], await f.input());
});

test('SR2a deployment reserves refresh slots and accounts complete worker memory across tenants', async t => {
  for (const weight of [false, 'working', 'rss']) {
    const budgets = structuredClone(budgetConfig); budgets.node.running = 2;
    if (weight === 'working') budgets.node.workingBytes = budgets.defaults.workingBytes;
    if (weight === 'rss') budgets.node.workerRssBytes = budgets.defaults.workerRssBytes;
    const f = await coordinationFixture(t, { budgets }); await f.open(); const c = coordinator(f);
    const first = await c.admit(f.contexts[0], await f.input());
    await assert.rejects(c.admit(f.contexts[1], await f.input(1)), { code: 'NODE_ADMISSION_REFUSED' });
    if (weight) await assert.rejects(c.admit(f.contexts[1], await f.input(1, true)), { code: 'NODE_ADMISSION_REFUSED' });
    else {
      const refresh = await c.admit(f.contexts[1], await f.input(1, true));
      assert.equal(refresh.fence, '1'); await c.release(refresh);
    }
    await c.release(first);
  }
});

test('SR2a refresh attempts charge exactly once, duplicate attempts cannot execute and quota denial creates no claim', async t => {
  const f = await coordinationFixture(t, { computeAttempts: 1 }); await f.open(); const c = coordinator(f), input = await f.input(0, true);
  const handle = await c.admit(f.contexts[0], input);
  await assert.rejects(c.admit(f.contexts[0], input), { code: 'ATTEMPT_ALREADY_ADMITTED' });
  await c.release(handle);
  await assert.rejects(c.admit(f.contexts[0], input), { code: 'ATTEMPT_ALREADY_ADMITTED' });
  await assert.rejects(c.admit(f.contexts[0], await f.input(0, true)), { code: 'USAGE_LIMIT_EXCEEDED' });
  const usage = await rows(f, 'h8_usage'); assert.equal(usage[0].admitted, 1); assert.equal(usage[0].denied, 1);
  assert.equal((await rows(f, 'h8_usage_events')).length, 2);
  assert.equal((await rows(f, 'sr_admission')).length, 1);
  assert.equal((await rows(f, 'sr_claim'))[0].fence, 1);
});

test('SR2a forged contexts, foreign resources and cross-instance handles cannot acquire or publish authority', async t => {
  const f = await coordinationFixture(t); await f.open(); const a = coordinator(f), b = coordinator(f), input = await f.input(0, true);
  await assert.rejects(a.admit({ ...f.contexts[0] }, input), { code: 'TENANT_CONTEXT_REQUIRED' });
  await assert.rejects(a.admit(f.contexts[1], { ...await f.input(1, true), claim: input.claim }), { code: 'RESOURCE_NOT_FOUND' });
  const handle = await a.admit(f.contexts[0], input); assert.ok(Object.isFrozen(handle));
  for (const bad of [{ ...handle }, handle]) {
    const c = bad === handle ? b : a;
    for (const method of ['renew', 'revoke', 'release']) await assert.rejects(c[method](bad), { code: 'ATTEMPT_HANDLE_REQUIRED' });
    await assert.rejects(c.publish(bad, () => assert.fail('forged publication')), { code: 'ATTEMPT_HANDLE_REQUIRED' });
  }
  await a.release(handle);
});

test('SR2a admission snapshots input before awaiting its transaction', async t => {
  const f = await coordinationFixture(t); await f.open(); let resume;
  const wait = new Promise(r => { resume = r; });
  const db = { durable: true, transaction: async work => { await wait; return f.db.transaction(work); }, close: async () => {} };
  const c = coordinator(f, db), input = await f.input(), original = input.attemptId;
  const result = c.admit(f.contexts[0], input); input.class = 'refresh'; input.revisions.policy++; input.attemptId = 'mutated'; resume();
  const handle = await result; assert.equal(handle.attemptId, original); assert.equal(handle.fence, undefined);
  assert.equal((await rows(f, 'sr_admission'))[0].class, 'query'); await c.release(handle);
});

test('SR2a composite claim references reject a foreign-scope attempt even through the control SQL role', async t => {
  const f = await coordinationFixture(t); await f.open(); const c = coordinator(f), handle = await c.admit(f.contexts[0], await f.input(0, true));
  await assert.rejects(f.db.transaction(sql => sql.query('INSERT INTO sr_claim VALUES (?,?,?,?,?,?,1,1,1,?)',
    ['test', f.contexts[1].tenantId, f.contexts[1].namespaceId, 'admin', 'source', f.uploaded[1].id, handle.attemptId])), { code: 'METADATA_REFERENCE_INVALID' });
  assert.equal((await rows(f, 'sr_claim')).length, 1); await c.release(handle);
});

test('SR2a SQL failures and publication callback failures roll back charges, reservations and business writes', async t => {
  const f = await coordinationFixture(t); await f.open();
  const broken = { durable: true, close: async () => {}, transaction: work => f.db.transaction(c => work({ query: (sql, values) => {
    if (sql.startsWith('INSERT INTO sr_claim')) throw Error('private SQL diagnostics');
    return c.query(sql, values);
  } })) };
  await assert.rejects(coordinator(f, broken).admit(f.contexts[0], await f.input(0, true)), { code: 'COORDINATION_UNAVAILABLE', message: 'COORDINATION_UNAVAILABLE' });
  for (const table of ['sr_admission', 'sr_claim', 'h8_usage', 'h8_usage_events']) assert.deepEqual(await rows(f, table), []);
  const c = coordinator(f), handle = await c.admit(f.contexts[0], await f.input(0, true)), before = await rows(f, 'h8_audit');
  await assert.rejects(c.publish(handle, async sql => {
    await sql.query("INSERT INTO h8_audit (event_id, created_at, action) VALUES ('rollback','synthetic','test')"); throw Error('sensitive failure');
  }), { code: 'COORDINATION_UNAVAILABLE' });
  assert.deepEqual(await rows(f, 'h8_audit'), before);
  assert.equal(await c.publish(handle, async () => 'published'), 'published'); await c.release(handle);
});

test('SR2a every publication rechecks tenant, identity, membership, role, revisions, epoch and budget version', async t => {
  const changes = [
    ["UPDATE h1_tenants SET state = 'suspended' WHERE tenant_id = 'tenant-one'", 'TENANT_UNAVAILABLE'],
    ["UPDATE h2_identities SET status = 'invited' WHERE subject = 'one'", 'UNKNOWN_PRINCIPAL'],
    ["UPDATE h2_memberships SET status = 'removed' WHERE namespace_id = 'one'", 'UNKNOWN_PRINCIPAL'],
    ["UPDATE h1_resources SET body = '{\"name\":\"Reader\",\"role\":\"reader\"}' WHERE namespace_id = 'one' AND kind = 'user'", 'SOURCE_ACCESS_DENIED'],
    ['UPDATE h1_revisions SET "authorization" = "authorization" + 1', 'AUTHORIZATION_REVISED'],
    ['UPDATE h1_revisions SET policy = policy + 1', 'METADATA_REVISED'],
    ['UPDATE h1_resources SET version = version + 1 WHERE kind = \'source\'', 'METADATA_REVISED'],
    ["UPDATE sr_control SET state = 'draining'", 'WORKSPACE_MAINTENANCE'],
    ['UPDATE sr_control SET epoch = epoch + 1', 'WORKSPACE_MAINTENANCE'],
    ['UPDATE sr_limits SET revision = revision + 1', 'WORKSPACE_MAINTENANCE'],
    ['UPDATE h4_budget_config SET version = version + 1', 'COORDINATION_CONFIG_CHANGED'],
  ];
  for (const [sql, code] of changes) {
    const f = await coordinationFixture(t); await f.open(); const c = coordinator(f), handle = await c.admit(f.contexts[0], await f.input(0, true));
    await f.db.transaction(db => db.query(sql));
    await assert.rejects(c.publish(handle, () => assert.fail('stale publication')), { code });
    await assert.rejects(c.renew(handle), { code });
    await c.release(handle); assert.equal((await rows(f, 'sr_admission'))[0].state, 'released');
  }
});

test('SR2a lease expiry revokes publication but retains capacity until containment ends', async t => {
  const f = await coordinationFixture(t); await f.open(); const c = coordinator(f), first = await c.admit(f.contexts[0], await f.input(0, true));
  assert.ok(first.holdUntil > first.executionDeadline); assert.ok(first.leaseUntil <= first.executionDeadline);
  await f.db.transaction(db => db.query('UPDATE sr_admission SET lease_until = 1'));
  await assert.rejects(c.publish(first, () => assert.fail('expired publication')), { code: 'ATTEMPT_EXPIRED' });
  await assert.rejects(c.admit(f.contexts[0], await f.input(0, true)), { code: 'TENANT_BUDGET_EXCEEDED' });
  await f.db.transaction(db => db.query('UPDATE sr_admission SET execution_deadline = 1, hold_until = 2'));
  const second = await c.admit(f.contexts[0], await f.input(0, true)); assert.equal(second.fence, '2'); assert.equal(second.generation, '2');
  await assert.rejects(c.publish(first, () => assert.fail('obsolete publication')), { code: 'CLAIM_LOST' });
  await c.release(first); assert.equal((await rows(f, 'sr_claim'))[0].attempt_id, second.attemptId);
  assert.equal(await c.publish(second, async () => 7), 7); await c.release(second);
});

test('SR2a revocation retains its reservation, advances the fence and cannot revoke a replacement', async t => {
  const f = await coordinationFixture(t); await f.open(); const c = coordinator(f), first = await c.admit(f.contexts[0], await f.input(0, true));
  await c.revoke(first); await c.revoke(first);
  assert.equal((await rows(f, 'sr_claim'))[0].fence, 2);
  await assert.rejects(c.admit(f.contexts[0], await f.input(0, true)), { code: 'TENANT_BUDGET_EXCEEDED' });
  await assert.rejects(c.publish(first, () => assert.fail('revoked publication')), { code: 'CLAIM_LOST' });
  await c.release(first); const second = await c.admit(f.contexts[0], await f.input(0, true));
  await c.revoke(first); await c.release(first);
  assert.equal(second.fence, '3'); assert.equal((await rows(f, 'sr_claim'))[0].attempt_id, second.attemptId); await c.release(second);
});

test('SR2a renewals respect cadence and immutable execution/containment deadlines', async t => {
  const budgets = structuredClone(budgetConfig); budgets.defaults.executionMs = budgets.node.executionMs = 100000;
  const f = await coordinationFixture(t, { budgets }); await f.open(); const c = coordinator(f), input = await f.input(); input.platformRemainingMs = 120000;
  const handle = await c.admit(f.contexts[0], input); assert.equal(await c.renew(handle), handle.leaseUntil);
  await f.db.transaction(db => db.query('UPDATE sr_admission SET next_renew = 1, lease_until = lease_until - 10000'));
  const renewed = await c.renew(handle), row = (await rows(f, 'sr_admission'))[0];
  assert.ok(renewed >= handle.leaseUntil); assert.ok(renewed <= handle.executionDeadline);
  assert.equal(row.execution_deadline, handle.executionDeadline); assert.equal(row.hold_until, handle.holdUntil);
  assert.equal(await c.renew(handle), renewed); await c.release(handle);
});

test('SR2a durable claims survive a new SQL connection and fences preserve BIGINT precision', async t => {
  const f = await coordinationFixture(t); await f.open(); const c = coordinator(f), first = await c.admit(f.contexts[0], await f.input(0, true)); await c.release(first);
  await f.db.transaction(db => db.query('UPDATE sr_claim SET fence = 9007199254740992, generation = 9007199254740992'));
  const db = new SqliteMetadataDatabase(f.path); t.after(() => db.close()); const metadata = new TenantMetadata(db, db), next = coordinator(f, db, metadata);
  const context = await metadata.authenticate(null, async () => ({ namespaceId: 'one', userId: 'admin' }));
  const second = await next.admit(context, await f.input(0, true)); assert.equal(second.fence, '9007199254740993'); assert.equal(second.generation, second.fence); await next.release(second);
  await f.db.transaction(sql => sql.query('UPDATE sr_claim SET fence = 9223372036854775807'));
  await assert.rejects(next.admit(context, await f.input(0, true)), { code: 'CLAIM_FENCE_EXHAUSTED' });
  assert.equal((await rows(f, 'sr_admission')).length, 2);
});

test('SR2a exhausted fences still permit revocation and never wrap or regain publication', async t => {
  const f = await coordinationFixture(t); await f.open(); const c = coordinator(f), first = await c.admit(f.contexts[0], await f.input(0, true)); await c.release(first);
  await f.db.transaction(db => db.query('UPDATE sr_claim SET fence = 9223372036854775806'));
  const last = await c.admit(f.contexts[0], await f.input(0, true)); assert.equal(last.fence, '9223372036854775807');
  await c.revoke(last);
  await assert.rejects(c.publish(last, () => assert.fail('cancelled publication')), { code: 'CLAIM_LOST' });
  const claim = (await f.db.transaction(db => db.query('SELECT CAST(fence AS TEXT) AS fence, attempt_id FROM sr_claim')))[0];
  assert.equal(claim.fence, last.fence); assert.equal(claim.attempt_id, null);
  await c.release(last);
  await assert.rejects(c.admit(f.contexts[0], await f.input(0, true)), { code: 'CLAIM_FENCE_EXHAUSTED' });
});

test('SR2a waiting for admission consumes platform remaining time without reserving or charging work', async t => {
  const f = await coordinationFixture(t); await f.open();
  const db = { durable: true, close: async () => {}, transaction: async work => {
    await new Promise(resolve => setTimeout(resolve, 20)); return f.db.transaction(work);
  } };
  const input = await f.input(0, true); input.platformRemainingMs = 3010;
  await assert.rejects(coordinator(f, db).admit(f.contexts[0], input), { code: 'EXECUTION_CANCELLED' });
  assert.deepEqual(await rows(f, 'sr_admission'), []); assert.deepEqual(await rows(f, 'h8_usage'), []);
});

test('SR2a SQL-time expiry before admission commit or after publication callback rolls back all effects', async t => {
  for (const stage of ['admission', 'publication']) {
    const f = await coordinationFixture(t); await f.open(); let offset = 0;
    const db = { durable: true, close: async () => {}, transaction: work => f.db.transaction(c => work({ query: async (sql, values) => {
      const result = await c.query(sql, values);
      if (stage === 'admission' && sql.startsWith('INSERT INTO sr_admission')) offset = 1000000;
      return sql.includes(' AS now_ms') ? result.map(row => ({ now_ms: Number(row.now_ms) + offset })) : result;
    } })) };
    const c = coordinator(f, db);
    if (stage === 'admission') {
      await assert.rejects(c.admit(f.contexts[0], await f.input(0, true)), { code: 'EXECUTION_CANCELLED' });
      assert.deepEqual(await rows(f, 'sr_admission'), []); assert.deepEqual(await rows(f, 'h8_usage'), []); assert.deepEqual(await rows(f, 'sr_claim'), []);
    } else {
      const handle = await c.admit(f.contexts[0], await f.input(0, true)), before = await rows(f, 'h8_audit');
      await assert.rejects(c.publish(handle, async sql => {
        await sql.query("INSERT INTO h8_audit (event_id, created_at, action) VALUES ('expired','synthetic','test')"); offset = 1000000;
      }), { code: 'ATTEMPT_EXPIRED' });
      assert.deepEqual(await rows(f, 'h8_audit'), before); offset = 0; await c.release(handle);
    }
  }
});
