import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { database } from './hosted-helpers.mjs';
import { h8Fixture, serveH8, referenceEnv } from './h8-helpers.mjs';
import { initializeUsage } from '../dist/hosted-usage.js';
import { OPERATOR_ACTOR, AUDIT_REDACTED, redactAuditDetail, initializeAudit, appendOperatorAudit, readOperatorAudit } from '../dist/operator-audit.js';
import { MetadataOperator } from '../dist/metadata-operator.js';
import { HostedProvisioning } from '../dist/hosted-provisioning.js';
import { activateAuthKey } from '../dist/hosted-auth.js';
import { StubMailTransport } from '../dist/mail.js';
import { migrateReference } from '../dist/single-node.js';
import { ReferenceMaintenance } from '../dist/single-node-maintenance.js';

async function fixture(t) {
  const f = await database(t);
  await initializeUsage(f.db);
  const mail = new StubMailTransport();
  let now = Date.UTC(2026, 9, 16, 12);
  const provisioning = new HostedProvisioning(f.db, f.config, mail, () => now);
  return { ...f, mail, provisioning, operator: new MetadataOperator(f.db), advance: ms => { now += ms; } };
}
const actions = entries => entries.map(e => e.action);

test('operator audit redaction strips secret-bearing detail fields, recursively', () => {
  const cyclic = { token: 'x' }; cyclic.self = cyclic;
  assert.doesNotThrow(() => redactAuditDetail(cyclic));
  const redacted = redactAuditDetail({
    action: 'membership.invited', keyId: 'key-1', userId: 'u-1',
    token: 'tok-secret', password: 'pw', authorization: 'bearer',
    nested: { signingKey: 'sk', totpSecret: 'ts', fingerprint: 'fp', sealed: 'sealed-blob', ok: 'fine' },
    list: [{ secret: 's' }, 'plain'],
  });
  assert.equal(redacted.action, 'membership.invited');
  assert.equal(redacted.keyId, 'key-1');
  assert.equal(redacted.userId, 'u-1');
  assert.equal(redacted.token, AUDIT_REDACTED);
  assert.equal(redacted.password, AUDIT_REDACTED);
  assert.equal(redacted.authorization, AUDIT_REDACTED);
  assert.equal(redacted.nested.signingKey, AUDIT_REDACTED);
  assert.equal(redacted.nested.totpSecret, AUDIT_REDACTED);
  assert.equal(redacted.nested.fingerprint, AUDIT_REDACTED);
  assert.equal(redacted.nested.sealed, AUDIT_REDACTED);
  assert.equal(redacted.nested.ok, 'fine');
  assert.equal(redacted.list[0].secret, AUDIT_REDACTED);
  assert.equal(redacted.list[1], 'plain');
  assert.equal(redactAuditDetail('plain-string'), 'plain-string');
});

