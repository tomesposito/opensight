import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { h8Fixture, referenceEnv, serveH8 } from './h8-helpers.mjs';
import { coordinationFixture } from './coordination-helpers.mjs';
import { HostedUsage, initializeUsage, resourceBytes } from '../dist/hosted-usage.js';
import { SqliteMetadataDatabase, PostgresMetadataDatabase } from '../dist/metadata-db.js';
import { MetadataOperator, checksum } from '../dist/metadata-operator.js';
import { TenantMetadata } from '../dist/metadata.js';
import { migrateReference } from '../dist/single-node.js';
import { ReferenceMaintenance } from '../dist/single-node-maintenance.js';
import { initializeJobs } from '../dist/job-schema.js';
import { migrateServerless } from '../dist/serverless-migration.js';
import { snapshotServerless, restoreServerless, migrateRegistered } from '../dist/serverless-backup.js';
import { seedSources } from './source-helpers.mjs';
import { drainHostedServer } from '../dist/hosted-server.js';

const one = { tenantId: 'tenant-one', namespaceId: 'one' };
const two = { tenantId: 'tenant-two', namespaceId: 'two' };
const config = JSON.parse(referenceEnv.OPENSIGHT_ENTITLEMENTS);
const month = '2026-10';
const unresolved = { code: 'ENTITLEMENT_UNRESOLVED', status: 503 };
async function setup(t) {
  const f = await h8Fixture(t); await initializeUsage(f.db); await initializeUsage(f.db);
  let now = Date.UTC(2026, 9, 3);
  const usage = new HostedUsage(f.db, config, () => now);
  return { ...f, usage, at: time => { now = Date.parse(time); } };
}
async function daily(db, scope, period, metric, admitted, denied = 0) {
  await db.transaction(c => c.query('INSERT INTO h8_usage VALUES (?,?,?,?,?,?)', [scope.tenantId, scope.namespaceId, period, metric, admitted, denied]));
}
async function counters(db) {
  return db.transaction(async c => ({ daily: await c.query('SELECT * FROM h8_usage ORDER BY tenant_id, period, metric'),
    events: await c.query('SELECT * FROM h8_usage_events ORDER BY event_id') }));
}

test('monthly rollup sums admitted and denied counts across days, excludes adjacent months and other metrics, and recomputes exactly', async t => {
  const f = await setup(t);
  for (const [period, metric, admitted, denied] of [
    ['2026-09-30', 'apiCalls', 1000, 1000], ['2026-11-01', 'computeAttempts', 2000, 2000],
    ['2026-10-01', 'apiCalls', 10, 2], ['2026-10-31', 'apiCalls', 20, 3],
    ['2026-10-01', 'computeAttempts', 4, 1], ['2026-10-17', 'computeAttempts', 5, 2],
    ['2026-10-03', 'aiCalls', 999, 999], ['2026-10-03', 'aiTokens', 9999, 0],
  ]) await daily(f.db, one, period, metric, admitted, denied);
  const before = await counters(f.db), first = await f.usage.rollupMonthlyUsage(one, month);
  assert.equal(first.apiCallsAdmitted, 30); assert.equal(first.apiCallsDenied, 5);
  assert.equal(first.computeAttemptsAdmitted, 9); assert.equal(first.computeAttemptsDenied, 3);
  assert.equal(first.egressBytes, 0);
  assert.deepEqual(await f.usage.rollupMonthlyUsage(one, month), first);
  assert.deepEqual(await counters(f.db), before);
  await daily(f.db, one, '2026-10-20', 'apiCalls', 7, 4);
  const updated = await f.usage.rollupMonthlyUsage(one, month);
  assert.deepEqual(updated, { ...first, apiCallsAdmitted: 37, apiCallsDenied: 9 });
  assert.deepEqual(await f.usage.rollupMonthlyUsage(one, month), updated);
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h8_monthly_usage'))).length, 1);
});

test('storage snapshots are current gauges, refreshed rather than summed even for past months', async t => {
  const f = await setup(t), bytes = await f.db.transaction(c => resourceBytes(c, one));
  assert.ok(bytes > 0);
  const first = await f.usage.rollupMonthlyUsage(one, '2026-09');
  assert.equal(first.storageBytes, bytes); assert.equal(first.storageAsOf, '2026-10-03T00:00:00.000Z');
  f.at('2026-10-04T12:00:00Z');
  const second = await f.usage.rollupMonthlyUsage(one, '2026-09');
  assert.equal(second.storageBytes, bytes); assert.equal(second.storageAsOf, '2026-10-04T12:00:00.000Z');
  await f.db.transaction(c => c.query("UPDATE h1_resources SET body = body || ' ' WHERE tenant_id = ? AND namespace_id = ?", [one.tenantId, one.namespaceId]));
  const current = await f.db.transaction(c => resourceBytes(c, one));
  assert.ok(current > bytes);
  assert.equal((await f.usage.rollupMonthlyUsage(one, '2026-09')).storageBytes, current);
});

