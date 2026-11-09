import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { h8Fixture, referenceEnv } from './h8-helpers.mjs';
import { database } from './hosted-helpers.mjs';
import { CHECKOUT_REUSE_MS, HostedBilling, initializeBilling } from '../dist/hosted-billing.js';
import { MetadataError } from '../dist/metadata-db.js';
import { readOperatorAudit } from '../dist/operator-audit.js';
import { migrateReference } from '../dist/single-node.js';
import { ReferenceMaintenance } from '../dist/single-node-maintenance.js';
import { assertReferenceErasureStores, purgeTenantRows, tenantDeletionInventory } from '../dist/tenant-erasure.js';

const operations = db => db.transaction(c => c.query('SELECT * FROM h9_billing_operations ORDER BY created_at, operation_id'));
const config = { apiKey: 'sk_test_placeholder', webhookSecret: 'whsec_test_placeholder', priceIds: { light: 'price_light', regular: 'price_regular', heavy: 'price_heavy' }, tierEntitlements: {} };
const origin = 'https://opensight.example';
async function fixture(t) {
  const f = await h8Fixture(t); await initializeBilling(f.db);
  let now = Date.UTC(2026, 10, 9);
  const calls = [], objects = new Map();
  const stripe = {
    async createPaymentLink(input) { return create('plink', input); },
    async createCheckoutSession(input) { return create('cs', input); },
  };
  function create(prefix, input) {
    calls.push(input);
    const reader = new DatabaseSync(f.path, { readOnly: true });
    try {
      // A separate connection sees only committed data, even during the POST.
      const row = reader.prepare('SELECT * FROM h9_billing_operations WHERE idempotency_key = ?').get(input.idempotencyKey);
      assert.ok(row, 'reservation must already be committed before Stripe');
      assert.ok(['pending', 'failed'].includes(row.status));
      assert.equal(row.stripe_object_id, null); assert.equal(row.stripe_url, null);
    } finally { reader.close(); }
    if (!objects.has(input.idempotencyKey)) {
      const id = `${prefix}_${objects.size + 1}`;
      objects.set(input.idempotencyKey, { id, url: `https://${prefix === 'cs' ? 'checkout' : 'buy'}.stripe.com/${id}` });
    }
    return objects.get(input.idempotencyKey);
  }
  const makeBilling = (extra = {}, settings = config) => new HostedBilling(f.db, settings, { stripe, origin, clock: () => now, ...extra });
  return { ...f, stripe, calls, objects, makeBilling, billing: makeBilling(), advance: ms => { now += ms; }, now: () => now };
}
async function creationAudits(db, action = 'billing.payment_link.created') {
  return (await readOperatorAudit(db, { limit: 100 })).filter(row => row.action === action);
}
async function seedOperation(db, id, tenant = 'tenant-one') {
  await db.transaction(c => c.query(`INSERT INTO h9_billing_operations
    (operation_id, idempotency_key, tenant_id, kind, tier, status, price_id, created_at, updated_at)
    VALUES (?, ?, ?, 'payment_link', 'light', 'pending', 'price_light', ?, ?)`,
  [id, `key_${id}`, tenant, '2026-11-09T00:00:00.000Z', '2026-11-09T00:00:00.000Z']));
}

test('227 operations: additive initialization preserves records and enforces unique keys', async t => {
  const f = await h8Fixture(t); await initializeBilling(f.db);
  await seedOperation(f.db, 'op_one');
  const before = await operations(f.db);
  await initializeBilling(f.db);
  assert.deepEqual(await operations(f.db), before);
  await assert.rejects(f.db.transaction(c => c.query(`INSERT INTO h9_billing_operations
    SELECT 'op_duplicate', idempotency_key, tenant_id, kind, tier, status, price_id, checkout_origin,
      stripe_object_id, stripe_url, created_at, updated_at FROM h9_billing_operations`)), { code: 'METADATA_CONFLICT' });
  await assert.rejects(seedOperation(f.db, 'op_missing', 'tenant-missing'), { code: 'METADATA_REFERENCE_INVALID' });
});

