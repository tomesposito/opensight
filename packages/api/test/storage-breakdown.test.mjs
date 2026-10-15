import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { manifestFixture } from './manifest-helpers.mjs';
import { migrateDispatch } from '../dist/dispatch-schema.js';
import { migrateObjects } from '../dist/object-schema.js';
import { migrateOperations } from '../dist/operation-schema.js';
import { DurableDispatch } from '../dist/dispatch.js';
import { ObjectLedger } from '../dist/object-ledger.js';
import { TenantMetadata } from '../dist/metadata.js';
import { HostedUsage } from '../dist/hosted-usage.js';
import { describeStorage, formatBytes, quotaExceededSummary, validateMaintenanceAdjustment, nextReclamationAt } from '../dist/storage-breakdown.js';

const digest = Buffer.alloc(32, 1).toString('base64');
const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'storage-inspect-cli.js');
async function fixture(t) {
  const f = await manifestFixture(t);
  await migrateDispatch(f.db, 'test', 'frozen', 'sqlite'); await migrateObjects(f.db, 'test', 'frozen', 'sqlite'); await migrateOperations(f.db, 'test', 'frozen', 'sqlite');
  const usage = new HostedUsage(f.db, f.entitlements, Date.now, 'test'), metadata = new TenantMetadata(f.db, f.db, usage);
  const contexts = await Promise.all(['one', 'two'].map(namespaceId => metadata.authenticate(null, async () => ({ namespaceId, userId: 'admin' }))));
  const dispatch = new DurableDispatch(f.db, metadata, 'test', { recover: async () => {}, dispatch: async () => {} }, 'sqlite'), ledger = new ObjectLedger(metadata, 'test');
  await f.open();
  return { ...f, metadata, contexts, usage, dispatch, ledger,
    plan: (capacityBytes = 200000, index = 0) => ledger.plan(contexts[index], { capacityBytes, purpose: 'raw-upload', mediaType: 'text/csv', checksum: digest }),
    async reserve(plans, index = 0) {
      const ctx = contexts[index], revisions = await metadata.revisions(ctx), handle = await dispatch.prepare(ctx, { kind: 'upload-reserve', revisions, requestDigest: 'a'.repeat(64), idempotencyKey: randomUUID() });
      await dispatch.commit(handle, async (c, now) => {
        await ledger.reserve(c, ctx, revisions, handle.intentId, plans, now, now + 600000, now + 60000);
        return { receipt: { id: plans[0].id, revision: 1 }, events: [] };
      }); return handle;
    },
    breakdown: (index = 0, now) => f.db.transaction(c => describeStorage(c, { deployment: 'test', tenantId: contexts[index].tenantId, namespaceId: contexts[index].namespaceId, ...(now === undefined ? {} : { now }) })),
  };
}

test('#91 fresh namespace reports zeros and no pending cleanup', async t => {
  const f = await fixture(t), b = await f.breakdown(1);
  assert.equal(b.limitBytes, 1000000); assert.equal(b.liveBytes, 0); assert.equal(b.reservedBytes, 0);
  assert.equal(b.pendingCleanupBytes, 0); assert.deepEqual(b.pendingCleanup, []); assert.equal(b.nextReclamationAt, null); assert.equal(b.overdueCount, 0);
});

test('#91 failed reservation stays charged and visible with its reclamation time', async t => {
  const f = await fixture(t);
  await f.reserve([f.plan(600000)]);
  const rejected = await f.reserve([f.plan(600000)]).then(() => null, e => e);
  assert.equal(rejected.code, 'USAGE_LIMIT_EXCEEDED');
  const b = await f.breakdown();
  assert.equal(b.reservedBytes, 600000); assert.equal(b.pendingCleanupBytes, 600000);
  assert.equal(b.pendingCleanup.length, 1); assert.equal(b.pendingCleanup[0].state, 'reserved');
  assert.ok(b.pendingCleanup[0].nextReclamationAt > Date.now());
  assert.equal(b.nextReclamationAt, b.pendingCleanup[0].nextReclamationAt);
  assert.equal(b.overdueCount, 0);
});

test('#91 quota error explains live, reserved, pending and next reclamation', async t => {
  const f = await fixture(t);
  await f.reserve([f.plan(600000)]);
  const rejected = await f.reserve([f.plan(600000)]).then(() => null, e => e);
  assert.equal(rejected.code, 'USAGE_LIMIT_EXCEEDED'); assert.equal(rejected.status, 429);
  const summary = String(rejected.detail?.summary ?? '');
  assert.ok(summary.includes('Storage limit'), 'names the limit');
  assert.ok(summary.includes('reserved'), 'names retained reservations');
  assert.ok(summary.includes('24-hour'), 'names the 24-hour retention rule');
  assert.equal(rejected.detail.breakdown.reservedBytes, 600000);
  assert.equal(rejected.detail.breakdown.pendingCleanupCount, 1);
  assert.equal(rejected.detail.breakdown.limitBytes, 1000000);
  assert.equal(rejected.detail.requestedBytes, 600000);
});

