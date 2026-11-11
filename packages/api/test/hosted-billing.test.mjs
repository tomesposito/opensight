import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { h8Fixture, serveH8 } from './h8-helpers.mjs';
import { billingConfig, httpStripeClient, initializeBilling, parseStripeEvent, verifyStripeSignature, HostedBilling, TIER_PRICE_CENTS } from '../dist/hosted-billing.js';
import { initializeUsage, HostedUsage } from '../dist/hosted-usage.js';
import { readOperatorAudit } from '../dist/operator-audit.js';
import { StubMailTransport } from '../dist/mail.js';

const SECRET = 'whsec_test_placeholder';
const FREE = { apiCalls: 100, storageBytes: 10000, computeAttempts: 10 };
const LIGHT = { apiCalls: 5000, storageBytes: 500000, computeAttempts: 500 };
const env = (extra = {}) => ({
  OPENSIGHT_STRIPE_SECRET_KEY: 'sk_test_placeholder', OPENSIGHT_STRIPE_WEBHOOK_SECRET: SECRET,
  OPENSIGHT_STRIPE_PRICE_LIGHT: 'price_light', OPENSIGHT_STRIPE_PRICE_REGULAR: 'price_regular', OPENSIGHT_STRIPE_PRICE_HEAVY: 'price_heavy',
  OPENSIGHT_BILLING_TIER_ENTITLEMENTS: JSON.stringify({ free: FREE, light: LIGHT, regular: { apiCalls: 20000, storageBytes: 2000000, computeAttempts: 2000 }, heavy: { apiCalls: 100000, storageBytes: 10000000, computeAttempts: 10000 } }),
  ...extra,
});
const sign = (raw, ts, secret = SECRET) => `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex')}`;

test('billing config: no Stripe config selects waitlist, partial Stripe config fails closed', () => {
  assert.equal(billingConfig({}), undefined);
  assert.throws(() => billingConfig({ OPENSIGHT_STRIPE_SECRET_KEY: 'sk_test_placeholder' }), { code: 'BILLING_CONFIG_INVALID' });
  assert.equal(billingConfig({ OPENSIGHT_BILLING_TIER_ENTITLEMENTS: '{}' }), undefined);
  assert.throws(() => billingConfig(env({ OPENSIGHT_BILLING_TIER_ENTITLEMENTS: '{"bogus":{}}' })), { code: 'BILLING_CONFIG_INVALID' });
  const config = billingConfig(env());
  assert.equal(config.priceIds.light, 'price_light');
  assert.deepEqual(config.tierEntitlements.free, FREE);
  assert.equal(TIER_PRICE_CENTS.light, 2900); assert.equal(TIER_PRICE_CENTS.heavy, 39900);
});

test('webhook signature verification accepts the genuine signature and rejects everything else', () => {
  const raw = Buffer.from(JSON.stringify({ id: 'evt_1', created: 1, type: 'ping', data: { object: {} } }));
  const now = 1_780_000_000;
  assert.doesNotThrow(() => verifyStripeSignature(raw, sign(raw, now), SECRET, now));
  assert.throws(() => verifyStripeSignature(raw, sign(raw, now, 'whsec_other'), SECRET, now), { code: 'STRIPE_SIGNATURE_INVALID' });
  assert.throws(() => verifyStripeSignature(Buffer.from('{"id":"evt_2"}'), sign(raw, now), SECRET, now), { code: 'STRIPE_SIGNATURE_INVALID' });
  assert.throws(() => verifyStripeSignature(raw, sign(raw, now - 1000), SECRET, now), { code: 'STRIPE_SIGNATURE_INVALID' });
  assert.throws(() => verifyStripeSignature(raw, undefined, SECRET, now), { code: 'STRIPE_SIGNATURE_INVALID' });
  assert.throws(() => verifyStripeSignature(raw, 'not-a-signature', SECRET, now), { code: 'STRIPE_SIGNATURE_INVALID' });
  assert.throws(() => parseStripeEvent(Buffer.from('{"id":"nope"}')), { code: 'STRIPE_EVENT_INVALID' });
});

test('Stripe client posts a form-encoded payment link request and validates the reply', async () => {
  let seen;
  const client = httpStripeClient('sk_test_placeholder', async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => ({ id: 'plink_1', url: 'https://buy.stripe.com/plink_1' }) };
  });
  const link = await client.createPaymentLink({ priceId: 'price_light', tenantId: 'tenant-one', tier: 'light', idempotencyKey: 'operation_link' });
  assert.deepEqual(link, { id: 'plink_1', url: 'https://buy.stripe.com/plink_1' });
  assert.equal(seen.url, 'https://api.stripe.com/v1/payment_links');
  assert.equal(seen.init.headers.authorization, 'Bearer sk_test_placeholder');
  assert.equal(seen.init.headers['Idempotency-Key'], 'operation_link');
  const form = new URLSearchParams(seen.init.body);
  assert.equal(form.get('line_items[0][price]'), 'price_light');
  assert.equal(form.get('metadata[tenant_id]'), 'tenant-one');
  const failing = httpStripeClient('sk_test_placeholder', async () => ({ ok: false, status: 402, json: async () => ({ error: {} }) }));
  await assert.rejects(failing.createPaymentLink({ priceId: 'price_light', tenantId: 'tenant-one', tier: 'light', idempotencyKey: 'operation_link' }), { code: 'STRIPE_REQUEST_FAILED' });
});

