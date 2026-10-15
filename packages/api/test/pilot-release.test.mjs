import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pilotRelease, pilotPlan, pilotDigest } from '../dist/pilot-release.js';
import { migrateServerless } from '../dist/serverless-migration.js';
import { coordinationFixture } from './coordination-helpers.mjs';
import { DurableCoordinator } from '../dist/coordination.js';

async function fixture(t) {
  const f = await coordinationFixture(t, { migrate: false });
  const env = { ...f.env, OPENSIGHT_ENTITLEMENTS: JSON.stringify(f.entitlements) };
  await migrateServerless(f.db, env, 'sqlite');
  await f.db.transaction(async c => { for (const table of ['sr_job_due', 'sr_execution', 'sr_execution_schema']) await c.query(`DROP TABLE ${table}`); });
  await f.open();
  const plan = { version: 1, deployment: 'test', operationId: randomUUID(), current: 'a'.repeat(64), target: 'b'.repeat(64), configuration: 'c'.repeat(64), expectedEpoch: 1, expiresAt: Date.now() + 3600000 };
  const authority = { planDigest: pilotDigest(plan), epoch: 2, phase: 'quiescent' };
  const run = (command, a = authority, p = plan) => pilotRelease(f.db, env, p, command, a, 'sqlite');
  return { ...f, env, plan, authority, run };
}
test('pilot release rejects unbound, expired and stale plans without writing the gate', async t => {
  const f = await fixture(t);
  assert.throws(() => pilotPlan({ ...f.plan, extra: true }), { code: 'PILOT_PLAN_INVALID' });
  assert.throws(() => pilotPlan({ ...f.plan, expiresAt: Date.now() - 1 }), { code: 'PILOT_PLAN_INVALID' });
  await assert.rejects(f.run('freeze', { ...f.authority, planDigest: 'd'.repeat(64) }), { code: 'PILOT_AUTHORITY_MISMATCH' });
  const stale = { ...f.plan, expectedEpoch: 2 };
  await assert.rejects(f.run('freeze', { ...f.authority, planDigest: pilotDigest(stale), epoch: 3 }, stale), { code: 'PILOT_EPOCH_MISMATCH' });
  assert.equal((await f.run('inspect')).control.state, 'open');
});
test('pilot release refuses live admissions and preserves the open gate on failure', async t => {
  const f = await fixture(t), coordinator = new DurableCoordinator(f.db, f.metadata, 'test', 'sqlite');
  const attempt = await coordinator.admit(f.contexts[0], await f.input());
  await assert.rejects(f.run('freeze'), { code: 'PILOT_LIVE_WORK' });
  assert.equal((await f.run('inspect')).control.epoch, 1);
  await coordinator.release(attempt); await f.run('freeze');
});
test('pilot release binds backup, migrates and receipts atomically, replays and preserves existing rows', async t => {
  const f = await fixture(t), before = await f.run('inspect');
  await f.run('freeze'); assert.equal((await f.run('freeze')).state, 'replayed');
  const a = { ...f.authority, phase: 'backed-up', backup: 'e'.repeat(64), preserved: before.preserved };
  await assert.rejects(f.run('migrate', { ...a, preserved: 'f'.repeat(64) }), { code: 'PILOT_BACKUP_MISMATCH' });
  await f.run('migrate', a); assert.equal((await f.run('migrate', a)).state, 'replayed');
  await assert.rejects(f.run('migrate', { ...a, backup: 'f'.repeat(64) }), { code: 'PILOT_RECEIPT_CONFLICT' });
  assert.equal((await f.run('verify', a)).preserved, before.preserved);
  await assert.rejects(f.run('reopen', a), { code: 'PILOT_PHASE_INVALID' });
  assert.equal((await f.run('inspect')).control.state, 'maintenance');
  await f.run('reopen', { ...a, phase: 'promoted' });
  assert.equal((await f.run('reopen', { ...a, phase: 'promoted' })).state, 'replayed');
  const after = await f.run('inspect'); assert.equal(after.control.state, 'open'); assert.equal(after.control.epoch, 2); assert.equal(after.preserved, before.preserved);
});
test('pilot release rolls back new DDL and its receipt when grant/migration fails, remains held', async t => {
  const f = await fixture(t); await f.run('freeze');
  const before = await f.run('inspect');
  await f.db.transaction(c => c.query("UPDATE sr_object_schema SET checksum = 'foreign'"));
  const changed = await f.run('inspect');
  await assert.rejects(f.run('migrate', { ...f.authority, phase: 'backed-up', backup: 'e'.repeat(64), preserved: changed.preserved }), { code: 'OBJECT_FOREIGN_SCHEMA' });
  const after = await f.run('inspect'); assert.equal(after.control.state, 'maintenance');
  assert.deepEqual(after.tables.h2_requests, before.tables.h2_requests);
  assert.equal((await f.db.transaction(c => c.query("SELECT name FROM sqlite_master WHERE name = 'sr_execution_schema'"))).length, 0);
});

