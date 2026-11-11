import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { h8Fixture, serveH8, referenceEnv } from './h8-helpers.mjs';
import { database } from './hosted-helpers.mjs';
import { billingConfig, waitlistBillingConfig, HostedBilling, initializeBilling, DAY_MS } from '../dist/hosted-billing.js';
import { initializeSignups } from '../dist/hosted-signup.js';
import { SignupOperator } from '../dist/hosted-signup-operator.js';
import { readOperatorAudit } from '../dist/operator-audit.js';
import { StubMailTransport } from '../dist/mail.js';
import { purgeTenantRows, tenantDeletionInventory } from '../dist/tenant-erasure.js';
import { migrateReference } from '../dist/single-node.js';
import { ReferenceMaintenance } from '../dist/single-node-maintenance.js';

const quotas = { apiCalls: 30000, storageBytes: 10000000000, computeAttempts: 1500 };
const entitlementEnv = { OPENSIGHT_TRIAL_ENTITLEMENT: JSON.stringify(quotas), OPENSIGHT_BILLING_TIER_ENTITLEMENTS: JSON.stringify({ light: quotas, regular: { ...quotas, apiCalls: 90000 }, heavy: { ...quotas, apiCalls: 300000 } }) };
const stripeEnv = { OPENSIGHT_STRIPE_SECRET_KEY: 'sk_fixture', OPENSIGHT_STRIPE_WEBHOOK_SECRET: 'whsec_fixture', OPENSIGHT_STRIPE_PRICE_LIGHT: 'price_l', OPENSIGHT_STRIPE_PRICE_REGULAR: 'price_r', OPENSIGHT_STRIPE_PRICE_HEAVY: 'price_h' };
async function fixture(t) {
  const f = await h8Fixture(t); Object.assign(f.env, entitlementEnv, { OPENSIGHT_ACCESS_REQUEST_NOTIFY_TO: 'operator@example.test' });
  await initializeBilling(f.db); await initializeSignups(f.db);
  let now = Date.UTC(2026, 10, 1); const clock = () => now, mail = new StubMailTransport();
  const config = waitlistBillingConfig(f.env);
  const options = { clock, mail, notifyTo: 'operator@example.test' };
  const billing = new HostedBilling(f.db, config, options);
  await billing.startTrial('tenant-one');
  const ask = (tier = 'regular', service = billing) => service.requestPaidPlan('tenant-one', tier, 'admin', 'one');
  const ops = new SignupOperator(f.db, { config: { enabled: false, volumeCap: 25 } }, billing, clock);
  return { ...f, clock, advance: days => { now += days * DAY_MS; }, config, options, billing, mail, ask, ops };
}
const requests = f => f.db.transaction(c => c.query('SELECT * FROM h11_paid_requests ORDER BY created_at, id'));

test('241 mode derives only from complete Stripe configuration; entitlements work without Stripe', async t => {
  const f = await fixture(t);
  assert.equal(billingConfig({}), undefined);
  assert.equal(billingConfig(entitlementEnv), undefined);
  assert.equal(f.billing.billingMode, 'waitlist');
  const checkout = new HostedBilling(f.db, billingConfig({ ...stripeEnv, ...entitlementEnv }), f.options);
  assert.equal(checkout.billingMode, 'checkout');
  await assert.rejects(f.ask('regular', checkout), { code: 'BILLING_WAITLIST_UNAVAILABLE' });
  for (const env of [{ OPENSIGHT_STRIPE_SECRET_KEY: 'only-one' }, { OPENSIGHT_TRIAL_ENTITLEMENT: '{}' }, { OPENSIGHT_BILLING_TIER_ENTITLEMENTS: '{"unknown":{}}' }]) assert.throws(() => billingConfig(env), { code: 'BILLING_CONFIG_INVALID' });
  const { request } = await serveH8(t, f, { clock: f.clock });
  const session = await request('/api/session', { headers: { authorization: 'one' } });
  assert.equal(session.body.billing.billingMode, 'waitlist'); assert.equal(session.body.billing.paidRequest, null);
  assert.equal((await request('/api/signup', { method: 'POST', body: {} })).status, 404);
});

