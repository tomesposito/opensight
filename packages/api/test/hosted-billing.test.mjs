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

test('billing config: disabled with no Stripe variables, fail-closed on partial config', () => {
  assert.equal(billingConfig({}), undefined);
  assert.throws(() => billingConfig({ OPENSIGHT_STRIPE_SECRET_KEY: 'sk_test_placeholder' }), { code: 'BILLING_CONFIG_INVALID' });
  assert.throws(() => billingConfig({ OPENSIGHT_BILLING_TIER_ENTITLEMENTS: '{}' }), { code: 'BILLING_CONFIG_INVALID' });
  assert.throws(() => billingConfig(env({ OPENSIGHT_BILLING_TIER_ENTITLEMENTS: '{"bogus":{}}' })), { code: 'BILLING_CONFIG_INVALID' });
  const config = billingConfig(env());
  assert.equal(config.priceIds.light, 'price_light');
  assert.deepEqual(config.tierEntitlements.free, FREE);
  assert.equal(TIER_PRICE_CENTS.light, 2900); assert.equal(TIER_PRICE_CENTS.heavy, 39900);
});

test('webhook signature verification accepts the genuine signature and rejects everything else', () => {
  const raw = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'ping', data: { object: {} } }));
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
  const link = await client.createPaymentLink({ priceId: 'price_light', tenantId: 'tenant-one', tier: 'light' });
  assert.deepEqual(link, { id: 'plink_1', url: 'https://buy.stripe.com/plink_1' });
  assert.equal(seen.url, 'https://api.stripe.com/v1/payment_links');
  assert.equal(seen.init.headers.authorization, 'Bearer sk_test_placeholder');
  const form = new URLSearchParams(seen.init.body);
  assert.equal(form.get('line_items[0][price]'), 'price_light');
  assert.equal(form.get('metadata[tenant_id]'), 'tenant-one');
  const failing = httpStripeClient('sk_test_placeholder', async () => ({ ok: false, status: 402, json: async () => ({ error: {} }) }));
  await assert.rejects(failing.createPaymentLink({ priceId: 'price_light', tenantId: 'tenant-one', tier: 'light' }), { code: 'STRIPE_REQUEST_FAILED' });
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
const subscriptionEvent = (id, object) => ({ id, type: 'customer.subscription.updated', object });
const activeSub = { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1794000000, items: { data: [{ price: { id: 'price_light' } }] } };

