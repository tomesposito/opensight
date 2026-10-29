import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinationFixture } from './coordination-helpers.mjs';
import { migrateV1Durable } from '../dist/v1-durable-schema.js';
import { DurableV1 } from '../dist/v1-durable.js';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { PostgresMetadataDatabase } from '../dist/metadata-db.js';
import { TenantMetadata } from '../dist/metadata.js';
import { migrateServerless } from '../dist/serverless-migration.js';
import { environment } from './hosted-helpers.mjs';
import { runtimeEnv } from './runtime-helpers.mjs';
import { referenceEnv } from './h8-helpers.mjs';
import { seedSources } from './source-helpers.mjs';

async function fixture(t, env = {}) {
  const f = await coordinationFixture(t);
  await migrateV1Durable(f.db, 'test', 'sqlite'); await f.open();
  return { ...f, store: (index = 0, overrides = {}) => new DurableV1(f.db, f.metadata, f.contexts[index], 'test', { ...env, ...overrides }, 'sqlite'),
    rows: table => f.db.transaction(c => c.query(`SELECT * FROM ${table}`)) };
}
const definition = { AnalysisId: 'draft', Name: 'Draft', Definition: { DataSetIdentifierDeclarations: [], Sheets: [] } };
async function write(f, reservation, id = 'draft') {
  const context = f.contexts[0], stamp = await f.metadata.revisions(context);
  await f.metadata.mutateAnalysis(context, id, { definition, datasets: [] }, 0, stamp, reservation);
}
test('D-86 rate windows survive invocation replacement and isolate tenants', async t => {
  const f = await fixture(t, { OPENSIGHT_V1_RATE_LIMIT_PER_MINUTE: '2' });
  assert.equal((await f.store().take()).allowed, true);
  assert.equal((await f.store().take()).allowed, true);
  const denied = await f.store().take(); assert.equal(denied.allowed, false); assert.ok(denied.retryAfter >= 1 && denied.retryAfter <= 60);
  assert.equal((await f.store(1).take()).allowed, true);
  await f.db.transaction(c => c.query('UPDATE sr_v1_rates SET reset_at = 1'));
  assert.equal((await f.store().take()).allowed, true);
});
test('D-86 pending keys serialize independent invocations and scope receipts to tenants', async t => {
  const f = await fixture(t), a = f.store(), b = f.store();
  const attempts = await Promise.allSettled([a.reserve('tenant-one', 'same'), b.reserve('tenant-one', 'same')]);
  assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(x => x.status === 'rejected').reason.code, 'IDEMPOTENCY_IN_PROGRESS');
  const r = attempts.find(x => x.status === 'fulfilled').value; r.prepare({ result: 'one' }); await r.commit(); await r.release();
  assert.deepEqual(await f.store().get('same'), { result: 'one' });
  assert.equal(await f.store(1).get('same'), undefined);
  const other = await f.store(1).reserve('tenant-two', 'same'); await other.release();
  await assert.rejects(f.store().reserve('tenant-two', 'forged'), { code: 'TENANT_CONTEXT_REQUIRED' });
});
test('D-86 a business write and receipt survive a lost response before route completion', async t => {
  const f = await fixture(t), r = await f.store().reserve('tenant-one', 'analysis-save');
  r.prepare({ id: 'draft', version: 1 }); await write(f, r);
  // Simulate process death before reservation.commit() or HTTP response.
  assert.deepEqual(await f.store().get('analysis-save'), { id: 'draft', version: 1 });
  assert.equal((await f.metadata.get(f.contexts[0], { kind: 'analysis', id: 'draft' })).version, 1);
  await r.release(); assert.deepEqual(await f.store().get('analysis-save'), { id: 'draft', version: 1 });
});
test('D-86 receipt capacity failure rolls back the analysis and outbox atomically', async t => {
  const f = await fixture(t, { OPENSIGHT_RETRY_CACHE_MAX_BYTES: '5' }), r = await f.store().reserve('tenant-one', 'oversize');
  r.prepare({ too: 'large' }); const before = await f.rows('h1_outbox');
  await assert.rejects(write(f, r), { code: 'IDEMPOTENCY_CAPACITY_EXCEEDED' });
  await assert.rejects(f.metadata.get(f.contexts[0], { kind: 'analysis', id: 'draft' }), { code: 'RESOURCE_NOT_FOUND' });
  assert.deepEqual(await f.rows('h1_outbox'), before);
  assert.equal(await f.store().get('oversize'), undefined); await r.release();
  assert.ok((await f.rows('sr_v1_capacity')).every(r => r.entries === 0 && r.bytes === 0));
});
test('D-86 pending entries count against global and per-tenant caps', async t => {
  const f = await fixture(t, { OPENSIGHT_RETRY_CACHE_MAX_ENTRIES: '2', OPENSIGHT_RETRY_CACHE_PER_TENANT_MAX_ENTRIES: '1' });
  const one = await f.store().reserve('tenant-one', 'one');
  await assert.rejects(f.store().reserve('tenant-one', 'two'), { code: 'IDEMPOTENCY_CAPACITY_EXCEEDED' });
  const two = await f.store(1).reserve('tenant-two', 'one');
  await assert.rejects(f.store(1, { OPENSIGHT_RETRY_CACHE_PER_TENANT_MAX_ENTRIES: '2' }).reserve('tenant-two', 'two'), { code: 'IDEMPOTENCY_CAPACITY_EXCEEDED' });
  await one.release(); await two.release();
});
test('D-86 expired reservations cannot publish after a replacement acquires the key', async t => {
  const f = await fixture(t), old = await f.store().reserve('tenant-one', 'key'); old.prepare({ old: true });
  await f.db.transaction(c => c.query('UPDATE sr_v1_receipts SET expires_at = 1'));
  const next = await f.store().reserve('tenant-one', 'key'); next.prepare({ current: true });
  await assert.rejects(write(f, old), { code: 'IDEMPOTENCY_IN_PROGRESS' }); await old.release();
  await write(f, next); await next.commit();
  assert.deepEqual(await f.store().get('key'), { current: true });
  const global = (await f.rows('sr_v1_capacity')).find(r => r.tenant_id === '');
  assert.equal(global.entries, 1); assert.equal(global.bytes, Buffer.byteLength(JSON.stringify({ current: true })));
});
test('D-86 late transaction failure rolls back receipt, bytes and metadata together', async t => {
  const f = await fixture(t), r = await f.store().reserve('tenant-one', 'rollback'); r.prepare({ id: 'draft' });
  const fail = { persist: async c => { await r.persist(c); throw Error('commit interrupted'); } };
  await assert.rejects(write(f, fail), /commit interrupted/);
  assert.equal(await f.store().get('rollback'), undefined);
  assert.ok((await f.rows('sr_v1_capacity')).every(r => r.bytes === 0));
  await write(f, r); assert.deepEqual(await f.store().get('rollback'), { id: 'draft' });
});
test('D-86 deletion purges receipts and rate windows and releases only that tenant capacity', async t => {
  const f = await fixture(t);
  for (const i of [0, 1]) { const r = await f.store(i).reserve(f.contexts[i].tenantId, 'key'); r.prepare({ private: i }); await r.commit(); await f.store(i).take(); }
  const pending = await f.store().reserve('tenant-one', 'pending'); pending.prepare({ stale: true });
  await f.db.transaction(c => c.query("UPDATE h1_tenants SET state = 'deleting' WHERE tenant_id = 'tenant-one'"));
  assert.ok((await f.rows('sr_v1_receipts')).every(r => r.tenant_id === 'tenant-two'));
  assert.ok((await f.rows('sr_v1_rates')).every(r => r.tenant_id === 'tenant-two'));
  assert.equal((await f.rows('sr_v1_capacity')).find(r => r.tenant_id === '').entries, 1);
  await assert.rejects(pending.commit(), { code: 'IDEMPOTENCY_IN_PROGRESS' });
  await assert.rejects(f.store().reserve('tenant-one', 'new'), { code: 'AUTHORIZATION_REVISED' });
  await assert.rejects(f.store().take(), { code: 'TENANT_UNAVAILABLE' });
});
test('D-86 authoring schema is owner migrated and rejects partial or altered state', async t => {
  const f = await fixture(t);
  await assert.rejects(migrateV1Durable(f.db, 'test', 'sqlite'), { code: 'WORKSPACE_MAINTENANCE_REQUIRED' });
  await f.db.transaction(c => c.query("UPDATE sr_control SET state = 'maintenance'"));
  await migrateV1Durable(f.db, 'test', 'sqlite');
  await f.db.transaction(c => c.query("UPDATE sr_v1_schema SET checksum = 'changed'"));
  await assert.rejects(migrateV1Durable(f.db, 'test', 'sqlite'), { code: 'V1_DURABLE_SCHEMA_INVALID' });
});
test('D-86 live PostgreSQL commits receipts with restricted tenant writes and enforces RLS, quotas and erasure',
  { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set' }, async t => {
    const schema = `v1_${randomUUID().replaceAll('-', '')}`, operator = `${schema}_op`, tenant = `${schema}_tenant`;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, options: `-c search_path=${schema}` });
    const roles = [];
    t.after(async () => { for (const p of roles) await p.end(); await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.query(`DROP ROLE IF EXISTS ${operator}, ${tenant}`); await pool.end(); });
    await pool.query(`CREATE SCHEMA ${schema}`);
    for (const [kind, role] of [['operator', operator], ['tenant', tenant]]) {
      await pool.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT ${kind === 'operator' ? 'BYPASSRLS' : 'NOBYPASSRLS'}`);
      await pool.query(`COMMENT ON ROLE ${role} IS 'opensight:test:${kind}'`);
    }
    const owner = new PostgresMetadataDatabase(pool), env = { ...environment(), ...referenceEnv, ...runtimeEnv(), OPENSIGHT_REFERENCE: undefined,
      OPENSIGHT_RUNTIME_OPERATOR_ROLE: operator, OPENSIGHT_RUNTIME_TENANT_ROLE: tenant };
    await migrateServerless(owner, env); await seedSources(owner);
    await pool.query("UPDATE sr_control SET state = 'open'");
    const dbFor = (role, tenantRole) => {
      const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, options: `-c search_path=${schema}` }); roles.push(p);
      return new PostgresMetadataDatabase({ connect: async () => { const c = await p.connect(); await c.query(`SET ROLE ${role}`); return c; } }, tenantRole);
    };
    const membership = dbFor(operator, false), scoped = dbFor(tenant, true), metadata = new TenantMetadata(scoped, membership);
    const contexts = await Promise.all(['one', 'two'].map(namespaceId => metadata.authenticate(null, async () => ({ namespaceId, userId: 'admin' }))));
    const store = i => new DurableV1(membership, metadata, contexts[i], 'test', { OPENSIGHT_V1_RATE_LIMIT_PER_MINUTE: '1' });
    for (const i of [0, 1]) {
      const reservation = await store(i).reserve(contexts[i].tenantId, 'same'); reservation.prepare({ private: i });
      await metadata.mutateAnalysis(contexts[i], 'draft', { definition, datasets: [] }, 0, await metadata.revisions(contexts[i]), reservation);
      assert.deepEqual(await store(i).get('same'), { private: i });
      const visible = await scoped.transaction(c => c.query('SELECT tenant_id, body FROM sr_v1_receipts'), contexts[i]);
      assert.equal(visible.length, 1); assert.equal(visible[0].tenant_id, contexts[i].tenantId);
      assert.equal((await store(i).take()).allowed, true); assert.equal((await store(i).take()).allowed, false);
    }
    const a = store(0), b = store(0), raced = await Promise.allSettled([a.reserve('tenant-one', 'race'), b.reserve('tenant-one', 'race')]);
    assert.equal(raced.filter(x => x.status === 'fulfilled').length, 1);
    await raced.find(x => x.status === 'fulfilled').value.release();
    await assert.rejects(scoped.transaction(c => c.query('CREATE TABLE forbidden (id INTEGER)'), contexts[0]), { code: '42501' });
    await pool.query("UPDATE h1_tenants SET state = 'deleting' WHERE tenant_id = 'tenant-one'");
    assert.equal((await pool.query("SELECT entries FROM sr_v1_capacity WHERE tenant_id = ''")).rows[0].entries, 1);
    assert.equal((await pool.query("SELECT 1 FROM sr_v1_receipts WHERE tenant_id = 'tenant-one'")).rows.length, 0);
    assert.deepEqual(await store(1).get('same'), { private: 1 });
  });
