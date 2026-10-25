import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { PostgresMetadataDatabase, SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { migrateServerless, serverlessTables } from '../dist/serverless-migration.js';
import { snapshotServerless, migrateRegistered, restoreServerless, validateRecovery } from '../dist/serverless-backup.js';
import { recordMaintenanceReceipt } from '../dist/serverless-backup-lambda.js';
import { checksum } from '../dist/metadata-operator.js';
import { AUDIT_SCHEMA_VERSION, auditSchemaChecksum, appendOperatorAudit } from '../dist/operator-audit.js';
import { environment } from './hosted-helpers.mjs';
import { referenceEnv } from './h8-helpers.mjs';
import { runtimeEnv } from './runtime-helpers.mjs';
import { coordinationFixture } from './coordination-helpers.mjs';
import { TenantMetadata } from '../dist/metadata.js';
import { DurableDispatch } from '../dist/dispatch.js';
import { ObjectLedger } from '../dist/object-ledger.js';

const live = { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set' };
const fingerprint = rows => checksum(rows.map(checksum).sort());
const registryFor = snapshot => ({ version: 1, revision: 1, epoch: snapshot.epoch, fence: snapshot.fence,
  completeThroughEpoch: snapshot.epoch, backups: { [snapshot.id]: checksum(snapshot) }, deletedTenants: [], retiredKeyVersions: [] });
const take = (f, dialect) => snapshotServerless(f.db, 'test', randomUUID(), Date.now() + 3600000, ['a'.repeat(32)], dialect);
const rows = (f, table) => f.db.transaction(c => c.query(`SELECT * FROM ${table}`));
async function legacy(f) {
  await f.db.transaction(async c => {
    await c.query('DROP TABLE h8_audit_schema');
    for (const column of ['actor', 'tenant_id', 'subject', 'detail']) await c.query(`ALTER TABLE h8_audit DROP COLUMN ${column}`);
  });
}
async function postgres(t, { seed = true, old = true } = {}) {
  const schema = 'backup_' + randomUUID().replaceAll('-', ''), operator = schema + '_op', tenant = schema + '_tn';
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, options: '-c search_path=' + schema });
  const db = new PostgresMetadataDatabase(pool);
  t.after(async () => { await pool.query('RESET ROLE'); await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.query(`DROP ROLE IF EXISTS ${operator}, ${tenant}`); await pool.end(); });
  await pool.query(`CREATE SCHEMA ${schema}`);
  for (const [kind, role] of [['operator', operator], ['tenant', tenant]]) {
    await pool.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT ${kind === 'operator' ? 'BYPASSRLS' : 'NOBYPASSRLS'}`);
    await pool.query(`COMMENT ON ROLE ${role} IS 'opensight:test:${kind}'`);
  }
  const fixture = seed ? await coordinationFixture(t, { migrate: false }) : undefined;
  const env = { ...(fixture?.env ?? { ...environment(), ...referenceEnv, ...runtimeEnv(), OPENSIGHT_REFERENCE: undefined }),
    OPENSIGHT_RUNTIME_OPERATOR_ROLE: operator, OPENSIGHT_RUNTIME_TENANT_ROLE: tenant,
    OPENSIGHT_ENTITLEMENTS: JSON.stringify({ defaults: { apiCalls: 1000, storageBytes: 1000000, computeAttempts: 20 }, tenants: {} }) };
  await migrateServerless(db, env);
  if (fixture) {
    // Retained tenants, identities, metadata and source references come from the
    // real fixture. Current markers/budgets and private control stay owner-built.
    for (const table of ['h1_tenants', 'h1_namespaces', 'h1_revisions', 'h1_resources', 'h1_links', 'h2_identities', 'h2_memberships']) {
      for (const row of await rows(fixture, table)) {
        const keys = Object.keys(row);
        await db.transaction(c => c.query(`INSERT INTO ${table} (${keys.map(k => '"' + k + '"').join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(row)));
      }
    }
  }
  const f = { db, pool, env, operator, tenant, schema };
  if (seed) {
    await pool.query("UPDATE sr_control SET state='open'");
    const metadata = new TenantMetadata(db, db), context = await metadata.authenticate(null, async () => ({ namespaceId: 'one', userId: 'admin' }));
    const dispatch = new DurableDispatch(db, metadata, 'test', { recover: async () => {}, dispatch: async () => {} }, 'postgres');
    const ledger = new ObjectLedger(metadata, 'test'), revisions = await metadata.revisions(context);
    const plan = ledger.plan(context, { capacityBytes: 128, purpose: 'raw-upload', mediaType: 'text/csv', checksum: Buffer.alloc(32, 1).toString('base64') });
    const handle = await dispatch.prepare(context, { kind: 'upload-reserve', revisions, requestDigest: 'a'.repeat(64), idempotencyKey: randomUUID() });
    await dispatch.commit(handle, async (c, now) => { await ledger.reserve(c, context, revisions, handle.intentId, [plan], now, now + 60000);
      await ledger.bind(c, context, plan.id, { version: 'retained-version', bytes: 32, checksum: Buffer.alloc(32, 1).toString('base64') });
      return { receipt: { id: plan.id, revision: 1 }, events: [] }; });
    await pool.query("UPDATE sr_control SET state='maintenance'");
  }
  if (old) await legacy(f);
  return f;
}