test('227 operations: encrypted backup restores retry keys and erasure removes only the selected tenant', async t => {
  const f = await h8Fixture(t); await migrateReference(f.db, referenceEnv, 'sqlite'); await initializeBilling(f.db);
  await seedOperation(f.db, 'op_one'); await seedOperation(f.db, 'op_two', 'tenant-two');
  await assertReferenceErasureStores(f.db);
  const directory = join(dirname(f.path), 'billing-backups'), key = randomBytes(32);
  const source = await ReferenceMaintenance.open(f.db, directory, key, 'frozen');
  const backup = await source.backup();
  const target = await database(t); await migrateReference(target.db, referenceEnv, 'sqlite');
  const restore = await ReferenceMaintenance.open(target.db, directory, key, 'frozen'); await restore.restore(backup.id);
  assert.deepEqual(await operations(target.db), await operations(f.db));
  const inventory = await f.db.transaction(c => tenantDeletionInventory(c, 'tenant-one'));
  assert.equal(inventory.find(row => row.store === 'h9_billing_operations').count, 1);
  await f.db.transaction(c => purgeTenantRows(c, 'tenant-one'));
  assert.deepEqual((await operations(f.db)).map(row => row.operation_id), ['op_two']);
});

test('227 payment links: sequential/restarted callers reuse one durable result, isolated by tenant and tier', async t => {
  const f = await fixture(t);
  const first = await f.billing.createPaymentLink('tenant-one', 'light');
  f.advance(60 * 86400000);
  assert.deepEqual(await f.makeBilling().createPaymentLink('tenant-one', 'light'), first);
  assert.equal(f.calls.length, 1);
  assert.equal((await operations(f.db))[0].status, 'completed');
  assert.equal((await creationAudits(f.db)).length, 1);
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h9_billing_links'))).length, 1);
  assert.notEqual((await f.billing.createPaymentLink('tenant-one', 'regular')).id, first.id);
  assert.notEqual((await f.billing.createPaymentLink('tenant-two', 'light')).id, first.id);
  assert.equal(new Set(f.calls.map(call => call.idempotencyKey)).size, 3);
});

test('227 payment links: concurrent instances wait for one Stripe POST and return the same link', async t => {
  const f = await fixture(t), entered = Promise.withResolvers(), release = Promise.withResolvers();
  const create = f.stripe.createPaymentLink;
  f.stripe.createPaymentLink = async input => { const result = await create(input); entered.resolve(); await release.promise; return result; };
  const first = f.billing.createPaymentLink('tenant-one', 'light');
  await entered.promise;
  const second = f.makeBilling().createPaymentLink('tenant-one', 'light');
  release.resolve();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results[0], results[1]); assert.equal(f.calls.length, 1);
  assert.equal((await operations(f.db)).length, 1);
  assert.equal((await creationAudits(f.db)).length, 1);
});

test('227 payment links: ambiguous failure retries the same key and frozen request after restart', async t => {
  const f = await fixture(t), create = f.stripe.createPaymentLink;
  let fail = true;
  f.stripe.createPaymentLink = async input => {
    const result = await create(input);
    if (fail) { fail = false; throw new MetadataError('STRIPE_REQUEST_FAILED', 502); }
    return result;
  };
  await assert.rejects(f.billing.createPaymentLink('tenant-one', 'light'), { code: 'STRIPE_REQUEST_FAILED', status: 502 });
  assert.equal((await operations(f.db))[0].status, 'failed');
  assert.equal((await creationAudits(f.db)).length, 0);
  const retry = f.makeBilling({}, { ...config, priceIds: { ...config.priceIds, light: 'price_changed' } });
  const result = await retry.createPaymentLink('tenant-one', 'light');
  assert.deepEqual(result, { ...f.objects.values().next().value, tier: 'light' });
  assert.deepEqual(f.calls[0], f.calls[1]); assert.equal(f.objects.size, 1);
  assert.equal((await operations(f.db))[0].status, 'completed');
  assert.equal((await creationAudits(f.db)).length, 1);
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h9_billing_links'))).length, 1);
});

