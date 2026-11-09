import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { h8Fixture, referenceEnv } from './h8-helpers.mjs';
import { database } from './hosted-helpers.mjs';
import { initializeBilling } from '../dist/hosted-billing.js';
import { migrateReference } from '../dist/single-node.js';
import { ReferenceMaintenance } from '../dist/single-node-maintenance.js';
import { assertReferenceErasureStores, purgeTenantRows, tenantDeletionInventory } from '../dist/tenant-erasure.js';

const operations = db => db.transaction(c => c.query('SELECT * FROM h9_billing_operations ORDER BY created_at, operation_id'));
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