test('#91 retiring past reclamation is flagged overdue; exact-version deletion clears the charge', async t => {
  const f = await fixture(t), ctx = f.contexts[0], plan = f.plan(200000);
  await f.reserve([plan]);
  await f.db.transaction(c => f.ledger.bind(c, ctx, plan.id, { version: 'exact-version', bytes: 12000, checksum: digest }));
  const later = Date.now() + 86500000;
  await f.db.transaction(c => f.ledger.retire(c, ctx, plan.id, later));
  const b = await f.breakdown(0, later);
  assert.equal(b.liveBytes, 12000); assert.equal(b.overdueCount, 1);
  assert.ok(b.pendingCleanup[0].overdue, 'retiring past its reclamation time is overdue');
  await assert.rejects(f.db.transaction(c => f.ledger.deleted(c, ctx, plan.id, 'wrong-version')), { code: 'OBJECT_BINDING_CONFLICT' });
  const still = await f.breakdown(0, later);
  assert.equal(still.liveBytes, 12000, 'wrong version proves nothing; charge retained');
  await f.db.transaction(c => f.ledger.deleted(c, ctx, plan.id, 'exact-version'));
  await f.db.transaction(c => f.ledger.deleted(c, ctx, plan.id, 'exact-version')); // duplicate cleanup is idempotent
  const done = await f.breakdown(0, later);
  assert.equal(done.liveBytes, 0); assert.equal(done.pendingCleanup.length, 0); assert.equal(done.overdueCount, 0);
});

test('#91 pinned live references block retire; breakdown stays namespace-scoped', async t => {
  const f = await fixture(t), ctx = f.contexts[0], plan = f.plan(200000);
  await f.reserve([plan]);
  const later = Date.now() + 86500000;
  await f.db.transaction(c => c.query('INSERT INTO sr_object_pin VALUES (?,?,?,?,?,?,?)', ['test', ctx.tenantId, ctx.namespaceId, ctx.userId, plan.id, 'backup', later + 100000]));
  await assert.rejects(f.db.transaction(c => f.ledger.retire(c, ctx, plan.id, later)), { code: 'OBJECT_RETENTION_REQUIRED' });
  const b = await f.breakdown();
  assert.equal(b.pendingCleanup.length, 0); assert.equal(b.protectedObjects.length, 1); assert.deepEqual(b.protectedObjects[0].protections, ['pin']); assert.equal(b.protectedObjects[0].nextReclamationAt, later + 100000); assert.equal(b.overdueCount, 0, 'pinned object is not an overdue obligation');
  const other = await f.breakdown(1);
  assert.equal(other.pendingCleanup.length, 0, 'namespace two sees none of namespace one');
});

test('#91 read-only diagnostic CLI prints the breakdown as JSON', async t => {
  const f = await fixture(t);
  await f.reserve([f.plan(600000)]);
  const run = promisify(execFile);
  const { stdout } = await run(process.execPath, [cli, '--deployment', 'test', '--tenant', f.contexts[0].tenantId, '--namespace', 'one'],
    { env: { ...process.env, OPENSIGHT_METADATA_DATABASE: f.path, OPENSIGHT_METADATA_POSTGRES: '' } });
  const b = JSON.parse(stdout);
  assert.equal(b.reservedBytes, 600000); assert.equal(b.limitBytes, 1000000);
  assert.equal(b.pendingCleanup.length, 1); assert.equal(b.pendingCleanup[0].state, 'reserved');
  const usage = await run(process.execPath, [cli], { env: process.env }).then(() => null, e => e);
  assert.equal(usage.code, 1); assert.match(usage.stderr, /STORAGE_INSPECT_USAGE/);
});