test('227 payment links: crash after Stripe success rolls back completion but preserves a resumable reservation', async t => {
  const f = await fixture(t);
  let crash = true;
  const db = { dialect: 'sqlite', close: async () => {}, transaction: work => f.db.transaction(async c => {
    let completed = false;
    const result = await work({ query: async (sql, values) => {
      if (sql.includes("SET status = 'completed'")) completed = true;
      return c.query(sql, values);
    } });
    if (crash && completed) { crash = false; throw new Error('simulated process loss before COMMIT'); }
    return result;
  }) };
  const billing = new HostedBilling(db, config, { stripe: f.stripe, clock: f.now });
  await assert.rejects(billing.createPaymentLink('tenant-one', 'light'), /simulated process loss/);
  assert.equal((await operations(f.db))[0].status, 'pending');
  assert.equal((await creationAudits(f.db)).length, 0);
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h9_billing_links'))).length, 0);
  f.advance(2 * 86400000);
  await f.makeBilling().createPaymentLink('tenant-one', 'light');
  assert.deepEqual(f.calls[0], f.calls[1]); assert.equal(f.objects.size, 1);
  assert.equal((await creationAudits(f.db)).length, 1);
});

test('227 PostgreSQL contract: reservation and execution lock the tenant before operation reads/writes', async t => {
  const f = await fixture(t); let locks = 0, locked = false;
  const db = { dialect: 'postgres', close: async () => {}, transaction: work => f.db.transaction(async c => {
    locked = false;
    try { return await work({ query: async (sql, values) => {
      if (sql === 'SELECT tenant_id FROM h1_tenants WHERE tenant_id = ? FOR UPDATE') {
        locked = true; locks++; return c.query(sql.replace(' FOR UPDATE', ''), values);
      }
      if (sql.includes('h9_billing_operations') || sql.startsWith('SELECT * FROM h9_billing WHERE')) assert.equal(locked, true);
      return c.query(sql, values);
    } }); } finally { locked = false; }
  }) };
  const create = f.stripe.createPaymentLink;
  f.stripe.createPaymentLink = input => { assert.equal(locked, true, 'execution lock covers Stripe'); return create(input); };
  const billing = new HostedBilling(db, config, { stripe: f.stripe, clock: f.now });
  const results = await Promise.all([billing.createPaymentLink('tenant-one', 'light'), billing.createPaymentLink('tenant-one', 'light')]);
  assert.deepEqual(results[0], results[1]); assert.equal(f.calls.length, 1); assert.equal(locks, 4);
  const checkout = new HostedBilling(db, config, { stripe: f.stripe, clock: f.now, origin });
  const sessions = await Promise.all([checkout.createCheckoutSession('tenant-one', 'regular'), checkout.createCheckoutSession('tenant-one', 'heavy')]);
  assert.deepEqual(sessions[0], sessions[1]); assert.equal(f.calls.length, 2); assert.equal(locks, 8);
});

test('227 checkout: concurrent instances return one reserved session even when another tier is requested', async t => {
  const f = await fixture(t), entered = Promise.withResolvers(), release = Promise.withResolvers();
  const create = f.stripe.createCheckoutSession;
  f.stripe.createCheckoutSession = async input => { const result = await create(input); entered.resolve(); await release.promise; return result; };
  const first = f.billing.createCheckoutSession('tenant-one', 'light');
  await entered.promise;
  const second = f.makeBilling().createCheckoutSession('tenant-one', 'heavy');
  release.resolve();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results[0], results[1]); assert.deepEqual(Object.keys(results[0]).sort(), ['id', 'url']);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].tier, 'light');
  assert.equal((await operations(f.db)).length, 1);
  assert.equal((await creationAudits(f.db, 'billing.checkout.created')).length, 1);
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h9_billing_links'))).length, 0);
});