test('241 concurrent requests and tier changes use one pending row, preserve requester/date and audit once', async t => {
  const f = await fixture(t), other = new HostedBilling(f.db, f.config, f.options);
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => f.ask('regular', i % 2 ? other : f.billing)));
  assert.equal(new Set(results.map(r => r.id)).size, 1); assert.equal((await requests(f)).length, 1);
  const original = results[0]; f.advance(1);
  const changed = await f.ask('heavy');
  assert.equal(changed.id, original.id); assert.equal(changed.createdAt, original.createdAt); assert.equal(changed.requestedBySubject, 'one');
  assert.equal(changed.requestedByEmail, 'one@example.test'); assert.equal(changed.tier, 'heavy');
  const audit = await readOperatorAudit(f.db);
  assert.equal(audit.filter(a => a.action === 'billing.paid_request.created').length, 1);
  assert.equal(audit.filter(a => a.action === 'billing.paid_request.tier_changed').length, 1);
  assert.equal(f.mail.messages.length, 1);
  await assert.rejects(f.ask('free'), { code: 'BILLING_TIER_INVALID' });
});

test('241 PostgreSQL mutation path locks the parent before request reads and writes', async t => {
  const f = await fixture(t); let locks = 0;
  const db = { dialect: 'postgres', transaction: work => f.db.transaction(c => {
    let locked = false;
    return work({ query: (sql, args) => {
      if (sql === 'SELECT tenant_id FROM h1_tenants WHERE tenant_id = ? FOR UPDATE') { locked = true; locks++; return c.query(sql.replace(' FOR UPDATE', ''), args); }
      if (sql.startsWith('SELECT * FROM h11_paid_requests WHERE tenant_id') || sql.startsWith('INSERT INTO h11_paid_requests') || sql.startsWith('UPDATE h11_paid_requests')) assert.equal(locked, true);
      return c.query(sql, args);
    } });
  }) };
  const billing = new HostedBilling(db, f.config, f.options);
  await f.ask('regular', billing); await f.ask('heavy', billing);
  await billing.resolvePaidRequest('tenant-one', 'withdrawn', 'one');
  assert.equal(locks, 3);
});

test('241 grant during trial applies immediately, discards clock, survives reload and is operator-audited', async t => {
  const f = await fixture(t), request = await f.ask('heavy');
  f.advance(2); await f.billing.resolvePaidRequest('tenant-one', 'granted', undefined, request.id);
  const state = await f.billing.state('tenant-one');
  assert.equal(state.tier, 'heavy'); assert.equal(state.entitlementSource, 'manual'); assert.equal(state.trialEndsAt, null);
  assert.equal(state.stripeSubscriptionId, null); assert.equal(state.stripeCustomerId, null);
  assert.equal(state.retentionDueAt, null); assert.equal(f.billing.trial('tenant-one'), null);
  assert.deepEqual(f.billing.tierEntitlement('tenant-one'), f.config.tierEntitlements.heavy);
  f.advance(90); const reloaded = new HostedBilling(f.db, f.config, f.options); await reloaded.load();
  assert.doesNotThrow(() => reloaded.assertAccess('tenant-one')); assert.equal((await reloaded.state('tenant-one')).tier, 'heavy');
  const grant = (await readOperatorAudit(f.db)).find(a => a.action === 'billing.paid_request.granted');
  assert.equal(grant.actor, 'deployment-operator'); assert.deepEqual(grant.detail, { requestId: request.id, tier: 'heavy' });
  assert.equal((await f.ops.status()).convertedToday, 0);
  await assert.rejects(f.ask(), { code: 'BILLING_PAID_REQUEST_UNAVAILABLE' });
});

