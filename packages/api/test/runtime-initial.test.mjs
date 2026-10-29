import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { SqliteMetadataDatabase, PostgresMetadataDatabase } from '../dist/metadata-db.js';
import { migrateServerless } from '../dist/serverless-migration.js';
import { initialCommand, initialAdministration, prepareInitial } from '../dist/runtime-initial.js';
import { createPrivateRuntime } from '../dist/runtime-private.js';
import { HostedAuth } from '../dist/hosted-auth.js';
import { hostedConfig } from '../dist/hosted-config.js';
import { totp } from '../dist/auth-crypto.js';
import { environment } from './hosted-helpers.mjs';
import { referenceEnv } from './h8-helpers.mjs';
import { runtimeEnv, context } from './runtime-helpers.mjs';
import { TenantMetadata } from '../dist/metadata.js';
import { DurableDispatch } from '../dist/dispatch.js';
import { ObjectLedger } from '../dist/object-ledger.js';
import { DurableUploads } from '../dist/durable-uploads.js';
import { directRequest } from './serverless-upload-helpers.mjs';
import { budgetEnvironment } from '../dist/budget-store.js';
import { checksum } from '../dist/metadata-operator.js';
import { DurableCoordinator } from '../dist/coordination.js';

const env = () => ({ ...environment(), ...referenceEnv, ...runtimeEnv(), OPENSIGHT_REFERENCE: undefined,
  OPENSIGHT_SERVERLESS_DATA: 'durable', OPENSIGHT_RELEASE_DIGEST: 'sha256:' + 'a'.repeat(64) });
const auth = e => `Operator ${Buffer.from(e.OPENSIGHT_OPERATOR_KEY, 'base64').toString('base64url')}`;
const bootstrap = e => ({ command: 'bootstrap-initial', version: 1, operationId: randomUUID(), authorization: auth(e), testers: [0, 1].map(i => ({
  tenantId: randomUUID(), namespaceId: randomUUID(), userId: randomUUID(), subject: randomUUID(), email: `tester${i}@example.test`, name: `Synthetic tester ${i}`,
  password: randomBytes(32).toString('base64url'), totpSecret: randomBytes(20).toString('base64') })) });