test('227 checkout: reuse ends exactly 24 hours after completion, then a fresh key/session is reserved', async t => {
  const f = await fixture(t);
  assert.equal(CHECKOUT_REUSE_MS, 24 * 60 * 60 * 1000);
  const first = await f.billing.createCheckoutSession('tenant-one', 'light');
  f.advance(CHECKOUT_REUSE_MS - 1);
  assert.deepEqual(await f.makeBilling().createCheckoutSession('tenant-one', 'heavy'), first);
  assert.equal(f.calls.length, 1);
  f.advance(1);
  const next = await f.billing.createCheckoutSession('tenant-one', 'heavy');
  assert.notEqual(next.id, first.id); assert.notEqual(f.calls[0].idempotencyKey, f.calls[1].idempotencyKey);
  assert.equal(f.calls[1].tier, 'heavy'); assert.equal(f.calls.length, 2);
  assert.equal((await operations(f.db)).length, 2);
  assert.equal((await creationAudits(f.db, 'billing.checkout.created')).length, 2);
});

test('227 checkout: tenant isolation and existing validation/subscription errors remain intact', async t => {
  const f = await fixture(t);
  for (const method of ['createPaymentLink', 'createCheckoutSession']) {
    for (const tier of ['free', 'invalid', null, 1]) await assert.rejects(f.billing[method]('tenant-one', tier), { code: 'BILLING_TIER_INVALID', status: 400 });
    await assert.rejects(f.billing[method]('tenant-missing', 'light'), { code: 'TENANT_UNAVAILABLE', status: 403 });
  }
  await assert.rejects(f.makeBilling({ origin: undefined }).createCheckoutSession('tenant-one', 'light'), { code: 'BILLING_CHECKOUT_UNAVAILABLE', status: 503 });
  await assert.rejects(f.makeBilling({ stripe: { createPaymentLink: f.stripe.createPaymentLink } }).createCheckoutSession('tenant-one', 'light'), { code: 'BILLING_CHECKOUT_UNAVAILABLE', status: 503 });
  const first = await f.billing.createCheckoutSession('tenant-one', 'light');
  assert.notEqual((await f.billing.createCheckoutSession('tenant-two', 'light')).id, first.id);
  await f.billing.handleEvent({ id: 'evt_reserved_checkout', created: 1, type: 'checkout.session.completed', object: {
    subscription: 'sub_reserved', customer: 'cus_reserved', metadata: { tenant_id: 'tenant-one', tier: 'light' }, payment_status: 'paid',
  } });
  for (const status of [null, 'active', 'incomplete', 'past_due', 'unpaid', 'trialing']) {
    await f.db.transaction(c => c.query('UPDATE h9_billing SET subscription_status = ? WHERE tenant_id = ?', [status, 'tenant-one']));
    await assert.rejects(f.billing.createCheckoutSession('tenant-one', 'regular'), { code: 'BILLING_SUBSCRIPTION_EXISTS', status: 409 });
  }
  f.advance(CHECKOUT_REUSE_MS);
  await assert.rejects(f.billing.createCheckoutSession('tenant-one', 'regular'), { code: 'BILLING_SUBSCRIPTION_EXISTS', status: 409 });
  for (const status of ['canceled', 'incomplete_expired']) {
    await f.db.transaction(c => c.query('UPDATE h9_billing SET subscription_status = ? WHERE tenant_id = ?', [status, 'tenant-one']));
    await f.billing.createCheckoutSession('tenant-one', 'regular');
    f.advance(CHECKOUT_REUSE_MS);
  }
  for (const state of ['suspended', 'provisioning', 'deleting', 'deleted']) {
    await f.db.transaction(c => c.query('UPDATE h1_tenants SET state = ?, tombstone = ? WHERE tenant_id = ?', [state, state === 'deleted' ? 'erased' : null, 'tenant-one']));
    await assert.rejects(f.billing.createCheckoutSession('tenant-one', 'light'), { code: 'TENANT_UNAVAILABLE', status: 403 });
  }
  await assert.rejects(f.billing.createPaymentLink('tenant-one', 'light'), { code: 'TENANT_UNAVAILABLE', status: 403 });
});