test('227 Stripe client forwards the checkout idempotency key and preserves named failures', async () => {
  const input = { priceId: 'price_light', tenantId: 'tenant-one', tier: 'light', origin: 'https://opensight.example', idempotencyKey: 'operation_checkout' };
  const session = { id: 'cs_key', url: 'https://checkout.stripe.com/c/pay/key' };
  const client = httpStripeClient('sk_test_placeholder', async (url, init) => {
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Idempotency-Key'], input.idempotencyKey);
    return { ok: true, status: 200, json: async () => session };
  });
  assert.deepEqual(await client.createCheckoutSession(input), session);
  for (const fetcher of [async () => { throw new Error('timeout'); }, async () => ({ ok: false, status: 500, json: async () => ({}) })]) {
    const failing = httpStripeClient('sk_test_placeholder', fetcher);
    await assert.rejects(failing.createCheckoutSession(input), { code: 'STRIPE_REQUEST_FAILED', status: 502 });
    await assert.rejects(failing.createPaymentLink(input), { code: 'STRIPE_REQUEST_FAILED', status: 502 });
  }
});

async function billingFixture(t, now = Date.UTC(2026, 10, 3, 12)) {
  const f = await h8Fixture(t);
  await initializeUsage(f.db); await initializeBilling(f.db);
  const mail = new StubMailTransport();
  let clock = now;
  const stripe = { createPaymentLink: async ({ tier }) => ({ id: `plink_${tier}`, url: `https://buy.stripe.com/plink_${tier}` }) };
  const billing = new HostedBilling(f.db, billingConfig(env()), { mail, notifyTo: 'operator@example.test', stripe, clock: () => clock });
  await billing.load();
  return { ...f, billing, mail, setClock: value => { clock = value; }, now: () => clock };
}
const subscriptionEvent = (id, object, created = 2) => ({ id, created, type: 'customer.subscription.updated', object });
const activeSub = { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1794000000, items: { data: [{ price: { id: 'price_light' } }] } };

test('211 parsing: retain Stripe creation seconds and reject missing or invalid ordering values', () => {
  const event = { id: 'evt_created', type: 'customer.subscription.updated', created: 1793707200, data: { object: activeSub } };
  assert.deepEqual(parseStripeEvent(Buffer.from(JSON.stringify(event))), { id: event.id, type: event.type, created: event.created, object: activeSub });
  for (const created of [undefined, null, '1793707200', -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseStripeEvent(Buffer.from(JSON.stringify({ ...event, created }))), { code: 'STRIPE_EVENT_INVALID' });
  }
});

async function bindActive(f) {
  await f.billing.handleEvent({ id: 'evt_bind', created: 10, type: 'checkout.session.completed', object: {
    subscription: 'sub_1', customer: 'cus_1', metadata: { tenant_id: 'tenant-one', tier: 'light' }, payment_status: 'paid',
  } });
  await f.billing.handleEvent(subscriptionEvent('evt_initial_active', activeSub, 20));
}
async function eventOutcome(f, eventId) {
  return { ...(await f.db.transaction(c => c.query('SELECT tenant_id, outcome FROM h9_billing_events WHERE event_id = ?', [eventId])))[0] };
}

test('211 ordering: older active events cannot undo cancellation, including after reload', async t => {
  const f = await billingFixture(t); await bindActive(f);
  const cancellation = { id: 'evt_new_cancel', created: 40, type: 'customer.subscription.deleted', object: { ...activeSub, current_period_end: 1 } };
  assert.equal((await f.billing.handleEvent(cancellation)).action, 'access_paused');
  const before = await f.billing.state('tenant-one');
  assert.equal(before.subscriptionStatus, 'canceled'); assert.equal(before.accessState, 'paused');
  assert.equal(before.lastStripeEventCreated, 40);
  const audits = await readOperatorAudit(f.db, { limit: 100 });
  const reloaded = new HostedBilling(f.db, billingConfig(env()), { clock: f.now }); await reloaded.load();
  const older = subscriptionEvent('evt_old_active', { ...activeSub, items: { data: [{ price: { id: 'price_heavy' } }] } }, 30);
  const result = await reloaded.handleEvent(older);
  assert.equal(result.handled, false); assert.equal(result.action, 'stale');
  assert.deepEqual(await reloaded.state('tenant-one'), before);
  assert.throws(() => reloaded.assertAccess('tenant-one'), { code: 'BILLING_ACCESS_PAUSED' });
  assert.deepEqual(await eventOutcome(f, older.id), { tenant_id: 'tenant-one', outcome: 'stale' });
  assert.equal((await reloaded.handleEvent(older)).duplicate, true);
  assert.deepEqual(await readOperatorAudit(f.db, { limit: 100 }), audits);
  assert.equal(f.mail.messages.length, 1);
  assert.equal((await reloaded.handleEvent(subscriptionEvent('evt_new_active', activeSub, 50))).action, 'access_restored');
  assert.doesNotThrow(() => reloaded.assertAccess('tenant-one'));
});

test('211 ordering: an old price or invoice cannot undo an upgrade or move its watermark', async t => {
  const f = await billingFixture(t); await bindActive(f);
  await f.billing.handleEvent(subscriptionEvent('evt_upgrade', { ...activeSub, items: { data: [{ price: { id: 'price_regular' } }] } }, 40));
  const before = await f.billing.state('tenant-one'); assert.equal(before.tier, 'regular');
  const entitlement = f.billing.tierEntitlement('tenant-one');
  for (const event of [subscriptionEvent('evt_old_tier', activeSub, 30),
    { id: 'evt_old_invoice', created: 35, type: 'invoice.payment_failed', object: { subscription: 'sub_1', customer: 'cus_1' } }]) {
    assert.equal((await f.billing.handleEvent(event)).action, 'stale');
    assert.deepEqual(await f.billing.state('tenant-one'), before);
    assert.deepEqual(f.billing.tierEntitlement('tenant-one'), entitlement);
    assert.equal((await eventOutcome(f, event.id)).outcome, 'stale');
  }
});

