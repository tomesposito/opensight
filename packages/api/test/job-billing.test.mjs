import test from 'node:test';
import assert from 'node:assert/strict';
import { HostedBilling, initializeBilling } from '../dist/hosted-billing.js';
import { HostedUsage, initializeUsage } from '../dist/hosted-usage.js';
import { TenantMetadata } from '../dist/metadata.js';
import { JobStore } from '../dist/job-store.js';
import { JobRunner } from '../dist/job-runner.js';
import { newDigest } from '../dist/digest-model.js';
import { initializeJobs } from '../dist/job-schema.js';
import { executor, jobFixture, refresh, report } from './job-helpers.mjs';
import { h8Fixture } from './h8-helpers.mjs';
import { createHostedApiServer, drainHostedServer } from '../dist/hosted-server.js';

const entitlement = { apiCalls: 1000, storageBytes: 1000000, computeAttempts: 100 };
const config = { apiKey: 'sk_test_placeholder', webhookSecret: 'whsec_test_placeholder',
  priceIds: { light: 'price_light', regular: 'price_regular', heavy: 'price_heavy' },
  tierEntitlements: { light: entitlement }, trialEntitlement: entitlement };
const tenantId = 'tenant-one';
async function setup(t, execute = executor()) {
  const f = await jobFixture(t, execute);
  t.after(() => f.budgets.close());
  await initializeBilling(f.db); await initializeUsage(f.db);
  const billing = new HostedBilling(f.db, config, { clock: f.clock,
    stripe: { async createPaymentLink() { throw new Error('Unexpected Stripe request'); } } });
  await billing.load();
  const usage = new HostedUsage(f.db, { defaults: entitlement, tenants: {} }, f.clock);
  usage.tierEntitlement = id => billing.tierEntitlement(id);
  const metadata = new TenantMetadata(f.db, f.db, usage), store = new JobStore(f.db, metadata, () => new Date(f.clock()));
  const runner = new JobRunner(store, execute, f.mail, async id => { await billing.expireTrials(); billing.assertAccess(id); });
  const login = (namespaceId = 'one', userId = 'admin') => metadata.authenticate(null, async () => ({ namespaceId, userId }));
  let event = 0;
  const subscription = async (status, periodEnd = Math.floor(f.clock() / 1000)) => {
    if (!event) await billing.handleEvent({ id: `evt_${++event}`, created: event, type: 'checkout.session.completed',
      object: { subscription: 'sub_test', customer: 'cus_test', metadata: { tenant_id: tenantId, tier: 'light' }, payment_status: 'paid' } });
    return billing.handleEvent({
      id: `evt_${++event}`, created: event, type: status === 'canceled' ? 'customer.subscription.deleted' : 'customer.subscription.updated',
      object: { id: 'sub_test', customer: 'cus_test', status, current_period_end: periodEnd,
        items: { data: [{ price: { id: 'price_light' } }] } },
    });
  };
  const pause = async reason => {
    if (reason === 'trial') { await billing.startTrial(tenantId); f.advance(14 * 86400000); }
    else await subscription(reason);
  };
  const compute = () => f.db.transaction(c => c.query("SELECT * FROM h8_usage_events WHERE tenant_id = ? AND metric = 'computeAttempts' ORDER BY created_at, event_id", [tenantId]));
  return { ...f, metadata, store, runner, billing, usage, login, subscription, pause, compute,
    put: async (id, spec = refresh, namespaceId = 'one') => store.put(await login(namespaceId), id, spec, 0, (c, s) => execute.authorize(c, s)) };
}

for (const reason of ['unpaid', 'canceled', 'trial']) test(`226 admission: ${reason} creates no occurrence, preserves the due job and resumes after payment`, async t => {
  const execute = executor(), calls = [];
  execute.execute = async context => { calls.push(context.tenantId); return {}; };
  const f = await setup(t, execute), job = await f.put('refresh');
  await f.put('refresh', refresh, 'two');
  await f.pause(reason); f.advance(60000);
  await f.runner.tick(); await f.runner.tick();
  const context = await f.login();
  assert.deepEqual(await f.store.history(context, job.id), []);
  assert.deepEqual(await f.store.get(context, job.id), job);
  assert.deepEqual(await f.compute(), []);
  assert.deepEqual(calls, ['tenant-two']);
  if (reason === 'trial') {
    const [row] = await f.db.transaction(c => c.query('SELECT access_state FROM h9_billing WHERE tenant_id = ?', [tenantId]));
    assert.equal(row.access_state, 'paused');
  }
  await f.subscription('active');
  await f.runner.tick();
  const history = await f.store.history(context, job.id);
  assert.equal(history.length, 1); assert.equal(history[0].state, 'succeeded');
  assert.deepEqual(calls, ['tenant-two', tenantId]);
  assert.equal((await f.compute()).length, 1);
  assert.equal((await f.store.get(context, job.id)).stopped, false);
});

