import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresMetadataDatabase } from '../dist/metadata-db.js';
import { initializeMetadata, metadataTables } from '../dist/metadata-schema.js';
import { TenantMetadata } from '../dist/metadata.js';
import { MetadataOperator } from '../dist/metadata-operator.js';

const login = (repo, namespaceId) => repo.authenticate(null, async () => ({ namespaceId, userId: 'admin' }));

test('H1 pooled adapter resets context after commit/rollback and discards connections on cleanup failure', async () => {
  const calls = [], released = []; let activeScope;
  const pool = { async connect() { return {
    async query(sql, values) {
      calls.push(sql);
      if (sql === 'RESET ALL') activeScope = undefined;
      if (sql.startsWith('SELECT set_config')) activeScope = [...values];
      return { rows: [] };
    },
    release(error) { released.push(error); }
  }; } };
  const db = new PostgresMetadataDatabase(pool, true);
  await assert.rejects(db.transaction(async () => {}), { code: 'TENANT_CONTEXT_REQUIRED' });
  assert.equal(calls.length, 0);
  let saved;
  await db.transaction(async c => { saved = c; assert.deepEqual(activeScope, ['a', 'one']); }, { tenantId: 'a', namespaceId: 'one' });
  assert.equal(activeScope, undefined); assert.equal(calls.at(-1), 'RESET ALL');
  await assert.rejects(saved.query('SELECT 1'), { code: 'METADATA_TRANSACTION_CLOSED' });
  await assert.rejects(db.transaction(async () => { assert.deepEqual(activeScope, ['b', 'two']); throw Error('abort'); }, { tenantId: 'b', namespaceId: 'two' }), /abort/);
  assert.equal(activeScope, undefined); assert.ok(calls.includes('ROLLBACK')); assert.deepEqual(released, [undefined, undefined]);
  for (const failure of ['cleanup', 'rollback']) {
    let resets = 0, discarded;
    const broken = new PostgresMetadataDatabase({ async connect() { return {
      async query(sql) {
        if (sql === 'RESET ALL' && ++resets === 2 && failure === 'cleanup' || sql === 'ROLLBACK' && failure === 'rollback') throw Error('connection failure');
        return { rows: [] };
      }, release(error) { discarded = error; }
    }; } });
    if (failure === 'rollback') await assert.rejects(broken.transaction(async () => { throw Error('work failed'); }), /work failed/);
    else await broken.transaction(async () => {});
    assert.ok(discarded instanceof Error);
  }
});

test('H1 live Postgres: restricted role, forced RLS, pooled reset, composite constraints and concurrent writers', { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set' }, async t => {
  const name = `h1_test_${randomUUID().replaceAll('-', '')}`, role = `${name}_tenant`;
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, options: `-c search_path=${name}` });
  let tenantPool;
  t.after(async () => {
    await tenantPool?.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
    await adminPool.query(`DROP ROLE IF EXISTS ${role}`);
    await adminPool.end();
  });
  await adminPool.query(`CREATE SCHEMA ${name}`);
  await adminPool.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS`);
  const operatorDb = new PostgresMetadataDatabase(adminPool), operator = new MetadataOperator(operatorDb);
  await initializeMetadata(operatorDb, 'postgres');
  await adminPool.query(`GRANT USAGE ON SCHEMA ${name} TO ${role}`);
  for (const table of metadataTables.filter(t => t !== 'migrations')) await adminPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON h1_${table} TO ${role}`);
  const url = new URL(process.env.DATABASE_URL); url.username = role; url.password = '';
  tenantPool = new Pool({ connectionString: url.href, max: 1, options: `-c search_path=${name}` });
  const tenantDb = new PostgresMetadataDatabase(tenantPool, true), repo = new TenantMetadata(tenantDb, operatorDb);
  for (const namespaceId of ['one', 'two']) {
    await operator.provision(namespaceId, { namespaceId, name: namespaceId, administrator: { id: 'admin', name: namespaceId } });
    await operator.checkpoint(namespaceId, 'created', 'configured'); await operator.checkpoint(namespaceId, 'configured', 'verified'); await operator.activate(namespaceId);
  }
  const a = await login(repo, 'one'), b = await login(repo, 'two');
  await repo.put(a, { kind: 'dataset', id: 'same' }, { definition: { name: 'one' }, sources: [] });
  await repo.put(b, { kind: 'dataset', id: 'same' }, { definition: { name: 'two' }, sources: [] });
  for (const context of [a, b, a]) assert.equal((await repo.get(context, { kind: 'dataset', id: 'same' })).body.definition.name, context.namespaceId);
  // Reuse the same physical connection outside the adapter: no request context may survive.
  const client = await tenantPool.connect();
  try {
    assert.deepEqual((await client.query('SELECT * FROM h1_resources')).rows, []);
    assert.deepEqual((await client.query('SELECT * FROM h1_tenants')).rows, []);
  } finally { client.release(); }
  await assert.rejects(tenantDb.transaction(async () => {}), { code: 'TENANT_CONTEXT_REQUIRED' });
  await tenantDb.transaction(async c => {
    assert.equal((await c.query('SELECT * FROM h1_resources')).length, 2);
    await assert.rejects(c.query('INSERT INTO h1_resources VALUES (?,?,?,?,?,?,?)', [b.tenantId, b.namespaceId, 'folder', '', 'foreign', '{"name":"Foreign"}', 1]), { code: '42501' });
    // The SQL error aborts this transaction; no subsequent writes are attempted.
  }, a);
  await assert.rejects(repo.put(a, { kind: 'group', id: 'bad' }, { name: 'Bad', userIds: ['missing'] }), { code: 'METADATA_REFERENCE_INVALID' });
  assert.deepEqual(await repo.list(b, 'group'), []);
  const unsafe = new TenantMetadata(new PostgresMetadataDatabase(adminPool, true), operatorDb);
  await assert.rejects(unsafe.list(await login(unsafe, 'one'), 'user'), { code: 'METADATA_UNSAFE_DATABASE_ROLE' });
  // Two distinct pool clients race CAS on a configuration row (authorization revision stays unchanged).
  const concurrent = new TenantMetadata(operatorDb, operatorDb), context = await login(concurrent, 'one');
  const results = await Promise.allSettled(['first', 'second'].map(name => concurrent.put(context, { kind: 'dataset', id: 'same' }, { definition: { name }, sources: [] }, 1)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'METADATA_CONFLICT');
  assert.equal((await repo.get(a, { kind: 'dataset', id: 'same' })).version, 2);
  assert.equal((await repo.revisions(a)).configuration, 3);
  const suspended = await operator.tenant(a.tenantId);
  const transitions = await Promise.allSettled(['suspend-a', 'suspend-b'].map(id => operator.transition(id, a.tenantId, 'suspend', suspended.version)));
  assert.equal(transitions.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await operator.tenant(a.tenantId)).state, 'suspended');
  await assert.rejects(repo.list(a, 'user'), { code: 'TENANT_UNAVAILABLE' });
  assert.equal((await repo.list(b, 'user'))[0].body.name, 'two');
});