test('registered legacy audit upgrade: SQLite inventory, preservation, exact retry and held restore', async t => {
  const f = await coordinationFixture(t, { migrate: false }), env = { ...f.env, OPENSIGHT_ENTITLEMENTS: JSON.stringify(f.entitlements) };
  await migrateServerless(f.db, env, 'sqlite'); await legacy(f);
  const snapshot = await take(f, 'sqlite'), registry = registryFor(snapshot), operation = randomUUID();
  assert.ok(!Object.hasOwn(snapshot.tables, 'h8_audit_schema'));
  assert.equal((await migrateRegistered(f.db, env, snapshot, registry, operation, 'sqlite')).replayed, false);
  assert.equal((await migrateRegistered(f.db, env, snapshot, registry, operation, 'sqlite')).replayed, true);
  const directory = await mkdtemp(join(tmpdir(), 'audit-restore-'));
  const target = { db: new SqliteMetadataDatabase(join(directory, 'target.sqlite')) };
  t.after(async () => { await target.db.close(); await rm(directory, { recursive: true }); });
  await migrateServerless(target.db, env, 'sqlite');
  const result = await restoreServerless(target.db, snapshot, { ...registry, epoch: snapshot.epoch + 1 }, 'sqlite');
  assert.equal(result.state, 'held'); assert.equal((await rows(target, 'h8_audit_schema'))[0].checksum, auditSchemaChecksum);
  assert.ok((await rows(target, 'h1_tenants')).every(row => row.state === 'suspended'));
});

test('live Postgres: registered legacy upgrade preserves retained objects, audit/receipts, restricted grants and old INSERT compatibility', live, async t => {
  const f = await postgres(t), snapshot = await take(f, 'postgres'), registry = registryFor(snapshot), operation = randomUUID();
  assert.equal(snapshot.objects.length, 1); assert.equal(snapshot.objects[0].version, 'retained-version');
  assert.equal(snapshot.tables.sr_object_pin.length, 1);
  assert.ok(snapshot.tables.h1_resources.length > 0);
  assert.equal((await migrateRegistered(f.db, f.env, snapshot, registry, operation)).replayed, false);
  assert.equal((await migrateRegistered(f.db, f.env, snapshot, registry, operation)).replayed, true);
  for (const table of serverlessTables.filter(t => !['h8_audit', 'h8_audit_schema', 'h2_requests'].includes(t)))
    assert.equal(fingerprint(await rows(f, table)), fingerprint(snapshot.tables[table]), table);
  const marker = (await rows(f, 'h8_audit_schema'))[0];
  assert.equal(Number(marker.version), AUDIT_SCHEMA_VERSION); assert.equal(marker.checksum, auditSchemaChecksum);
  const audit = await rows(f, 'h8_audit');
  for (const old of snapshot.tables.h8_audit) assert.deepEqual(audit.find(row => row.event_id === old.event_id), { ...old, actor: 'deployment-operator', tenant_id: null, subject: null, detail: null });
  // Pool.query discards a connection on a failed query. Keep one checked-out
  // client so a denied operation cannot silently reset later probes to owner.
  const client = await f.pool.connect();
  try {
    await client.query('SET ROLE ' + f.operator);
    await assert.rejects(client.query('CREATE TABLE forbidden (id INT)'), { code: '42501' });
    await assert.rejects(client.query('UPDATE h8_audit_schema SET version=version'), { code: '42501' });
    await client.query('SELECT * FROM h8_audit_schema');
    await client.query('INSERT INTO h8_audit VALUES ($1,$2,$3)', [randomUUID(), new Date().toISOString(), 'old.release.audit']);
    await appendOperatorAudit({ query: async (sql, values) => { let i = 0; return (await client.query(sql.replace(/\?/g, () => '$' + ++i), values)).rows; } }, { action: 'current.release.audit' });
  } finally { await client.query('RESET ROLE'); client.release(); }
  // After reopened traffic changes audit history, the old frozen operation is no longer replayable.
  await assert.rejects(migrateRegistered(f.db, f.env, snapshot, registry, operation), { code: 'MIGRATION_PRESERVATION_FAILED' });
});