test('#91 maintenance adjustment is specified and validated before any implementation', async t => {
  const scope = { deployment: 'test', tenantId: 'tenant-one', namespaceId: 'one' };
  const plan = validateMaintenanceAdjustment({ action: 'recompute-gauge', ...scope,
    ledgerReservedBytes: 600000, ledgerLiveBytes: 12000, currentReservedBytes: 612000, currentLiveBytes: 12000 });
  assert.equal(plan.action, 'recompute-gauge');
  assert.deepEqual(plan.writes, { reservedBytes: 600000, liveBytes: 12000,
    auditEvent: 'storage.maintenance.recompute-gauge:test/tenant-one/one:reserved=600000:live=12000' });
  assert.throws(() => validateMaintenanceAdjustment({ action: 'adjust-quota', ...scope, ledgerReservedBytes: 0, ledgerLiveBytes: 0, currentReservedBytes: 1, currentLiveBytes: 0 }),
    { code: 'MAINTENANCE_ACTION_INVALID' }, 'only the bounded recompute action is valid');
  assert.throws(() => validateMaintenanceAdjustment({ action: 'recompute-gauge', ...scope, ledgerReservedBytes: -1, ledgerLiveBytes: 0, currentReservedBytes: 0, currentLiveBytes: 0 }),
    { code: 'MAINTENANCE_ADJUSTMENT_INVALID' }, 'negative ledger values rejected');
  assert.throws(() => validateMaintenanceAdjustment({ action: 'recompute-gauge', ...scope, ledgerReservedBytes: 0, ledgerLiveBytes: 0, currentReservedBytes: 0, currentLiveBytes: 0 }),
    { code: 'MAINTENANCE_NOOP' }, 'no-op adjustments rejected');
  assert.throws(() => validateMaintenanceAdjustment({ action: 'recompute-gauge', deployment: 'test', tenantId: 'tenant one!', namespaceId: 'one',
    ledgerReservedBytes: 0, ledgerLiveBytes: 0, currentReservedBytes: 1, currentLiveBytes: 0 }), 'scope identifiers validated');
});

test('#91 formatBytes and nextReclamationAt helpers', () => {
  assert.equal(formatBytes(256 * 1024 * 1024), '256 MiB');
  assert.equal(formatBytes(600000), '586 KiB');
  assert.equal(nextReclamationAt(0, 1000, 0), 86400000, '24h minimum hold dominates');
  assert.equal(quotaExceededSummary({ limitBytes: 1, metadataBytes: 0, liveBytes: 0, reservedBytes: 0, totalBytes: 0,
    pendingCleanupBytes: 0, nextReclamationAt: null, overdueCount: 0, pendingCleanup: [], deployment: 't', tenantId: 't', namespaceId: 'n', at: '' }, 1).includes('no pending objects'), true);
});

test('#91 expired unpinned reservation is an overdue cleanup obligation even before retirement', async t => {
  const f = await fixture(t); await f.reserve([f.plan(10000)]);
  const b = await f.breakdown(0, Date.now() + 90000000);
  assert.equal(b.overdueCount, 1); assert.equal(b.pendingCleanup[0].state, 'reserved');
});

test('#91 source reference protects storage through its expiry; namespace and owner must match', async t => {
  const f = await fixture(t), ctx = f.contexts[0];
  const plan = f.ledger.plan(ctx, { capacityBytes: 10000, purpose: 'source', mediaType: 'text/csv', checksum: digest });
  await f.reserve([plan]); await f.db.transaction(c => f.ledger.bind(c, ctx, plan.id, { version: 'v1', bytes: 100, checksum: digest }));
  const expiry = Date.now() + 180000000;
  const body = JSON.stringify({ binding: { version: 4, objectId: plan.id, state: 'active', expiresAt: new Date(expiry).toISOString() } });
  await f.db.transaction(c => c.query("UPDATE h1_resources SET body = ? WHERE tenant_id = ? AND namespace_id = ? AND owner_id = ? AND kind = 'source'", [body, ctx.tenantId, ctx.namespaceId, ctx.userId]));
  const b = await f.breakdown();
  assert.equal(b.pendingCleanup.length, 0); assert.equal(b.protectedBytes, 100);
  assert.deepEqual(b.protectedObjects[0].protections, ['source']); assert.equal(b.protectedObjects[0].nextReclamationAt, expiry);
  assert.equal(b.nextReclamationAt, null, 'live source is not pending cleanup');
  const later = await f.breakdown(0, expiry + 1); assert.equal(later.pendingCleanup.length, 1); assert.equal(later.overdueCount, 1);
});

test('#91 SQLite diagnostic cannot create a missing database or run an unbounded inspection', async t => {
  const { inspectSqlite } = await import('../dist/storage-inspection.js');
  const f = await fixture(t);
  await assert.rejects(inspectSqlite(f.path + '.missing', { deployment: 'test', tenantId: f.contexts[0].tenantId, namespaceId: 'one' }));
  const { access } = await import('node:fs/promises'); await assert.rejects(access(f.path + '.missing'));
  const { inspectPostgres } = await import('../dist/storage-inspection.js');
  await assert.rejects(inspectPostgres('postgresql://user@localhost/test?sslmode=disable', '-----BEGIN CERTIFICATE-----', { deployment: 'test', tenantId: 'tenant', namespaceId: 'one' }), { code: 'STORAGE_INSPECT_CONFIG_INVALID' });
});

