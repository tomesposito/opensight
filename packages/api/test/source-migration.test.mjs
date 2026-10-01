import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { sourceFixture, registration, columns, policy, credentials, upload } from './source-helpers.mjs';
import { SourceMigration } from '../dist/source-migration.js';
import { assertHostedSourcesReady, expireUploads } from '../dist/source-maintenance.js';
const binding = { version: 3, connectorId: 'postgresql', state: 'active', columns, endpointId: 'reference', schema: 'public', table: 'synthetic' };
async function migrationFixture(t) {
  const f = await sourceFixture(t), a = await f.login();
  await f.metadata.put(a, { kind: 'source', id: 'legacy', ownerId: 'admin' }, { binding: { connectionEnv: 'OLD_SOURCE', security: 'unrestricted' } });
  const config = { migrationId: 'cutover', maintenance: true, backupDirectory: join(dirname(f.path), 'backup'), sources: [{ tenantId: 'tenant-one', namespaceId: 'one', ownerId: 'admin', id: 'legacy', binding, policy, credentialsEnv: 'SOURCE_CREDENTIALS' }] };
  const secret = credentials(), env = { SOURCE_CREDENTIALS: JSON.stringify(secret) };
  const migrate = () => new SourceMigration(f.db, f.key, f.endpoints);
  const freeze = () => f.db.transaction(c => c.query("UPDATE h1_tenants SET state = 'suspended' WHERE tenant_id = 'tenant-one'"));
  const resume = () => f.db.transaction(c => c.query("UPDATE h1_tenants SET state = 'active' WHERE tenant_id = 'tenant-one'"));
  return Object.assign(f, { config, secret, env, migrate, freeze, resume });
}
test('H3 migration freezes writes, inventories every source, encrypts credentials and requires sealed cutover', async t => {
  const f = await migrationFixture(t);
  await assert.rejects(assertHostedSourcesReady(f.db), { code: 'SOURCE_MIGRATION_REQUIRED' });
  await assert.rejects(f.migrate().migrate(f.config, f.env), { code: 'MIGRATION_MAINTENANCE_REQUIRED' });
  const beforeFreeze = await f.login();
  await f.freeze();
  await assert.rejects(f.sources.create(beforeFreeze, 'x', registration()), { code: 'TENANT_UNAVAILABLE' });
  const result = await f.migrate().migrate(f.config, f.env);
  assert.deepEqual(result.counts, { sources: 1, secrets: 1 });
  assert.deepEqual(await f.migrate().migrate(f.config, {}), result);
  await assert.rejects(assertHostedSourcesReady(f.db), { code: 'SOURCE_MIGRATION_UNSEALED' });
  assert.equal((await readFile(join(f.config.backupDirectory, 'h3-v1-cutover.json'), 'utf8')).includes(f.secret.password), false);
  await f.migrate().seal(f.config); await assertHostedSourcesReady(f.db);
  await assert.rejects(f.migrate().rollback(f.config), { code: 'MIGRATION_ROLLBACK_BOUNDARY' });
  await f.resume(); const a = await f.login();
  assert.deepEqual(await f.sources.payload(a, await f.sources.get(a, 'legacy')), f.secret);
});
test('H3 interrupted migration rolls back atomically and resumes from an encrypted versioned backup', async t => {
  const f = await migrationFixture(t); await f.freeze();
  await assert.rejects(f.migrate().migrate(f.config, f.env, async stage => { if (stage === 'row-written') throw new Error('injected crash'); }), /injected crash/);
  assert.equal((await f.db.transaction(c => c.query("SELECT body FROM h1_resources WHERE kind = 'source'")))[0].body.includes('OLD_SOURCE'), true);
  assert.equal((await f.db.transaction(c => c.query("SELECT * FROM h1_resources WHERE kind = 'secret'"))).length, 0);
  await f.restart();
  await f.migrate().migrate(f.config, {}); // Original plaintext environment can already be removed.
  await f.migrate().rollback(f.config);
  assert.equal((await f.db.transaction(c => c.query("SELECT body FROM h1_resources WHERE kind = 'source'")))[0].body.includes('OLD_SOURCE'), true);
  assert.equal((await f.db.transaction(c => c.query("SELECT * FROM h1_resources WHERE kind = 'secret'"))).length, 0);
  await assert.rejects(f.migrate().migrate(f.config, f.env), { code: 'MIGRATION_ID_REUSED' });
});
test('H3 migration refuses incomplete mappings, foreign principals, missing secrets and stale source rows', async t => {
  for (const kind of ['missing-source', 'principal', 'secret', 'changed']) {
    const f = await migrationFixture(t);
    if (kind === 'missing-source') await f.metadata.put(await f.login(), { kind: 'source', id: 'unmapped', ownerId: 'admin' }, { binding: {} });
    await f.freeze();
    if (kind === 'principal') f.config.sources[0].policy = { rowLevel: true, rowRules: [{ id: 'foreign', principals: [{ type: 'user', id: 'foreign' }], predicate: { column: 'region', operator: 'eq', value: 'east' } }] };
    if (kind === 'changed') {
      await assert.rejects(f.migrate().migrate(f.config, f.env, async stage => { if (stage === 'inventoried') throw new Error('pause'); }), /pause/);
      await f.db.transaction(c => c.query("UPDATE h1_resources SET version = version + 1 WHERE kind = 'source'"));
    }
    await assert.rejects(f.migrate().migrate(f.config, kind === 'secret' ? {} : f.env), { code: { 'missing-source': 'MIGRATION_UNRESOLVED_SOURCE', principal: 'MIGRATION_UNRESOLVED_REFERENCE', secret: 'MIGRATION_SECRET_REQUIRED', changed: 'MIGRATION_INPUT_CHANGED' }[kind] });
    assert.equal((await f.db.transaction(c => c.query("SELECT * FROM h1_resources WHERE kind = 'secret'"))).length, 0);
  }
});
test('H3 expiry maintenance deletes payloads durably even for suspended tenants', async t => {
  const f = await sourceFixture(t), a = await f.login(), u = await f.sources.upload(a, upload(undefined, new Date(Date.now() + 10000).toISOString()));
  await f.db.transaction(c => c.query("UPDATE h1_tenants SET state = 'suspended' WHERE tenant_id = 'tenant-one'"));
  await expireUploads(f.db, Date.now() + 20000);
  assert.equal((await f.db.transaction(c => c.query("SELECT * FROM h1_resources WHERE kind = 'secret'"))).length, 0);
  await f.db.transaction(c => c.query("UPDATE h1_tenants SET state = 'active' WHERE tenant_id = 'tenant-one'"));
  await f.restart(); await assertHostedSourcesReady(f.db);
  await assert.rejects(f.sources.get(await f.login(), u.id), { code: 'UPLOAD_EXPIRED' });
});
test('H3 upload migration preserves explicit expiry and encrypts the payload; changed backups cannot be sealed', async t => {
  const f = await migrationFixture(t), intake = upload(), source = f.config.sources[0];
  source.binding = { version: 3, connectorId: 'file', state: 'active', columns, rowCount: 3, expiresAt: intake.expiresAt };
  delete source.credentialsEnv; source.uploadEnv = 'UPLOAD_BYTES'; source.uploadConfig = intake.config;
  await f.freeze();
  await assert.rejects(f.migrate().migrate(f.config, { UPLOAD_BYTES: 'invalid' }), { code: 'MIGRATION_UPLOAD_REQUIRED' });
  source.binding.rowCount = 4;
  await assert.rejects(f.migrate().migrate(f.config, { UPLOAD_BYTES: intake.base64 }), { code: 'MIGRATION_UPLOAD_MISMATCH' });
  source.binding.rowCount = 3;
  await f.migrate().migrate(f.config, { UPLOAD_BYTES: intake.base64 });
  const path = join(f.config.backupDirectory, 'h3-v1-cutover.json'), original = await readFile(path, 'utf8');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(original.includes(intake.base64), false); assert.equal(original.includes('east,10,a'), false);
  const modified = JSON.parse(original); modified.after[1].body.binding.rowCount = 999;
  await writeFile(path, JSON.stringify(modified));
  await assert.rejects(f.migrate().seal(f.config), { code: 'MIGRATION_BACKUP_MISMATCH' });
  await writeFile(path, original); await f.migrate().seal(f.config); await f.resume(); await f.restart();
  const context = await f.login(), stored = await f.sources.get(context, 'legacy');
  assert.equal(stored.binding.expiresAt, intake.expiresAt);
  assert.deepEqual((await f.sources.payload(context, stored)).rows, [['east', 10, 'a'], ['west', 20, 'b'], ['east', 30, 'c']]);
});
test('H3 migration rollback restores replaced encrypted secrets without leaving a second writer or payload', async t => {
  const f = await sourceFixture(t), context = await f.login(), initial = registration();
  await f.sources.create(context, 'source', initial);
  const before = await f.sources.get(context, 'source');
  await f.db.transaction(c => c.query("UPDATE h1_tenants SET state = 'suspended' WHERE tenant_id = 'tenant-one'"));
  const config = { migrationId: 'replace', maintenance: true, backupDirectory: join(dirname(f.path), 'backup'), sources: [{ tenantId: 'tenant-one', namespaceId: 'one', ownerId: 'admin', id: 'source', binding, policy, credentialsEnv: 'REPLACEMENT' }] };
  const migration = new SourceMigration(f.db, f.key, f.endpoints);
  await migration.migrate(config, { REPLACEMENT: JSON.stringify(credentials()) });
  assert.equal((await f.db.transaction(c => c.query("SELECT * FROM h1_resources WHERE kind = 'secret'"))).length, 1);
  await migration.rollback(config);
  await f.db.transaction(c => c.query("UPDATE h1_tenants SET state = 'active' WHERE tenant_id = 'tenant-one'"));
  await f.restart(); const current = await f.login(), restored = await f.sources.get(current, 'source');
  assert.equal(restored.secretId, before.secretId);
  assert.deepEqual(await f.sources.payload(current, restored), initial.credentials);
  assert.equal((await f.metadata.list(current, 'secret')).length, 1);
});