test('recorded egress uses exact daily bytes and metadata-only events, with UTC month isolation and no invented traffic', async t => {
  const f = await setup(t);
  f.at('2026-09-30T23:59:59.999Z'); await f.usage.recordEgressBytes(one, 10000);
  f.at('2026-10-01T00:00:00.000Z'); await f.usage.recordEgressBytes(one, 12);
  const other = new HostedUsage(f.db, config, f.usage.clock);
  await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? f.usage : other).recordEgressBytes(one, 3)));
  f.at('2026-10-31T23:59:59.999Z'); await f.usage.recordEgressBytes(one, 17); await f.usage.recordEgressBytes(one, 0);
  f.at('2026-11-01T00:00:00.000Z'); await f.usage.recordEgressBytes(one, 20000);
  await daily(f.db, two, '2026-10-02', 'apiCalls', 999);
  assert.equal((await f.usage.rollupMonthlyUsage(one, month)).egressBytes, 65);
  assert.equal((await f.usage.rollupMonthlyUsage(two, month)).egressBytes, 0);
  const events = (await counters(f.db)).events;
  assert.equal(events.length, 17);
  assert.ok(events.every(e => e.metric === 'egressBytes' && e.unit === 'byte' && e.outcome === 'admitted'));
  assert.deepEqual(Object.keys(events[0]).sort(), ['event_id', 'tenant_id', 'namespace_id', 'created_at', 'metric', 'unit', 'amount', 'outcome'].sort());
});

test('invalid, corrupt and overflowing egress amounts fail closed atomically', async t => {
  const f = await setup(t);
  for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null]) await assert.rejects(f.usage.recordEgressBytes(one, amount), unresolved);
  assert.deepEqual(await counters(f.db), { daily: [], events: [] });
  await f.usage.recordEgressBytes(one, Number.MAX_SAFE_INTEGER);
  const before = await counters(f.db);
  await assert.rejects(f.usage.recordEgressBytes(one, 1), unresolved);
  assert.deepEqual(await counters(f.db), before);
  assert.equal((await f.usage.rollupMonthlyUsage(one, month)).egressBytes, Number.MAX_SAFE_INTEGER);
  await f.db.transaction(c => c.query('UPDATE h8_usage SET admitted = -1'));
  await assert.rejects(f.usage.recordEgressBytes(one, 0), unresolved);
});

test('egress event failure rolls back its daily counter', async t => {
  const f = await setup(t);
  await f.db.transaction(c => c.query("CREATE TRIGGER fail_egress BEFORE INSERT ON h8_usage_events BEGIN SELECT RAISE(ABORT, 'unavailable'); END"));
  await assert.rejects(f.usage.recordEgressBytes(one, 12), unresolved);
  assert.deepEqual(await counters(f.db), { daily: [], events: [] });
});

test('billing isolates tenants, reports suspended tenants, and reads unrolled months explicitly without writes', async t => {
  const f = await setup(t);
  await daily(f.db, one, '2026-10-01', 'apiCalls', 11, 1);
  await daily(f.db, two, '2026-10-01', 'apiCalls', 22, 2);
  await daily(f.db, two, '2026-10-01', 'computeAttempts', 5, 4);
  const before = await counters(f.db);
  const empty = await f.usage.monthlyUsage(one, month);
  assert.deepEqual(await f.usage.monthlyUsage({ ...one, userId: 'must-not-leak' }, month), empty);
  assert.deepEqual(empty, { ...one, period: month, apiCallsAdmitted: 0, apiCallsDenied: 0,
    computeAttemptsAdmitted: 0, computeAttemptsDenied: 0, storageBytes: 0, storageAsOf: null, egressBytes: 0 });
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h8_monthly_usage'))).length, 0);
  await f.db.transaction(c => c.query("UPDATE h1_tenants SET state = 'suspended' WHERE tenant_id = ?", [two.tenantId]));
  const records = await f.usage.rollupMonthlyUsageForPeriod(month);
  assert.deepEqual(records.map(r => [r.tenantId, r.namespaceId, r.apiCallsAdmitted, r.apiCallsDenied, r.computeAttemptsAdmitted, r.computeAttemptsDenied]),
    [['tenant-one', 'one', 11, 1, 0, 0], ['tenant-two', 'two', 22, 2, 5, 4]]);
  assert.deepEqual(await f.usage.monthlyUsageForPeriod(month), records);
  assert.deepEqual(await f.usage.monthlyUsage({ ...one, userId: 'must-not-leak' }, month), records[0]);
  assert.deepEqual(await f.usage.monthlyUsageForPeriod(month, one.tenantId), [records[0]]);
  f.at('2026-11-02T00:00:00Z');
  assert.deepEqual(await f.usage.monthlyUsage(one, month), records[0]);
  assert.deepEqual(await counters(f.db), before);
});

