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
    await migrateServerless(db, env); await migrateServerless(db, env);
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