for (const reason of ['unpaid', 'canceled', 'trial']) test(`226 execution: queued ${reason} refresh fails with its billing code before executor or compute`, async t => {
  const f = await setup(t), job = await f.put('refresh'), context = await f.login();
  f.advance(60000); await f.runner.claimDue();
  const [run] = await f.store.history(context, job.id);
  assert.equal(run.state, 'queued');
  const begin = t.mock.method(f.executor, 'begin'), execute = t.mock.method(f.executor, 'execute'), consume = t.mock.method(f.usage, 'consume');
  await f.pause(reason); await f.runner.tick();
  const [failed] = await f.store.history(context, job.id);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.errorCode, reason === 'trial' ? 'TRIAL_EXPIRED' : 'BILLING_ACCESS_PAUSED');
  assert.equal(begin.mock.callCount(), 0); assert.equal(execute.mock.callCount(), 0); assert.equal(consume.mock.callCount(), 0);
  assert.deepEqual(await f.compute(), []);
  assert.equal((await f.store.get(context, job.id)).stopped, false);
  await f.subscription('active'); f.advance(60000); await f.runner.tick();
  const history = await f.store.history(context, job.id);
  assert.equal(history.length, 2); assert.equal(history.filter(run => run.state === 'succeeded').length, 1);
  assert.equal(execute.mock.callCount(), 1);
});

test('226 execution: pause during context resolution is checked before compute admission', async t => {
  const f = await setup(t); await f.put('refresh');
  const context = await f.login(), run = await f.store.enqueue(context, 'refresh');
  const resolve = f.store.context.bind(f.store);
  t.mock.method(f.store, 'context', async (...args) => { const context = await resolve(...args); await f.pause('unpaid'); return context; });
  const execute = t.mock.method(f.executor, 'execute'), consume = t.mock.method(f.usage, 'consume');
  await f.runner.execute(run);
  assert.equal((await f.store.history(context, 'refresh'))[0].errorCode, 'BILLING_ACCESS_PAUSED');
  assert.equal(execute.mock.callCount(), 0); assert.equal(consume.mock.callCount(), 0);
});

test('226 execution: executor recheck stops a mid-run pause before source access', async t => {
  const execute = executor(), f = await setup(t, execute); let recheck, sourceReads = 0;
  execute.begin = (_context, verify) => { recheck = verify; };
  execute.execute = async () => { await f.pause('unpaid'); await recheck(); sourceReads++; return {}; };
  await f.put('refresh'); const context = await f.login(), run = await f.store.enqueue(context, 'refresh');
  await f.runner.execute(run);
  assert.equal(sourceReads, 0);
  assert.equal((await f.store.history(context, 'refresh'))[0].errorCode, 'BILLING_ACCESS_PAUSED');
  assert.equal((await f.compute()).length, 1); // Admitted before billing changed; no refund of earlier work.
  assert.equal((await f.store.get(context, 'refresh')).stopped, false);
});

test('226 execution: pause at completion prevents notification publication', async t => {
  const execute = executor(), f = await setup(t, execute);
  execute.execute = async () => { await f.pause('unpaid'); return {}; };
  await f.put('report', report); const context = await f.login();
  await f.runner.execute(await f.store.enqueue(context, 'report'));
  assert.equal((await f.store.history(context, 'report'))[0].errorCode, 'BILLING_ACCESS_PAUSED');
  assert.deepEqual(await f.store.deliveries(context, 'report'), []);
});

const sharedDigest = () => newDigest('revenue', 'admin', { cadence: 'daily', timeColumn: 'day', dimensions: [], destination: { kind: 'shared', recipientIds: ['admin', 'other'] } });
async function deliveryFixture(t, spec) {
  const execute = executor();
  execute.authorizeSharedDigest = async () => {};
  execute.renderSharedDigest = async () => ({ message: { to: ['one-admin@example.test', 'one-other@example.test'], subject: 'Synthetic shared digest', html: '<p>Metric</p>' }, verify: async () => {} });
  const f = await setup(t, execute); await f.put('delivery', spec);
  const context = await f.login(), run = await f.store.enqueue(context, 'delivery');
  await f.runner.execute(run);
  assert.equal((await f.store.history(context, 'delivery'))[0].state, 'delivering');
  return { ...f, context, run };
}

for (const [kind, spec] of [['report', () => report], ['shared digest', sharedDigest]]) {
  for (const reason of ['unpaid', 'trial']) test(`226 delivery: ${reason} blocks ${kind} rendering and compute before mail transport`, async t => {
    const f = await deliveryFixture(t, spec()), before = await f.compute();
    const begin = t.mock.method(f.executor, 'begin'), render = t.mock.method(f.executor, kind === 'report' ? 'render' : 'renderSharedDigest');
    const consume = t.mock.method(f.usage, 'consume'), send = t.mock.method(f.mail, 'send');
    await f.pause(reason); await f.runner.deliver();
    const [delivery] = await f.store.deliveries(f.context, 'delivery');
    assert.equal(delivery.state, 'cancelled'); assert.equal(delivery.attempts, 0);
    assert.equal(delivery.error_code, reason === 'trial' ? 'TRIAL_EXPIRED' : 'BILLING_ACCESS_PAUSED');
    assert.equal(begin.mock.callCount(), 0); assert.equal(render.mock.callCount(), 0);
    assert.equal(consume.mock.callCount(), 0); assert.equal(send.mock.callCount(), 0);
    assert.deepEqual(await f.compute(), before);
    assert.equal((await f.store.get(f.context, 'delivery')).stopped, false);
  });
}

