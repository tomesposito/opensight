import test from 'node:test';
import assert from 'node:assert/strict';
import { HostedBilling, initializeBilling } from '../dist/hosted-billing.js';
import { HostedUsage, initializeUsage } from '../dist/hosted-usage.js';
import { TenantMetadata } from '../dist/metadata.js';
import { JobStore } from '../dist/job-store.js';
import { JobRunner } from '../dist/job-runner.js';
import { executor, jobFixture, refresh } from './job-helpers.mjs';

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