test('#91 real TLS PostgreSQL CLI matches SQLite, enforces read-only snapshots and disposes failed connections',
  { skip: process.env.DATABASE_URL && process.env.OPENSIGHT_TEST_POSTGRES_CA ? false : 'live TLS PostgreSQL is not configured' }, async t => {
    const { Pool } = await import('pg');
    const { readFile } = await import('node:fs/promises');
    const ca = await readFile(process.env.OPENSIGHT_TEST_POSTGRES_CA, 'utf8');
    const admin = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { ca, rejectUnauthorized: true }, max: 1 });
    const name = 'storage_' + randomUUID().replaceAll('-', '');
    let pool;
    t.after(async () => { await pool?.end(); await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.end(); });
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(process.env.DATABASE_URL); url.pathname = '/' + name;
    pool = new Pool({ connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true }, max: 1 });
    const f = await fixture(t); await f.reserve([f.plan(600000)]);
    // The fixture uses production migrations. Copy their real DDL/data, not a hand-written substitute schema.
    await f.db.transaction(async c => {
      for (const { name, sql } of await c.query("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid")) {
        await pool.query(sql);
        for (const row of await c.query(`SELECT * FROM ${name}`)) {
          const cols = Object.keys(row); await pool.query(`INSERT INTO ${name} (${cols.map(c => '"' + c + '"').join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})`, Object.values(row));
        }
      }
    });
    // Make the real query refuse to operate unless the CLI has established the promised transaction properties.
    await pool.query('ALTER TABLE sr_limits RENAME TO sr_limits_backing');
    await pool.query(`CREATE FUNCTION inspection_guard() RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN
      IF current_setting('transaction_read_only') <> 'on' OR current_setting('transaction_isolation') <> 'repeatable read'
      THEN RAISE EXCEPTION 'read-only snapshot missing'; END IF;
      BEGIN UPDATE sr_storage_usage SET reserved_bytes = reserved_bytes; RAISE EXCEPTION 'write unexpectedly allowed';
      EXCEPTION WHEN read_only_sql_transaction THEN NULL; END; RETURN true; END $$`);
    await pool.query('CREATE VIEW sr_limits AS SELECT * FROM sr_limits_backing WHERE inspection_guard()');
    const run = promisify(execFile), env = { ...process.env, OPENSIGHT_METADATA_DATABASE: '', OPENSIGHT_METADATA_POSTGRES: url.toString(), OPENSIGHT_POSTGRES_CA: ca };
    const args = [cli, '--deployment', 'test', '--tenant', f.contexts[0].tenantId, '--namespace', 'one'];
    const { stdout } = await run(process.execPath, args, { env }); const b = JSON.parse(stdout);
    const sqlite = await f.breakdown(); assert.equal(b.reservedBytes, sqlite.reservedBytes); assert.equal(b.liveBytes, sqlite.liveBytes);
    assert.deepEqual(b.pendingCleanup, sqlite.pendingCleanup); assert.equal(b.gaugeMatchesLedger, true);
    const missing = await run(process.execPath, [cli, '--deployment', 'missing', '--tenant', 'tenant', '--namespace', 'one'], { env }).then(() => null, e => e);
    assert.equal(missing.code, 1); assert.doesNotMatch(missing.stderr, /postgresql:|password/);
    const invalidCA = await run(process.execPath, args, { env: { ...env, OPENSIGHT_POSTGRES_CA: ca.replace('CERTIFICATE', 'INVALID') } }).then(() => null, e => e);
    assert.equal(invalidCA.code, 1);
    const foreignCA = new URL('../../../ops/serverless/rds-ca.pem', import.meta.url).pathname;
    const wrongCA = await run(process.execPath, args, { env: { ...env, OPENSIGHT_POSTGRES_CA: '', OPENSIGHT_POSTGRES_CA_FILE: foreignCA } }).then(() => null, e => e);
    assert.equal(wrongCA.code, 1);
    const other = await run(process.execPath, [cli, '--deployment', 'test', '--tenant', f.contexts[1].tenantId, '--namespace', 'two'], { env });
    assert.equal(JSON.parse(other.stdout).reservedBytes, 0);
    const connections = await pool.query("SELECT count(*) FROM pg_stat_activity WHERE application_name = 'opensight-storage-inspect' AND datname = current_database()");
    assert.equal(Number(connections.rows[0].count), 0);
  });
