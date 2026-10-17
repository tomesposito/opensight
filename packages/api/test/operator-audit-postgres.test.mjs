import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresMetadataDatabase } from '../dist/metadata-db.js';
import { migrateRuntime } from '../dist/runtime-migration.js';
import { OPERATOR_ACTOR, AUDIT_SCHEMA_VERSION, auditSchemaChecksum, initializeAudit, appendOperatorAudit, readOperatorAudit } from '../dist/operator-audit.js';
import { HostedProvisioning } from '../dist/hosted-provisioning.js';
import { hostedConfig } from '../dist/hosted-config.js';
import { MailError, StubMailTransport } from '../dist/mail.js';
import { environment } from './hosted-helpers.mjs';
import { runtimeEnv } from './runtime-helpers.mjs';
import { referenceEnv } from './h8-helpers.mjs';

const live = { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set' };

/** Fresh schema as the owner (mirrors the migration owner role). Teardown is a single
 *  ordered close the test registers LAST, so role/session pools end before the role drop. */
async function ownerDb(t) {
  const schema = `audit_test_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
  const db = new PostgresMetadataDatabase(pool);
  await pool.query(`CREATE SCHEMA "${schema}"`);
  const roles = [];
  return { schema, pool, db, roles,
    close: async () => {
      // Schema first: CASCADE drops the granted privileges so the role drop succeeds.
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      for (const role of roles) await pool.query(`DROP ROLE IF EXISTS "${role}"`);
      await pool.end();
    } };
}

/** Restricted runtime role: no CREATE on the schema, DML on h8_audit only — the deployed shape. */
async function restrictedDb(t, owner, { migrated }) {
  const role = `${owner.schema}_runtime`;
  owner.roles.push(role);
  await owner.pool.query(`CREATE ROLE "${role}" NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS`);
  await owner.pool.query(`GRANT USAGE ON SCHEMA "${owner.schema}" TO "${role}"`);
  await owner.pool.query(`REVOKE CREATE ON SCHEMA "${owner.schema}" FROM "${role}"`);
  await owner.pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON h8_audit TO "${role}"`);
  if (migrated) await owner.pool.query(`GRANT SELECT ON h8_audit_schema TO "${role}"`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 6,
    options: `-c search_path=${owner.schema} -c role=${role}` });
  t.after(() => pool.end());
  return new PostgresMetadataDatabase(pool);
}