test('227 checkout: timeout reconciliation freezes key, price, origin and tier, then starts the reuse window', async t => {
  const f = await fixture(t), create = f.stripe.createCheckoutSession;
  let fail = true;
  f.stripe.createCheckoutSession = async input => {
    const result = await create(input);
    if (fail) { fail = false; throw new MetadataError('STRIPE_REQUEST_FAILED', 502); }
    return result;
  };
  await assert.rejects(f.billing.createCheckoutSession('tenant-one', 'light'), { code: 'STRIPE_REQUEST_FAILED', status: 502 });
  const reserved = (await operations(f.db))[0]; assert.equal(reserved.status, 'failed');
  assert.equal((await creationAudits(f.db, 'billing.checkout.created')).length, 0);
  f.advance(CHECKOUT_REUSE_MS - 1);
  const retry = f.makeBilling({ origin: 'https://changed.example' }, { ...config, priceIds: { ...config.priceIds, light: 'price_changed' } });
  const reconciled = await retry.createCheckoutSession('tenant-one', 'heavy');
  assert.deepEqual(f.calls[0], f.calls[1]); assert.equal(f.objects.size, 1);
  assert.deepEqual(reconciled, f.objects.get(reserved.idempotency_key));
  f.advance(CHECKOUT_REUSE_MS - 1);
  assert.deepEqual(await retry.createCheckoutSession('tenant-one', 'regular'), reconciled);
  assert.equal(f.calls.length, 2);
  assert.equal((await creationAudits(f.db, 'billing.checkout.created')).length, 1);
  f.advance(1);
  assert.notEqual((await retry.createCheckoutSession('tenant-one', 'regular')).id, reconciled.id);
  assert.notEqual(f.calls[2].idempotencyKey, reserved.idempotency_key);
});

test('227 checkout: stale pending reservation survives process loss before POST and resumes with the original key', async t => {
  const f = await fixture(t); let transactions = 0;
  const db = { dialect: 'sqlite', close: async () => {}, transaction: work => {
    if (++transactions === 2) throw new Error('simulated process loss after reservation');
    return f.db.transaction(work);
  } };
  const billing = new HostedBilling(db, config, { stripe: f.stripe, clock: f.now, origin });
  await assert.rejects(billing.createCheckoutSession('tenant-one', 'light'), /simulated process loss/);
  const reserved = (await operations(f.db))[0]; assert.equal(reserved.status, 'pending'); assert.equal(f.calls.length, 0);
  f.advance(3 * CHECKOUT_REUSE_MS);
  const result = await f.makeBilling().createCheckoutSession('tenant-one', 'light');
  assert.equal(f.calls[0].idempotencyKey, reserved.idempotency_key); assert.equal(f.calls.length, 1);
  assert.equal((await operations(f.db)).length, 1);
  assert.deepEqual(await f.billing.createCheckoutSession('tenant-one', 'heavy'), result);
  assert.equal((await creationAudits(f.db, 'billing.checkout.created')).length, 1);
});

test('227 checkout: webhook binding between reservation and execution prevents the Stripe POST', async t => {
  const f = await fixture(t); let reserve = true;
  const db = { dialect: 'sqlite', close: async () => {}, transaction: async work => {
    const result = await f.db.transaction(work);
    if (reserve) {
      reserve = false;
      await f.billing.handleEvent({ id: 'evt_between_transactions', created: 1, type: 'checkout.session.completed', object: {
        subscription: 'sub_bound', customer: 'cus_bound', metadata: { tenant_id: 'tenant-one', tier: 'light' }, payment_status: 'paid',
      } });
    }
    return result;
  } };
  const billing = new HostedBilling(db, config, { stripe: f.stripe, clock: f.now, origin });
  await assert.rejects(billing.createCheckoutSession('tenant-one', 'light'), { code: 'BILLING_SUBSCRIPTION_EXISTS', status: 409 });
  assert.equal(f.calls.length, 0); assert.equal((await operations(f.db))[0].status, 'pending');
});