test('226 delivery: shared digest recheck stops source access when billing pauses during render', async t => {
  const f = await deliveryFixture(t, sharedDigest()); let recheck, sourceReads = 0;
  f.executor.begin = (_context, verify) => { recheck = verify; };
  f.executor.renderSharedDigest = async () => { await f.pause('unpaid'); await recheck(); sourceReads++; throw new Error('Source accessed after billing pause'); };
  await f.runner.deliver();
  assert.equal(sourceReads, 0); assert.equal(f.mail.messages.length, 0);
  assert.equal((await f.store.deliveries(f.context, 'delivery'))[0].error_code, 'BILLING_ACCESS_PAUSED');
});

test('226 delivery: pause during report authorization blocks render compute', async t => {
  const f = await deliveryFixture(t, report);
  f.executor.authorize = async context => { if (context.userId === 'other') await f.pause('unpaid'); };
  const consume = t.mock.method(f.usage, 'consume'), render = t.mock.method(f.executor, 'render');
  await f.runner.deliver();
  assert.equal(consume.mock.callCount(), 0); assert.equal(render.mock.callCount(), 0);
  assert.equal((await f.store.deliveries(f.context, 'delivery'))[0].error_code, 'BILLING_ACCESS_PAUSED');
});

test('226 manual enqueue keeps its existing claim semantics; the runner still gates execution', async t => {
  const f = await setup(t); await f.put('refresh'); await f.pause('unpaid');
  const context = await f.login(), run = await f.store.enqueue(context, 'refresh');
  assert.equal(run.state, 'queued');
  await f.runner.execute(run);
  assert.equal((await f.store.history(context, 'refresh'))[0].errorCode, 'BILLING_ACCESS_PAUSED');
});

test('226 admission: retry window and cancellation before period end still allow scheduled refresh', async t => {
  const f = await setup(t); await f.put('refresh');
  await f.subscription('past_due'); f.advance(60000); await f.runner.tick();
  await f.subscription('canceled', Math.floor(f.clock() / 1000) + 120);
  f.advance(60000); await f.runner.tick();
  const context = await f.login(), before = await f.store.history(context, 'refresh');
  assert.equal(before.length, 2); assert.ok(before.every(run => run.state === 'succeeded'));
  f.advance(60000); await f.runner.tick();
  assert.deepEqual(await f.store.history(context, 'refresh'), before);
  assert.equal((await f.store.get(context, 'refresh')).stopped, false);
});

test('226 hosted composition expires trials before scheduler admission and queued execution', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T08:00:00Z') });
  const f = await h8Fixture(t); await initializeBilling(f.db); await initializeJobs(f.db);
  f.env = { ...f.env, OPENSIGHT_STRIPE_SECRET_KEY: config.apiKey, OPENSIGHT_STRIPE_WEBHOOK_SECRET: config.webhookSecret,
    OPENSIGHT_STRIPE_PRICE_LIGHT: config.priceIds.light, OPENSIGHT_STRIPE_PRICE_REGULAR: config.priceIds.regular,
    OPENSIGHT_STRIPE_PRICE_HEAVY: config.priceIds.heavy, OPENSIGHT_TRIAL_ENTITLEMENT: JSON.stringify(entitlement) };
  const billing = new HostedBilling(f.db, config); await billing.startTrial(tenantId);
  const metadata = new TenantMetadata(f.db, f.db), store = new JobStore(f.db, metadata);
  const context = await metadata.authenticate(null, async () => ({ namespaceId: 'one', userId: 'admin' }));
  for (const id of ['due', 'queued']) await store.put(context, id, refresh, 0, async () => {});
  await store.enqueue(context, 'queued');
  t.mock.timers.tick(14 * 86400000);
  let runner; const recover = JobRunner.prototype.recover;
  t.mock.method(JobRunner.prototype, 'recover', async function () { runner = this; await recover.call(this); });
  const server = await createHostedApiServer({ membershipDatabase: f.db, tenantDatabase: f.db, env: f.env,
    security: { authenticate: async () => undefined }, stripeFetcher: async () => { throw new Error('Unexpected Stripe request'); } });
  try {
    await runner.tick();
    assert.deepEqual(await store.history(context, 'due'), []);
    const [failed] = await store.history(context, 'queued');
    assert.equal(failed.state, 'failed'); assert.equal(failed.errorCode, 'TRIAL_EXPIRED');
    assert.deepEqual(await f.db.transaction(c => c.query("SELECT * FROM h8_usage_events WHERE metric = 'computeAttempts'")), []);
    assert.equal((await f.db.transaction(c => c.query('SELECT access_state FROM h9_billing WHERE tenant_id = ?', [tenantId])))[0].access_state, 'paused');
  } finally { await drainHostedServer(server); }
});