test('live Postgres: legacy 3-column audit table upgrades through the owner migration with a version/checksum marker',
live, async t => {
  const owner = await ownerDb(t);
  await owner.db.transaction(async c => {
    await c.query('CREATE TABLE h8_audit (event_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, action TEXT NOT NULL)');
    await c.query("INSERT INTO h8_audit (event_id, created_at, action) VALUES ('legacy-1','2026-01-01T00:00:00.000Z','backup.created')");
  });
  await owner.db.transaction(c => initializeAudit(c));
  await owner.db.transaction(c => initializeAudit(c)); // idempotent second run
  const cols = await owner.db.transaction(c => c.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'h8_audit' ORDER BY ordinal_position"));
  assert.deepEqual(cols.map(r => String(r.column_name)),
    ['event_id', 'created_at', 'action', 'actor', 'tenant_id', 'subject', 'detail']);
  const legacy = await owner.db.transaction(c => c.query('SELECT actor, tenant_id, subject, detail FROM h8_audit'));
  assert.equal(legacy.length, 1);
  assert.equal(String(legacy[0].actor), OPERATOR_ACTOR);
  assert.equal(legacy[0].tenant_id, null);
  const marker = await owner.db.transaction(c => c.query('SELECT version, checksum FROM h8_audit_schema WHERE id = 1'));
  assert.equal(marker.length, 1);
  assert.equal(Number(marker[0].version), AUDIT_SCHEMA_VERSION);
  assert.equal(String(marker[0].checksum), auditSchemaChecksum);
  // A tampered marker fails closed instead of running against a foreign schema.
  await owner.db.transaction(c => c.query("UPDATE h8_audit_schema SET checksum = 'tampered' WHERE id = 1"));
  await assert.rejects(owner.db.transaction(c => initializeAudit(c)), { code: 'AUDIT_SCHEMA_MISMATCH' });
  t.after(() => owner.close());
});

test('live Postgres: concurrent appends/reads as the restricted runtime role do no DDL and all succeed',
live, async t => {
  const owner = await ownerDb(t);
  await owner.db.transaction(c => initializeAudit(c));
  const restricted = await restrictedDb(t, owner, { migrated: true });
  const probe = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${owner.schema} -c role=${owner.schema}_runtime` });
  t.after(() => probe.end());
  t.after(() => owner.close());
  await assert.rejects(probe.query('CREATE TABLE probe_ddl (id INT)'), { code: '42501' }); // restriction is real
  const appends = Array.from({ length: 20 }, (_, i) =>
    restricted.transaction(c => appendOperatorAudit(c, { action: `concurrent.event-${i}`, detail: { i } })));
  const reads = Array.from({ length: 4 }, () => readOperatorAudit(restricted, { limit: 50 }));
  const results = await Promise.all([...appends, ...reads]);
  assert.ok(results.slice(0, 20).every(r => r === undefined));
  assert.ok(results.slice(20).every(entries => Array.isArray(entries)));
  const count = await owner.db.transaction(c => c.query('SELECT COUNT(*) AS n FROM h8_audit'));
  assert.equal(Number(count[0].n), 20);
  // The runtime role can read the migration marker for deployment verification.
  const marker = await restricted.transaction(c => c.query('SELECT version FROM h8_audit_schema WHERE id = 1'));
  assert.equal(Number(marker[0].version), AUDIT_SCHEMA_VERSION);
});

test('live Postgres: append/read against an unmigrated table fail closed without attempting DDL',
live, async t => {
  const owner = await ownerDb(t);
  await owner.db.transaction(async c => {
    await c.query('CREATE TABLE h8_audit (event_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, action TEXT NOT NULL)');
  });
  const restricted = await restrictedDb(t, owner, { migrated: false });
  await assert.rejects(
    restricted.transaction(c => appendOperatorAudit(c, { action: 'should.not.migrate' })),
    { code: 'AUDIT_SCHEMA_NOT_MIGRATED' });
  await assert.rejects(readOperatorAudit(restricted), { code: 'AUDIT_SCHEMA_NOT_MIGRATED' });
  // Nothing was created or altered by the failed calls.
  const tables = await owner.db.transaction(c => c.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()"));
  assert.deepEqual(tables.map(r => String(r.table_name)).sort(), ['h8_audit']);
  t.after(() => owner.close());
});

test('live Postgres #122: failed invitation delivery still audits provisioning and invitation minting; retried activation audits exactly once',
live, async t => {
  const owner = await ownerDb(t);
  await migrateRuntime(owner.db, { ...environment(), ...referenceEnv, ...runtimeEnv(), OPENSIGHT_REFERENCE: undefined });
  const config = hostedConfig(environment());
  const now = Date.UTC(2026, 9, 17, 12);
  const clock = () => now;
  const attempted = [];
  const failingMail = { configured: true, async send(message) { attempted.push(message); throw new MailError('SMTP_SEND_FAILED'); } };
  const input = { name: 'Acme', administrator: { email: 'boss@example.test', name: 'Boss' } };
  const provisioning = new HostedProvisioning(owner.db, config, failingMail, clock);
  await assert.rejects(provisioning.provision('mailfail-1', input), err => err instanceof MailError && err.code === 'SMTP_SEND_FAILED');
  // The provisioning mutations committed before delivery failed, and were audited in their own transaction.
  let entries = await readOperatorAudit(owner.db, { limit: 200 });
  let actions = entries.map(e => e.action);
  assert.ok(actions.includes('tenant.provisioned'), 'tenant.provisioned missing after failed delivery');
  assert.ok(entries.some(e => e.action === 'membership.invited' && e.subject === 'boss@example.test'), 'admin invitation missing after failed delivery');
  assert.ok(!actions.includes('tenant.activated'), 'activation must not be audited before delivery succeeds');
  // No invitation token appears in the audit log.
  const tokens = attempted.flatMap(m => [...m.html.matchAll(/<code>([^<]+)<\/code>/g)].map(match => match[1]));
  assert.ok(tokens.length >= 1);
  const dump = JSON.stringify(entries);
  for (const token of tokens) assert.ok(!dump.includes(token), 'invitation token leaked into the audit log');
  // Retry with a working transport: the idempotent provisioning transaction emits nothing new,
  // delivery succeeds, and activation is audited exactly once.
  const retrying = new HostedProvisioning(owner.db, config, new StubMailTransport(), clock);
  const done = await retrying.provision('mailfail-1', input);
  assert.equal(done.status, 'complete');
  await retrying.provision('mailfail-1', input); // duplicate retry: already complete
  entries = await readOperatorAudit(owner.db, { limit: 200 });
  assert.equal(entries.filter(e => e.action === 'tenant.provisioned').length, 1);
  assert.equal(entries.filter(e => e.action === 'tenant.activated').length, 1);
  assert.equal(entries.filter(e => e.action === 'membership.invited' && e.subject === 'boss@example.test').length, 1);
  t.after(() => owner.close());
});
