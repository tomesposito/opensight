import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { h8Fixture, referenceEnv } from './h8-helpers.mjs';
import { migrateReference } from '../dist/single-node.js';
import { ReferenceMaintenance } from '../dist/single-node-maintenance.js';
import { MetadataOperator } from '../dist/metadata-operator.js';
import { deletionOptions } from '../dist/tenant-erasure.js';

const execute = { dryRun: false, confirmTenantId: 'tenant-one' };
async function fixture(t) {
  const f = await h8Fixture(t); await migrateReference(f.db, referenceEnv, 'sqlite');
  const dir = await mkdtemp(join(tmpdir(), 'erasure-')), backups = join(dir, 'backups'), key = randomBytes(32);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const maintenance = await ReferenceMaintenance.open(f.db, backups, key, 'frozen');
  const operator = new MetadataOperator(f.db);
  await operator.transition('erase-one', 'tenant-one', 'delete', 1);
  return { ...f, dir, backups, key, maintenance, operator };
}
async function snapshot(db) {
  return db.transaction(async c => {
    const tables = await c.query("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name"), result = {};
    for (const { name } of tables) result[name] = await c.query(`SELECT * FROM ${name} ORDER BY rowid`);
    return result;
  });
}
const count = (report, store, action = 'delete') => report.counts.find(c => c.store === store && c.action === action)?.count;

test('115 dry-run is the default, inventories exact counts, and creates no directory, registry, or SQL writes', async t => {
  const f = await fixture(t), before = await snapshot(f.db);
  const report = await f.maintenance.deleteTenant('erase-one');
  assert.equal(report.status, 'planned'); assert.equal(report.dryRun, true);
  assert.equal(count(report, 'h1_resources'), before.h1_resources.filter(r => r.tenant_id === 'tenant-one').length);
  assert.equal(count(report, 'h1_resources.user'), 2);
  assert.equal(count(report, 'h2_memberships'), 1); assert.equal(count(report, 'h2_identities'), 1);
  assert.equal(count(report, 'h1_namespaces', 'scrub'), 1);
  assert.equal(count(report, 'h8_audit', 'retain'), before.h8_audit.filter(r => r.tenant_id === 'tenant-one').length);
  assert.equal(count(report, 'backups.files'), 0);
  assert.deepEqual(await snapshot(f.db), before);
  assert.deepEqual(await readdir(f.dir), []);
});

test('115 dry-run leaves existing encrypted backups and registry byte-for-byte unchanged', async t => {
  const f = await fixture(t); await f.maintenance.backup();
  const files = await readdir(f.backups), before = await snapshot(f.db);
  const contents = await Promise.all(files.map(async file => ({ bytes: await readFile(join(f.backups, file)), modified: (await stat(join(f.backups, file))).mtimeMs })));
  const report = await f.maintenance.deleteTenant('erase-one', 'unresolved');
  assert.equal(count(report, 'backups.files'), 1); assert.equal(count(report, 'backups.registrations'), 1);
  assert.deepEqual(await snapshot(f.db), before);
  assert.deepEqual(await readdir(f.backups), files);
  assert.deepEqual(await Promise.all(files.map(async file => ({ bytes: await readFile(join(f.backups, file)), modified: (await stat(join(f.backups, file))).mtimeMs }))), contents);
});

test('115 execution requires exact tenant confirmation and external-copy assertion; mode typos fail closed', async t => {
  const f = await fixture(t), before = await snapshot(f.db);
  for (const options of [{ dryRun: false }, { dryRun: false, confirmTenantId: 'tenant-two' }, { dryRun: false, confirmTenantId: true }]) {
    await assert.rejects(f.maintenance.deleteTenant('erase-one', 'none', options), { code: 'TENANT_ERASURE_CONFIRMATION_REQUIRED' });
  }
  await assert.rejects(f.maintenance.deleteTenant('erase-one', undefined, execute), { code: 'BACKUP_COPIES_UNRESOLVED' });
  await assert.rejects(f.maintenance.deleteTenant('erase-one', 'none', { dryRun: 'false' }), { code: 'TENANT_ERASURE_MODE_INVALID' });
  assert.deepEqual(deletionOptions({}), { dryRun: true, confirmTenantId: undefined });
  assert.deepEqual(deletionOptions({ OPENSIGHT_DELETE_MODE: 'execute', OPENSIGHT_DELETE_CONFIRM: 'tenant-one' }), execute);
  assert.throws(() => deletionOptions({ OPENSIGHT_DELETE_MODE: 'Execute' }), { code: 'TENANT_ERASURE_MODE_INVALID' });
  assert.deepEqual(await snapshot(f.db), before); assert.deepEqual(await readdir(f.dir), []);
});