test('pilot release live Postgres transition verifies actual execution grants and idempotent receipts',
  { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set' }, async t => {
    const { Pool } = await import('pg');
    const { PostgresMetadataDatabase } = await import('../dist/metadata-db.js');
    const { environment } = await import('./hosted-helpers.mjs');
    const { referenceEnv } = await import('./h8-helpers.mjs');
    const { runtimeEnv } = await import('./runtime-helpers.mjs');
    const schema = `pilot_${randomUUID().replaceAll('-', '')}`, operator = `${schema}_op`, tenant = `${schema}_tenant`;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, options: `-c search_path=${schema}` });
    t.after(async () => { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.query(`DROP ROLE IF EXISTS ${operator}, ${tenant}`); await pool.end(); });
    await pool.query(`CREATE SCHEMA ${schema}`);
    for (const [kind, role] of [['operator', operator], ['tenant', tenant]]) {
      await pool.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT ${kind === 'operator' ? 'BYPASSRLS' : 'NOBYPASSRLS'}`);
      await pool.query(`COMMENT ON ROLE ${role} IS 'opensight:test:${kind}'`);
    }
    const db = new PostgresMetadataDatabase(pool), env = { ...environment(), ...referenceEnv, ...runtimeEnv(), OPENSIGHT_REFERENCE: undefined,
      OPENSIGHT_RUNTIME_OPERATOR_ROLE: operator, OPENSIGHT_RUNTIME_TENANT_ROLE: tenant,
      OPENSIGHT_ENTITLEMENTS: JSON.stringify({ defaults: { apiCalls: 1000, storageBytes: 1000000, computeAttempts: 20 }, tenants: {} }) };
    await migrateServerless(db, env);
    await pool.query('DROP TABLE sr_job_due, sr_execution, sr_execution_schema');
    await pool.query("UPDATE sr_control SET state = 'open'");
    const plan = { version: 1, deployment: 'test', operationId: randomUUID(), current: 'a'.repeat(64), target: 'b'.repeat(64), configuration: 'c'.repeat(64), expectedEpoch: 1, expiresAt: Date.now() + 3600000 };
    const run = (command, authority) => pilotRelease(db, env, plan, command, authority);
    const before = await run('inspect'), authority = { planDigest: pilotDigest(plan), epoch: 2, phase: 'quiescent' };
    await run('freeze', authority);
    const backup = { ...authority, phase: 'backed-up', backup: 'e'.repeat(64), preserved: before.preserved };
    await run('migrate', backup); await run('verify', backup);
    await pool.query(`GRANT SELECT ON sr_execution TO ${tenant}`);
    await assert.rejects(run('reopen', { ...backup, phase: 'promoted' }), { code: 'PILOT_GRANTS_INVALID' });
    assert.equal((await run('inspect')).control.state, 'maintenance');
    await pool.query(`REVOKE SELECT ON sr_execution FROM ${tenant}`);
    await run('reopen', { ...backup, phase: 'promoted' });
    assert.equal((await run('inspect')).control.state, 'open');
  });