test('live Postgres: pre-upgrade registered backup restores only into a current empty held target', live, async t => {
  const f = await postgres(t), snapshot = await take(f, 'postgres'), registry = { ...registryFor(snapshot), epoch: 2 };
  const target = await postgres(t, { seed: false, old: false });
  const result = await restoreServerless(target.db, snapshot, registry);
  assert.equal(result.state, 'held'); assert.equal(result.epoch, 2);
  assert.equal((await rows(target, 'h8_audit_schema'))[0].checksum, auditSchemaChecksum);
  assert.equal((await rows(target, 'sr_object'))[0].object_version, 'retained-version');
  assert.ok((await rows(target, 'h1_tenants')).every(row => row.state === 'suspended'));
  assert.ok((await rows(target, 'h2_memberships')).every(row => row.status === 'removed'));
  assert.equal((await rows(target, 'sr_control'))[0].state, 'maintenance');
  await assert.rejects(restoreServerless(target.db, snapshot, registry), { code: 'RESTORE_TARGET_NOT_EMPTY' });
});

test('live Postgres: legacy migration denies stale/altered registration, post-backup writes and conflicting receipts', live, async t => {
  const f = await postgres(t), snapshot = await take(f, 'postgres'), registry = registryFor(snapshot), operation = randomUUID();
  for (const patch of [{ epoch: 2 }, { completeThroughEpoch: 0 }, { fence: -1 }, { backups: {} }, { retiredKeyVersions: snapshot.keyVersions }, { deletedTenants: ['tenant-one'] }])
    await assert.rejects(migrateRegistered(f.db, f.env, snapshot, { ...registry, ...patch }, operation), { code: 'MIGRATION_BACKUP_REQUIRED' });
  const altered = structuredClone(snapshot); altered.tables.h1_namespaces[0].name = 'changed';
  await assert.rejects(migrateRegistered(f.db, f.env, altered, registry, operation), { code: 'MIGRATION_BACKUP_REQUIRED' });
  for (const [sql, values] of [
    ["UPDATE h1_namespaces SET name='changed' WHERE namespace_id='one'", []],
    ["INSERT INTO h8_audit VALUES ('unexpected','2026-01-01T00:00:00Z','unexpected')", []],
    ["INSERT INTO h2_requests VALUES ('unexpected','unexpected')", []],
    ["UPDATE sr_object SET object_version='changed'", []],
    ["UPDATE sr_object_schema SET checksum='changed'", []],
  ]) {
    // Rolled-back caller transaction leaves the same registered baseline for each probe.
    await assert.rejects(f.db.transaction(async c => {
      await c.query(sql, values);
      await migrateRegistered({ durable: true, transaction: work => work(c), close: async () => {} }, f.env, snapshot, registry, operation);
    }), { code: 'MIGRATION_PRESERVATION_FAILED' });
  }
  await f.pool.query('INSERT INTO h2_requests VALUES ($1,$2)', ['cloud-migration:' + operation, 'conflict']);
  await assert.rejects(migrateRegistered(f.db, f.env, snapshot, registry, operation), { code: 'MIGRATION_RECEIPT_CONFLICT' });
  assert.equal((await f.pool.query("SELECT to_regclass('h8_audit_schema') AS marker")).rows[0].marker, null);
});

