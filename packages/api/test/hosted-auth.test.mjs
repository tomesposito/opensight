import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { authFixture, database } from './hosted-helpers.mjs';
import { HostedAuth, activateAuthKey } from '../dist/hosted-auth.js';
import { HostedProvisioning } from '../dist/hosted-provisioning.js';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { StubMailTransport } from '../dist/mail.js';

test('H2 preprovisioned enrollment is confirmed by MFA, cannot reset credentials and replays without issuing sessions', async t => {
  const f = await authFixture(t);
  assert.deepEqual(await f.auth.accept(f.invitation, f.password, f.code(), 'local'), { accepted: true });
  assert.deepEqual(await f.auth.enroll(f.invitation, f.password, 'local'), { enrollmentRequired: false });
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h2_sessions'))).length, 0);
  await assert.rejects(f.auth.login('unknown@example.test', f.password, f.code(), f.tenant.tenantId, 'local'), { code: 'AUTHENTICATION_FAILED' });
  await assert.rejects(f.auth.login(f.email, f.password + 'x', f.code(), f.tenant.tenantId, 'local'), { code: 'AUTHENTICATION_FAILED' });
  await assert.rejects(f.auth.login(f.email, f.password, '000000', f.tenant.tenantId, 'local'), { code: 'AUTHENTICATION_FAILED' });
  await assert.rejects(f.auth.login(f.email, f.password, f.code(), 'missing', 'local'), { code: 'AUTHENTICATION_FAILED' });
  const session = await f.login(); assert.equal((await f.auth.verify(session.token)).namespaceId, f.tenant.namespaceId);
  const [identity] = await f.db.transaction(c => c.query('SELECT * FROM h2_identities'));
  assert.ok(!JSON.stringify(identity).includes(f.password)); assert.ok(!JSON.stringify(identity).includes(f.secret.toString('base64')));
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h2_identities'))).length, 1);
});
test('H2 login and acceptance refuse inactive invitations, unconfirmed MFA, expired and removed memberships', async t => {
  const { db, config } = await database(t), mail = new StubMailTransport(); let now = 1800000000000;
  const auth = await HostedAuth.create(db, config, () => now), provision = new HostedProvisioning(db, config, mail, () => now);
  const email = 'new@example.test', password = randomBytes(24).toString('base64');
  const tenant = await provision.provision('new', { name: 'New', administrator: { email, name: 'New' } });
  const token = mail.messages[0].html.match(/<code>([^<]+)<\/code>/)[1];
  await assert.rejects(auth.login(email, password, '123456', tenant.tenantId, 'local'), { code: 'AUTHENTICATION_FAILED' });
  await auth.enroll(token, password, 'local');
  await assert.rejects(auth.enroll(token, password + 'x', 'local'), { code: 'AUTHENTICATION_FAILED' });
  await assert.rejects(auth.login(email, password, '123456', tenant.tenantId, 'local'), { code: 'AUTHENTICATION_FAILED' });
  await assert.rejects(auth.accept(token, password, '123456', 'local'), { code: 'AUTHENTICATION_FAILED' });
  now += config.invitationSeconds * 1000;
  await assert.rejects(auth.enroll(token, password, 'local'), { code: 'AUTHENTICATION_FAILED' });
});
test('H2 sessions survive a process restart; forgery, wrong issuer/audience/origin and expiry fail closed', async t => {
  const f = await authFixture(t), session = await f.login();
  const second = new SqliteMetadataDatabase(f.path); t.after(() => second.close());
  const restarted = await HostedAuth.create(second, f.config, f.clock);
  assert.deepEqual(await restarted.verify(session.token), await f.auth.verify(session.token));
  for (const token of [session.token + 'x', 'forged', session.token.replace('h2.', 'h1.'), session.token.replace('.test-key.', '.other-key.')]) await assert.rejects(restarted.verify(token), { code: 'AUTHENTICATION_FAILED' });
  for (const field of ['issuer', 'audience', 'origin']) {
    const other = await HostedAuth.create(second, { ...f.config, [field]: 'wrong' }, f.clock);
    await assert.rejects(other.verify(session.token), { code: 'AUTHENTICATION_FAILED' });
  }
  f.advance(f.config.sessionSeconds * 1000);
  await assert.rejects(restarted.verify(session.token), { code: 'AUTHENTICATION_FAILED' });
});
test('H2 TOTP consumption is atomic across concurrent logins', async t => {
  const f = await authFixture(t), code = f.code();
  const results = await Promise.allSettled([1, 2].map(() => f.auth.login(f.email, f.password, code, f.tenant.tenantId, 'local')));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'AUTHENTICATION_FAILED');
});
test('H2 tenant switching verifies preprovisioned membership and revokes the old session atomically', async t => {
  const f = await authFixture(t);
  const other = await f.provisioning.provision('onboard-two', { ...f.input, name: 'Second tenant' });
  const token = f.mail.messages[1].html.match(/<code>([^<]+)<\/code>/)[1];
  let session = await f.login();
  await assert.rejects(f.auth.switchTenant(session.token, other.tenantId), { code: 'AUTHENTICATION_FAILED' });
  assert.ok(await f.auth.verify(session.token));
  await f.auth.accept(token, f.password, f.code(), 'local'); f.advance();
  const switched = await f.auth.switchTenant(session.token, other.tenantId);
  assert.equal(switched.expiresAt, session.expiresAt, 'Switching cannot renew the authenticated session lifetime');
  assert.equal((await f.auth.verify(switched.token)).namespaceId, other.namespaceId);
  await assert.rejects(f.auth.verify(session.token), { code: 'AUTHENTICATION_FAILED' });
  await f.auth.logout(switched.token);
  await assert.rejects(f.auth.verify(switched.token), { code: 'AUTHENTICATION_FAILED' });
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h2_identities'))).length, 1);
});
test('H2 suspension/resume, metadata revisions, membership removal and signing-key rotation invalidate existing sessions', async t => {
  const f = await authFixture(t); let session = await f.login();
  let state = await f.provisioning.operator.tenant(f.tenant.tenantId);
  await f.provisioning.operator.transition('suspend', state.tenantId, 'suspend', state.version);
  await assert.rejects(f.auth.verify(session.token), { code: 'AUTHENTICATION_FAILED' });
  state = await f.provisioning.operator.tenant(state.tenantId);
  await f.provisioning.operator.transition('resume', state.tenantId, 'resume', state.version);
  await assert.rejects(f.auth.verify(session.token), { code: 'AUTHENTICATION_FAILED' });
  for (const field of ['authorization', 'policy', 'configuration']) {
    session = await f.login();
    await f.db.transaction(c => c.query(`UPDATE h1_revisions SET "${field}" = "${field}" + 1 WHERE tenant_id = ?`, [state.tenantId]));
    await assert.rejects(f.auth.verify(session.token), { code: 'AUTHENTICATION_FAILED' });
  }
  session = await f.login();
  const next = { ...f.config, keyId: 'rotated', signingKey: randomBytes(32) };
  await activateAuthKey(f.db, next);
  await assert.rejects(f.auth.verify(session.token), { code: 'AUTH_KEY_REVOKED' });
  await assert.rejects(HostedAuth.create(f.db, f.config, f.clock), { code: 'AUTH_KEY_REVOKED' });
  await assert.rejects(activateAuthKey(f.db, f.config), { code: 'AUTH_KEY_REUSED' });
  const current = await HostedAuth.create(f.db, next, f.clock);
  session = await current.login(f.email, f.password, f.code(), state.tenantId, 'local');
  const identity = await current.verify(session.token);
  await f.provisioning.removeMember(state.tenantId, identity.userId);
  await assert.rejects(current.verify(session.token), { code: 'AUTHENTICATION_FAILED' });
  f.advance(); await assert.rejects(current.login(f.email, f.password, f.code(), state.tenantId, 'local'), { code: 'AUTHENTICATION_FAILED' });
});
test('H2 durable rate limits survive restart and recover only after their window', async t => {
  const { db, config } = await database(t); let now = 1800000000000;
  let auth = await HostedAuth.create(db, config, () => now);
  for (let i = 0; i < 10; i++) await auth.limit('same-account', 'peer');
  auth = await HostedAuth.create(db, config, () => now);
  await assert.rejects(auth.limit('same-account', 'different-peer'), { code: 'AUTH_RATE_LIMITED' });
  for (let i = 0; i < 40; i++) await auth.limit(`other-${i}`, 'peer');
  await assert.rejects(auth.limit('other-final', 'peer'), { code: 'AUTH_RATE_LIMITED' });
  now += 900000; await auth.limit('same-account', 'peer');
});
test('H2 onboarding is idempotent, secret-free in responses, durable before delivery and resumes failed delivery', async t => {
  const { db, config } = await database(t); const mail = new StubMailTransport(); let fail = true;
  const provision = new HostedProvisioning(db, config, { configured: true, async send(message) { if (fail) throw Error('stub failure'); await mail.send(message); } });
  const input = { name: 'Retry', administrator: { email: 'retry@example.test', name: 'Retry' } };
  await assert.rejects(provision.provision('retry', input), /stub failure/);
  const [state] = await db.transaction(c => c.query('SELECT * FROM h1_tenants'));
  assert.equal(state.state, 'provisioning'); assert.equal((await db.transaction(c => c.query('SELECT * FROM h2_memberships'))).length, 1);
  fail = false; const completed = await provision.provision('retry', input);
  assert.deepEqual(await provision.provision('retry', input), completed); assert.equal(mail.messages.length, 1);
  await assert.rejects(provision.provision('retry', { ...input, name: 'Changed' }), { code: 'OPERATION_ID_REUSED' });
  assert.equal((await db.transaction(c => c.query('SELECT * FROM h1_tenants'))).length, 1);
  assert.ok(!/token|password|secret|email/i.test(JSON.stringify(completed)));
});