test('211 ordering: equal-created events keep the first applied state in either delivery order', async t => {
  for (const firstStatus of ['active', 'unpaid']) await t.test(firstStatus, async t => {
    const f = await billingFixture(t); await bindActive(f);
    await f.billing.handleEvent(subscriptionEvent('evt_first', { ...activeSub, status: firstStatus }, 30));
    const before = await f.billing.state('tenant-one');
    const second = subscriptionEvent('evt_second', { ...activeSub, status: firstStatus === 'active' ? 'unpaid' : 'active' }, 30);
    assert.equal((await f.billing.handleEvent(second)).action, 'stale');
    assert.deepEqual(await f.billing.state('tenant-one'), before);
    assert.equal(f.billing.accessPaused('tenant-one'), firstStatus === 'unpaid');
    assert.equal((await eventOutcome(f, second.id)).outcome, 'stale');
  });
});

test('211 ordering: concurrent events read the last committed state before applying', async t => {
  const f = await billingFixture(t); await bindActive(f);
  const results = await Promise.all([
    f.billing.handleEvent({ id: 'evt_concurrent_cancel', created: 40, type: 'customer.subscription.deleted', object: { ...activeSub, current_period_end: 1 } }),
    f.billing.handleEvent(subscriptionEvent('evt_concurrent_old', activeSub, 30)),
  ]);
  assert.deepEqual(results.map(result => result.action), ['access_paused', 'stale']);
  const state = await f.billing.state('tenant-one');
  assert.equal(state.subscriptionStatus, 'canceled'); assert.equal(state.lastStripeEventCreated, 40);
  assert.throws(() => f.billing.assertAccess('tenant-one'), { code: 'BILLING_ACCESS_PAUSED' });
});

test('211 PostgreSQL path: tenant lock covers the initial insert and subsequent reconciliation', async t => {
  const f = await billingFixture(t); let locks = 0;
  // Exercise the PostgreSQL locking contract over the local fixture. SQLite
  // alone would hide a missing row lock because BEGIN IMMEDIATE serializes it.
  const db = { dialect: 'postgres', close: async () => {}, transaction: work => f.db.transaction(c => {
    let locked = false;
    return work({ query: async (sql, values) => {
      if (sql === 'SELECT tenant_id FROM h1_tenants WHERE tenant_id = ? FOR UPDATE') {
        assert.deepEqual(values, ['tenant-one']); locked = true; locks++;
        return c.query(sql.replace(' FOR UPDATE', ''), values);
      }
      if (sql.startsWith('SELECT * FROM h9_billing WHERE') || sql.startsWith('INSERT INTO h9_billing (')) assert.equal(locked, true);
      return c.query(sql, values);
    } });
  }) };
  const billing = new HostedBilling(db, billingConfig(env()), { clock: f.now });
  await bindActive({ billing });
  assert.equal((await billing.handleEvent(subscriptionEvent('evt_locked_old', activeSub, 15))).action, 'stale');
  assert.equal(locks, 3);
  assert.equal((await f.billing.state('tenant-one')).lastStripeEventCreated, 20);
});

test('211 migration: existing billing rows get a nullable event watermark, initialization is idempotent', async t => {
  const f = await billingFixture(t); await bindActive(f);
  const { lastStripeEventCreated, ...before } = await f.billing.state('tenant-one');
  await f.db.transaction(c => c.query('ALTER TABLE h9_billing DROP COLUMN last_stripe_event_created'));
  await initializeBilling(f.db); await initializeBilling(f.db);
  assert.deepEqual(await f.billing.state('tenant-one'), { ...before, lastStripeEventCreated: null });
  await f.billing.handleEvent(subscriptionEvent('evt_after_migration', activeSub, 30));
  assert.equal((await f.billing.state('tenant-one')).lastStripeEventCreated, 30);
});

test('211 fencing: previous-subscription updates and invoices cannot change a replacement binding', async t => {
  const f = await billingFixture(t); await bindActive(f);
  await f.billing.handleEvent({ id: 'evt_replace', created: 30, type: 'checkout.session.completed', object: {
    subscription: 'sub_new', customer: 'cus_1', metadata: { tenant_id: 'tenant-one', tier: 'regular' }, payment_status: 'paid',
  } });
  const before = await f.billing.state('tenant-one');
  assert.equal(before.stripeSubscriptionId, 'sub_new'); assert.equal(before.tier, 'regular');
  const audits = await readOperatorAudit(f.db, { limit: 100 });
  for (const [index, type] of ['customer.subscription.updated', 'customer.subscription.deleted', 'invoice.payment_failed', 'invoice.paid', 'invoice.payment_succeeded'].entries()) {
    for (const metadata of [undefined, { tenant_id: 'tenant-one' }]) {
      const event = { id: `evt_foreign_${index}_${metadata ? 'metadata' : 'customer'}`, created: 1000 + index, type, object: {
        ...activeSub, status: 'unpaid', subscription: 'sub_1', metadata, items: { data: [{ price: { id: 'price_heavy' } }] },
      } };
      const result = await f.billing.handleEvent(event);
      assert.equal(result.handled, false); assert.equal(result.action, 'foreign_subscription');
      assert.deepEqual(await f.billing.state('tenant-one'), before);
      assert.deepEqual(await eventOutcome(f, event.id), { tenant_id: 'tenant-one', outcome: 'foreign_subscription' });
      assert.equal((await f.billing.handleEvent(event)).duplicate, true);
    }
  }
  assert.deepEqual(await readOperatorAudit(f.db, { limit: 100 }), audits);
  assert.equal(f.mail.messages.length, 0); assert.doesNotThrow(() => f.billing.assertAccess('tenant-one'));
  // Rejected events must not advance ordering and suppress legitimate pauses.
  assert.equal((await f.billing.handleEvent({ id: 'evt_cancel_current', created: 40, type: 'customer.subscription.deleted', object: {
    ...activeSub, id: 'sub_new', current_period_end: 1, items: { data: [{ price: { id: 'price_regular' } }] },
  } })).action, 'access_paused');
  const paused = await f.billing.state('tenant-one');
  assert.equal((await f.billing.handleEvent(subscriptionEvent('evt_old_reactivate', activeSub, 50))).action, 'foreign_subscription');
  assert.deepEqual(await f.billing.state('tenant-one'), paused);
  assert.throws(() => f.billing.assertAccess('tenant-one'), { code: 'BILLING_ACCESS_PAUSED' });
});