test('live Postgres: wrong ownership, missing tables, partial audit schemas and forged markers stay closed', live, async t => {
  const f = await postgres(t);
  for (const [sql, code] of [
    [`ALTER TABLE h8_audit OWNER TO ${f.tenant}`, 'BACKUP_FOREIGN_DATABASE'],
    ['DROP TABLE sr_result_chunk', 'BACKUP_FOREIGN_DATABASE'],
    ['ALTER TABLE h8_audit ADD COLUMN actor TEXT', 'BACKUP_SCHEMA_INVALID'],
    ['CREATE VIEW h8_audit_schema AS SELECT 1 AS id', 'BACKUP_FOREIGN_DATABASE'],
  ]) await assert.rejects(f.db.transaction(async c => {
    await c.query(sql);
    await snapshotServerless({ durable: true, transaction: work => work(c) }, 'test', randomUUID(), Date.now() + 3600000, ['a'.repeat(32)]);
  }), { code });
  const snapshot = await take(f, 'postgres'), registry = registryFor(snapshot);
  for (const tables of [{ ...snapshot.tables, unknown: [] }, Object.fromEntries(Object.entries(snapshot.tables).filter(([name]) => name !== 'h1_resources')),
    { ...snapshot.tables, h8_audit_schema: [{ id: 1, version: 1, checksum: 'forged' }] }]) {
    const bad = { ...snapshot, tables }, registered = { ...registry, epoch: 2, backups: { [bad.id]: checksum(bad) } };
    assert.throws(() => validateRecovery(bad, registered), { code: 'BACKUP_SCHEMA_INVALID' });
  }
  await migrateRegistered(f.db, f.env, snapshot, registry, randomUUID());
  await f.pool.query("UPDATE h8_audit_schema SET checksum='forged'");
  await assert.rejects(take(f, 'postgres'), { code: 'BACKUP_SCHEMA_INVALID' });
});

test('live Postgres: failed post-DDL preservation check rolls back audit columns, marker and receipt atomically', live, async t => {
  const f = await postgres(t), snapshot = await take(f, 'postgres'), registry = registryFor(snapshot), operation = randomUUID();
  const injected = { durable: true, transaction: work => f.db.transaction(c => work({ query: async (sql, values) => {
    const result = await c.query(sql, values);
    if (sql.startsWith('INSERT INTO h8_audit_schema')) await c.query("UPDATE h1_namespaces SET name='injected' WHERE namespace_id='one'");
    return result;
  } })) };
  await assert.rejects(migrateRegistered(injected, f.env, snapshot, registry, operation), { code: 'MIGRATION_PRESERVATION_FAILED' });
  assert.equal((await f.pool.query("SELECT to_regclass('h8_audit_schema') AS marker")).rows[0].marker, null);
  assert.equal(fingerprint(await rows(f, 'h1_namespaces')), fingerprint(snapshot.tables.h1_namespaces));
  assert.equal(fingerprint(await rows(f, 'h2_requests')), fingerprint(snapshot.tables.h2_requests));
  assert.equal((await migrateRegistered(f.db, f.env, snapshot, registry, operation)).replayed, false);
  assert.equal((await migrateRegistered(f.db, f.env, snapshot, registry, operation)).replayed, true);
});

test('live Postgres: current-schema registered migration re-tightens marker grants and requires its own receipt for a legacy retry', live, async t => {
  const f = await postgres(t), old = await take(f, 'postgres');
  await migrateRegistered(f.db, f.env, old, registryFor(old), randomUUID());
  await assert.rejects(migrateRegistered(f.db, f.env, old, registryFor(old), randomUUID()), { code: 'BACKUP_SCHEMA_INVALID' });
  await f.pool.query(`GRANT ALL ON h8_audit_schema TO ${f.operator}, ${f.tenant}`);
  await f.pool.query(`GRANT UPDATE (version) ON h8_audit_schema TO ${f.operator}, ${f.tenant}`);
  const current = await take(f, 'postgres'), registry = registryFor(current), operation = randomUUID();
  await migrateRegistered(f.db, f.env, current, registry, operation);
  await migrateRegistered(f.db, f.env, current, registry, operation);
  const client = await f.pool.connect();
  try {
    for (const role of [f.operator, f.tenant]) {
      await client.query('SET ROLE ' + role);
      await assert.rejects(client.query('UPDATE h8_audit_schema SET version=version'), { code: '42501' });
      if (role === f.operator) await client.query('SELECT * FROM h8_audit_schema');
      else await assert.rejects(client.query('SELECT * FROM h8_audit_schema'), { code: '42501' });
      await client.query('RESET ROLE');
    }
  } finally { await client.query('RESET ROLE'); client.release(); }
});