test('241 expiry with pending request pauses without retention; restart/migration preserve hold', async t => {
  const f = await fixture(t); await f.ask(); f.advance(50);
  await f.billing.expireTrials();
  const state = await f.billing.state('tenant-one');
  assert.equal(state.accessState, 'paused'); assert.equal(state.retentionDueAt, null);
  assert.equal(state.pauseEffectiveAt, new Date(Date.UTC(2026, 10, 15)).toISOString());
  assert.throws(() => f.billing.assertAccess('tenant-one'), { code: 'TRIAL_EXPIRED' });
  await initializeBilling(f.db); await f.billing.load();
  assert.equal((await f.billing.state('tenant-one')).retentionDueAt, null);
  const status = await f.ops.status(); assert.equal(status.retentionDue.length, 0); assert.equal(status.paidRequestsOpen, 1);
  assert.doesNotMatch(f.mail.messages.at(-1).html, /retained for 30 days/);
  await f.billing.resolvePaidRequest('tenant-one', 'granted');
  assert.equal((await f.billing.state('tenant-one')).accessState, 'active'); assert.doesNotThrow(() => f.billing.assertAccess('tenant-one'));
});

for (const resolution of ['withdrawn', 'declined']) test(`241 ${resolution} restarts retention from resolution and permits a fresh request`, async t => {
  const f = await fixture(t); const first = await f.ask(); f.advance(60);
  await f.billing.resolvePaidRequest('tenant-one', resolution, resolution === 'withdrawn' ? 'one' : undefined);
  const state = await f.billing.state('tenant-one');
  assert.equal(state.accessState, 'paused'); assert.equal(state.retentionDueAt, new Date(f.clock() + 30 * DAY_MS).toISOString());
  assert.equal((await f.billing.viewState('tenant-one')).paidRequest.state, resolution);
  f.advance(1); const second = await f.ask('light'); assert.notEqual(second.id, first.id);
  assert.equal((await f.billing.state('tenant-one')).retentionDueAt, null);
  await assert.rejects(f.billing.resolvePaidRequest('tenant-one', 'granted', undefined, first.id), { code: 'BILLING_PAID_REQUEST_NOT_PENDING' });
  assert.equal((await requests(f)).filter(r => r.state === 'pending').length, 1);
});

test('241 decline/withdraw during trial preserves the trial deadline and no paused retention starts early', async t => {
  const f = await fixture(t); const before = await f.billing.state('tenant-one');
  await f.ask(); await f.billing.resolvePaidRequest('tenant-one', 'declined');
  assert.equal((await f.billing.state('tenant-one')).trialEndsAt, before.trialEndsAt);
  assert.equal((await f.billing.state('tenant-one')).retentionDueAt, null);
  assert.doesNotThrow(() => f.billing.assertAccess('tenant-one'));
  await f.ask(); await f.billing.resolvePaidRequest('tenant-one', 'withdrawn', 'one');
  f.advance(20); assert.equal((await f.billing.state('tenant-one')).retentionDueAt, new Date(Date.parse(before.trialEndsAt) + 30 * DAY_MS).toISOString());
});

test('241 missing entitlements and audit failures roll back grant/request, with no notification', async t => {
  const f = await fixture(t), request = await f.ask();
  const unconfigured = new HostedBilling(f.db, { tierEntitlements: {}, trialEntitlement: quotas }, f.options);
  await assert.rejects(unconfigured.resolvePaidRequest('tenant-one', 'granted'), { code: 'ENTITLEMENT_UNRESOLVED' });
  assert.equal((await f.billing.latestPaidRequest('tenant-one')).state, 'pending');
  const db = { dialect: 'sqlite', transaction: work => f.db.transaction(c => work({ query: (sql, args) => {
    if (sql.startsWith('INSERT INTO h8_audit') && args.includes('billing.paid_request.granted')) throw new Error('audit unavailable');
    return c.query(sql, args);
  } })) };
  await assert.rejects(new HostedBilling(db, f.config, f.options).resolvePaidRequest('tenant-one', 'granted'), /audit unavailable/);
  assert.equal((await f.billing.latestPaidRequest('tenant-one')).id, request.id);
  assert.equal((await f.billing.state('tenant-one')).tier, null); assert.equal(f.mail.messages.length, 1);
});