test('211 fencing: metadata and customer fallback cannot establish arbitrary subscription or invoice bindings', async t => {
  const f = await billingFixture(t);
  for (const [index, type] of ['customer.subscription.updated', 'customer.subscription.deleted', 'customer.subscription.created', 'invoice.payment_failed', 'invoice.paid', 'invoice.payment_succeeded'].entries()) {
    const result = await f.billing.handleEvent({ id: `evt_unbound_${index}`, created: 30, type, object: {
      ...activeSub, subscription: 'sub_1', metadata: { tenant_id: 'tenant-one' },
    } });
    assert.equal(result.action, 'foreign_subscription');
    assert.deepEqual(await f.billing.state('tenant-one'), { tenantId: 'tenant-one', status: 'none' });
  }
  await bindActive(f);
  const before = await f.billing.state('tenant-one');
  for (const [index, object] of [{ customer: 'cus_1' }, { subscription: null, customer: 'cus_1' }, { id: 'sub_other', customer: 'cus_other', metadata: { tenant_id: 'tenant-one' } }].entries()) {
    const type = index === 2 ? 'customer.subscription.created' : 'invoice.payment_failed';
    assert.equal((await f.billing.handleEvent({ id: `evt_bad_binding_${index}`, created: 40, type, object })).action, 'foreign_subscription');
    assert.deepEqual(await f.billing.state('tenant-one'), before);
  }
});

test('211 fencing: subscription creation for the bound customer can explicitly establish and replace a binding', async t => {
  const f = await billingFixture(t);
  await f.db.transaction(c => c.query('INSERT INTO h9_billing (tenant_id, stripe_customer_id, updated_at) VALUES (?,?,?)', ['tenant-one', 'cus_1', new Date(f.now()).toISOString()]));
  assert.equal((await f.billing.handleEvent({ id: 'evt_first_created', created: 10, type: 'customer.subscription.created', object: activeSub })).handled, true);
  assert.equal((await f.billing.state('tenant-one')).stripeSubscriptionId, 'sub_1');
  const replacement = { id: 'evt_new_created', created: 20, type: 'customer.subscription.created', object: { ...activeSub, id: 'sub_new' } };
  assert.equal((await f.billing.handleEvent(replacement)).handled, true);
  const before = await f.billing.state('tenant-one'); assert.equal(before.stripeSubscriptionId, 'sub_new');
  assert.equal((await f.billing.handleEvent({ id: 'evt_late_created', created: 15, type: 'customer.subscription.created', object: activeSub })).action, 'stale');
  assert.deepEqual(await f.billing.state('tenant-one'), before);
  assert.equal((await f.billing.handleEvent(subscriptionEvent('evt_late_update', activeSub, 30))).action, 'foreign_subscription');
  assert.deepEqual(await f.billing.state('tenant-one'), before);
});

test('211 fencing: checkout replacement requires tenant metadata or a stored payment link, and must be newer', async t => {
  const f = await billingFixture(t); await bindActive(f);
  const before = await f.billing.state('tenant-one');
  const object = { customer: 'cus_1', subscription: 'sub_new' };
  assert.equal((await f.billing.handleEvent({ id: 'evt_customer_only', created: 30, type: 'checkout.session.completed', object })).action, 'foreign_subscription');
  assert.deepEqual(await f.billing.state('tenant-one'), before);
  assert.equal((await f.billing.handleEvent({ id: 'evt_stale_checkout', created: 15, type: 'checkout.session.completed', object: { ...object, metadata: { tenant_id: 'tenant-one', tier: 'heavy' } } })).action, 'stale');
  assert.deepEqual(await f.billing.state('tenant-one'), before);
  await f.billing.createPaymentLink('tenant-one', 'regular');
  assert.equal((await f.billing.handleEvent({ id: 'evt_link_replacement', created: 40, type: 'checkout.session.completed', object: { ...object, payment_link: 'plink_regular', payment_status: 'paid' } })).handled, true);
  const state = await f.billing.state('tenant-one'); assert.equal(state.stripeSubscriptionId, 'sub_new'); assert.equal(state.tier, 'regular');
});

