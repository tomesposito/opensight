import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MetadataMigration } from '../dist/metadata-migration.js';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { initializeMetadata } from '../dist/metadata-schema.js';
import { TenantMetadata } from '../dist/metadata.js';
import { AutomationStore } from '../dist/automation-store.js';
import { DefinitionStore } from '../dist/store.js';
import { emptyAutomationState } from '../dist/automation-state.js';
import { decryptMetadataSecret } from '../dist/metadata-secrets.js';
import { legacyWrite, freezeLegacy } from '../dist/metadata-maintenance.js';

const save = (path, value) => writeFile(path, JSON.stringify(value));
const login = (repo, namespaceId = 'default', userId = 'admin') => repo.authenticate(null, async () => ({ namespaceId, userId }));
const prepared = (input = 'input') => ({ resourceType: 'dataset', dataSetId: 'prepared', name: 'Prepared', physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: { version: 1, input, steps: [] } });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'opensight-h1-migration-'));
  const dataRoot = join(dir, 'definitions'); await mkdir(dataRoot);
  const config = {
    migrationId: 'migration', maintenance: true, backupDirectory: join(dir, 'backup'),
    securityPath: join(dir, 'security.json'), prepPath: join(dir, 'prep.json'), aiPath: join(dir, 'ai.json'), automationPath: join(dir, 'automation.json'),
    namespaces: ['default', 'second'].map(namespaceId => ({ namespaceId, tenantId: randomUUID(), purpose: 'self-hosted', ...(namespaceId === 'default' ? { dataRoot } : {}) })),
    securityColumns: [],
    datasets: ['default', 'second'].map(namespaceId => ({ namespaceId, id: 'sales', arn: 'portable-dataset', definition: { name: namespaceId }, sources: [] })),
    sources: ['default', 'second'].map(namespaceId => ({ namespaceId, id: 'input', ownerId: 'admin', binding: { connectionEnv: 'TEST_SOURCE', security: 'unrestricted' } }))
  };
  const security = {
    version: 1, namespaces: ['default', 'second'].map(id => ({ id, name: id })),
    users: ['default', 'second'].map(namespaceId => ({ namespaceId, id: 'admin', name: namespaceId, role: 'administrator' })),
    groups: ['default', 'second'].map(namespaceId => ({ namespaceId, id: 'same', name: namespaceId, userIds: ['admin'] })),
    datasets: ['default', 'second'].map(namespaceId => ({ namespaceId, datasetId: 'sales', dataSetArn: 'portable-dataset', rowLevel: true, rowRules: [] })),
    folders: [{ namespaceId: 'default', id: 'folder', name: 'Folder', grants: [{ principal: { type: 'group', id: 'same' }, role: 'viewer' }] }],
    assets: [{ namespaceId: 'default', id: 'dashboard', kind: 'dashboard', folderId: 'folder', grants: [] }],
    invitations: [{ namespaceId: 'default', id: 'invited', name: 'Invited', role: 'reader', invitedBy: 'admin', expiresAt: '2030-01-01T00:00:00Z', tokenHash: 'a'.repeat(64) }]
  };
  const definition = { DashboardId: 'dashboard', Name: 'Preserved', Definition: { DataSetIdentifierDeclarations: [{ Identifier: 'sales', DataSetArn: 'portable-dataset' }], Sheets: [] } };
  const encryptionKey = randomBytes(32).toString('base64'), plaintext = 'synthetic-test-key';
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'base64'), Buffer.alloc(12, 7));
  cipher.setAAD(Buffer.from(JSON.stringify(['default', 'openai', ''])));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const ai = { version: 1, configs: [{ namespaceId: 'default', provider: 'openai', model: 'synthetic-model', encryptedKey: [Buffer.alloc(12, 7), cipher.getAuthTag(), encrypted].map(v => v.toString('base64')).join('.') }] };
  const automation = emptyAutomationState();
  automation.subscriptions.push({ id: 'report', userId: 'admin', dashboardId: 'dashboard', recipients: ['synthetic@example.invalid'], enabled: false, schedule: { kind: 'interval', minutes: 60, timeZone: 'UTC' }, nextRun: null });
  await save(config.securityPath, security); await save(join(dataRoot, 'dashboard.json'), definition);
  await save(config.prepPath, { version: 1, datasets: ['default', 'second'].map(namespaceId => ({ namespaceId, userId: 'admin', resource: prepared() })) });
  await save(config.aiPath, ai); await save(config.automationPath, automation);
  const dbPath = join(dir, 'metadata.db'), db = new SqliteMetadataDatabase(dbPath); await initializeMetadata(db);
  t.after(async () => { await db.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, config, db, dbPath, security, definition, ai, encryptionKey, plaintext, migration: new MetadataMigration(db) };
}