test('audit schema migration is idempotent and attributes legacy rows to the deployment operator', async t => {
  const f = await database(t);
  await f.db.transaction(async c => {
    await c.query('CREATE TABLE h8_audit (event_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, action TEXT NOT NULL)');
    await c.query("INSERT INTO h8_audit (event_id, created_at, action) VALUES ('legacy-1','2026-01-01T00:00:00.000Z','backup.created')");
  });
  await f.db.transaction(c => initializeAudit(c));
  await f.db.transaction(c => initializeAudit(c)); // second run must not fail on existing columns
  const rows = await f.db.transaction(c => c.query('SELECT * FROM h8_audit'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor, OPERATOR_ACTOR);
  assert.equal(rows[0].tenant_id, null);
  assert.equal(rows[0].subject, null);
  assert.equal(rows[0].detail, null);
});

test('every tenant lifecycle mutation appends an attributed audit entry', async t => {
  const f = await fixture(t), op = f.operator;
  const request = { namespaceId: 'ns-one', name: 'Tenant One', administrator: { id: 'admin-1', name: 'Admin' } };
  const provisioned = await op.provision('op-provision-1', request);
  await op.checkpoint('op-provision-1', 'created', 'configured');
  await op.checkpoint('op-provision-1', 'configured', 'verified');
  await op.activate('op-provision-1');
  const tenantId = provisioned.tenantId;
  await op.transition('op-suspend-1', tenantId, 'suspend', (await op.tenant(tenantId)).version);
  await op.transition('op-resume-1', tenantId, 'resume', (await op.tenant(tenantId)).version);
  await op.transition('op-delete-1', tenantId, 'delete', (await op.tenant(tenantId)).version);
  await op.checkpoint('op-delete-1', 'revoked', 'artifacts-removed');
  await op.finishDeletion('op-delete-1');
  const entries = await readOperatorAudit(f.db, { limit: 200 });
  for (const expected of ['tenant.provisioned', 'operation.checkpointed', 'tenant.activated', 'tenant.suspended',
    'tenant.resumed', 'tenant.deletion-requested', 'tenant.deletion-finished']) assert.ok(actions(entries).includes(expected), expected);
  const provisionedEntry = entries.find(e => e.action === 'tenant.provisioned');
  assert.equal(provisionedEntry.actor, OPERATOR_ACTOR);
  assert.equal(provisionedEntry.tenantId, tenantId);
  assert.deepEqual(provisionedEntry.detail, { operationId: 'op-provision-1', name: 'Tenant One' });
  assert.ok(provisionedEntry.createdAt.length >= 20);
  // Idempotent replay of an already-applied mutation emits nothing new.
  const before = entries.length;
  await op.provision('op-provision-1', request);
  assert.equal((await readOperatorAudit(f.db, { limit: 200 })).length, before);
});

test('a failed operator mutation leaves no audit entry', async t => {
  const f = await fixture(t);
  await assert.rejects(f.operator.transition('op-bad-1', 'nonexistent-tenant', 'suspend', 1), { code: 'RESOURCE_NOT_FOUND' });
  assert.ok((await readOperatorAudit(f.db, { limit: 200 })).every(e => e.action !== 'tenant.suspended'));
});

test('onboarding, invitation minting and member removal are audited without secret values', async t => {
  const f = await fixture(t);
  const onboarded = await f.provisioning.provision('onboard-1', { name: 'Acme', administrator: { email: 'boss@example.test', name: 'Boss' } });
  const tenantId = onboarded.tenantId;
  const invited = await f.provisioning.inviteMember('invite-1', tenantId, { email: 'member@example.test', name: 'Member', role: 'reader' });
  let entries = await readOperatorAudit(f.db, { limit: 200 });
  const onboard = entries.find(e => e.action === 'tenant.activated');
  assert.equal(onboard.actor, OPERATOR_ACTOR);
  assert.equal(onboard.tenantId, tenantId);
  assert.equal(onboard.subject, 'boss@example.test');
  // Provisioning and invitation minting are audited in the creating transaction,
  // independent of the later delivery/activation step.
  const provisioned = entries.find(e => e.action === 'tenant.provisioned');
  assert.equal(provisioned.tenantId, tenantId);
  assert.equal(provisioned.subject, 'boss@example.test');
  assert.equal(provisioned.detail.operationId, onboarded.operationId);
  assert.equal(provisioned.detail.name, 'Acme');
  const adminInvite = entries.find(e => e.action === 'membership.invited' && e.subject === 'boss@example.test');
  assert.ok(adminInvite);
  assert.equal(adminInvite.detail.role, 'administrator');
  const invite = entries.find(e => e.action === 'membership.invited' && e.subject === 'member@example.test');
  assert.ok(invite);
  assert.equal(invite.detail.role, 'reader');
  assert.equal(invite.detail.operationId, invited.operationId);
  // The single-use invitation tokens mailed to recipients never appear in the audit log.
  const tokens = f.mail.messages.flatMap(m => [...m.html.matchAll(/<code>([^<]+)<\/code>/g)].map(match => match[1]));
  assert.ok(tokens.length >= 2);
  const dump = JSON.stringify(entries);
  for (const token of tokens) assert.ok(!dump.includes(token), 'invitation token leaked into the audit log');
  const memberships = await f.db.transaction(c => c.query('SELECT user_id FROM h2_memberships WHERE tenant_id = ? AND status = ?', [tenantId, 'invited']));
  await f.provisioning.removeMember(tenantId, String(memberships[0].user_id));
  entries = await readOperatorAudit(f.db, { limit: 200 });
  const removed = entries.find(e => e.action === 'membership.removed');
  assert.equal(removed.tenantId, tenantId);
  assert.equal(removed.subject, String(memberships[0].user_id));
});

test('auth key rotation is audited with the key ID only', async t => {
  const f = await fixture(t);
  await activateAuthKey(f.db, f.config);
  const entries = await readOperatorAudit(f.db, { limit: 200 });
  const rotation = entries.find(e => e.action === 'auth.key-rotated');
  assert.ok(rotation);
  assert.equal(rotation.actor, OPERATOR_ACTOR);
  assert.equal(rotation.tenantId, null);
  assert.deepEqual(rotation.detail, { keyId: f.config.keyId });
  const dump = JSON.stringify(entries);
  assert.ok(!dump.includes('fingerprint'), 'key fingerprint leaked into the audit log');
  assert.ok(!dump.includes(String(f.config.signingKey)), 'signing key leaked into the audit log');
});

test('maintenance backup and retention append audit entries', async t => {
  const f = await h8Fixture(t); await migrateReference(f.db, referenceEnv, 'sqlite');
  const dir = await mkdtemp(join(tmpdir(), 'h8-audit-')), key = randomBytes(32);
  const maintenance = await ReferenceMaintenance.open(f.db, dir, key, 'frozen');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const backup = await maintenance.backup();
  const created = (await readOperatorAudit(f.db, { limit: 200 })).find(e => e.action === 'backup.created');
  assert.ok(created);
  assert.deepEqual(created.detail, { backupId: backup.id, rows: backup.rows });
  await maintenance.retain(30, 30);
  const retained = (await readOperatorAudit(f.db, { limit: 200 })).find(e => e.action === 'retention.applied');
  assert.deepEqual(retained.detail, { auditDays: 30, usageDays: 30 });
});

test('audit read path is newest-first, bounded, and operator-only over HTTP', async t => {
  const f = await h8Fixture(t); await initializeUsage(f.db);
  const base = Date.UTC(2026, 9, 16);
  for (let i = 0; i < 5; i++) await f.db.transaction(c => appendOperatorAudit(c, { action: `test.event-${i}` }, base + i * 1000));
  const entries = await readOperatorAudit(f.db, { limit: 3 });
  assert.deepEqual(entries.map(e => e.action), ['test.event-4', 'test.event-3', 'test.event-2']);
  assert.equal((await readOperatorAudit(f.db)).length, 5);
  await assert.rejects(readOperatorAudit(f.db, { limit: 0 }), { code: 'METADATA_INVALID' });
  await assert.rejects(readOperatorAudit(f.db, { limit: 201 }), { code: 'METADATA_INVALID' });
  const s = await serveH8(t, f);
  assert.equal((await s.request('/api/host/audit')).status, 403);
  const allowed = await s.request('/api/host/audit', { headers: s.operator });
  assert.equal(allowed.status, 200);
  assert.deepEqual(allowed.body.entries.map(e => e.action), ['test.event-4', 'test.event-3', 'test.event-2', 'test.event-1', 'test.event-0']);
  assert.ok(allowed.body.entries.every(e => e.actor === OPERATOR_ACTOR));
});