test('211 allowlist: unknown subscription and invoice types are recorded without changing billing', async t => {
  const f = await billingFixture(t);
  await f.billing.createPaymentLink('tenant-one', 'light');
  await f.billing.handleEvent({ id: 'evt_allow_checkout', created: 1, type: 'checkout.session.completed', object: { payment_link: 'plink_light', subscription: 'sub_1', customer: 'cus_1', payment_status: 'paid' } });
  await f.billing.handleEvent(subscriptionEvent('evt_allow_active', activeSub));
  const before = await f.billing.state('tenant-one');
  const audits = await readOperatorAudit(f.db, { limit: 100 });
  for (const [index, type] of ['customer.subscription.fabricated', 'customer.subscription.updated.extra', 'invoice.paid.extra'].entries()) {
    const event = { id: `evt_ignored_${index}`, created: 100, type, object: { ...activeSub, status: 'unpaid', subscription: 'sub_other', metadata: { tenant_id: 'tenant-one' } } };
    const result = await f.billing.handleEvent(event);
    assert.equal(result.action, 'ignored'); assert.equal(result.handled, false);
    assert.deepEqual(await f.billing.state('tenant-one'), before);
    assert.equal((await f.db.transaction(c => c.query('SELECT outcome FROM h9_billing_events WHERE event_id = ?', [event.id])))[0].outcome, 'ignored');
    assert.equal((await f.billing.handleEvent(event)).duplicate, true);
  }
  assert.deepEqual(await readOperatorAudit(f.db, { limit: 100 }), audits);
  assert.equal(f.mail.messages.length, 0);
  assert.doesNotThrow(() => f.billing.assertAccess('tenant-one'));
});

test('webhook flow: checkout binds the tenant, subscription activates the tier, replay is a no-op', async t => {
  const f = await billingFixture(t);
  await f.billing.createPaymentLink('tenant-one', 'light');
  const checkout = await f.billing.handleEvent({ id: 'evt_checkout', created: 1, type: 'checkout.session.completed', object: { payment_link: 'plink_light', subscription: 'sub_1', customer: 'cus_1', payment_status: 'paid' } });
  assert.equal(checkout.handled, true);
  let state = await f.billing.state('tenant-one');
  assert.equal(state.tier, 'light'); assert.equal(state.stripeSubscriptionId, 'sub_1');
  const activated = await f.billing.handleEvent(subscriptionEvent('evt_active', activeSub));
  assert.equal(activated.action, 'recorded');
  state = await f.billing.state('tenant-one');
  assert.equal(state.subscriptionStatus, 'active'); assert.equal(state.accessState, 'active');
  const replay = await f.billing.handleEvent(subscriptionEvent('evt_active', activeSub));
  assert.equal(replay.duplicate, true);
  const audits = (await readOperatorAudit(f.db, { limit: 100 })).filter(e => e.action === 'billing.entitlement.changed');
  assert.ok(audits.length >= 1);
  assert.ok(audits.every(e => typeof e.detail?.stripeEventId === 'string'));
  const unmatched = await f.billing.handleEvent({ id: 'evt_stray', created: 1, type: 'invoice.paid', object: { subscription: 'sub_unknown', customer: 'cus_unknown' } });
  assert.equal(unmatched.handled, false); assert.equal(unmatched.action, 'unmatched');
});

test('past-due rule: failed payment keeps access during retries, unpaid pauses; drop-to-Free is unavailable', async t => {
  const f = await billingFixture(t);
  await f.billing.createPaymentLink('tenant-one', 'light');
  await f.billing.handleEvent({ id: 'evt_co', created: 1, type: 'checkout.session.completed', object: { payment_link: 'plink_light', subscription: 'sub_1', customer: 'cus_1', payment_status: 'paid' } });
  await f.billing.handleEvent(subscriptionEvent('evt_act', activeSub));
  await f.billing.handleEvent({ id: 'evt_fail', created: 3, type: 'invoice.payment_failed', object: { subscription: 'sub_1', customer: 'cus_1' } });
  let state = await f.billing.state('tenant-one');
  assert.equal(state.subscriptionStatus, 'past_due');
  assert.doesNotThrow(() => f.billing.assertAccess('tenant-one'));
  const usage = new HostedUsage(f.db, { defaults: FREE, tenants: {} });
  usage.tierEntitlement = tenantId => f.billing.tierEntitlement(tenantId);
  assert.deepEqual(usage.entitlement({ tenantId: 'tenant-one', namespaceId: 'one' }), LIGHT);
  const paused = await f.billing.handleEvent(subscriptionEvent('evt_unpaid', { ...activeSub, status: 'unpaid' }, 4));
  assert.equal(paused.action, 'access_paused');
  assert.throws(() => f.billing.assertAccess('tenant-one'), { code: 'BILLING_ACCESS_PAUSED', status: 403 });
  assert.equal(f.mail.messages.length, 1);
  assert.match(f.mail.messages[0].subject, /tenant-one/);
  const pauseAudit = (await readOperatorAudit(f.db, { limit: 100 })).find(e => e.action === 'billing.access.paused');
  assert.equal(pauseAudit.detail.stripeEventId, 'evt_unpaid');
  assert.equal(f.billing.resolveDropToFree, undefined);

});

test('past-due rule: paying in Stripe restores the paid tier when the subscription returns to active', async t => {
  const f = await billingFixture(t);
  await f.billing.createPaymentLink('tenant-one', 'regular');
  await f.billing.handleEvent({ id: 'evt_co2', created: 1, type: 'checkout.session.completed', object: { payment_link: 'plink_regular', subscription: 'sub_1', customer: 'cus_1', payment_status: 'paid' } });
  const regular = { ...activeSub, items: { data: [{ price: { id: 'price_regular' } }] } };
  await f.billing.handleEvent(subscriptionEvent('evt_act2', regular));
  await f.billing.handleEvent(subscriptionEvent('evt_unpaid2', { ...regular, status: 'unpaid' }, 3));
  assert.throws(() => f.billing.assertAccess('tenant-one'), { code: 'BILLING_ACCESS_PAUSED' });
  const restored = await f.billing.handleEvent(subscriptionEvent('evt_back', regular, 4));
  assert.equal(restored.action, 'access_restored');
  const state = await f.billing.state('tenant-one');
  assert.equal(state.tier, 'regular'); assert.equal(state.accessState, 'active');
  assert.doesNotThrow(() => f.billing.assertAccess('tenant-one'));
});