test('maintenance receipt: exact retry and lost write response reconcile; conflicting evidence never overwrites', async () => {
  const expected = { state: 'migrated', epoch: 2, replayed: false, plan: 'plan', registry: 'registry', backup: 'backup' };
  let stored, writes = 0;
  const io = { read: async () => { if (!stored) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' }); return stored; },
    create: async value => { if (stored) throw new Error('conditional conflict'); writes++; stored = value; } };
  await recordMaintenanceReceipt(expected, io);
  await recordMaintenanceReceipt({ ...expected, replayed: true }, io); assert.equal(writes, 1);
  await assert.rejects(recordMaintenanceReceipt({ ...expected, backup: 'changed' }, io), { code: 'BACKUP_RECEIPT_CONFLICT' });
  stored = undefined;
  await recordMaintenanceReceipt(expected, { ...io, create: async value => { stored = value; throw new Error('lost response'); } });
  stored = undefined;
  await assert.rejects(recordMaintenanceReceipt(expected, { ...io, create: async () => { stored = { ...expected, plan: 'foreign' }; throw new Error('conditional conflict'); } }), { code: 'BACKUP_RECEIPT_CONFLICT' });
});

async function beforeWorkspaceAndWarnings(f) {
  await f.pool.query('DROP TABLE h2_login_selections, h8_ai_warnings');
  await f.pool.query('ALTER TABLE h1_tenants DROP COLUMN display_name, DROP COLUMN slug');
}

test('live Postgres: deployed audit-v1 inventory upgrades workspace and AI warnings with retained data and exact retry', live, async t => {
  const f = await postgres(t, { old: false }); await beforeWorkspaceAndWarnings(f);
  const snapshot = await take(f, 'postgres'), registry = registryFor(snapshot), operation = randomUUID();
  assert.equal(snapshot.objects.length, 1);
  assert.equal('display_name' in snapshot.tables.h1_tenants[0], false);
  assert.equal('h2_login_selections' in snapshot.tables, false);
  assert.equal('h8_ai_warnings' in snapshot.tables, false);
  assert.equal((await migrateRegistered(f.db, f.env, snapshot, registry, operation)).replayed, false);
  assert.equal((await migrateRegistered(f.db, f.env, snapshot, registry, operation)).replayed, true);
  assert.deepEqual(await rows(f, 'h2_login_selections'), []);
  assert.deepEqual(await rows(f, 'h8_ai_warnings'), []);
  assert.equal(fingerprint(await rows(f, 'h1_tenants')), fingerprint(snapshot.tables.h1_tenants.map(row => ({ ...row, display_name: null, slug: null }))));
  for (const table of Object.keys(snapshot.tables).filter(name => !['h1_tenants', 'h8_audit', 'h2_requests'].includes(name)))
    assert.equal(fingerprint(await rows(f, table)), fingerprint(snapshot.tables[table]), table);
  const grants = (await f.pool.query(`SELECT has_table_privilege($1, 'h2_login_selections', 'SELECT,INSERT,UPDATE') AS login,
    has_table_privilege($1, 'h8_ai_warnings', 'SELECT,INSERT,UPDATE') AS warnings,
    has_schema_privilege($1, current_schema(), 'CREATE') AS ddl`, [f.operator])).rows[0];
  assert.deepEqual(grants, { login: true, warnings: true, ddl: false });
  const target = await postgres(t, { seed: false, old: false });
  const restored = await restoreServerless(target.db, snapshot, { ...registry, epoch: registry.epoch + 1 });
  assert.equal(restored.state, 'held');
  assert.ok((await rows(target, 'h1_tenants')).every(row => row.state === 'suspended' && row.display_name === null && row.slug === null));
});

test('live Postgres: workspace and AI warning upgrade rolls back on failed preservation without leaving a receipt', live, async t => {
  const f = await postgres(t, { old: false }); await beforeWorkspaceAndWarnings(f);
  const snapshot = await take(f, 'postgres'), registry = registryFor(snapshot), operation = randomUUID();
  const injected = { durable: true, transaction: work => f.db.transaction(c => work({ query: async (sql, values) => {
    const result = await c.query(sql, values);
    if (sql.startsWith('ALTER TABLE h1_tenants ADD COLUMN display_name')) await c.query("UPDATE h1_namespaces SET name='injected' WHERE namespace_id='one'");
    return result;
  } })) };
  await assert.rejects(migrateRegistered(injected, f.env, snapshot, registry, operation), { code: 'MIGRATION_PRESERVATION_FAILED' });
  const after = await take(f, 'postgres');
  assert.equal('h2_login_selections' in after.tables, false);
  assert.equal('h8_ai_warnings' in after.tables, false);
  assert.equal('display_name' in after.tables.h1_tenants[0], false);
  assert.equal(fingerprint(after.tables.h1_namespaces), fingerprint(snapshot.tables.h1_namespaces));
  assert.equal(fingerprint(after.tables.h2_requests), fingerprint(snapshot.tables.h2_requests));
});