test('H1 migrates all legacy records with scoped references, encrypted keys, held activation and rollback boundary', async t => {
  const f = await fixture(t), { db, migration, config, encryptionKey } = f;
  const legacy = await AutomationStore.load({}, config.securityPath, v => v);
  const report = await migration.migrate(config, encryptionKey);
  assert.equal(report.state, 'committed');
  assert.deepEqual(report.counts, { namespaces: 2, user: 2, group: 2, folder: 1, invitation: 1, policy: 2, source: 2, dataset: 2, dashboard: 1, 'prepared-dataset': 2, secret: 1, 'ai-config': 1, job: 1 });
  assert.equal(JSON.stringify(report).includes('synthetic'), false);
  assert.deepEqual(await migration.migrate(config, encryptionKey), report);
  const repo = new TenantMetadata(db, db);
  await assert.rejects(login(repo), { code: 'UNKNOWN_PRINCIPAL' });
  await assert.rejects(legacy.change(d => { d.users = []; }), { code: 'LEGACY_STORE_FROZEN' });
  assert.equal(legacy.read().users.length, 2);
  await assert.rejects(AutomationStore.load({}, config.securityPath, v => v), { code: 'LEGACY_STORE_FROZEN' });
  await assert.rejects(DefinitionStore.load(config.namespaces[0].dataRoot), { code: 'LEGACY_STORE_FROZEN' });
  const backupPath = join(config.backupDirectory, 'h1-v1-migration.json'), backup = await readFile(backupPath, 'utf8');
  assert.equal(backup.includes(f.plaintext), false); assert.equal(backup.includes(encryptionKey), false);
  assert.equal((await stat(backupPath)).mode & 0o777, 0o600);
  assert.equal((await migration.seal(config)).state, 'sealed'); await migration.seal(config);
  const a = await login(repo), b = await login(repo, 'second');
  assert.deepEqual((await repo.get(a, { kind: 'dashboard', id: 'dashboard' })).body.definition, f.definition);
  assert.deepEqual((await repo.get(a, { kind: 'dashboard', id: 'dashboard' })).body.grants, []);
  for (const context of [a, b]) {
    assert.equal((await repo.get(context, { kind: 'user', id: 'admin' })).body.name, context.namespaceId);
    assert.equal((await repo.get(context, { kind: 'dataset', id: 'sales' })).body.definition.name, context.namespaceId);
    assert.deepEqual((await repo.get(context, { kind: 'prepared-dataset', ownerId: 'admin', id: 'prepared' })).body.resource, prepared());
  }
  const secret = await repo.get(a, { kind: 'secret', id: 'ai-provider' });
  assert.equal(decryptMetadataSecret(secret.body.ciphertext, encryptionKey, a, secret), f.plaintext);
  assert.throws(() => decryptMetadataSecret(secret.body.ciphertext, encryptionKey, b, secret), { code: 'METADATA_SECRET_UNAVAILABLE' });
  assert.equal((await repo.list(a, 'job'))[0].body.executionDisabled, true);
  assert.deepEqual(await repo.list(b, 'job'), []);
  for (const id of ['dashboard', 'unknown']) await assert.rejects(repo.get(b, { kind: 'dashboard', id }), { code: 'RESOURCE_NOT_FOUND', status: 404 });
  await assert.rejects(migration.rollback(config), { code: 'MIGRATION_ROLLBACK_BOUNDARY' });
  await assert.rejects(legacy.change(() => {}), { code: 'LEGACY_STORE_FROZEN' });
});