test('cancelled subscription pauses at period end, not before', async t => {
  const start = Date.UTC(2026, 10, 3, 12);
  const f = await billingFixture(t, start);
  await f.billing.createPaymentLink('tenant-one', 'light');
  await f.billing.handleEvent({ id: 'evt_co3', created: 1, type: 'checkout.session.completed', object: { payment_link: 'plink_light', subscription: 'sub_1', customer: 'cus_1', payment_status: 'paid' } });
  await f.billing.handleEvent(subscriptionEvent('evt_act3', activeSub));
  const periodEndSeconds = Math.floor(start / 1000) + 86400;
  await f.billing.handleEvent({ id: 'evt_cancel', created: 3, type: 'customer.subscription.deleted', object: { ...activeSub, status: 'canceled', current_period_end: periodEndSeconds } });
  const state = await f.billing.state('tenant-one');
  assert.equal(state.accessState, 'paused');
  assert.equal(state.pauseEffectiveAt, new Date(periodEndSeconds * 1000).toISOString());
  assert.doesNotThrow(() => f.billing.assertAccess('tenant-one'));
  f.setClock(start + 86401_000);
  assert.throws(() => f.billing.assertAccess('tenant-one'), { code: 'BILLING_ACCESS_PAUSED' });
});

test('payment link validation: paid tiers only, tenant must exist', async t => {
  const f = await billingFixture(t);
  await assert.rejects(f.billing.createPaymentLink('tenant-one', 'free'), { code: 'BILLING_TIER_INVALID' });
  await assert.rejects(f.billing.createPaymentLink('tenant-missing', 'light'), { code: 'TENANT_UNAVAILABLE' });
});

function rawRequest(port, path, { method = 'POST', headers = {}, raw = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ port, host: '127.0.0.1', path, method, headers: { host: 'opensight.example', ...headers, 'Content-Length': Buffer.byteLength(raw) } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, body: res.headers['content-type']?.includes('json') && text ? JSON.parse(text) : text });
      });
    });
    req.on('error', reject); req.end(raw);
  });
}

test('HTTP: operator payment link, signed webhook, pause gate on the tenant plane, admin resolution', async t => {
  const f = await h8Fixture(t);
  await initializeUsage(f.db);
  Object.assign(f.env, env());
  const stripeFetcher = async () => ({ ok: true, status: 200, json: async () => ({ id: 'plink_regular', url: 'https://buy.stripe.com/plink_regular' }) });
  const { server, request, operator } = await serveH8(t, f, { stripeFetcher });
  const port = server.address().port;

  const link = await request('/api/host/tenants/tenant-one/billing/payment-link', { method: 'POST', headers: operator, body: { tier: 'regular' } });
  assert.equal(link.status, 201); assert.equal(link.body.url, 'https://buy.stripe.com/plink_regular');

  const deliver = async event => {
    const raw = JSON.stringify(event);
    return rawRequest(port, '/api/host/billing/webhook', { headers: { 'content-type': 'application/json', 'stripe-signature': sign(raw, Math.floor(Date.now() / 1000)) }, raw });
  };
  const badRaw = JSON.stringify({ id: 'evt_bad', created: 1, type: 'invoice.paid', data: { object: {} } });
  const bad = await rawRequest(port, '/api/host/billing/webhook', { headers: { 'content-type': 'application/json', 'stripe-signature': sign(badRaw, Math.floor(Date.now() / 1000), 'whsec_wrong') }, raw: badRaw });
  assert.equal(bad.status, 400); assert.equal(bad.body.errorCode, 'STRIPE_SIGNATURE_INVALID');

  let res = await deliver({ id: 'evt_h_co', created: 1, type: 'checkout.session.completed', data: { object: { payment_link: 'plink_regular', subscription: 'sub_9', customer: 'cus_9', payment_status: 'paid' } } });
  assert.equal(res.status, 200); assert.equal(res.body.handled, true);
  res = await deliver({ id: 'evt_h_act', created: 2, type: 'customer.subscription.updated', data: { object: { id: 'sub_9', customer: 'cus_9', status: 'active', items: { data: [{ price: { id: 'price_regular' } }] } } } });
  assert.equal(res.status, 200);
  let session = await request('/api/session', { headers: { authorization: 'one' } });
  assert.equal(session.status, 200);

  res = await deliver({ id: 'evt_h_unpaid', created: 3, type: 'customer.subscription.updated', data: { object: { id: 'sub_9', customer: 'cus_9', status: 'unpaid', items: { data: [{ price: { id: 'price_regular' } }] } } } });
  assert.equal(res.status, 200);
  session = await request('/api/session', { headers: { authorization: 'one' } });
  assert.equal(session.status, 200); assert.equal(session.body.billing.accessState, 'paused');
  const product = await request('/api/users', { headers: { authorization: 'one' } });
  assert.equal(product.status, 403); assert.equal(product.body.errorCode, 'BILLING_ACCESS_PAUSED');

  res = await deliver({ id: 'evt_h_old_active', created: 2, type: 'customer.subscription.updated', data: { object: { id: 'sub_9', customer: 'cus_9', status: 'active', items: { data: [{ price: { id: 'price_light' } }] } } } });
  assert.equal(res.status, 200); assert.equal(res.body.handled, false);
  assert.equal((await eventOutcome(f, 'evt_h_old_active')).outcome, 'stale');
  const stillPaused = await request('/api/users', { headers: { authorization: 'one' } });
  assert.equal(stillPaused.status, 403); assert.equal(stillPaused.body.errorCode, 'BILLING_ACCESS_PAUSED');

  const resolved = await request('/api/host/tenants/tenant-one/billing/resolve', { method: 'POST', headers: operator, body: { action: 'drop_to_free' } });
  assert.equal(resolved.status, 404);
  session = await request('/api/session', { headers: { authorization: 'one' } });
  assert.equal(session.status, 200);
});