test('241 operator queue is oldest first, excludes closed tenants and never lists pending requests as retention due', async t => {
  const f = await fixture(t); const first = await f.ask(); f.advance(1); await f.billing.startTrial('tenant-two');
  await f.billing.requestPaidPlan('tenant-two', 'light', 'admin', 'two'); f.advance(50);
  let status = await f.ops.status(); assert.equal(status.paidRequestsOpen, 2);
  assert.equal(status.paidRequests[0].id, first.id); assert.equal(status.paidRequests[1].tenantId, 'tenant-two');
  assert.deepEqual(status.retentionDue, []);
  await f.db.transaction(c => c.query("UPDATE h1_tenants SET state = 'deleting' WHERE tenant_id = 'tenant-two'"));
  assert.equal((await f.ops.status()).paidRequestsOpen, 1);
  await assert.rejects(f.billing.resolvePaidRequest('tenant-two', 'granted'), { code: 'TENANT_UNAVAILABLE' });
});

test('241 HTTP tenant-admin and narrow operator boundaries, including origin, scope and stale request defenses', async t => {
  const f = await fixture(t); f.advance(16);
  const { request, operator } = await serveH8(t, f, { clock: f.clock, mailTransport: f.mail });
  const headers = { authorization: 'one', origin: f.env.OPENSIGHT_PUBLIC_ORIGIN }, op = { ...operator, origin: headers.origin };
  for (const bad of [{}, { authorization: 'one' }, { ...headers, origin: 'https://hostile.example' }]) {
    assert.notEqual((await request('/api/billing/paid-request', { method: 'POST', headers: bad, body: { tier: 'regular' } })).status, 200);
  }
  assert.equal((await request('/api/billing/paid-request', { method: 'POST', headers, body: { tier: 'regular', tenantId: 'tenant-two' } })).status, 400);
  const created = await request('/api/billing/paid-request', { method: 'POST', headers, body: { tier: 'regular' } });
  assert.equal(created.status, 200); assert.equal(created.body.billing.paidRequest.requestedByEmail, 'one@example.test');
  assert.equal(created.body.billing.retentionDueAt, null);
  assert.equal((await request('/api/namespaces/two/billing/paid-request', { method: 'DELETE', headers })).status, 404);
  await f.db.transaction(c => c.query("UPDATE h1_resources SET body = ? WHERE tenant_id = 'tenant-one' AND resource_id = 'admin' AND kind = 'user'", [JSON.stringify({ name: 'Reader', role: 'reader' })]));
  for (const path of ['/api/billing/paid-request', '/api/namespaces/one/billing/paid-request']) for (const method of ['POST', 'DELETE']) assert.equal((await request(path, { method, headers, body: method === 'POST' ? { tier: 'heavy' } : undefined })).body.errorCode, 'SECURITY_ADMIN_REQUIRED');
  const pending = await f.billing.latestPaidRequest('tenant-one'); const path = '/api/host/tenants/tenant-one/billing/paid-request/grant';
  assert.equal((await request(path, { method: 'POST', headers, body: { requestId: pending.id } })).status, 403);
  assert.equal((await request(path, { method: 'POST', headers: { ...op, origin: 'https://hostile.example' }, body: { requestId: pending.id } })).status, 403);
  assert.equal((await request(path, { method: 'GET', headers: op })).status, 403);
  assert.equal((await request(path, { method: 'POST', headers: op, body: { requestId: 'stale' } })).status, 409);
  const granted = await request(path, { method: 'POST', headers: op, body: { requestId: pending.id } }); assert.equal(granted.status, 200);
  const session = await request('/api/session', { headers }); assert.equal(session.body.billingPaused, false); assert.equal(session.body.trial, null);
  assert.equal(session.body.billing.entitlementSource, 'manual');
  await f.db.transaction(c => c.query("UPDATE h1_resources SET body = ? WHERE tenant_id = 'tenant-one' AND resource_id = 'admin' AND kind = 'user'", [JSON.stringify({ name: 'Admin', role: 'administrator' })]));
  const access = await request('/api/users', { headers }); assert.equal(access.status, 200, JSON.stringify(access.body));
  assert.equal((await request(path, { method: 'POST', headers: op, body: { requestId: pending.id } })).status, 409);
  assert.equal((await request('/api/host/signups', { headers: op })).body.paidRequestsOpen, 0);
  for (const action of ['payment-link', 'webhook']) assert.equal((await request(action === 'webhook' ? '/api/host/billing/webhook' : `/api/host/tenants/tenant-one/billing/${action}`, { method: 'POST', headers: operator, body: { tier: 'light' } })).status, 404);
});

