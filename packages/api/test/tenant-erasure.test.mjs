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

// Include stale/legacy asset bodies: erasure must not require authoring validation.
async function insertResource(c, scope, key, body) {
  await c.query('INSERT INTO h1_resources VALUES (?,?,?,?,?,?,1)', [scope.tenantId, scope.namespaceId, key.kind, key.ownerId ?? '', key.id, JSON.stringify(body)]);
}
import { HostedCache } from '../dist/hosted-cache.js';
import { TenantBudgets } from '../dist/budgets.js';
import { budgetConfig } from './budget-helpers.mjs';

test('115 purges every asset kind, uploads, embedding state, AI warnings, and tenant labels while retaining audit and other tenants', async t => {
  const f = await fixture(t);
  await f.db.transaction(async c => {
    for (const ns of ['one', 'two']) {
      const scope = { tenantId: `tenant-${ns}`, namespaceId: ns };
      for (const kind of ['dataset', 'prepared-dataset', 'analysis', 'dashboard', 'source', 'secret']) {
        await insertResource(c, scope, { kind, id: kind, ...(['source', 'secret', 'prepared-dataset'].includes(kind) ? { ownerId: 'admin' } : {}) },
          kind === 'source' ? { binding: { version: 3, connectorId: 'file' } } : { synthetic: `private-${ns}` });
      }
      await c.query('INSERT INTO h5_embedding_config VALUES (?,?,1,?)', [scope.tenantId, ns, '{}']);
      await c.query('INSERT INTO h8_ai_warnings VALUES (?,?,?,?,?,NULL)', [scope.tenantId, ns, '2026-10-28', '{}', '2026-10-28T00:00:00.000Z']);
      await c.query('INSERT INTO h2_login_selections VALUES (?,?,1000000,0)', [`selection-${ns}`, ns]);
      await c.query('UPDATE h1_tenants SET display_name = ?, slug = ?, placement = ?, limit_policy = ? WHERE tenant_id = ?', [ns, ns, '{}', '{}', scope.tenantId]);
    }
    await c.query("INSERT INTO h6_keys VALUES ('embedding-key','synthetic',1)");
    await c.query("INSERT INTO h6_sessions (session_id,tenant_id,namespace_id,issuer_id,key_id,grant_body,bootstrap_hash,bootstrap_expires_at) VALUES ('embedding','tenant-one','one','admin','embedding-key','{}','synthetic',1000000)");
    await c.query("INSERT INTO h2_identities (subject,email,status) VALUES ('unrelated','unrelated@example.test','active')");
  });
  const before = await snapshot(f.db), plan = await f.maintenance.deleteTenant('erase-one');
  for (const kind of ['dataset', 'prepared-dataset', 'analysis', 'dashboard', 'source', 'secret']) assert.equal(count(plan, `h1_resources.${kind}`), 1);
  assert.equal(count(plan, 'h8_ai_warnings'), 1); assert.equal(count(plan, 'h6_sessions'), 1); assert.equal(count(plan, 'h2_login_selections'), 1);
  const result = await f.maintenance.deleteTenant('erase-one', 'none', execute);
  assert.equal(result.status, 'deleted');
  const after = await snapshot(f.db);
  for (const entry of plan.counts.filter(c => c.action === 'delete' && !c.store.includes('.'))) {
    if (entry.store === 'h2_identities' || entry.store === 'h2_login_selections') assert.ok(after[entry.store].every(r => r.subject !== 'one'));
    else assert.equal(after[entry.store].filter(r => r.tenant_id === 'tenant-one').length, 0, entry.store);
  }
  for (const [table, rows] of Object.entries(before)) {
    assert.deepEqual(after[table].filter(r => r.tenant_id === 'tenant-two'), rows.filter(r => r.tenant_id === 'tenant-two'), table);
  }
  for (const row of before.h8_audit) assert.ok(after.h8_audit.some(actual => JSON.stringify(actual) === JSON.stringify(row)));
  assert.equal(after.h8_audit.filter(r => r.action === 'tenant.deletion-completed').length, 1);
  assert.ok(after.h2_identities.some(r => r.subject === 'unrelated'));
  const tenant = after.h1_tenants.find(r => r.tenant_id === 'tenant-one');
  for (const key of ['display_name', 'slug', 'placement', 'limit_policy']) assert.equal(tenant[key], null);
});

test('115 retains identities and login selections shared with another tenant', async t => {
  const f = await fixture(t);
  await f.db.transaction(async c => {
    await c.query("INSERT INTO h2_memberships (subject,tenant_id,namespace_id,user_id,status) VALUES ('one','tenant-two','two','other','active')");
    await c.query("INSERT INTO h2_login_selections VALUES ('shared','one',1000000,0)");
  });
  const plan = await f.maintenance.deleteTenant('erase-one');
  assert.equal(count(plan, 'h2_identities'), 0); assert.equal(count(plan, 'h2_login_selections'), 0);
  await f.maintenance.deleteTenant('erase-one', 'none', execute);
  const after = await snapshot(f.db);
  assert.ok(after.h2_identities.some(r => r.subject === 'one')); assert.equal(after.h2_login_selections.length, 1);
});

test('115 refuses unsupported tenant stores and external upload references before any writes', async t => {
  const f = await fixture(t);
  await f.db.transaction(c => c.query('CREATE TABLE unexpected_store (tenant_id TEXT, payload TEXT)'));
  let before = await snapshot(f.db);
  await assert.rejects(f.maintenance.deleteTenant('erase-one', 'none', execute), error => {
    assert.equal(error.code, 'TENANT_ERASURE_STORE_UNSUPPORTED'); assert.deepEqual(error.detail.stores, ['unexpected_store']); return true;
  });
  assert.deepEqual(await snapshot(f.db), before); assert.deepEqual(await readdir(f.dir), []);
  await f.db.transaction(async c => {
    await c.query('DROP TABLE unexpected_store');
    await insertResource(c, { tenantId: 'tenant-one', namespaceId: 'one' }, { kind: 'source', id: 'external', ownerId: 'admin' }, { binding: { version: 4, objectId: 'external' } });
  });
  before = await snapshot(f.db);
  await assert.rejects(f.maintenance.deleteTenant('erase-one', 'none', execute), { code: 'TENANT_ERASURE_STORE_UNSUPPORTED' });
  assert.deepEqual(await snapshot(f.db), before);
});

test('115 erases attached in-memory cache entries by exact tenant ownership', async t => {
  const f = await fixture(t), cache = new HostedCache(new TenantBudgets(budgetConfig, async () => {}));
  for (const tenantId of ['tenant-one', 'tenant-two']) {
    const scope = { tenantId, limits: budgetConfig.defaults, check() {}, onFailure() {} };
    await cache.refresh(scope, `${tenantId}:dataset`, 'stamp', async () => ({ bytes: 1024 }));
  }
  const maintenance = await ReferenceMaintenance.open(f.db, f.backups, f.key, 'frozen', [cache]);
  const plan = await maintenance.deleteTenant('erase-one');
  assert.equal(count(plan, 'blaze.memory'), 1); assert.equal(cache.countTenant('tenant-one'), 1);
  await maintenance.deleteTenant('erase-one', 'none', execute);
  assert.equal(cache.countTenant('tenant-one'), 0); assert.equal(cache.countTenant('tenant-two'), 1);
});