test('213 HTTP: billing-only tier quotas apply with signup off and preserve operator defaults', async t => {
  const f = await h8Fixture(t);
  Object.assign(f.env, env({ OPENSIGHT_SIGNUP_ENABLED: 'false',
    OPENSIGHT_BILLING_TIER_ENTITLEMENTS: JSON.stringify({ light: { ...LIGHT, apiCalls: 0 } }) }));
  const { server, request } = await serveH8(t, f, { stripeFetcher: async () => { throw new Error('Unexpected Stripe request'); } });
  const headers = { authorization: 'one' };
  assert.equal((await request('/api/users', { headers })).status, 200);
  const raw = JSON.stringify({ id: 'evt_213_paid', created: 1, type: 'checkout.session.completed', data: { object: {
    subscription: 'sub_213', customer: 'cus_213', metadata: { tenant_id: 'tenant-one', tier: 'light' }, payment_status: 'paid',
  } } });
  const paid = await rawRequest(server.address().port, '/api/host/billing/webhook', {
    headers: { 'content-type': 'application/json', 'stripe-signature': sign(raw, Math.floor(Date.now() / 1000)) }, raw,
  });
  assert.equal(paid.status, 200); assert.equal(paid.body.handled, true);
  for (let n = 0; n < 3; n++) {
    const denied = await request('/api/users', { headers });
    assert.equal(denied.status, 429); assert.equal(denied.body.errorCode, 'USAGE_LIMIT_EXCEEDED');
    assert.equal((await request('/api/users', { headers: { authorization: 'two' } })).status, 200);
  }
  // Identity remains available for billing resolution even when product quotas are exhausted.
  const session = await request('/api/session', { headers });
  assert.equal(session.status, 200); assert.equal(session.body.billing.tier, 'light');
});

test('HTTP: without Stripe configuration the billing routes do not exist and the product works unchanged', async t => {
  const f = await h8Fixture(t);
  const { request, operator } = await serveH8(t, f);
  const link = await request('/api/host/tenants/tenant-one/billing/payment-link', { method: 'POST', headers: operator, body: { tier: 'light' } });
  assert.equal(link.status, 404);
  const session = await request('/api/session', { headers: { authorization: 'one' } });
  assert.equal(session.status, 200);
});


test('197: paid beats trial beats none; exact expiry, retained deadline, one audited pause', async t => {
  const f = await h8Fixture(t); await initializeUsage(f.db); await initializeBilling(f.db); await initializeBilling(f.db);
  let now = Date.UTC(2026, 10, 6); const start = now;
  const mail = new StubMailTransport();
  const billing = new HostedBilling(f.db, billingConfig(env({ OPENSIGHT_TRIAL_ENTITLEMENT: JSON.stringify(LIGHT) })), { clock: () => now, mail, notifyTo: 'operator@example.test' });
  await billing.startTrial('tenant-one');
  assert.deepEqual(billing.tierEntitlement('tenant-one'), LIGHT);
  assert.deepEqual(billing.trial('tenant-one'), { endsAt: new Date(start + 14 * 86400000).toISOString(), daysRemaining: 14 });
  now += 14 * 86400000 - 1; assert.doesNotThrow(() => billing.assertAccess('tenant-one'));
  now++; assert.throws(() => billing.assertAccess('tenant-one'), { code: 'TRIAL_EXPIRED', status: 403 });
  await billing.expireTrials(); await billing.expireTrials();
  const state = await billing.state('tenant-one');
  assert.equal(state.pauseEffectiveAt, state.trialEndsAt);
  assert.equal(state.retentionDueAt, new Date(start + 44 * 86400000).toISOString());
  assert.equal(billing.tierEntitlement('tenant-one'), null);
  const usage = new HostedUsage(f.db, { defaults: FREE, tenants: {} }); usage.tierEntitlement = id => billing.tierEntitlement(id);
  assert.throws(() => usage.entitlement({ tenantId: 'tenant-one', namespaceId: 'one' }), { code: 'ENTITLEMENT_UNRESOLVED' });
  assert.equal(mail.messages.length, 1);
  const audits = await readOperatorAudit(f.db, { limit: 100 });
  assert.equal(audits.filter(e => e.action === 'billing.access.paused' && e.detail.reason === 'trial_expired').length, 1);
  await billing.handleEvent({ id: 'evt_trial_checkout', created: 1, type: 'checkout.session.completed', object: {
    subscription: 'sub_1', customer: 'cus_1', metadata: { tenant_id: 'tenant-one', tier: 'light' }, payment_status: 'paid',
  } });
  await billing.handleEvent(subscriptionEvent('evt_trial_paid', activeSub));
  assert.equal((await billing.state('tenant-one')).trialEndsAt, null);
  assert.equal(billing.trial('tenant-one'), null); assert.deepEqual(billing.tierEntitlement('tenant-one'), LIGHT);
  assert.doesNotThrow(() => billing.assertAccess('tenant-one'));
  assert.equal(billing.tierEntitlement('no-billing'), undefined);
});

