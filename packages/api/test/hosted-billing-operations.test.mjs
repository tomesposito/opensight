import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { h8Fixture, referenceEnv } from './h8-helpers.mjs';
import { database } from './hosted-helpers.mjs';
import { HostedBilling, initializeBilling } from '../dist/hosted-billing.js';
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
});