test('monthly methods strictly validate periods and fail closed for missing or mismatched scopes', async t => {
  const f = await setup(t);
  for (const invalid of ['', '2026', '2026-1', '2026-00', '2026-13', '0000-10', '2026-10-01', '2026-10\n', ' 2026-10', '2026-10x', undefined]) {
    for (const method of ['monthlyUsage', 'rollupMonthlyUsage']) await assert.rejects(f.usage[method](one, invalid), { code: 'USAGE_PERIOD_INVALID', status: 400 });
    for (const method of ['monthlyUsageForPeriod', 'rollupMonthlyUsageForPeriod']) await assert.rejects(f.usage[method](invalid), { code: 'USAGE_PERIOD_INVALID' });
  }
  for (const method of ['monthlyUsage', 'rollupMonthlyUsage']) {
    await assert.rejects(f.usage[method]({ ...one, tenantId: 'absent' }, month), { code: 'TENANT_UNAVAILABLE' });
    await assert.rejects(f.usage[method]({ ...one, namespaceId: two.namespaceId }, month), unresolved);
  }
  await assert.rejects(f.usage.monthlyUsageForPeriod(month, 'absent'), { code: 'TENANT_UNAVAILABLE' });
  await assert.rejects(f.usage.recordEgressBytes({ ...one, namespaceId: two.namespaceId }, 1), unresolved);
  await assert.rejects(f.usage.recordEgressBytes({ ...one, tenantId: 'absent' }, 1), { code: 'TENANT_UNAVAILABLE' });
  await f.db.transaction(c => c.query("UPDATE h1_tenants SET state = 'deleted', tombstone = 'billing-test' WHERE tenant_id = ?", [one.tenantId]));
  await assert.rejects(f.usage.monthlyUsage(one, month), { code: 'TENANT_UNAVAILABLE' });
  assert.deepEqual((await f.usage.monthlyUsageForPeriod(month)).map(r => r.tenantId), [two.tenantId]);
});

test('corrupt daily values, unsafe monthly sums and corrupt persisted snapshots fail closed without replacing good records', async t => {
  const f = await setup(t);
  const baseline = await f.usage.rollupMonthlyUsage(one, month);
  for (const [admitted, denied] of [[-1, 0], [1, -1], [1.5, 0], [1, 1.5], ['corrupt', 0], [9007199254740992, 0]]) {
    await daily(f.db, one, '2026-10-01', 'apiCalls', admitted, denied);
    await assert.rejects(f.usage.rollupMonthlyUsage(one, month), unresolved);
    assert.deepEqual(await f.usage.monthlyUsage(one, month), baseline);
    await f.db.transaction(c => c.query('DELETE FROM h8_usage'));
  }
  for (const metric of ['apiCalls', 'computeAttempts', 'egressBytes']) {
    await daily(f.db, one, '2026-10-01', metric, Number.MAX_SAFE_INTEGER);
    await daily(f.db, one, '2026-10-02', metric, 1);
    await assert.rejects(f.usage.rollupMonthlyUsage(one, month), unresolved);
    await f.db.transaction(c => c.query('DELETE FROM h8_usage'));
  }
  await daily(f.db, one, '2026-10-01', 'computeAttempts', 0, Number.MAX_SAFE_INTEGER);
  await daily(f.db, one, '2026-10-02', 'computeAttempts', 0, 1);
  await assert.rejects(f.usage.rollupMonthlyUsage(one, month), unresolved);
  await f.db.transaction(c => c.query('UPDATE h8_monthly_usage SET storage_bytes = -1'));
  await assert.rejects(f.usage.monthlyUsage(one, month), unresolved);
  await f.db.transaction(c => c.query("UPDATE h8_monthly_usage SET storage_bytes = 0, storage_as_of = 'invalid'"));
  await assert.rejects(f.usage.monthlyUsage(one, month), unresolved);
});