test('241 grant email uses exact copy, escaped workspace names and valid stable dedupe keys', async t => {
  const f = await fixture(t); await f.db.transaction(c => c.query('UPDATE h1_tenants SET display_name = ? WHERE tenant_id = ?', ['Reports <img src=x> & Ops', 'tenant-one']));
  const r = await f.ask(); await f.billing.resolvePaidRequest('tenant-one', 'granted');
  assert.equal(f.mail.messages.length, 2);
  const [operator, admin] = f.mail.messages;
  assert.deepEqual(operator.to, ['operator@example.test']); assert.match(operator.html, /Paid requests queue/);
  assert.deepEqual(admin.to, ['one@example.test']); assert.equal(admin.subject, 'Your OpenSight Regular plan is on');
  assert.equal(admin.html, "<p>Your workspace Reports &lt;img src=x&gt; &amp; Ops is now on the Regular plan. No payment was taken — subscriptions open later, and we'll write again before anything is charged.</p>");
  for (const msg of [operator, admin]) { assert.match(msg.dedupeKey, /^[a-f0-9]{64}$/); assert.equal(msg.tenantId, undefined); }
  assert.notEqual(operator.dedupeKey, admin.dedupeKey); assert.equal((await f.billing.latestPaidRequest('tenant-one')).id, r.id);
});

test('241 mail failure is logged safely and cannot undo requests or grants', async t => {
  const f = await fixture(t), warnings = []; t.mock.method(console, 'warn', line => warnings.push(JSON.parse(line)));
  const mail = { configured: true, send: async () => { throw new Error('sensitive transport details'); } };
  const billing = new HostedBilling(f.db, f.config, { ...f.options, mail });
  const r = await f.ask('regular', billing); assert.equal((await requests(f)).length, 1);
  await billing.resolvePaidRequest('tenant-one', 'granted');
  assert.equal((await billing.state('tenant-one')).entitlementSource, 'manual');
  assert.deepEqual(warnings.map(w => w.kind), ['created', 'granted']);
  for (const w of warnings) assert.deepEqual(w, { code: 'BILLING_PAID_REQUEST_MAIL_FAILED', requestId: r.id, kind: w.kind });
});

test('241 schema migrates old trial/Stripe sources, is idempotent, and enforces the final pending invariant', async t => {
  const f = await fixture(t); await f.db.transaction(async c => {
    await c.query('ALTER TABLE h9_billing DROP COLUMN entitlement_source');
    await c.query("INSERT INTO h9_billing (tenant_id, tier, updated_at) VALUES ('tenant-two', 'regular', ?)", [new Date(f.clock()).toISOString()]);
  });
  // Run the PostgreSQL introspection branch against the local database too.
  const db = { dialect: 'postgres', transaction: work => f.db.transaction(c => work({ query: (sql, args) => c.query(sql.startsWith('SELECT column_name AS name') ? 'PRAGMA table_info(h9_billing)' : sql, args) })) };
  await initializeBilling(db); await initializeBilling(f.db);
  assert.equal((await f.billing.state('tenant-one')).entitlementSource, 'trial'); assert.equal((await f.billing.state('tenant-two')).entitlementSource, 'stripe');
  await f.ask();
  await assert.rejects(f.db.transaction(c => c.query("INSERT INTO h11_paid_requests (id, tenant_id, tier, requested_by_subject, requested_by_email, state, created_at) VALUES ('duplicate', 'tenant-one', 'light', 'one', 'one@example.test', 'pending', ?)", [new Date(f.clock()).toISOString()])), { code: 'METADATA_CONFLICT' });
});

