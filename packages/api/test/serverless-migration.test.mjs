import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresMetadataDatabase } from '../dist/metadata-db.js';
import { migrateServerless } from '../dist/serverless-migration.js';
import { DurableCoordinator } from '../dist/coordination.js';
import { coordinationFixture } from './coordination-helpers.mjs';
import { environment } from './hosted-helpers.mjs';
import { runtimeEnv } from './runtime-helpers.mjs';
import { referenceEnv } from './h8-helpers.mjs';

async function legacyAssetKinds(db, dialect) {
  await db.transaction(async c => {
    if (dialect === 'postgres') {
      const checks = await c.query("SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'h1_resources'::regclass AND contype = 'c'");
      for (const row of checks.filter(r => r.definition.includes("'metric'"))) {
        assert.match(row.conname, /^[a-zA-Z0-9_]+$/);
        await c.query(`ALTER TABLE h1_resources DROP CONSTRAINT "${row.conname}"`);
        await c.query(`ALTER TABLE h1_resources ADD CONSTRAINT "${row.conname}" ${row.definition.replace(/, '(?:metric|prep-template)'::text/g, '')}`);
      }
    } else {
      const [{ sql }] = await c.query("SELECT sql FROM sqlite_master WHERE name = 'h1_resources'");
      const [{ sql: links }] = await c.query("SELECT sql FROM sqlite_master WHERE name = 'h1_links'");
      const saved = {};
      for (const table of ['h1_resources', 'h1_links']) saved[table] = await c.query(`SELECT * FROM ${table}`);
      await c.query('DROP TABLE h1_links'); await c.query('DROP TABLE h1_resources');
      await c.query(sql.replace(/,\s*'(?:metric|prep-template)'/g, '')); await c.query(links);
      for (const [table, rows] of Object.entries(saved)) for (const row of rows) {
        const columns = Object.keys(row);
        await c.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, Object.values(row));
      }
    }
  });
}
async function assetRows(db) {
  return db.transaction(async c => ({ resources: await c.query('SELECT * FROM h1_resources ORDER BY tenant_id,namespace_id,kind,owner_id,resource_id'),
    links: await c.query('SELECT * FROM h1_links ORDER BY tenant_id,namespace_id,kind,owner_id,resource_id,target_kind,target_owner,target_id') }));
}
async function addGoverned(db, kind, owner = '') {
  return db.transaction(c => c.query(`INSERT INTO h1_resources (tenant_id,namespace_id,kind,owner_id,resource_id,body,version)
    SELECT tenant_id,namespace_id,?,?,?,'{}',1 FROM h1_namespaces LIMIT 1`, [kind, owner, randomUUID()]));
}