test('monthly record survives a fresh instance and database connection, including after daily retention', async t => {
  const f = await setup(t);
  await daily(f.db, one, '2026-10-01', 'apiCalls', 12, 2);
  const record = await f.usage.rollupMonthlyUsage(one, month);
  const reopened = new SqliteMetadataDatabase(f.path);
  try {
    const restarted = new HostedUsage(reopened, config);
    assert.deepEqual(await restarted.monthlyUsage(one, month), record);
    await reopened.transaction(c => c.query('DELETE FROM h8_usage'));
    assert.deepEqual(await restarted.monthlyUsage(one, month), record);
  } finally { await reopened.close(); }
});

test('operator usage routes require the key and no Origin, validate periods, and expose stored reads plus explicit rollups', async t => {
  const f = await setup(t); f.env = { ...f.env, ...referenceEnv };
  const { server, request, operator } = await serveH8(t, f);
  try {
  const path = `/api/host/usage/${month}`;
  for (const headers of [{}, { authorization: 'one' }, { authorization: 'Embed forged' }, { authorization: 'Operator invalid' }, { ...operator, origin: f.env.OPENSIGHT_PUBLIC_ORIGIN }]) {
    for (const method of ['GET', 'POST']) {
      const result = await request(path, { headers, method, ...(method === 'POST' ? { body: {} } : {}) });
      assert.equal(result.status, 403); assert.equal(result.body.errorCode, 'OPERATOR_REQUIRED');
    }
  }
  for (const invalid of ['', '/2026-00', '/2026-13', '/2026-1', '/0000-01', '/2026-10-01']) {
    const result = await request(`/api/host/usage${invalid}`, { headers: operator });
    assert.equal(result.status, 400); assert.equal(result.body.errorCode, 'USAGE_PERIOD_INVALID');
  }
  await daily(f.db, one, '2026-10-01', 'apiCalls', 12, 3);
  const before = await counters(f.db), empty = await request(path, { headers: operator });
  assert.equal(empty.status, 200); assert.equal(empty.body.records.length, 2);
  assert.ok(empty.body.records.every(r => r.storageAsOf === null));
  const rolled = await request(path, { headers: operator, method: 'POST', body: {} });
  assert.equal(rolled.status, 200); assert.equal(rolled.body.period, month);
  assert.equal(rolled.body.records[0].apiCallsAdmitted, 12);
  assert.deepEqual((await request(path, { headers: operator })).body, rolled.body);
  const filtered = await request(`${path}/tenants/${one.tenantId}`, { headers: operator });
  assert.deepEqual(filtered.body.records, [rolled.body.records[0]]);
  assert.equal((await request(`${path}/tenants/absent`, { headers: operator })).body.errorCode, 'TENANT_UNAVAILABLE');
  assert.deepEqual(await counters(f.db), before);
  assert.equal((await request(`/api/namespaces/one/host/usage/${month}`, { headers: { authorization: 'one' } })).body.errorCode, 'HOSTED_CAPABILITY_UNAVAILABLE');
  } finally { await drainHostedServer(server); }
});

test('invocation mode hides billing routes even with valid operator credentials', async t => {
  const f = await setup(t); await initializeJobs(f.db);
  const { server, request, operator } = await serveH8(t, f, { invocation: { usage: f.usage, signal: new AbortController().signal } });
  try {
  for (const method of ['GET', 'POST']) for (const headers of [{}, operator]) {
    const result = await request(`/api/host/usage/${month}`, { headers, method, ...(method === 'POST' ? { body: {} } : {}) });
    assert.equal(result.status, 404); assert.equal(result.body.errorCode, 'RESOURCE_NOT_FOUND');
  }
  } finally { await drainHostedServer(server); }
});

