import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { h8Fixture, referenceEnv } from './h8-helpers.mjs';
import { coordinationFixture } from './coordination-helpers.mjs';
import { HostedUsage } from '../dist/hosted-usage.js';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { MetadataOperator, checksum } from '../dist/metadata-operator.js';
import { migrateReference } from '../dist/single-node.js';
import { ReferenceMaintenance } from '../dist/single-node-maintenance.js';
import { migrateServerless } from '../dist/serverless-migration.js';
import { snapshotServerless, restoreServerless, migrateRegistered } from '../dist/serverless-backup.js';

const one = { tenantId: 'tenant-one', namespaceId: 'one' };
const two = { tenantId: 'tenant-two', namespaceId: 'two' };
const config = JSON.parse(referenceEnv.OPENSIGHT_ENTITLEMENTS);
config.defaults.egressBytes = 100;
const clock = () => Date.UTC(2026, 9, 3);
const rows = db => db.transaction(c => c.query('SELECT * FROM h8_egress_reservations ORDER BY id'));
async function targetDatabase(t) {
  const directory = await mkdtemp(join(tmpdir(), 'egress-maintenance-'));
  const target = new SqliteMetadataDatabase(join(directory, 'target.sqlite'));
  t.after(async () => { await target.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, target };
}
const registryFor = snapshot => ({ version: 1, revision: 1, epoch: 1, fence: snapshot.fence, completeThroughEpoch: 1,
  backups: { [snapshot.id]: checksum(snapshot) }, deletedTenants: [], retiredKeyVersions: [] });

test('reference backup and retention preserve live egress reservations; erasure removes only its tenant claims', async t => {
  const f = await h8Fixture(t); await migrateReference(f.db, referenceEnv, 'sqlite');
  const usage = new HostedUsage(f.db, config, clock);
  await usage.reserveEgress(one); await usage.reserveEgress(two);
  const before = await rows(f.db), { directory, target } = await targetDatabase(t), key = randomBytes(32);
  const maintenance = await ReferenceMaintenance.open(f.db, join(directory, 'backups'), key, 'frozen');
  const backup = await maintenance.backup();
  await migrateReference(target, referenceEnv, 'sqlite');
  await (await ReferenceMaintenance.open(target, join(directory, 'backups'), key, 'frozen')).restore(backup.id);
  assert.deepEqual(await rows(target), before);
  // Restore suspends tenants for review; even once reviewed, the claim must
  // still prevent spending against usage whose settlement failed previously.
  await target.transaction(c => c.query("UPDATE h1_tenants SET state = 'active' WHERE tenant_id = ?", [one.tenantId]));
  await assert.rejects(new HostedUsage(target, config, clock).checkEgress(one), { code: 'USAGE_LIMIT_EXCEEDED', status: 429 });
  await maintenance.retain(0, 30, Date.UTC(2027, 0, 1));
  assert.deepEqual(await rows(f.db), before);
  await new MetadataOperator(f.db).transition('egress-delete', one.tenantId, 'delete', 1);
  await maintenance.deleteTenant('egress-delete', 'none', { dryRun: false, confirmTenantId: one.tenantId });
  assert.deepEqual(await rows(f.db), before.filter(row => row.tenant_id === two.tenantId));
});

test('serverless backup, registered migration and restore preserve live egress claims', async t => {
  const f = await coordinationFixture(t, { migrate: false });
  const env = { ...f.env, OPENSIGHT_ENTITLEMENTS: JSON.stringify(f.entitlements) };
  await migrateServerless(f.db, env, 'sqlite');
  const usage = new HostedUsage(f.db, config, clock);
  await usage.reserveEgress(one);
  const before = await rows(f.db);
  const snapshot = await snapshotServerless(f.db, 'test', randomUUID(), Date.now() + 3600000, ['a'.repeat(32)], 'sqlite');
  assert.deepEqual(snapshot.tables.h8_egress_reservations, before);
  const registry = registryFor(snapshot);
  await migrateRegistered(f.db, env, snapshot, registry, randomUUID(), 'sqlite');
  assert.deepEqual(await rows(f.db), before);
  const { target } = await targetDatabase(t);
  await migrateServerless(target, env, 'sqlite');
  await restoreServerless(target, snapshot, { ...registry, epoch: 2 }, 'sqlite');
  assert.deepEqual(await rows(target), before);
  await target.transaction(c => c.query("UPDATE h1_tenants SET state = 'active' WHERE tenant_id = ?", [one.tenantId]));
  await assert.rejects(new HostedUsage(target, config, clock).reserveEgress(one), { code: 'USAGE_LIMIT_EXCEEDED', status: 429 });
});

test('pre-reservation reference and serverless backups restore and migrate with an empty reservation store', async t => {
  const f = await h8Fixture(t); await migrateReference(f.db, referenceEnv, 'sqlite');
  await f.db.transaction(c => c.query('DROP TABLE h8_egress_reservations'));
  const { directory, target } = await targetDatabase(t), key = randomBytes(32);
  const maintenance = await ReferenceMaintenance.open(f.db, join(directory, 'backups'), key, 'frozen');
  const backup = await maintenance.backup();
  await migrateReference(target, referenceEnv, 'sqlite');
  await (await ReferenceMaintenance.open(target, join(directory, 'backups'), key, 'frozen')).restore(backup.id);
  assert.deepEqual(await rows(target), []);

  const cloud = await coordinationFixture(t, { migrate: false });
  const env = { ...cloud.env, OPENSIGHT_ENTITLEMENTS: JSON.stringify(cloud.entitlements) };
  await migrateServerless(cloud.db, env, 'sqlite');
  await cloud.db.transaction(c => c.query('DROP TABLE h8_egress_reservations'));
  const snapshot = await snapshotServerless(cloud.db, 'test', randomUUID(), Date.now() + 3600000, ['a'.repeat(32)], 'sqlite');
  assert.equal(Object.hasOwn(snapshot.tables, 'h8_egress_reservations'), false);
  const registry = registryFor(snapshot), operation = randomUUID();
  assert.equal((await migrateRegistered(cloud.db, env, snapshot, registry, operation, 'sqlite')).replayed, false);
  assert.equal((await migrateRegistered(cloud.db, env, snapshot, registry, operation, 'sqlite')).replayed, true);
  assert.deepEqual(await rows(cloud.db), []);
  const restored = await targetDatabase(t);
  await migrateServerless(restored.target, env, 'sqlite');
  await restoreServerless(restored.target, snapshot, { ...registry, epoch: 2 }, 'sqlite');
  assert.deepEqual(await rows(restored.target), []);
});
