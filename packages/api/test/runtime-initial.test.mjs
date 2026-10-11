import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { SqliteMetadataDatabase, PostgresMetadataDatabase } from '../dist/metadata-db.js';
import { migrateServerless } from '../dist/serverless-migration.js';
import { initialCommand, initialAdministration } from '../dist/runtime-initial.js';
import { createPrivateRuntime } from '../dist/runtime-private.js';
import { HostedAuth } from '../dist/hosted-auth.js';
import { hostedConfig } from '../dist/hosted-config.js';
import { totp } from '../dist/auth-crypto.js';
import { environment } from './hosted-helpers.mjs';
import { referenceEnv } from './h8-helpers.mjs';
import { runtimeEnv, context } from './runtime-helpers.mjs';

const env = () => ({ ...environment(), ...referenceEnv, ...runtimeEnv(), OPENSIGHT_REFERENCE: undefined,
  OPENSIGHT_SERVERLESS_DATA: 'durable', OPENSIGHT_RELEASE_DIGEST: 'sha256:' + 'a'.repeat(64) });
const auth = e => `Operator ${Buffer.from(e.OPENSIGHT_OPERATOR_KEY, 'base64').toString('base64url')}`;
const bootstrap = e => ({ command: 'bootstrap-initial', version: 1, operationId: randomUUID(), authorization: auth(e), testers: [0, 1].map(i => ({
  tenantId: randomUUID(), namespaceId: randomUUID(), userId: randomUUID(), subject: randomUUID(), email: `tester${i}@example.test`, name: `Synthetic tester ${i}`,
  password: randomBytes(32).toString('base64url'), totpSecret: randomBytes(20).toString('base64') })) });