test('SR2d composed migration installs all checkpoints atomically and replays without rewriting budgets or opening maintenance', async t => {
  const f = await coordinationFixture(t, { migrate: false }), env = { ...f.env, OPENSIGHT_ENTITLEMENTS: JSON.stringify(f.entitlements) };
  const before = await f.db.transaction(c => c.query('SELECT * FROM h4_budget_config'));
  await migrateServerless(f.db, env, 'sqlite'); await migrateServerless(f.db, env, 'sqlite');
  assert.deepEqual(await f.db.transaction(c => c.query('SELECT * FROM h4_budget_config')), before);
  assert.equal((await f.db.transaction(c => c.query('SELECT state FROM sr_control')))[0].state, 'maintenance');
  for (const table of ['sr_coordination_schema', 'sr_manifest_schema', 'sr_dispatch_schema', 'sr_object_schema', 'sr_operation_schema', 'sr_execution_schema']) assert.equal((await f.db.transaction(c => c.query(`SELECT version FROM ${table}`)))[0].version, 1);
  await f.open();
  const coordinator = new DurableCoordinator(f.db, f.metadata, 'test', 'sqlite'), attempt = await coordinator.admit(f.contexts[0], await f.input());
  await assert.rejects(migrateServerless(f.db, env, 'sqlite'), { code: 'WORKSPACE_MAINTENANCE_REQUIRED' });
  await f.db.transaction(c => c.query("UPDATE sr_control SET state = 'maintenance'"));
  await assert.rejects(migrateServerless(f.db, env, 'sqlite'), { code: 'WORKSPACE_DRAIN_REQUIRED' });
  await coordinator.release(attempt); await migrateServerless(f.db, env, 'sqlite');
  await f.db.transaction(c => c.query("UPDATE sr_object_schema SET checksum = 'foreign'"));
  await assert.rejects(migrateServerless(f.db, env, 'sqlite'), { code: 'OBJECT_FOREIGN_SCHEMA' });
});
test('SR2d composed migration rolls back new schemas on a foreign later checkpoint', async t => {
  const f = await coordinationFixture(t, { migrate: false }), env = { ...f.env, OPENSIGHT_ENTITLEMENTS: JSON.stringify(f.entitlements) };
  await f.db.transaction(c => c.query('CREATE TABLE sr_object (foreign_value TEXT)'));
  await assert.rejects(migrateServerless(f.db, env, 'sqlite'), { code: 'OBJECT_FOREIGN_SCHEMA' });
  const rows = await f.db.transaction(c => c.query("SELECT name FROM sqlite_master WHERE name LIKE 'sr_%'"));
  assert.deepEqual(rows.map(r => r.name).sort(), ['sr_control', 'sr_object']);
});
test('SR2d live Postgres composed owner migration grants runtime DML without ownership, DDL or tenant access to private ledgers',
  { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set' }, async t => {
    const schema = `sr3_${randomUUID().replaceAll('-', '')}`, operator = `${schema}_op`, tenant = `${schema}_tenant`;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, options: `-c search_path=${schema}` });
    t.after(async () => { await pool.query('RESET ROLE'); await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.query(`DROP ROLE IF EXISTS ${operator}, ${tenant}`); await pool.end(); });
    await pool.query(`CREATE SCHEMA ${schema}`);
    for (const [kind, role] of [['operator', operator], ['tenant', tenant]]) {
      await pool.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT ${kind === 'operator' ? 'BYPASSRLS' : 'NOBYPASSRLS'}`);
      await pool.query(`COMMENT ON ROLE ${role} IS 'opensight:test:${kind}'`);
    }
    const db = new PostgresMetadataDatabase(pool), env = { ...environment(), ...referenceEnv, ...runtimeEnv(), OPENSIGHT_REFERENCE: undefined,
      OPENSIGHT_RUNTIME_OPERATOR_ROLE: operator, OPENSIGHT_RUNTIME_TENANT_ROLE: tenant,
      OPENSIGHT_ENTITLEMENTS: JSON.stringify({ defaults: { apiCalls: 1000, storageBytes: 1000000, computeAttempts: 20 }, tenants: {} }) };
    await migrateServerless(db, env);
    await pool.query("INSERT INTO h1_tenants (tenant_id,state,version) VALUES ('governed','active',1)");
    await pool.query("INSERT INTO h1_namespaces VALUES ('governed','governed','Governed migration')");
    await addGoverned(db, 'user');
    await legacyAssetKinds(db, 'postgres');
    const before = await assetRows(db);
    await assert.rejects(addGoverned(db, 'metric'), { code: 'METADATA_REFERENCE_INVALID' });
    await migrateServerless(db, env); await migrateServerless(db, env);
    assert.deepEqual(await assetRows(db), before);
    for (const kind of ['metric', 'prep-template']) {
      await addGoverned(db, kind);
      await assert.rejects(addGoverned(db, kind, 'forged-owner'), { code: 'METADATA_REFERENCE_INVALID' });
    }
    await assert.rejects(addGoverned(db, 'unknown-kind'), { code: 'METADATA_REFERENCE_INVALID' });
    const client = await pool.connect();
    try {
    await client.query(`SET ROLE ${operator}`);
    assert.equal((await client.query('SELECT state FROM sr_control')).rows[0].state, 'maintenance');
    await client.query('UPDATE sr_object SET object_id = object_id WHERE false');
    await assert.rejects(client.query("UPDATE sr_control SET state = 'open'"), { code: '42501' });
    await assert.rejects(client.query('CREATE TABLE forbidden (value TEXT)'), { code: '42501' });
    await client.query('UPDATE h7_jobs SET version = version WHERE false');
    await client.query('RESET ROLE'); await client.query(`SET ROLE ${tenant}`);
    assert.deepEqual((await client.query('SELECT * FROM sr_storage_usage')).rows, []);
    await assert.rejects(client.query('UPDATE sr_storage_usage SET live_bytes = 0'), { code: '42501' });
    for (const table of ['sr_object', 'sr_outbox', 'sr_operation', 'sr_dispatch_intent', 'sr_result_chunk', 'h2_sessions', 'sr_execution', 'sr_job_due']) await assert.rejects(client.query(`SELECT * FROM ${table}`), { code: '42501' });

    } finally { await client.query('RESET ROLE'); client.release(); }
  });

test('Issue #146: existing serverless databases gain tenant columns and selection ledger on the owner migration', async t => {
  const f = await coordinationFixture(t, { migrate: false }), env = { ...f.env, OPENSIGHT_ENTITLEMENTS: JSON.stringify(f.entitlements) };
  await migrateServerless(f.db, env, 'sqlite');
  await f.db.transaction(async c => {
    await c.query('DROP TABLE h2_login_selections');
    await c.query('ALTER TABLE h1_tenants DROP COLUMN display_name');
  });
  await migrateServerless(f.db, env, 'sqlite'); await migrateServerless(f.db, env, 'sqlite');
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h2_login_selections'))).length, 0);
  const tenants = await f.db.transaction(c => c.query('SELECT display_name FROM h1_tenants'));
  assert.ok(tenants.length); assert.ok(tenants.every(row => row.display_name === null));
});

test('Issues #157/#160: frozen SQLite owner migration upgrades legacy asset kinds atomically and preserves resources and links', async t => {
  const f = await coordinationFixture(t, { migrate: false }), env = { ...f.env, OPENSIGHT_ENTITLEMENTS: JSON.stringify(f.entitlements) };
  await legacyAssetKinds(f.db, 'sqlite');
  const before = await assetRows(f.db);
  assert.ok(before.resources.length); assert.ok(before.links.length);
  for (const kind of ['metric', 'prep-template']) await assert.rejects(addGoverned(f.db, kind));
  await f.db.transaction(c => c.query('CREATE TABLE sr_object (foreign_value TEXT)'));
  await assert.rejects(migrateServerless(f.db, env, 'sqlite'), { code: 'OBJECT_FOREIGN_SCHEMA' });
  assert.deepEqual(await assetRows(f.db), before);
  for (const kind of ['metric', 'prep-template']) await assert.rejects(addGoverned(f.db, kind));
  await f.db.transaction(c => c.query('DROP TABLE sr_object'));
  await migrateServerless(f.db, env, 'sqlite'); await migrateServerless(f.db, env, 'sqlite');
  assert.deepEqual(await assetRows(f.db), before);
  for (const kind of ['metric', 'prep-template']) {
    await addGoverned(f.db, kind);
    await assert.rejects(addGoverned(f.db, kind, 'forged-owner'));
  }
  await assert.rejects(addGoverned(f.db, 'unknown-kind'));
  assert.deepEqual(await f.db.transaction(c => c.query('PRAGMA foreign_key_check')), []);
  assert.equal((await f.db.transaction(c => c.query('SELECT state FROM sr_control')))[0].state, 'maintenance');
});
