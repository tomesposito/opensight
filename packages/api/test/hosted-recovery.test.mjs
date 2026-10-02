import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { migrateReference, assertReferenceSchema } from '../dist/reference-schema.js';
import { assertEncryptionKey } from '../dist/hosted-key-rotation.js';
import { captureBackup, restoreBackup, writeBackup, readBackup, reconcileRestore } from '../dist/hosted-recovery.js';
import { MetadataOperator } from '../dist/metadata-operator.js';
import { sourceFixture, registration } from './source-helpers.mjs';
import { budgetConfig } from './budget-helpers.mjs';

async function fixture(t) {
  const f = await sourceFixture(t); await migrateReference(f.db, 'sqlite', budgetConfig); await assertEncryptionKey(f.db, f.key);
  await f.db.transaction(async c => {
    for (const ns of ['one', 'two']) {
      await c.query("INSERT INTO h2_identities (subject,email,status) VALUES (?,?,'active')", [ns, `${ns}@example.test`]);
      await c.query("INSERT INTO h2_memberships VALUES (?,?,?,'admin','active',1)", [ns, `tenant-${ns}`, ns]);
    }
  });
  await f.sources.create(await f.login(), 'source', registration());
  return f;
}
test('H8 tenant restore retains newer member revocations, suspends access, and requires explicit reconciliation before resume', async t => {
  const f = await fixture(t), snapshot = await captureBackup(f.db, f.key, 'frozen');
  await f.db.transaction(async c => {
    await c.query("UPDATE h2_memberships SET status = 'removed', version = 3 WHERE tenant_id = 'tenant-one'");
    await c.query('UPDATE h1_revisions SET "authorization" = 20 WHERE tenant_id = ?', ['tenant-one']);
  });
  await restoreBackup(f.db, snapshot, f.key, 'frozen', 'tenant-one');
  assert.equal((await f.db.transaction(c => c.query("SELECT status FROM h2_memberships WHERE tenant_id = 'tenant-one'")))[0].status, 'removed');
  const operator = new MetadataOperator(f.db), tenant = await operator.tenant('tenant-one');
  assert.equal(tenant.state, 'suspended'); assert.equal((await operator.tenant('tenant-two')).state, 'active');
  await assert.rejects(f.login(), { code: 'UNKNOWN_PRINCIPAL' });
  await assert.rejects(operator.transition('resume-before-review', 'tenant-one', 'resume', tenant.version), { code: 'RESTORE_RECONCILIATION_REQUIRED' });
  assert.ok(Number((await f.db.transaction(c => c.query('SELECT "authorization" FROM h1_revisions WHERE tenant_id = ?', ['tenant-one'])))[0].authorization) > 20);
  await reconcileRestore(f.db, 'tenant-one', tenant.version, ['admin'], 'frozen');
  await operator.transition('resume-after-review', 'tenant-one', 'resume', tenant.version);
  assert.equal((await operator.tenant('tenant-one')).state, 'active');
});
test('H8 restoring an older tenant snapshot cannot erase a newer deletion tombstone or reintroduce payloads', async t => {
  const f = await fixture(t), snapshot = await captureBackup(f.db, f.key, 'frozen'), operator = new MetadataOperator(f.db);
  const tenant = await operator.tenant('tenant-one');
  await operator.transition('delete', 'tenant-one', 'delete', tenant.version);
  await operator.checkpoint('delete', 'revoked', 'artifacts-removed'); await operator.finishDeletion('delete');
  const tombstone = await operator.tenant('tenant-one');
  await restoreBackup(f.db, snapshot, f.key, 'frozen', 'tenant-one');
  assert.deepEqual(await operator.tenant('tenant-one'), tombstone);
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h1_resources WHERE tenant_id = ?', ['tenant-one']))).length, 0);
});
test('H8 total-loss backup includes encrypted uploads/secrets and key versions; restore disables sessions and all tenant admission', async t => {
  const f = await fixture(t), snapshot = await captureBackup(f.db, f.key, 'frozen'), backupKey = randomBytes(32).toString('base64');
  const dir = await mkdtemp(join(tmpdir(), 'h8-backup-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'backup.sealed'); await writeBackup(path, snapshot, backupKey);
  assert.equal((await stat(path)).mode & 0o777, 0o600); assert.equal((await readFile(path, 'utf8')).includes('tenant-one'), false);
  assert.deepEqual(await readBackup(path, backupKey), snapshot);
  await assert.rejects(readBackup(path, randomBytes(32).toString('base64')), { code: 'BACKUP_INVALID' });
  const target = new SqliteMetadataDatabase(join(dir, 'restored.sqlite')); t.after(() => target.close());
  await migrateReference(target, 'sqlite', budgetConfig);
  await restoreBackup(target, snapshot, f.key, 'frozen');
  const tenants = await target.transaction(c => c.query('SELECT state FROM h1_tenants')); assert.ok(tenants.every(t => t.state === 'suspended'));
  assert.equal((await target.transaction(c => c.query('SELECT * FROM h8_restore_holds'))).length, 2);
  assert.equal((await target.transaction(c => c.query("SELECT * FROM h1_resources WHERE kind = 'secret'"))).length, 1);
  await assert.rejects(restoreBackup(target, snapshot, f.key, 'frozen'), { code: 'RESTORE_EMPTY_TARGET_REQUIRED' });
});
test('H8 interrupted staged migrations and corrupt restore roll back completely; incompatible writers are refused', async t => {
  const f = await fixture(t);
  const before = await f.db.transaction(c => c.query('SELECT * FROM h4_budget_config'));
  await assert.rejects(migrateReference(f.db, 'sqlite', budgetConfig, async () => { throw new Error('interrupted'); }), /interrupted/);
  assert.deepEqual(await f.db.transaction(c => c.query('SELECT * FROM h4_budget_config')), before); await assertReferenceSchema(f.db);
  const snapshot = await captureBackup(f.db, f.key, 'frozen'), corrupt = structuredClone(snapshot);
  corrupt.tables.h1_resources.find(r => r.kind === 'source').kind = 'invalid-kind';
  await assert.rejects(restoreBackup(f.db, corrupt, f.key, 'frozen', 'tenant-one'));
  assert.equal((await new MetadataOperator(f.db).tenant('tenant-one')).state, 'active');
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h8_restore_holds'))).length, 0);
  await f.db.transaction(c => c.query('UPDATE h8_schema SET version = 99'));
  await assert.rejects(assertReferenceSchema(f.db), { code: 'REFERENCE_SCHEMA_INCOMPATIBLE' });
  await assert.rejects(migrateReference(f.db, 'sqlite', budgetConfig), { code: 'REFERENCE_SCHEMA_INCOMPATIBLE' });
});