test('241 backup preserves requests; erasure inventories and deletes request identity data', async t => {
  const f = await fixture(t); await migrateReference(f.db, referenceEnv, 'sqlite'); await f.ask();
  const directory = join(dirname(f.path), 'backups');
  const source = await ReferenceMaintenance.open(f.db, directory, Buffer.alloc(32, 7), 'frozen');
  const backup = await source.backup();
  const target = await database(t); await migrateReference(target.db, referenceEnv, 'sqlite');
  const restore = await ReferenceMaintenance.open(target.db, directory, Buffer.alloc(32, 7), 'frozen'); await restore.restore(backup.id);
  assert.deepEqual(await target.db.transaction(c => c.query('SELECT * FROM h11_paid_requests')), await requests(f));
  assert.equal((await f.db.transaction(c => tenantDeletionInventory(c, 'tenant-one'))).find(r => r.store === 'h11_paid_requests').count, 1);
  await f.db.transaction(c => purgeTenantRows(c, 'tenant-one')); assert.deepEqual(await requests(f), []);
});

test('241 HTTP withdrawal and decline are audited; no-Stripe signup can be enabled with existing trial quotas', async t => {
  const f = await fixture(t); f.env.OPENSIGHT_SIGNUP_ENABLED = 'true';
  const { request, operator } = await serveH8(t, f, { clock: f.clock, mailTransport: f.mail, signupChallengeVerifier: async () => true });
  const headers = { authorization: 'one', origin: f.env.OPENSIGHT_PUBLIC_ORIGIN };
  assert.equal((await request('/api/host/signups', { headers: operator })).body.enabled, true);
  assert.equal((await request('/api/signup/checkout', { method: 'POST', headers, body: { tier: 'regular' } })).status, 404);
  for (const action of ['withdrawn', 'declined']) {
    const created = await request('/api/billing/paid-request', { method: 'POST', headers, body: { tier: 'light' } }); assert.equal(created.status, 200);
    const pending = await f.billing.latestPaidRequest('tenant-one');
    const result = action === 'withdrawn' ? await request('/api/namespaces/one/billing/paid-request', { method: 'DELETE', headers })
      : await request('/api/host/tenants/tenant-one/billing/paid-request/decline', { method: 'POST', headers: { ...operator, origin: headers.origin }, body: { requestId: pending.id } });
    assert.equal(result.status, 200); assert.equal(result.body.billing.paidRequest.state, action);
    const audit = (await readOperatorAudit(f.db)).find(a => a.action === `billing.paid_request.${action}`);
    assert.equal(audit.actor, action === 'withdrawn' ? 'one' : 'deployment-operator'); assert.equal(audit.detail.requestId, pending.id);
  }
});

test('241 adding Stripe leaves manually granted tenants on their manual tier without a subscription', async t => {
  const f = await fixture(t); await f.ask(); await f.billing.resolvePaidRequest('tenant-one', 'granted');
  Object.assign(f.env, stripeEnv);
  const { request } = await serveH8(t, f, { clock: f.clock });
  const result = await request('/api/session', { headers: { authorization: 'one' } });
  assert.equal(result.body.billing.billingMode, 'checkout'); assert.equal(result.body.billing.tier, 'regular');
  assert.equal(result.body.billing.entitlementSource, 'manual'); assert.equal(result.body.billing.stripeSubscriptionId, null);
});

test('241 waiting retention remains held when Stripe is later configured and an unpaid checkout is recorded', async t => {
  const f = await fixture(t); await f.ask(); f.advance(20); await f.billing.expireTrials();
  const billing = new HostedBilling(f.db, billingConfig({ ...stripeEnv, ...entitlementEnv }), f.options); await billing.load();
  await billing.handleEvent({ id: 'evt_waiting_unpaid', created: 100, type: 'checkout.session.completed', object: {
    metadata: { tenant_id: 'tenant-one', tier: 'regular' }, subscription: 'sub_waiting', customer: 'cus_waiting', payment_status: 'unpaid',
  } });
  assert.equal((await billing.state('tenant-one')).retentionDueAt, null); assert.equal((await f.ops.status()).retentionDue.length, 0);
});
