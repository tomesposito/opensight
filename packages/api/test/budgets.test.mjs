import test from 'node:test';
import assert from 'node:assert/strict';
import { TenantBudgets, validateBudgets } from '../dist/budgets.js';
import { migrateBudgets, readBudgets } from '../dist/budget-store.js';
import { sourceFixture } from './source-helpers.mjs';
import { budgetConfig } from './budget-helpers.mjs';
const deferred = () => { let resolve; return { promise: new Promise(r => { resolve = r; }), resolve }; };
const turn = () => new Promise(r => setImmediate(r));
const gate = (f, config = budgetConfig) => new TenantBudgets(config, c => f.metadata.assertContext(c));

test('H4 queue bounds reject before callbacks; copied or absent tenant contexts cannot allocate', async t => {
  const f = await sourceFixture(t), a = await f.login(), b = await f.login('two'), g = gate(f), hold = deferred(); let io = 0;
  const run = c => g.run(c, false, async () => {}, async () => { io++; await hold.promise; });
  const first = run(a); await turn();
  const queued = Array.from({ length: 4 }, () => run(a));
  assert.throws(() => run(a), { code: 'TENANT_BUDGET_EXCEEDED' });
  for (const c of [undefined, { ...a }, { ...a, tenantId: b.tenantId }]) assert.throws(() => run(c), { code: 'TENANT_CONTEXT_REQUIRED' });
  assert.equal(io, 1); assert.deepEqual(g.node(), { running: 1, queued: 4 });
  await g.run(b, false, async () => {}, async () => { io++; });
  assert.equal(io, 2); hold.resolve(); await Promise.all([first, ...queued]);
  assert.equal(g.snapshot(a.tenantId).peakQueued, 4); assert.equal(g.snapshot(a.tenantId).peakRunning, 1);
  assert.deepEqual(g.node(), { running: 0, queued: 0 });
});
test('H4 node queue bounds, reserved refresh capacity and per-tenant round-robin', async t => {
  const f = await sourceFixture(t), a = await f.login(), b = await f.login('two');
  const config = structuredClone(budgetConfig); config.node.running = 2; config.node.queued = 2; config.defaults.queued = 2;
  const g = gate(f, config), hold = deferred(), order = [];
  const first = g.run(a, false, async () => {}, async () => { await hold.promise; });
  const a2 = g.run(a, false, async () => {}, async () => { order.push('a'); });
  const b1 = g.run(b, false, async () => {}, async () => { order.push('b'); });
  assert.throws(() => g.run(b, false, async () => {}, async () => {}), { code: 'NODE_ADMISSION_REFUSED' });
  hold.resolve(); await Promise.all([first, a2, b1]);
  const hold2 = deferred(), active = g.run(a, false, async () => {}, () => hold2.promise);
  await g.run(b, true, async () => {}, async () => { order.push('refresh'); });
  hold2.resolve(); await active; assert.ok(order.includes('refresh'));
});
test('H4 fake timers: queued expiry, queued abort, running cancellation retains slot until cleanup', async t => {
  const f = await sourceFixture(t), a = await f.login(), g = gate(f), hold = deferred();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = g.run(a, false, async () => {}, async () => { await hold.promise; return 'partial'; });
  await turn();
  const queued = g.run(a, false, async () => {}, async () => assert.fail('expired job ran'));
  const expired = assert.rejects(queued, { code: 'QUEUE_WAIT_EXCEEDED' });
  t.mock.timers.tick(30000); await expired;
  assert.equal(g.node().running, 1);
  const cancelled = assert.rejects(first, { code: 'EXECUTION_CANCELLED' }); hold.resolve(); await cancelled;
  const controller = new AbortController(), hold2 = deferred();
  const next = g.run(a, false, async () => {}, () => hold2.promise);
  const aborted = g.run(a, false, async () => {}, async () => assert.fail(), controller.signal);
  const rejected = assert.rejects(aborted, { code: 'EXECUTION_CANCELLED' }); controller.abort(); await rejected;
  hold2.resolve(); await next;
  assert.deepEqual(g.node(), { running: 0, queued: 0 });
});
test('H4 budgets reject unknown fields, invalid ceilings, unresolved tenant policy and unfrozen writes; restart is identical', async t => {
  const f = await sourceFixture(t);
  for (const change of [c => c.defaults.running = 100, c => c.node.refreshSlots = c.node.running, c => c.defaults.extra = 1, c => c.defaults.executionMs = 0]) {
    const config = structuredClone(budgetConfig); change(config); assert.throws(() => validateBudgets(config), { code: 'BUDGET_CONFIG_INVALID' });
  }
  await assert.rejects(readBudgets(f.db), { code: 'BUDGET_MIGRATION_REQUIRED' });
  await assert.rejects(migrateBudgets(f.db, budgetConfig), { code: 'BUDGET_MAINTENANCE_REQUIRED' });
  await assert.rejects(migrateBudgets(f.db, { ...budgetConfig, tenants: { missing: budgetConfig.defaults } }, 'frozen'), { code: 'BUDGET_TENANT_UNRESOLVED' });
  await f.db.transaction(c => c.query("UPDATE h1_tenants SET limit_policy = 'unresolved' WHERE tenant_id = 'tenant-one'"));
  await assert.rejects(migrateBudgets(f.db, budgetConfig, 'frozen'), { code: 'BUDGET_POLICY_REPAIR_REQUIRED' });
  await f.db.transaction(c => c.query('UPDATE h1_tenants SET limit_policy = NULL'));
  await migrateBudgets(f.db, budgetConfig, 'frozen'); const before = await readBudgets(f.db); await f.restart();
  assert.deepEqual(await readBudgets(f.db), before);
  const old = await f.login(); const g = gate(f, before); const hold = deferred();
  const result = g.run(old, false, async () => {}, () => hold.promise), reject = assert.rejects(result, { code: 'EXECUTION_CANCELLED' });
  await turn(); g.close(); hold.resolve(); await reject;
  await f.restart(); const next = gate(f, await readBudgets(f.db));
  assert.throws(() => next.run(old, false, async () => {}, async () => {}), { code: 'TENANT_CONTEXT_REQUIRED' });
  assert.deepEqual(next.node(), { running: 0, queued: 0 });
});