test('H1 rollback restores legacy admission without altering source bytes and can be retried', async t => {
  const { config, db, migration, encryptionKey } = await fixture(t), before = await readFile(config.securityPath);
  await migration.migrate(config, encryptionKey); await migration.rollback(config); await migration.rollback(config);
  assert.deepEqual(await readFile(config.securityPath), before);
  const store = await AutomationStore.load({}, config.securityPath, v => v); await store.change(() => {});
  await db.transaction(async c => {
    assert.equal((await c.query('SELECT * FROM h1_tenants')).length, 0);
    assert.equal((await c.query('SELECT * FROM h1_outbox')).length, 0);
    assert.equal((await c.query('SELECT state FROM h1_migrations'))[0].state, 'rolled-back');
  });
  await assert.rejects(migration.migrate(config, encryptionKey), { code: 'MIGRATION_ID_REUSED' });
});

test('H1 invalid inventories fail closed before metadata commit; rollback releases a rejected inventory', async t => {
  for (const [name, change] of [
    ['mapping', f => { f.config.namespaces.pop(); }],
    ['duplicate-user', async f => { f.security.users.push(f.security.users[0]); await save(f.config.securityPath, f.security); }],
    ['duplicate-source', f => { f.config.sources.push(f.config.sources[0]); }],
    ['missing-prep-source', f => { f.config.sources = []; }],
    ['missing-owner', async f => { await save(f.config.prepPath, { version: 1, datasets: [{ namespaceId: 'default', userId: 'missing', resource: prepared() }] }); }],
    ['policy-arn', f => { f.config.datasets[0].arn = 'foreign'; }],
    ['asset-binding', f => { f.config.datasets = []; }],
    ['ai-key', f => { f.encryptionKey = randomBytes(32).toString('base64'); }],
    ['prep-cycle', async f => { await save(f.config.prepPath, { version: 1, datasets: [{ namespaceId: 'default', userId: 'admin', resource: prepared({ dataset: 'prepared' }) }] }); }]
  ]) await t.test(name, async t => {
    const f = await fixture(t); await change(f);
    await assert.rejects(f.migration.migrate(f.config, f.encryptionKey));
    await f.db.transaction(async c => assert.equal((await c.query('SELECT * FROM h1_tenants')).length, 0));
    await f.migration.rollback(f.config);
    await AutomationStore.load({}, f.config.securityPath, v => v);
  });
});

test('H1 maintenance, fixture purpose, changed inputs and tampered backup are explicit failures', async t => {
  const f = await fixture(t);
  await assert.rejects(f.migration.migrate({ ...f.config, maintenance: false }), { code: 'MIGRATION_MAINTENANCE_REQUIRED' });
  const customer = structuredClone(f.config); customer.namespaces[0].purpose = 'customer';
  customer.namespaces[0].dataRoot = fileURLToPath(new URL('../../../fixtures', import.meta.url));
  await assert.rejects(f.migration.migrate(customer), { code: 'MIGRATION_FIXTURE_CUSTOMER_REJECTED' });
  await assert.rejects(f.migration.migrate(f.config, f.encryptionKey, async stage => { if (stage === 'inventoried') throw Error('interrupted'); }), /interrupted/);
  await writeFile(f.config.securityPath, `${await readFile(f.config.securityPath, 'utf8')} `);
  await assert.rejects(f.migration.migrate(f.config), { code: 'MIGRATION_INPUT_CHANGED' });
  const path = join(f.config.backupDirectory, 'h1-v1-migration.json'), backup = JSON.parse(await readFile(path, 'utf8'));
  backup.rows[0].body.name = 'changed'; await save(path, backup);
  await assert.rejects(f.migration.migrate(f.config), { code: 'MIGRATION_BACKUP_MISMATCH' });
});