test('211 allowlist: unknown subscription and invoice types are recorded without changing billing', async t => {
  const f = await billingFixture(t);
  await f.billing.createPaymentLink('tenant-one', 'light');
  await f.billing.handleEvent({ id: 'evt_allow_checkout', type: 'checkout.session.completed', object: { payment_link: 'plink_light', subscription: 'sub_1', customer: 'cus_1' } });
  await f.billing.handleEvent(subscriptionEvent('evt_allow_active', activeSub));
  const before = await f.billing.state('tenant-one');
  const audits = await readOperatorAudit(f.db, { limit: 100 });
  for (const [index, type] of ['customer.subscription.fabricated', 'customer.subscription.updated.extra', 'invoice.paid.extra'].entries()) {
    const event = { id: `evt_ignored_${index}`, type, object: { ...activeSub, status: 'unpaid', subscription: 'sub_other', metadata: { tenant_id: 'tenant-one' } } };
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
  const checkout = await f.billing.handleEvent({ id: 'evt_checkout', type: 'checkout.session.completed', object: { payment_link: 'plink_light', subscription: 'sub_1', customer: 'cus_1' } });
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
  const unmatched = await f.billing.handleEvent({ id: 'evt_stray', type: 'invoice.paid', object: { subscription: 'sub_unknown', customer: 'cus_unknown' } });
  assert.equal(unmatched.handled, false); assert.equal(unmatched.action, 'unmatched');
});

test('past-due rule: failed payment keeps access during retries, unpaid pauses; drop-to-Free is unavailable', async t => {
  const f = await billingFixture(t);
  await f.billing.createPaymentLink('tenant-one', 'light');
  await f.billing.handleEvent({ id: 'evt_co', type: 'checkout.session.completed', object: { payment_link: 'plink_light', subscription: 'sub_1', customer: 'cus_1' } });
  await f.billing.handleEvent(subscriptionEvent('evt_act', activeSub));
  await f.billing.handleEvent({ id: 'evt_fail', type: 'invoice.payment_failed', object: { subscription: 'sub_1', customer: 'cus_1' } });
  let state = await f.billing.state('tenant-one');
  assert.equal(state.subscriptionStatus, 'past_due');
  assert.doesNotThrow(() => f.billing.assertAccess('tenant-one'));
  const usage = new HostedUsage(f.db, { defaults: FREE, tenants: {} });
  usage.tierEntitlement = tenantId => f.billing.tierEntitlement(tenantId);
  assert.deepEqual(usage.entitlement({ tenantId: 'tenant-one', namespaceId: 'one' }), LIGHT);
  const paused = await f.billing.handleEvent(subscriptionEvent('evt_unpaid', { ...activeSub, status: 'unpaid' }));
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
  await f.billing.handleEvent({ id: 'evt_co2', type: 'checkout.session.completed', object: { payment_link: 'plink_regular', subscription: 'sub_1', customer: 'cus_1' } });
  const regular = { ...activeSub, items: { data: [{ price: { id: 'price_regular' } }] } };
  await f.billing.handleEvent(subscriptionEvent('evt_act2', regular));
  await f.billing.handleEvent(subscriptionEvent('evt_unpaid2', { ...regular, status: 'unpaid' }));
  assert.throws(() => f.billing.assertAccess('tenant-one'), { code: 'BILLING_ACCESS_PAUSED' });
  const restored = await f.billing.handleEvent(subscriptionEvent('evt_back', regular));
  assert.equal(restored.action, 'access_restored');
  const state = await f.billing.state('tenant-one');
  assert.equal(state.tier, 'regular'); assert.equal(state.accessState, 'active');
  assert.doesNotThrow(() => f.billing.assertAccess('tenant-one'));
});

test('cancelled subscription pauses at period end, not before', async t => {
  const start = Date.UTC(2026, 10, 3, 12);
  const f = await billingFixture(t, start);
  await f.billing.createPaymentLink('tenant-one', 'light');
  await f.billing.handleEvent({ id: 'evt_co3', type: 'checkout.session.completed', object: { payment_link: 'plink_light', subscription: 'sub_1', customer: 'cus_1' } });
  await f.billing.handleEvent(subscriptionEvent('evt_act3', activeSub));
  const periodEndSeconds = Math.floor(start / 1000) + 86400;
  await f.billing.handleEvent({ id: 'evt_cancel', type: 'customer.subscription.deleted', object: { ...activeSub, status: 'canceled', current_period_end: periodEndSeconds } });
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
  const badRaw = JSON.stringify({ id: 'evt_bad', type: 'invoice.paid', data: { object: {} } });
  const bad = await rawRequest(port, '/api/host/billing/webhook', { headers: { 'content-type': 'application/json', 'stripe-signature': sign(badRaw, Math.floor(Date.now() / 1000), 'whsec_wrong') }, raw: badRaw });
  assert.equal(bad.status, 400); assert.equal(bad.body.errorCode, 'STRIPE_SIGNATURE_INVALID');

  let res = await deliver({ id: 'evt_h_co', type: 'checkout.session.completed', data: { object: { payment_link: 'plink_regular', subscription: 'sub_9', customer: 'cus_9' } } });
  assert.equal(res.status, 200); assert.equal(res.body.handled, true);
  res = await deliver({ id: 'evt_h_act', type: 'customer.subscription.updated', data: { object: { id: 'sub_9', customer: 'cus_9', status: 'active', items: { data: [{ price: { id: 'price_regular' } }] } } } });
  assert.equal(res.status, 200);
  let session = await request('/api/session', { headers: { authorization: 'one' } });
  assert.equal(session.status, 200);

  res = await deliver({ id: 'evt_h_unpaid', type: 'customer.subscription.updated', data: { object: { id: 'sub_9', customer: 'cus_9', status: 'unpaid', items: { data: [{ price: { id: 'price_regular' } }] } } } });
  assert.equal(res.status, 200);
  session = await request('/api/session', { headers: { authorization: 'one' } });
  assert.equal(session.status, 200); assert.equal(session.body.billing.accessState, 'paused');
  const product = await request('/api/users', { headers: { authorization: 'one' } });
  assert.equal(product.status, 403); assert.equal(product.body.errorCode, 'BILLING_ACCESS_PAUSED');

  const resolved = await request('/api/host/tenants/tenant-one/billing/resolve', { method: 'POST', headers: operator, body: { action: 'drop_to_free' } });
  assert.equal(resolved.status, 404);
  session = await request('/api/session', { headers: { authorization: 'one' } });
  assert.equal(session.status, 200);
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
  await billing.handleEvent(subscriptionEvent('evt_trial_paid', { ...activeSub, metadata: { tenant_id: 'tenant-one' } }));
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
  await billing.handleEvent({ id: 'evt_session_meta', type: 'checkout.session.completed', object: { id: 'cs_new', metadata: { tenant_id: 'tenant-one', tier: 'regular' }, subscription: 'sub_new', customer: 'cus_new', payment_status: 'paid' } });
  const state = await billing.state('tenant-one'); assert.equal(state.tier, 'regular'); assert.equal(state.trialEndsAt, null); assert.equal(state.retentionDueAt, null);
  assert.doesNotThrow(() => billing.assertAccess('tenant-one'));
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h9_billing_links'))).length, 0);
  await assert.rejects(billing.createCheckoutSession('tenant-one', 'free'), { code: 'BILLING_TIER_INVALID' });
});