test('197 checkout: session/subscription metadata, no payment-link row, paid conversion restores expired trial', async t => {
  const f = await h8Fixture(t); await initializeBilling(f.db);
  let now = Date.UTC(2026, 10, 6), seen;
  const stripe = httpStripeClient('sk_test', async (url, init) => { seen = { url, form: new URLSearchParams(init.body) }; return { ok: true, status: 200, json: async () => ({ id: 'cs_new', url: 'https://checkout.stripe.com/c/pay/test' }) }; });
  const billing = new HostedBilling(f.db, billingConfig(env({ OPENSIGHT_TRIAL_ENTITLEMENT: JSON.stringify(LIGHT) })), { clock: () => now, origin: 'https://opensight.example', stripe });
  await billing.startTrial('tenant-one'); now += 14 * 86400000; await billing.expireTrials();
  await billing.createCheckoutSession('tenant-one', 'regular');
  assert.equal(seen.url, 'https://api.stripe.com/v1/checkout/sessions'); assert.equal(seen.form.get('mode'), 'subscription');
  for (const prefix of ['metadata', 'subscription_data[metadata]']) { assert.equal(seen.form.get(`${prefix}[tenant_id]`), 'tenant-one'); assert.equal(seen.form.get(`${prefix}[tier]`), 'regular'); }
  assert.equal(seen.form.get('line_items[0][price]'), 'price_regular');
  await billing.handleEvent({ id: 'evt_session_meta', created: 1, type: 'checkout.session.completed', object: { id: 'cs_new', metadata: { tenant_id: 'tenant-one', tier: 'regular' }, subscription: 'sub_new', customer: 'cus_new', payment_status: 'paid' } });
  const state = await billing.state('tenant-one'); assert.equal(state.tier, 'regular'); assert.equal(state.trialEndsAt, null); assert.equal(state.retentionDueAt, null);
  assert.doesNotThrow(() => billing.assertAccess('tenant-one'));
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h9_billing_links'))).length, 0);
  await assert.rejects(billing.createCheckoutSession('tenant-one', 'free'), { code: 'BILLING_TIER_INVALID' });
});

const TRIAL212 = { apiCalls: 42, storageBytes: 4200, computeAttempts: 42 };
async function trialBilling212(t) {
  const f = await h8Fixture(t); await initializeUsage(f.db); await initializeBilling(f.db);
  const start = Date.UTC(2026, 10, 6); let now = start;
  const mail = new StubMailTransport();
  const stripe = { createPaymentLink: async ({ tier }) => ({ id: `plink_${tier}`, url: `https://buy.stripe.com/plink_${tier}` }) };
  const billing = new HostedBilling(f.db, billingConfig(env({ OPENSIGHT_TRIAL_ENTITLEMENT: JSON.stringify(TRIAL212) })), { clock: () => now, mail, notifyTo: 'operator@example.test', stripe });
  await billing.startTrial('tenant-one');
  return { f, billing, trialEnds: new Date(start + 14 * 86400000).toISOString() };
}

test('212: unpaid checkout and incomplete subscription keep a live trial; the active transition converts', async t => {
  const { f, billing, trialEnds } = await trialBilling212(t);
  const unpaid = await billing.handleEvent({ id: 'evt_212_unpaid', created: 1, type: 'checkout.session.completed', object: {
    subscription: 'sub_1', customer: 'cus_1', metadata: { tenant_id: 'tenant-one', tier: 'light' }, payment_status: 'unpaid',
  } });
  assert.equal(unpaid.handled, true);
  let state = await billing.state('tenant-one');
  assert.equal(state.stripeSubscriptionId, 'sub_1'); assert.equal(state.tier, null); assert.equal(state.trialEndsAt, trialEnds);
  assert.deepEqual(billing.tierEntitlement('tenant-one'), TRIAL212);
  assert.equal(billing.trial('tenant-one').endsAt, trialEnds);
  await billing.handleEvent({ id: 'evt_212_created', created: 2, type: 'customer.subscription.created', object: { ...activeSub, status: 'incomplete' } });
  state = await billing.state('tenant-one');
  assert.equal(state.subscriptionStatus, 'incomplete'); assert.equal(state.tier, null); assert.equal(state.trialEndsAt, trialEnds);
  assert.deepEqual(billing.tierEntitlement('tenant-one'), TRIAL212);
  assert.doesNotThrow(() => billing.assertAccess('tenant-one'));
  const audits = await readOperatorAudit(f.db, { limit: 100 });
  assert.equal(audits.filter(e => e.action === 'billing.trial.converted').length, 0);
  await billing.handleEvent(subscriptionEvent('evt_212_active', activeSub, 3));
  state = await billing.state('tenant-one');
  assert.equal(state.tier, 'light'); assert.equal(state.trialEndsAt, null); assert.equal(billing.trial('tenant-one'), null);
  assert.deepEqual(billing.tierEntitlement('tenant-one'), LIGHT);
});

test('212: unpaid payment-link checkout binds but does not convert a live trial', async t => {
  const { billing, trialEnds } = await trialBilling212(t);
  await billing.createPaymentLink('tenant-one', 'light');
  const result = await billing.handleEvent({ id: 'evt_212_link_unpaid', created: 1, type: 'checkout.session.completed', object: {
    payment_link: 'plink_light', subscription: 'sub_1', customer: 'cus_1', payment_status: 'unpaid',
  } });
  assert.equal(result.handled, true);
  const state = await billing.state('tenant-one');
  assert.equal(state.stripeSubscriptionId, 'sub_1'); assert.equal(state.tier, null); assert.equal(state.trialEndsAt, trialEnds);
  assert.deepEqual(billing.tierEntitlement('tenant-one'), TRIAL212);
});