test('billing reads and rollups leave existing quota denial behavior and enforcement counters unchanged', async t => {
  const f = await setup(t), usage = new HostedUsage(f.db, { defaults: { ...config.defaults, apiCalls: 1, computeAttempts: 1 }, tenants: {} }, f.usage.clock);
  const metadata = new TenantMetadata(f.db, f.db, usage), context = await metadata.authenticate(null, async () => ({ namespaceId: 'one', userId: 'admin' }));
  for (const metric of ['apiCalls', 'computeAttempts']) {
    await usage.consume(metadata, context, metric);
    await assert.rejects(usage.consume(metadata, context, metric), { code: 'USAGE_LIMIT_EXCEEDED', status: 429 });
  }
  const before = await counters(f.db);
  await usage.monthlyUsageForPeriod(month); const record = await usage.rollupMonthlyUsage(one, month);
  assert.deepEqual([record.apiCallsAdmitted, record.apiCallsDenied, record.computeAttemptsAdmitted, record.computeAttemptsDenied], [1, 1, 1, 1]);
  await usage.monthlyUsage(one, month); assert.deepEqual(await counters(f.db), before);
  await assert.rejects(usage.consume(metadata, context, 'apiCalls'), { code: 'USAGE_LIMIT_EXCEEDED' });
});

test('single-node backups preserve monthly records, daily retention keeps them and tenant erasure removes only its records', async t => {
  const f = await setup(t); await migrateReference(f.db, referenceEnv, 'sqlite');
  await daily(f.db, one, '2026-10-01', 'apiCalls', 10);
  const records = await f.usage.rollupMonthlyUsageForPeriod(month);
  const directory = await mkdtemp(join(tmpdir(), 'billing-maintenance-')), key = randomBytes(32);
  const maintenance = await ReferenceMaintenance.open(f.db, join(directory, 'backups'), key, 'frozen');
  const target = new SqliteMetadataDatabase(join(directory, 'target.sqlite'));
  t.after(async () => { await target.close(); await rm(directory, { recursive: true, force: true }); });
  const backup = await maintenance.backup();
  await migrateReference(target, referenceEnv, 'sqlite');
  await (await ReferenceMaintenance.open(target, join(directory, 'backups'), key, 'frozen')).restore(backup.id);
  assert.deepEqual(await new HostedUsage(target, config).monthlyUsageForPeriod(month), records);
  await maintenance.retain(0, 30, Date.UTC(2027, 0, 1));
  assert.equal((await counters(f.db)).daily.length, 0);
  assert.deepEqual(await f.usage.monthlyUsageForPeriod(month), records);
  await new MetadataOperator(f.db).transition('billing-delete', one.tenantId, 'delete', 1);
  await maintenance.deleteTenant('billing-delete', 'none');
  assert.deepEqual((await f.db.transaction(c => c.query('SELECT tenant_id FROM h8_monthly_usage'))).map(r => r.tenant_id), [two.tenantId]);
});

test('serverless migration and backup inventory preserve billing snapshots, accept pre-billing databases and include object storage gauges', async t => {
  const f = await coordinationFixture(t, { migrate: false }), env = { ...f.env, OPENSIGHT_ENTITLEMENTS: JSON.stringify(f.entitlements) };
  await migrateServerless(f.db, env, 'sqlite');
  const usage = new HostedUsage(f.db, f.entitlements, () => Date.UTC(2026, 9, 3), 'test');
  await f.db.transaction(c => c.query('INSERT INTO sr_storage_usage (deployment, tenant_id, namespace_id, reserved_bytes, live_bytes) VALUES (?,?,?,?,?) ON CONFLICT (deployment, tenant_id, namespace_id) DO UPDATE SET reserved_bytes = excluded.reserved_bytes, live_bytes = excluded.live_bytes', ['test', one.tenantId, one.namespaceId, 17, 23]));
  await usage.recordEgressBytes(one, 12);
  const record = await usage.rollupMonthlyUsage(one, month);
  assert.equal(record.storageBytes, await f.db.transaction(c => resourceBytes(c, one)) + 40);
  const snapshot = await snapshotServerless(f.db, 'test', randomUUID(), Date.now() + 3600000, ['a'.repeat(32)], 'sqlite');
  assert.equal(snapshot.tables.h8_monthly_usage.length, 1);
  const registry = { version: 1, revision: 1, epoch: 1, fence: snapshot.fence, completeThroughEpoch: 1,
    backups: { [snapshot.id]: checksum(snapshot) }, deletedTenants: [], retiredKeyVersions: [] };
  await migrateRegistered(f.db, env, snapshot, registry, randomUUID(), 'sqlite');
  const directory = await mkdtemp(join(tmpdir(), 'billing-serverless-')), target = new SqliteMetadataDatabase(join(directory, 'target.sqlite'));
  t.after(async () => { await target.close(); await rm(directory, { recursive: true, force: true }); });
  await migrateServerless(target, env, 'sqlite');
  await restoreServerless(target, snapshot, { ...registry, epoch: 2 }, 'sqlite');
  assert.deepEqual(await new HostedUsage(target, config).monthlyUsage(one, month), record);
  await f.db.transaction(c => c.query('DROP TABLE h8_monthly_usage'));
  const legacy = await snapshotServerless(f.db, 'test', randomUUID(), Date.now() + 3600000, ['a'.repeat(32)], 'sqlite');
  assert.equal(Object.hasOwn(legacy.tables, 'h8_monthly_usage'), false);
  const legacyRegistry = { ...registry, backups: { [legacy.id]: checksum(legacy) } }, operation = randomUUID();
  assert.equal((await migrateRegistered(f.db, env, legacy, legacyRegistry, operation, 'sqlite')).replayed, false);
  assert.equal((await migrateRegistered(f.db, env, legacy, legacyRegistry, operation, 'sqlite')).replayed, true);
  assert.deepEqual(await f.db.transaction(c => c.query('SELECT * FROM h8_monthly_usage')), []);
  const oldTarget = new SqliteMetadataDatabase(join(directory, 'legacy.sqlite'));
  try {
    await migrateServerless(oldTarget, env, 'sqlite');
    await restoreServerless(oldTarget, legacy, { ...legacyRegistry, epoch: 2 }, 'sqlite');
    assert.equal((await new HostedUsage(oldTarget, config).monthlyUsage(one, month)).storageAsOf, null);
  } finally { await oldTarget.close(); }
});