const activate = (e, b) => ({ command: 'activate-initial', version: 1, operationId: b.operationId, expectedEpoch: 1, releaseDigest: e.OPENSIGHT_RELEASE_DIGEST, authorization: auth(e) });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'opensight-initial-')), db = new SqliteMetadataDatabase(join(dir, 'metadata.sqlite')), e = env();
  t.after(async () => { await db.close(); await rm(dir, { recursive: true, force: true }); });
  await migrateServerless(db, e, 'sqlite');
  const runtime = createPrivateRuntime(() => e, { databases: () => ({ membership: db, tenant: db }), initial: (db, env, input) => initialAdministration(db.membership, env, input, 'sqlite') });
  const call = raw => runtime.administration(raw, context);
  return { db, e, call, b: bootstrap(e) };
}
test('SR4b1 private setup rejects authority, unknown fields and unsafe modes before SQL', async () => {
  const e = env(), b = bootstrap(e), runtime = createPrivateRuntime(() => e, { databases: () => assert.fail('invalid command opened SQL') });
  for (const raw of [{}, { ...b, authorization: 'Operator forged' }, { ...b, unknown: true }, { ...b, version: 2 }, { ...b, testers: [] },
    { ...b, testers: [b.testers[0], b.testers[0]] }, { ...b, testers: [{ ...b.testers[0], totpSecret: 'invalid' }, b.testers[1]] },
    { ...activate(e, b), expectedEpoch: 2 }, { ...activate(e, b), releaseDigest: 'sha256:' + 'b'.repeat(64) }]) await assert.rejects(runtime.administration(raw, context));
  for (const [field, value] of [['OPENSIGHT_MAINTENANCE', 'open'], ['OPENSIGHT_SERVERLESS_DATA', undefined], ['OPENSIGHT_REFERENCE', 'single-node'], ['OPENSIGHT_MODE', 'demo']]) {
    const changed = { ...e, [field]: value };
    await assert.rejects(createPrivateRuntime(() => changed, { databases: () => assert.fail('unsafe mode opened SQL') }).administration(b, context));
  }
});
test('SR4b1 atomic bootstrap retries preserve credentials, use opaque receipts and create no invitation or mail', async t => {
  const f = await fixture(t), first = await f.call(f.b);
  assert.deepEqual(first, { state: 'bootstrapped', epoch: 1, tenants: 2 });
  const snapshot = () => f.db.transaction(c => c.query('SELECT * FROM h2_identities ORDER BY subject'));
  const before = await snapshot(); assert.deepEqual(await f.call(f.b), first); assert.deepEqual(await snapshot(), before);
  for (const changed of [{ ...f.b, operationId: randomUUID() }, { ...f.b, testers: [{ ...f.b.testers[0], password: randomBytes(32).toString('base64url') }, f.b.testers[1]] }]) {
    await assert.rejects(f.call(changed), { code: 'INITIAL_BOOTSTRAP_CONFLICT' });
  }
  assert.deepEqual(await snapshot(), before);
  const receipts = await f.db.transaction(c => c.query('SELECT * FROM h2_requests'));
  assert.equal(receipts.length, 2); assert.ok(receipts.every(r => /^[a-f0-9]{64}$/.test(r.request_hash)));
  for (const table of ['h2_invitations', 'h2_onboarding', 'h2_sessions']) assert.deepEqual(await f.db.transaction(c => c.query(`SELECT * FROM ${table}`)), []);
  assert.equal((await f.db.transaction(c => c.query('SELECT state FROM sr_control')))[0].state, 'maintenance');
  for (const tester of f.b.testers) for (const secret of [tester.password, tester.totpSecret]) assert.ok(!JSON.stringify([first, receipts, before]).includes(secret));
});
test('SR4b1 initial activation admits real password/TOTP authentication, denies foreign tenancy and cannot reopen', async t => {
  const f = await fixture(t), a = activate(f.e, f.b);
  await assert.rejects(f.call(a), { code: 'INITIAL_BOOTSTRAP_REQUIRED' });
  await f.call(f.b); assert.deepEqual(await f.call(a), { state: 'active', epoch: 1 }); assert.deepEqual(await f.call(a), { state: 'active', epoch: 1 });
  const service = await HostedAuth.create(f.db, hostedConfig(f.e), Date.now, false);
  for (const [index, tester] of f.b.testers.entries()) {
    const code = totp(Buffer.from(tester.totpSecret, 'base64'), Math.floor(Date.now() / 30000));
    await assert.rejects(service.login(tester.email, tester.password, code, f.b.testers[1 - index].tenantId, '198.51.100.2'));
    const login = await service.login(tester.email, tester.password, code, tester.tenantId, '198.51.100.2');
    assert.equal(typeof login.token, 'string');
  }
  await assert.rejects(f.call(f.b), { code: 'INITIAL_MAINTENANCE_REQUIRED' });
  await f.db.transaction(c => c.query("UPDATE sr_control SET state = 'maintenance'"));
  await assert.rejects(f.call(a), { code: 'INITIAL_ACTIVATION_CONFLICT' });
  await f.db.transaction(c => c.query('UPDATE sr_control SET epoch = 2'));
  await assert.rejects(f.call(a), { code: 'INITIAL_EPOCH_REQUIRED' });
});
test('SR4b1 bootstrap refuses populated, foreign, incompatible and retired-key databases without partial identities', async t => {
  for (const [sql, code] of [
    ["INSERT INTO h1_tenants VALUES ('existing','active',1,NULL,NULL,NULL)", 'INITIAL_DATABASE_NOT_EMPTY'],
    ["CREATE TABLE foreign_table (value TEXT)", 'INITIAL_SCHEMA_NOT_OWNED'],
    ["UPDATE sr_object_schema SET checksum = 'foreign'", 'INITIAL_SCHEMA_INVALID'],
    ["UPDATE sr_control SET state = 'draining'", 'INITIAL_MAINTENANCE_REQUIRED'],
    ["INSERT INTO h2_keys VALUES ('retired','unknown',0)", 'INITIAL_AUTH_KEY_INVALID'],
    ["UPDATE sr_limits SET entitlements = '{\"defaults\":null,\"tenants\":{}}'", 'COORDINATION_CONFIG_CHANGED']
  ]) {
    const f = await fixture(t); await f.db.transaction(c => c.query(sql));
    await assert.rejects(f.call(f.b), { code }); assert.deepEqual(await f.db.transaction(c => c.query('SELECT * FROM h2_identities')), []);
  }
});
test('SR4b1 bootstrap rollback is atomic and initial activation refuses changed tester membership', async t => {
  const f = await fixture(t), faulty = { durable: true, transaction: work => f.db.transaction(c => work({ query: (sql, args) => {
    if (sql.startsWith('INSERT INTO h2_requests')) throw Error('synthetic transaction failure'); return c.query(sql, args);
  } })), close: async () => {} };
  await assert.rejects(initialAdministration(faulty, f.e, initialCommand(f.b, f.e), 'sqlite'));
  for (const table of ['h1_tenants', 'h2_identities', 'h1_operations', 'h2_requests']) assert.deepEqual(await f.db.transaction(c => c.query(`SELECT * FROM ${table}`)), []);
  await f.call(f.b); await f.db.transaction(c => c.query("UPDATE h2_memberships SET status = 'removed' WHERE subject = ?", [f.b.testers[0].subject]));
  await assert.rejects(f.call(activate(f.e, f.b)), { code: 'INITIAL_TESTERS_CHANGED' });
});
test('SR4b1 live Postgres initial setup requires schema ownership and preserves runtime control denial',
  { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set' }, async t => {
    const schema = 'initial_' + randomUUID().replaceAll('-', ''), operator = schema + '_op', tenant = schema + '_tenant', owner = schema + '_owner';
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, options: `-c search_path=${schema}` });
    t.after(async () => { await pool.query('RESET ROLE'); await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.query(`DROP ROLE IF EXISTS ${operator}, ${tenant}, ${owner}`); await pool.end(); });
    await pool.query(`CREATE ROLE ${owner} NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOINHERIT`);
    await pool.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${owner}`);
    for (const [kind, role] of [['operator', operator], ['tenant', tenant]]) {
      await pool.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT ${kind === 'operator' ? 'BYPASSRLS' : 'NOBYPASSRLS'}`);
      await pool.query(`COMMENT ON ROLE ${role} IS 'opensight:test:${kind}'`);
    }
    const e = { ...env(), OPENSIGHT_RUNTIME_OPERATOR_ROLE: operator, OPENSIGHT_RUNTIME_TENANT_ROLE: tenant }, db = new PostgresMetadataDatabase(pool), b = bootstrap(e);
    await pool.query(`SET ROLE ${owner}`); await migrateServerless(db, e); const command = initialCommand(b, e);
    await assert.rejects(initialAdministration(db, e, command), { code: 'INITIAL_OWNER_RLS_REQUIRED' });
    await pool.query('RESET ROLE'); await pool.query(`ALTER ROLE ${owner} BYPASSRLS`);
    await pool.query(`SET ROLE ${operator}`);
    await assert.rejects(initialAdministration(db, e, command), { code: 'INITIAL_SCHEMA_NOT_OWNED' });
    await pool.query('RESET ROLE'); await pool.query(`SET ROLE ${owner}`);
    const otherPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, options: `-c search_path=${schema}` });
    try {
      await otherPool.query(`SET ROLE ${owner}`);
      assert.deepEqual(await Promise.all([initialAdministration(db, e, command), initialAdministration(new PostgresMetadataDatabase(otherPool), e, command)]),
        [{ state: 'bootstrapped', epoch: 1, tenants: 2 }, { state: 'bootstrapped', epoch: 1, tenants: 2 }]);
    } finally { await otherPool.end(); }
    await initialAdministration(db, e, initialCommand(activate(e, b), e));
    assert.equal((await pool.query('SELECT state FROM sr_control')).rows[0].state, 'open');
    await pool.query('RESET ROLE'); await pool.query(`SET ROLE ${operator}`); await assert.rejects(pool.query("UPDATE sr_control SET state = 'maintenance'"), { code: '42501' });
    await pool.query('RESET ROLE');
  });