const activate = (e, b) => ({ command: 'activate-initial', version: 1, operationId: b.operationId, expectedEpoch: 1, releaseDigest: e.OPENSIGHT_RELEASE_DIGEST, authorization: auth(e) });
function budgetTune(e, b) {
  const old = budgetEnvironment(e), target = structuredClone(old);
  Object.assign(target.defaults, { workingBytes: 67108864, cacheBytes: 67108864, workerRssBytes: 1073741824, workerHeapMb: 512 }); target.node.workerHeapMb = 512;
  return { target, environment: { ...e, OPENSIGHT_NODE_LIMITS: JSON.stringify(target.node), OPENSIGHT_TENANT_LIMIT_DEFAULTS: JSON.stringify(target.defaults) },
    command: { ...activate(e, b), command: 'tune-initial-budgets', previousBudgetDigest: checksum(old), targetBudgetDigest: checksum(target) } };
}
function executionExtension(e, b, expectedBudgetVersion = 2, executionMs = 30000) {
  const old = budgetEnvironment(e), target = structuredClone(old);
  target.defaults.executionMs = target.node.executionMs = executionMs;
  const environment = { ...e, OPENSIGHT_RELEASE_DIGEST: 'sha256:' + 'b'.repeat(64), OPENSIGHT_NODE_LIMITS: JSON.stringify(target.node), OPENSIGHT_TENANT_LIMIT_DEFAULTS: JSON.stringify(target.defaults) };
  return { target, environment, command: { ...activate(environment, b), command: 'extend-pilot-execution', expectedBudgetVersion,
    activationReleaseDigest: 'sha256:' + 'a'.repeat(64), previousBudgetDigest: checksum(old), targetBudgetDigest: checksum(target) } };
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'opensight-initial-')), db = new SqliteMetadataDatabase(join(dir, 'metadata.sqlite')), e = env();
  t.after(async () => { await db.close(); await rm(dir, { recursive: true, force: true }); });
  await migrateServerless(db, e, 'sqlite');
  const runtime = createPrivateRuntime(() => e, { databases: () => ({ membership: db, tenant: db }), prepareInitial: (db, env) => prepareInitial(db.membership, env, 'sqlite'), initial: (db, env, input) => initialAdministration(db.membership, env, input, 'sqlite') });
  const call = raw => runtime.administration(raw, context);
  return { db, e, call, b: bootstrap(e) };
}
test('SR4b1 private setup rejects authority, unknown fields and unsafe modes before SQL', async () => {
  const e = env(), b = bootstrap(e), runtime = createPrivateRuntime(() => e, { databases: () => assert.fail('invalid command opened SQL') });
  for (const raw of [{ command: 'migrate', authorization: 'Operator forged' }, { command: 'migrate', authorization: auth(e), unknown: true }, {}, { ...b, authorization: 'Operator forged' }, { ...b, unknown: true }, { ...b, version: 2 }, { ...b, testers: [] },
    { ...b, testers: [b.testers[0], b.testers[0]] }, { ...b, testers: [{ ...b.testers[0], totpSecret: 'invalid' }, b.testers[1]] },
    { ...activate(e, b), expectedEpoch: 2 }, { ...activate(e, b), releaseDigest: 'sha256:' + 'b'.repeat(64) }]) await assert.rejects(runtime.administration(raw, context));
  const repair = { ...activate(e, b), command: 'repair-initial-locks' };
  for (const changed of [{ authorization: 'Operator forged' }, { unknown: true }, { expectedEpoch: 2 }, { releaseDigest: 'sha256:' + 'b'.repeat(64) }])
    await assert.rejects(runtime.administration({ ...repair, ...changed }, context));
  const tune = budgetTune(e, b), tuningRuntime = createPrivateRuntime(() => tune.environment, { databases: () => assert.fail('invalid tuning opened SQL') });
  for (const changed of [{ authorization: 'Operator forged' }, { unknown: true }, { expectedEpoch: 2 }, { previousBudgetDigest: 'invalid' }, { targetBudgetDigest: 'b'.repeat(64) }, { previousBudgetDigest: tune.command.targetBudgetDigest }])
    await assert.rejects(tuningRuntime.administration({ ...tune.command, ...changed }, context));
  const extension = executionExtension(tune.environment, b), extendingRuntime = createPrivateRuntime(() => extension.environment, { databases: () => assert.fail('invalid extension opened SQL') });
  for (const changed of [{ authorization: 'Operator forged' }, { unknown: true }, { expectedEpoch: 2 }, { activationReleaseDigest: 'invalid' },
    { releaseDigest: e.OPENSIGHT_RELEASE_DIGEST }, { expectedBudgetVersion: 1 }, { expectedBudgetVersion: 2147483647 }, { expectedBudgetVersion: 2.5 },
    { previousBudgetDigest: 'invalid' }, { targetBudgetDigest: 'b'.repeat(64) }, { previousBudgetDigest: extension.command.targetBudgetDigest }])
    await assert.rejects(extendingRuntime.administration({ ...extension.command, ...changed }, context));
  for (const [field, value] of [['OPENSIGHT_MAINTENANCE', 'open'], ['OPENSIGHT_SERVERLESS_DATA', undefined], ['OPENSIGHT_REFERENCE', 'single-node'], ['OPENSIGHT_MODE', 'demo']]) {
    const changed = { ...e, [field]: value };
    await assert.rejects(createPrivateRuntime(() => changed, { databases: () => assert.fail('unsafe mode opened SQL') }).administration(b, context));
  }
});
test('SR4b3 initial memory correction rejects held work, rolls back, preserves state and verifies retries', async t => {
  const f = await fixture(t); await f.call(f.b); await f.call(activate(f.e, f.b));
  const tuning = budgetTune(f.e, f.b), metadata = new TenantMetadata(f.db, f.db), tester = f.b.testers[0];
  const tenantContext = await metadata.authenticate(null, async () => ({ namespaceId: tester.namespaceId, userId: tester.userId }));
  const coordinator = new DurableCoordinator(f.db, metadata, 'test', 'sqlite');
  const attempt = await coordinator.admit(tenantContext, { attemptId: randomUUID(), class: 'query', revisions: await metadata.revisions(tenantContext), platformRemainingMs: 28000 });
  Object.assign(f.e, tuning.environment);
  await assert.rejects(f.call(tuning.command), { code: 'WORKSPACE_DRAIN_REQUIRED' });
  assert.equal((await f.db.transaction(c => c.query('SELECT version FROM h4_budget_config')))[0].version, 1);
  await coordinator.release(attempt);
  const snapshot = () => f.db.transaction(async c => ({ identities: await c.query('SELECT * FROM h2_identities ORDER BY subject'), admissions: await c.query('SELECT * FROM sr_admission'), control: await c.query('SELECT * FROM sr_control') }));
  const before = await snapshot();
  const broken = { durable: true, close: async () => {}, transaction: work => f.db.transaction(c => work({ query: (sql, args) => {
    if (sql.startsWith('INSERT INTO h2_requests')) throw Error('synthetic budget interruption'); return c.query(sql, args);
  } })) };
  await assert.rejects(initialAdministration(broken, f.e, initialCommand(tuning.command, f.e), 'sqlite'));
  assert.equal((await f.db.transaction(c => c.query('SELECT version FROM h4_budget_config')))[0].version, 1);
  assert.equal((await f.db.transaction(c => c.query('SELECT revision FROM sr_limits')))[0].revision, 1);
  const expected = { state: 'budgets-configured', epoch: 1, budgetVersion: 2 };
  assert.deepEqual(await f.call(tuning.command), expected); assert.deepEqual(await f.call(tuning.command), expected);
  assert.deepEqual(await snapshot(), before);
  assert.equal((await f.db.transaction(c => c.query("SELECT * FROM h8_audit WHERE action = 'runtime.initial-budgets-configured'"))).length, 1);
  assert.deepEqual(JSON.parse((await f.db.transaction(c => c.query('SELECT body FROM h4_budget_config')))[0].body), tuning.target);
  await assert.rejects(f.call({ ...tuning.command, previousBudgetDigest: 'c'.repeat(64) }), { code: 'INITIAL_BUDGET_CHANGE_CONFLICT' });
  await f.db.transaction(c => c.query("UPDATE sr_control SET state = 'maintenance'"));
  await assert.rejects(f.call(tuning.command), { code: 'INITIAL_BUDGET_CHANGE_INVALID' });
  await migrateServerless(f.db, f.e, 'sqlite');
  assert.equal((await f.db.transaction(c => c.query('SELECT revision FROM sr_limits')))[0].revision, 2);
});
test('SR4b3 initial tuning refuses changed authority, quotas and stale configuration', async t => {
  for (const fault of ['release', 'testers', 'previous', 'quota', 'epoch']) {
    const f = await fixture(t); await f.call(f.b); await f.call(activate(f.e, f.b));
    const tuning = budgetTune(f.e, f.b); Object.assign(f.e, tuning.environment);
    if (fault === 'release') { f.e.OPENSIGHT_RELEASE_DIGEST = 'sha256:' + 'b'.repeat(64); tuning.command.releaseDigest = f.e.OPENSIGHT_RELEASE_DIGEST; }
    if (fault === 'testers') await f.db.transaction(c => c.query("UPDATE h2_memberships SET status = 'removed'"));
    if (fault === 'previous') tuning.command.previousBudgetDigest = 'c'.repeat(64);
    if (fault === 'quota') { tuning.target.defaults.sourceRows--; f.e.OPENSIGHT_TENANT_LIMIT_DEFAULTS = JSON.stringify(tuning.target.defaults); tuning.command.targetBudgetDigest = checksum(tuning.target); }
    if (fault === 'epoch') await f.db.transaction(c => c.query('UPDATE sr_control SET epoch = 2'));
    await assert.rejects(f.call(tuning.command));
    assert.equal((await f.db.transaction(c => c.query('SELECT version FROM h4_budget_config')))[0].version, 1);
    assert.equal((await f.db.transaction(c => c.query('SELECT revision FROM sr_limits')))[0].revision, 1);
  }
});
test('SR4b5 execution extension binds original activation after patch, serializes, rolls back and preserves state', async t => {
  const f = await fixture(t); await f.call(f.b); await f.call(activate(f.e, f.b));
  const tuning = budgetTune(f.e, f.b); Object.assign(f.e, tuning.environment); await f.call(tuning.command);
  const extension = executionExtension(f.e, f.b), metadata = new TenantMetadata(f.db, f.db), tester = f.b.testers[0];
  const tenantContext = await metadata.authenticate(null, async () => ({ namespaceId: tester.namespaceId, userId: tester.userId }));
  const coordinator = new DurableCoordinator(f.db, metadata, 'test', 'sqlite');
  const attempt = await coordinator.admit(tenantContext, { attemptId: randomUUID(), class: 'query', revisions: await metadata.revisions(tenantContext), platformRemainingMs: 28000 });
  Object.assign(f.e, extension.environment);
  await assert.rejects(f.call(extension.command), { code: 'WORKSPACE_DRAIN_REQUIRED' }); await coordinator.release(attempt);
  const snapshot = () => f.db.transaction(async c => ({ identities: await c.query('SELECT * FROM h2_identities ORDER BY subject'), admissions: await c.query('SELECT * FROM sr_admission'), control: await c.query('SELECT * FROM sr_control') }));
  const before = await snapshot();
  const broken = { durable: true, close: async () => {}, transaction: work => f.db.transaction(c => work({ query: (sql, args) => {
    if (sql.startsWith('INSERT INTO h2_requests')) throw Error('synthetic extension interruption'); return c.query(sql, args);
  } })) };
  await assert.rejects(initialAdministration(broken, f.e, initialCommand(extension.command, f.e), 'sqlite'));
  assert.equal((await f.db.transaction(c => c.query('SELECT version FROM h4_budget_config')))[0].version, 2);
  assert.equal((await f.db.transaction(c => c.query('SELECT revision FROM sr_limits')))[0].revision, 2);
  const expected = { state: 'budgets-configured', epoch: 1, budgetVersion: 3 };
  assert.deepEqual(await f.call(extension.command), expected); assert.deepEqual(await f.call(extension.command), expected);
  assert.deepEqual(await snapshot(), before);
  assert.equal((await f.db.transaction(c => c.query("SELECT * FROM h8_audit WHERE action = 'runtime.pilot-execution-extended'"))).length, 1);
  assert.deepEqual(JSON.parse((await f.db.transaction(c => c.query('SELECT body FROM h4_budget_config')))[0].body), extension.target);
  await assert.rejects(f.call({ ...extension.command, previousBudgetDigest: 'c'.repeat(64) }), { code: 'INITIAL_BUDGET_CHANGE_CONFLICT' });
  const next = executionExtension(f.e, f.b, 3, 45000); Object.assign(f.e, next.environment);
  assert.deepEqual(await f.call(next.command), { ...expected, budgetVersion: 4 });
});
test('SR4b5 execution extension refuses changed quotas, ceiling, regressions and stale authority', async t => {
  const f = await fixture(t); await f.call(f.b); await f.call(activate(f.e, f.b));
  const tuning = budgetTune(f.e, f.b); Object.assign(f.e, tuning.environment); await f.call(tuning.command);
  for (const fault of ['activation', 'previous', 'version', 'quota', 'ceiling', 'regression']) {
    const extension = executionExtension(tuning.environment, f.b);
    if (fault === 'activation') extension.command.activationReleaseDigest = extension.environment.OPENSIGHT_RELEASE_DIGEST;
    if (fault === 'previous') extension.command.previousBudgetDigest = 'c'.repeat(64);
    if (fault === 'version') extension.command.expectedBudgetVersion = 3;
    if (fault === 'quota') extension.target.defaults.sourceRows--;
    if (fault === 'ceiling') extension.target.defaults.executionMs = extension.target.node.executionMs = 90001;
    if (fault === 'regression') extension.target.defaults.executionMs = 1;
    extension.environment.OPENSIGHT_TENANT_LIMIT_DEFAULTS = JSON.stringify(extension.target.defaults);
    extension.environment.OPENSIGHT_NODE_LIMITS = JSON.stringify(extension.target.node);
    extension.command.targetBudgetDigest = checksum(extension.target); Object.assign(f.e, extension.environment);
    await assert.rejects(f.call(extension.command), undefined, fault);
    assert.equal((await f.db.transaction(c => c.query('SELECT version FROM h4_budget_config')))[0].version, 2);
    assert.equal((await f.db.transaction(c => c.query('SELECT revision FROM sr_limits')))[0].revision, 2);
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
  assert.deepEqual(await f.call({ command: 'migrate', authorization: auth(f.e) }), { state: 'migrated', maintenance: true });
  await assert.rejects(f.call(a), { code: 'INITIAL_BOOTSTRAP_REQUIRED' });
  await f.call(f.b); await assert.rejects(f.call({ command: 'migrate', authorization: auth(f.e) }), { code: 'INITIAL_MAINTENANCE_REQUIRED' });
  assert.deepEqual(await f.call(a), { state: 'active', epoch: 1 }); assert.deepEqual(await f.call(a), { state: 'active', epoch: 1 });
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
    ["INSERT INTO h1_tenants (tenant_id,state,version,tombstone,placement,limit_policy) VALUES ('existing','active',1,NULL,NULL,NULL)", 'INITIAL_DATABASE_NOT_EMPTY'],
    ["CREATE TABLE foreign_table (value TEXT)", 'INITIAL_SCHEMA_NOT_OWNED'],
    ["UPDATE sr_object_schema SET checksum = 'foreign'", 'INITIAL_SCHEMA_INVALID'],
    ["UPDATE sr_v1_schema SET checksum = 'foreign'", 'INITIAL_SCHEMA_INVALID'],
    ["DELETE FROM sr_v1_capacity", 'INITIAL_SCHEMA_INVALID'],
    ["UPDATE sr_v1_capacity SET entries = 1", 'INITIAL_DATABASE_NOT_EMPTY'],
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
    await assert.rejects(prepareInitial(db, e), { code: '42501' }, 'a restricted owner cannot grant itself bypass');
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

test('SR4b2 live Postgres initial repair enables serialized row locks without writable control or configuration',
  { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set' }, async t => {
    const schema = 'locks_' + randomUUID().replaceAll('-', ''), operator = schema + '_op', tenant = schema + '_tenant';
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, options: `-c search_path=${schema}` });
    t.after(async () => { await pool.query('RESET ROLE'); await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.query(`DROP ROLE IF EXISTS ${operator}, ${tenant}`); await pool.end(); });
    await pool.query(`CREATE SCHEMA ${schema}`);
    for (const [kind, role] of [['operator', operator], ['tenant', tenant]]) {
      await pool.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT ${kind === 'operator' ? 'BYPASSRLS' : 'NOBYPASSRLS'}`);
      await pool.query(`COMMENT ON ROLE ${role} IS 'opensight:test:${kind}'`);
    }
    const e = { ...env(), OPENSIGHT_RUNTIME_OPERATOR_ROLE: operator, OPENSIGHT_RUNTIME_TENANT_ROLE: tenant }, db = new PostgresMetadataDatabase(pool), b = bootstrap(e);
    const tables = ['sr_control', 'sr_limits', 'h4_budget_config'];
    e.OPENSIGHT_ENTITLEMENTS = JSON.stringify({ defaults: { apiCalls: 1000, computeAttempts: 20, storageBytes: 134217728 }, tenants: {} });
    const roleQuery = async (role, sql) => {
      const client = await pool.connect();
      try { await client.query(`SET ROLE ${role}`); return await client.query(sql); }
      finally { await client.query('RESET ROLE'); client.release(); }
    };
    await migrateServerless(db, e);
    // Reproduce the already-activated legacy schema and its exact insufficient grants.
    for (const table of tables) {
      await pool.query(`REVOKE ALL (runtime_lock) ON ${table} FROM "${operator}"`);
      await pool.query(`ALTER TABLE ${table} DROP COLUMN runtime_lock`);
    }
    await initialAdministration(db, e, initialCommand(b, e));
    await initialAdministration(db, e, initialCommand(activate(e, b), e));
    const repair = initialCommand({ ...activate(e, b), command: 'repair-initial-locks' }, e);
    for (const table of tables) await assert.rejects(roleQuery(operator, `SELECT * FROM ${table} FOR UPDATE`), { code: '42501' }, table);
    await pool.query(`SET ROLE ${operator}`);
    await assert.rejects(initialAdministration(db, e, repair), { code: 'INITIAL_SCHEMA_NOT_OWNED' });
    await pool.query('RESET ROLE');
    await assert.rejects(initialAdministration(db, { ...e, OPENSIGHT_RELEASE_DIGEST: 'sha256:' + 'b'.repeat(64) }, { ...repair, releaseDigest: 'sha256:' + 'b'.repeat(64) }), { code: 'INITIAL_LOCK_REPAIR_REQUIRED' });
    const tester = b.testers[0];
    await pool.query('INSERT INTO sr_storage_usage VALUES ($1,$2,$3,0,0)', ['test', tester.tenantId, tester.namespaceId]);
    await assert.rejects(initialAdministration(db, e, repair), { code: 'INITIAL_DATABASE_NOT_EMPTY' });
    await pool.query('DELETE FROM sr_storage_usage');
    await pool.query("UPDATE sr_control SET state = 'maintenance'");
    await assert.rejects(initialAdministration(db, e, repair), { code: 'INITIAL_LOCK_REPAIR_REQUIRED' });
    await pool.query("UPDATE sr_control SET state = 'open'");
    const broken = { durable: true, close: async () => {}, transaction: work => db.transaction(c => work({ query: (sql, args) => {
      if (sql.startsWith('ALTER TABLE h4_budget_config ADD')) throw Error('synthetic repair interruption'); return c.query(sql, args);
    } })) };
    await assert.rejects(initialAdministration(broken, e, repair));
    assert.deepEqual((await pool.query("SELECT table_name FROM information_schema.columns WHERE table_schema = $1 AND column_name = 'runtime_lock'", [schema])).rows, []);
    await pool.query('ALTER TABLE sr_control ADD COLUMN runtime_lock TEXT');
    await assert.rejects(initialAdministration(db, e, repair), { code: 'RUNTIME_LOCK_SCHEMA_INVALID' });
    await pool.query('ALTER TABLE sr_control DROP COLUMN runtime_lock');
    const before = (await pool.query('SELECT * FROM h2_identities ORDER BY subject')).rows;
    assert.deepEqual(await initialAdministration(db, e, repair), { state: 'locks-repaired', epoch: 1 });
    assert.deepEqual(await initialAdministration(db, e, repair), { state: 'locks-repaired', epoch: 1 });
    assert.deepEqual((await pool.query('SELECT * FROM h2_identities ORDER BY subject')).rows, before);
    assert.deepEqual((await pool.query('SELECT state, epoch FROM sr_control')).rows, [{ state: 'open', epoch: '1' }]);
    assert.equal((await pool.query("SELECT * FROM h8_audit WHERE action = 'runtime.initial-locks-repaired'")).rows.length, 1);
    for (const table of tables) {
      assert.equal((await roleQuery(operator, `SELECT * FROM ${table} FOR UPDATE`)).rows.length, 1);
      await assert.rejects(roleQuery(operator, `UPDATE ${table} SET runtime_lock = 1`), { code: '23514' });
      await assert.rejects(roleQuery(operator, `DELETE FROM ${table} WHERE false`), { code: '42501' });
      await assert.rejects(roleQuery(operator, `TRUNCATE ${table}`), { code: '42501' });
    }
    for (const sql of ["UPDATE sr_control SET state = 'maintenance'", 'UPDATE sr_control SET epoch = 2', "UPDATE sr_limits SET entitlements = '{}'", "UPDATE h4_budget_config SET body = '{}'", 'ALTER TABLE sr_control DROP CONSTRAINT sr_control_runtime_lock_zero'])
      await assert.rejects(roleQuery(operator, sql), { code: '42501' });
    const other = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, options: `-c search_path=${schema}` });
    const firstClient = await pool.connect(), secondClient = await other.connect();
    try {
      await firstClient.query(`SET ROLE ${operator}`); await secondClient.query(`SET ROLE ${operator}`);
      for (const table of tables) {
        await firstClient.query('BEGIN'); await firstClient.query(`SELECT * FROM ${table} FOR UPDATE`);
        await secondClient.query('BEGIN'); await secondClient.query("SET LOCAL lock_timeout = '100ms'");
        await assert.rejects(secondClient.query(`SELECT * FROM ${table} FOR UPDATE`), { code: '55P03' });
        await secondClient.query('ROLLBACK'); await firstClient.query('ROLLBACK');
        assert.equal((await secondClient.query(`SELECT * FROM ${table} FOR UPDATE`)).rows.length, 1);
      }
    } finally {
      for (const client of [firstClient, secondClient]) { await client.query('ROLLBACK'); await client.query('RESET ROLE'); client.release(); }
      await other.end();
    }
    for (const table of tables) await assert.rejects(roleQuery(tenant, `SELECT * FROM ${table} FOR UPDATE`), { code: '42501' });
    // Exercise the failed upload path through the real, separate SQL role boundaries.
    const rolePool = role => ({ connect: async () => { const client = await pool.connect(); await client.query(`SET ROLE ${role}`); return client; } });
    const operatorDb = new PostgresMetadataDatabase(rolePool(operator)), tenantDb = new PostgresMetadataDatabase(rolePool(tenant), true);
    const metadata = new TenantMetadata(tenantDb, operatorDb), contexts = [];
    for (const tester of b.testers) contexts.push(await metadata.authenticate(null, async () => ({ namespaceId: tester.namespaceId, userId: tester.userId })));
    const events = [], transport = { recover: async e => { events.push(e); }, dispatch: async e => { events.push(e); } };
    const dispatch = new DurableDispatch(operatorDb, metadata, 'test', transport), ledger = new ObjectLedger(metadata, 'test');
    const objects = { capability: async (_entry, until) => ({ url: 'https://upload.example.invalid', method: 'PUT', headers: {}, expiresAt: new Date(until).toISOString() }),
      head: async (entry, version) => ({ version, bytes: entry.capacityBytes, checksum: entry.checksum }) };
    const uploads = new DurableUploads(metadata, dispatch, ledger, objects), key = randomUUID(), request = directRequest();
    const reservation = await uploads.reserve(contexts[0], request, key, async () => {});
    assert.equal(reservation.state, 'reserved');
    assert.equal((await uploads.reserve(contexts[0], request, key, async () => {})).id, reservation.id);
    const accepted = await uploads.complete(contexts[0], reservation.id, { versionId: 'synthetic-exact-version' }, randomUUID(), async () => {});
    assert.equal(accepted.state, 'queued'); assert.ok(events.length >= 4);
    await assert.rejects(uploads.status(contexts[1], accepted.id, async () => {}), { code: 'RESOURCE_NOT_FOUND' });
    await pool.query('RESET ROLE');
    // Tuning serializes with actual runtime admission and preserves accepted work.
    const tuning = budgetTune(e, b), tune = initialCommand(tuning.command, tuning.environment);
    const workBefore = (await pool.query('SELECT * FROM sr_operation')).rows;
    const coordinator = new DurableCoordinator(operatorDb, metadata, 'test');
    const attempt = await coordinator.admit(contexts[0], { attemptId: randomUUID(), class: 'query', revisions: await metadata.revisions(contexts[0]), platformRemainingMs: 28000 });
    await pool.query('RESET ROLE');
    await assert.rejects(initialAdministration(db, tuning.environment, tune), { code: 'WORKSPACE_DRAIN_REQUIRED' });
    await coordinator.release(attempt); await pool.query('RESET ROLE');
    const held = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, options: `-c search_path=${schema}` });
    const holder = await held.connect();
    const limited = { durable: true, close: async () => {}, transaction: work => db.transaction(async c => {
      await c.query("SET LOCAL lock_timeout = '100ms'"); return work(c);
    }) };
    try {
      await holder.query('BEGIN'); await holder.query('SELECT * FROM sr_control FOR UPDATE');
      await assert.rejects(initialAdministration(limited, tuning.environment, tune), { code: '55P03' });
    } finally { await holder.query('ROLLBACK'); holder.release(); await held.end(); }
    assert.deepEqual(await initialAdministration(db, tuning.environment, tune), { state: 'budgets-configured', epoch: 1, budgetVersion: 2 });
    assert.deepEqual(await initialAdministration(db, tuning.environment, tune), { state: 'budgets-configured', epoch: 1, budgetVersion: 2 });
    assert.deepEqual((await pool.query('SELECT * FROM sr_operation')).rows, workBefore);
    assert.deepEqual((await pool.query('SELECT * FROM h2_identities ORDER BY subject')).rows, before);
    assert.deepEqual((await pool.query('SELECT revision, budget_version FROM sr_limits')).rows, [{ revision: 2, budget_version: 2 }]);
    const next = await coordinator.admit(contexts[0], { attemptId: randomUUID(), class: 'query', revisions: await metadata.revisions(contexts[0]), platformRemainingMs: 28000 });
    assert.equal(coordinator.describe(next).limits.workerHeapMb, 512); await coordinator.release(next); await pool.query('RESET ROLE');
    const extension = executionExtension(tuning.environment, b), extend = initialCommand(extension.command, extension.environment);
    const active = await coordinator.admit(contexts[0], { attemptId: randomUUID(), class: 'query', revisions: await metadata.revisions(contexts[0]), platformRemainingMs: 28000 });
    await pool.query('RESET ROLE');
    await assert.rejects(initialAdministration(db, extension.environment, extend), { code: 'WORKSPACE_DRAIN_REQUIRED' });
    await coordinator.release(active); await pool.query('RESET ROLE');
    assert.deepEqual(await initialAdministration(db, extension.environment, extend), { state: 'budgets-configured', epoch: 1, budgetVersion: 3 });
    assert.deepEqual(await initialAdministration(db, extension.environment, extend), { state: 'budgets-configured', epoch: 1, budgetVersion: 3 });
    assert.deepEqual((await pool.query('SELECT * FROM sr_operation')).rows, workBefore);
    assert.deepEqual((await pool.query('SELECT * FROM h2_identities ORDER BY subject')).rows, before);
    assert.deepEqual((await pool.query('SELECT revision, budget_version FROM sr_limits')).rows, [{ revision: 3, budget_version: 3 }]);
    const extended = await coordinator.admit(contexts[0], { attemptId: randomUUID(), class: 'query', revisions: await metadata.revisions(contexts[0]), platformRemainingMs: 100000 });
    assert.equal(coordinator.describe(extended).limits.executionMs, 30000); await coordinator.release(extended); await pool.query('RESET ROLE');
    await pool.query('UPDATE sr_control SET epoch = 2');
    await assert.rejects(initialAdministration(db, e, repair), { code: 'INITIAL_EPOCH_REQUIRED' });
  });

test('SR4b1 live Postgres initial migration rolls back role caps and refuses preparation after bootstrap',
  { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set' }, async t => {
    const schema = 'prepare_' + randomUUID().replaceAll('-', ''), operator = schema + '_op', tenant = schema + '_tenant';
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, options: `-c search_path=${schema}` });
    t.after(async () => { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.query(`DROP ROLE IF EXISTS ${operator}, ${tenant}`); await pool.end(); });
    await pool.query(`CREATE SCHEMA ${schema}`);
    for (const [kind, role] of [['operator', operator], ['tenant', tenant]]) {
      await pool.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT ${kind === 'operator' ? 'BYPASSRLS' : 'NOBYPASSRLS'} CONNECTION LIMIT 4`);
      await pool.query(`COMMENT ON ROLE ${role} IS 'opensight:test:${kind}'`);
    }
    const e = { ...env(), OPENSIGHT_RUNTIME_OPERATOR_ROLE: operator, OPENSIGHT_RUNTIME_TENANT_ROLE: tenant }, db = new PostgresMetadataDatabase(pool);
    const broken = { durable: true, transaction: work => db.transaction(c => work({ query: (sql, args) => {
      if (sql === `ALTER ROLE "${tenant}" CONNECTION LIMIT 8`) throw Error('synthetic role preparation failure'); return c.query(sql, args);
    } })), close: async () => {} };
    await assert.rejects(prepareInitial(broken, e));
    const caps = async () => (await pool.query('SELECT rolname, rolconnlimit, rolbypassrls, rolcreaterole FROM pg_roles WHERE rolname IN ($1,$2) ORDER BY rolname', [operator, tenant])).rows;
    assert.ok((await caps()).every(r => r.rolconnlimit === 4));
    assert.deepEqual((await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = $1", [schema])).rows, []);
    await prepareInitial(db, e); await prepareInitial(db, e);
    const rows = await caps(); assert.ok(rows.every(r => r.rolconnlimit === 8 && !r.rolcreaterole));
    assert.equal(rows.find(r => r.rolname === operator).rolbypassrls, true); assert.equal(rows.find(r => r.rolname === tenant).rolbypassrls, false);
    const b = bootstrap(e); await initialAdministration(db, e, initialCommand(b, e));
    await assert.rejects(prepareInitial(db, e), { code: 'INITIAL_MAINTENANCE_REQUIRED' });
    assert.equal((await pool.query('SELECT state FROM sr_control')).rows[0].state, 'maintenance');
  });