test('readiness fails when the monthly billing migration is missing', async t => {
  const f = await setup(t); f.env = { ...f.env, ...referenceEnv };
  const { server, request, operator } = await serveH8(t, f);
  try {
  assert.equal((await request('/readyz', { headers: operator })).status, 200);
  await f.db.transaction(c => c.query('DROP TABLE h8_monthly_usage'));
  assert.equal((await request('/readyz', { headers: operator })).body.errorCode, 'MIGRATIONS_REQUIRED');
  } finally { await drainHostedServer(server); }
});

test('live Postgres monthly billing serializes concurrent meters, preserves exact totals and stays private to the operator',
  { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set' }, async t => {
    const schema = `billing_${randomUUID().replaceAll('-', '')}`, role = `${schema}_tenant`;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 6, options: `-c search_path=${schema}` });
    t.after(async () => { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.query(`DROP ROLE IF EXISTS ${role}`); await pool.end(); });
    await pool.query(`CREATE SCHEMA ${schema}`);
    const db = new PostgresMetadataDatabase(pool);
    await migrateReference(db, referenceEnv); await seedSources(db); await initializeUsage(db);
    const clock = () => Date.UTC(2026, 9, 3), usage = new HostedUsage(db, config, clock), other = new HostedUsage(db, config, clock);
    await daily(db, one, '2026-09-30', 'apiCalls', 999, 999);
    await daily(db, one, '2026-10-01', 'apiCalls', 10, 2);
    await daily(db, one, '2026-10-02', 'apiCalls', 20, 3);
    await daily(db, one, '2026-10-01', 'computeAttempts', 4, 1);
    await daily(db, one, '2026-11-01', 'computeAttempts', 999, 999);
    await daily(db, two, '2026-10-01', 'apiCalls', 5, 6);
    await Promise.all(Array.from({ length: 32 }, (_, i) => (i % 2 ? usage : other).recordEgressBytes(one, 7)));
    const records = await usage.rollupMonthlyUsageForPeriod(month);
    assert.deepEqual(records.map(r => [r.apiCallsAdmitted, r.apiCallsDenied, r.computeAttemptsAdmitted, r.computeAttemptsDenied, r.egressBytes]), [[30, 5, 4, 1, 224], [5, 6, 0, 0, 0]]);
    assert.deepEqual(await other.rollupMonthlyUsage(one, month), records[0]);
    assert.deepEqual(await new HostedUsage(db, config).monthlyUsageForPeriod(month), records);
    await daily(db, one, '2026-10-04', 'computeAttempts', Number.MAX_SAFE_INTEGER);
    await assert.rejects(usage.rollupMonthlyUsage(one, month), unresolved);
    assert.deepEqual(await usage.monthlyUsage(one, month), records[0]);
    await pool.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS`);
    await pool.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE ${role}`);
      await assert.rejects(client.query('SELECT * FROM h8_monthly_usage'), { code: '42501' });
      await assert.rejects(client.query('DELETE FROM h8_monthly_usage'), { code: '42501' });
    } finally { await client.query('RESET ROLE'); client.release(); }
  });
