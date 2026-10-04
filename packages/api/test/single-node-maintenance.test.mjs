import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { h8Fixture } from './h8-helpers.mjs';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { migrateReference } from '../dist/single-node.js';
import { ReferenceMaintenance } from '../dist/single-node-maintenance.js';
import { budgetConfig } from './budget-helpers.mjs';
import { MetadataOperator } from '../dist/metadata-operator.js';
import { hostedReadiness } from '../dist/hosted-health.js';
import { HostedUsage, appendOperatorAudit } from '../dist/hosted-usage.js';
import { TenantMetadata } from '../dist/metadata.js';
import { referenceEnv } from './h8-helpers.mjs';
async function fixture(t) {
  const f = await h8Fixture(t); await migrateReference(f.db, referenceEnv, 'sqlite');
  const dir = await mkdtemp(join(tmpdir(), 'h8-backup-')), backups = join(dir, 'backups'), key = randomBytes(32);
  const maintenance = await ReferenceMaintenance.open(f.db, backups, key, 'frozen');
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { ...f, dir, backups, key, maintenance };
}
test('H8 fresh install, migration, restart and encrypted held restore drill', async t => {
  const f = await fixture(t), start = performance.now();
  await migrateReference(f.db, referenceEnv, 'sqlite'); // maintenance rerun is safe
  await hostedReadiness(f.db, f.db);
  const backup = await f.maintenance.backup(), data = await readFile(join(f.backups, `${backup.id}.backup`), 'utf8');
  assert.equal(data.includes('one@example.test'), false); assert.equal((await stat(join(f.backups, `${backup.id}.backup`))).mode & 0o777, 0o600);
  const target = new SqliteMetadataDatabase(join(f.dir, 'restore.sqlite'));
  await migrateReference(target, referenceEnv, 'sqlite');
  const restore = await ReferenceMaintenance.open(target, f.backups, f.key, 'frozen');
  await restore.restore(backup.id);
  await assert.rejects(restore.restore(backup.id), { code: 'RESTORE_TARGET_NOT_EMPTY' });
  assert.deepEqual((await target.transaction(c => c.query('SELECT state FROM h1_tenants'))).map(r => r.state), ['suspended', 'suspended']);
  assert.ok((await target.transaction(c => c.query('SELECT status FROM h2_memberships'))).every(r => r.status === 'removed'));
  await target.close();
  const restart = new SqliteMetadataDatabase(join(f.dir, 'restore.sqlite')); t.after(() => restart.close());
  await hostedReadiness(restart, restart);
  const reopened = await ReferenceMaintenance.open(restart, f.backups, f.key, 'frozen');
  await assert.rejects(reopened.review('tenant-one', ['foreign']), { code: 'RESTORE_REVIEW_INVALID' });
  await reopened.review('tenant-one', ['admin']);
  const op = new MetadataOperator(restart), tenant = await op.tenant('tenant-one'); await op.transition('resume-reviewed', 'tenant-one', 'resume', tenant.version);
  const usage = new HostedUsage(restart, JSON.parse(referenceEnv.OPENSIGHT_ENTITLEMENTS)), metadata = new TenantMetadata(restart, restart, usage);
  const context = await metadata.authenticate(null, async () => ({ namespaceId: 'one', userId: 'admin' }));
  await assert.rejects(usage.consume(metadata, context, 'apiCalls'), { code: 'USAGE_LIMIT_EXCEEDED' }); // conservative current-day restore fence
  t.diagnostic(`H8 SQLite drill: ${backup.rows} rows, ${backup.bytes} encrypted bytes, ${Math.round(performance.now() - start)} ms`);
});
test('H8 deletion purges managed backups and private tenant state; old files cannot resurrect a tenant', async t => {
  const f = await fixture(t), backup = await f.maintenance.backup();
  const old = await readFile(join(f.backups, `${backup.id}.backup`));
  const op = new MetadataOperator(f.db); await op.transition('delete-one', 'tenant-one', 'delete', 1);
  await assert.rejects(f.maintenance.deleteTenant('delete-one', undefined), { code: 'BACKUP_COPIES_UNRESOLVED' });
  assert.equal((await op.tenant('tenant-one')).state, 'deleting');
  await f.maintenance.deleteTenant('delete-one', 'none'); await f.maintenance.deleteTenant('delete-one', 'none');
  assert.equal((await op.tenant('tenant-one')).state, 'deleted');
  assert.deepEqual(await readdir(f.backups), ['registry']);
  assert.equal((await f.db.transaction(c => c.query("SELECT * FROM h1_resources WHERE tenant_id = 'tenant-one'"))).length, 0);
  assert.equal((await f.db.transaction(c => c.query("SELECT * FROM h2_memberships WHERE tenant_id = 'tenant-one'"))).length, 0);
  assert.equal((await op.tenant('tenant-two')).state, 'active');
  await writeFile(join(f.backups, `${backup.id}.backup`), old);
  await assert.rejects(f.maintenance.restore(backup.id), { code: 'BACKUP_UNREGISTERED' });
  await f.maintenance.deleteTenant('delete-one', 'none');
  const fresh = await f.maintenance.backup(), target = new SqliteMetadataDatabase(join(f.dir, 'after-delete.sqlite')); t.after(() => target.close());
  await migrateReference(target, referenceEnv, 'sqlite');
  await (await ReferenceMaintenance.open(target, f.backups, f.key, 'frozen')).restore(fresh.id);
  assert.equal((await new MetadataOperator(target).tenant('tenant-one')).state, 'deleted');
});
test('H8 backup authentication, maintenance gates and audit/usage retention fail closed', async t => {
  const f = await fixture(t);
  await assert.rejects(ReferenceMaintenance.open(f.db, f.backups, f.key), { code: 'REFERENCE_MAINTENANCE_REQUIRED' });
  await assert.rejects(ReferenceMaintenance.open(f.db, process.cwd(), f.key, 'frozen'), { code: 'BACKUP_DIRECTORY_INVALID' });
  await f.db.transaction(async c => {
    await appendOperatorAudit(c, 'old-event', Date.UTC(2000, 0, 1));
    await c.query("INSERT INTO h1_outbox VALUES ('audit-event','tenant-one','one','tenant.test',1,'2000-01-01T00:00:00.000Z')");
    await c.query("INSERT INTO h1_outbox VALUES ('storage-event','tenant-one','one','usage.storage.bytes:100',1,'2000-01-01T00:00:00.000Z')");
  });
  await f.maintenance.retain(0, 30);
  assert.equal((await f.db.transaction(c => c.query("SELECT * FROM h1_outbox WHERE event_id = 'audit-event'"))).length, 1);
  assert.equal((await f.db.transaction(c => c.query("SELECT * FROM h1_outbox WHERE event_id = 'storage-event'"))).length, 0);
  await f.maintenance.retain(1, 30);
  assert.equal((await f.db.transaction(c => c.query("SELECT * FROM h1_outbox WHERE event_id = 'audit-event'"))).length, 0);
  const backup = await f.maintenance.backup();
  await writeFile(join(f.backups, `${backup.id}.backup`), 'tampered');
  await assert.rejects(f.maintenance.restore(backup.id), { code: 'BACKUP_INVALID' });
  await writeFile(join(f.backups, 'registry'), 'tampered');
  await assert.rejects(f.maintenance.backup(), { code: 'BACKUP_REGISTRY_INVALID' });
});