test('H1 frozen-write lock serializes a racing freeze with an in-flight legacy write', async t => {
  const { config } = await fixture(t);
  let release, entered; const started = new Promise(r => { entered = r; }), hold = new Promise(r => { release = r; });
  const write = legacyWrite(config.securityPath, async () => { entered(); await hold; }); await started;
  await assert.rejects(freezeLegacy(config.securityPath, config.migrationId), { code: 'METADATA_CONFLICT' });
  release(); await write; await freezeLegacy(config.securityPath, config.migrationId);
  await assert.rejects(legacyWrite(config.securityPath, async () => {}), { code: 'LEGACY_STORE_FROZEN' });
});

test('H1 SIGKILL during migration rolls back SQLite and resumes without a servable partial tenant', async t => {
  for (const stage of ['frozen', 'inventoried', 'tenant-written', 'row-written', 'before-commit', 'committed']) await t.test(stage, async t => {
    const f = await fixture(t), configPath = join(f.dir, 'config.json'); await save(configPath, f.config);
    const worker = fork(fileURLToPath(new URL('./support/metadata-migration-worker.mjs', import.meta.url)), [configPath, f.dbPath, stage], { execArgv: [], env: { ...process.env, OPENSIGHT_AI_ENCRYPTION_KEY: f.encryptionKey }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let stderr = ''; worker.stderr.on('data', data => { stderr += data; });
    t.after(() => { if (worker.exitCode === null) worker.kill('SIGKILL'); });
    const reached = await Promise.race([once(worker, 'message').then(([m]) => m), once(worker, 'exit').then(() => { throw Error(stderr); })]);
    assert.equal(reached, stage); const exited = once(worker, 'exit'); worker.kill('SIGKILL'); await exited;
    const repo = new TenantMetadata(f.db, f.db); await assert.rejects(login(repo), { code: 'UNKNOWN_PRINCIPAL' });
    await f.db.transaction(async c => assert.equal((await c.query('SELECT * FROM h1_tenants')).length, stage === 'committed' ? 2 : 0));
    assert.equal((await f.migration.migrate(f.config, f.encryptionKey)).state, 'committed');
    await f.migration.seal(f.config); assert.equal((await repo.list(await login(repo), 'user')).length, 1);
  });
});


test('H1 offline CLI uses environment configuration, reports counts only, and enforces seal boundary', async t => {
  const f = await fixture(t), configPath = join(f.dir, 'operator-config.json'); await save(configPath, f.config);
  const env = { ...process.env, OPENSIGHT_METADATA_DATABASE: f.dbPath, OPENSIGHT_METADATA_MIGRATION_CONFIG: configPath, OPENSIGHT_AI_ENCRYPTION_KEY: f.encryptionKey };
  delete env.NODE_TEST_CONTEXT;
  const cli = fileURLToPath(new URL('../dist/metadata-migrate-cli.js', import.meta.url));
  const invoke = action => promisify(execFile)(process.execPath, [cli, action], { env });
  const migrated = await invoke('migrate');
  assert.ok(migrated.stdout, JSON.stringify(migrated));
  assert.equal(JSON.parse(migrated.stdout).state, 'committed');
  assert.equal(migrated.stdout.includes(f.plaintext), false);
  assert.equal(JSON.parse((await invoke('seal')).stdout).state, 'sealed');
  await assert.rejects(invoke('rollback'), error => error.stderr.trim() === 'MIGRATION_ROLLBACK_BOUNDARY');
  await assert.rejects(invoke('unknown'), error => error.stderr.trim() === 'MIGRATION_CONFIGURATION_REQUIRED');
});

test('H1 concurrent maintenance commands cannot roll back a migration while it commits', async t => {
  const f = await fixture(t);
  let entered, release; const ready = new Promise(r => { entered = r; }), hold = new Promise(r => { release = r; });
  const migrating = f.migration.migrate(f.config, f.encryptionKey, async stage => { if (stage === 'before-commit') { entered(); await hold; } });
  await ready;
  try { await assert.rejects(f.migration.rollback(f.config), { code: 'METADATA_CONFLICT' }); }
  finally { release(); }
  assert.equal((await migrating).state, 'committed');
  await f.migration.rollback(f.config);
});
