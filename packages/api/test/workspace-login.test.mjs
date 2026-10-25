import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { authFixture, decode32 } from './hosted-helpers.mjs';
import { HostedAuth, LOGIN_SELECTION_MS } from '../dist/hosted-auth.js';
import { digest, totp } from '../dist/auth-crypto.js';

const denied = { code: 'AUTHENTICATION_FAILED', status: 401 };
const rows = (f, sql, args = []) => f.db.transaction(c => c.query(sql, args));
async function member(f, name = 'Second workspace') {
  const op = await f.provisioning.provision(name.replaceAll(' ', '-'), { ...f.input, name });
  const token = f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
  await f.auth.accept(token, f.password, f.code(), 'local'); f.advance();
  return op;
}
async function challenge(f) { const result = await f.auth.login(f.email, f.password, f.code(), undefined, 'local'); f.advance(); return result; }

test('Issue #146 item 3: multi-workspace login lists names/fallback, stores only a digest, consumes TOTP once and issues only on selection', async t => {
  const f = await authFixture(t), second = await member(f);
  await rows(f, 'UPDATE h1_tenants SET display_name = NULL, slug = NULL WHERE tenant_id = ?', [second.tenantId]);
  const before = await rows(f, 'SELECT * FROM h2_sessions'), code = f.code(), now = f.clock();
  const result = await f.auth.login(f.email, f.password, code, '', 'local');
  assert.equal(result.selectionRequired, true); assert.equal(result.email, f.email); assert.equal(result.token, undefined);
  assert.deepEqual(new Map(result.workspaces.map(w => [w.tenantId, w])), new Map([
    [f.tenant.tenantId, { tenantId: f.tenant.tenantId, name: 'Synthetic tenant', slug: 'synthetic-tenant' }],
    [second.tenantId, { tenantId: second.tenantId, name: second.tenantId, slug: null }],
  ]));
  assert.equal(result.selectionExpiresAt, now + LOGIN_SELECTION_MS); assert.ok(LOGIN_SELECTION_MS <= 300000);
  const stored = await rows(f, 'SELECT * FROM h2_login_selections');
  assert.equal(stored.length, 1); assert.equal(stored[0].selection_id, digest(result.selectionToken));
  assert.equal(JSON.stringify(stored).includes(result.selectionToken), false);
  assert.deepEqual(await rows(f, 'SELECT * FROM h2_sessions'), before);
  await assert.rejects(f.auth.login(f.email, f.password, code, undefined, 'local'), denied);
  await assert.rejects(f.auth.login(f.email, f.password, code, f.tenant.tenantId, 'local'), denied);
  const step = (await rows(f, 'SELECT last_step FROM h2_identities WHERE email = ?', [f.email]))[0].last_step;
  const session = await f.auth.completeLogin(result.selectionToken, second.tenantId, 'local');
  assert.equal(session.tenantId, second.tenantId); assert.equal((await f.auth.verify(session.token)).namespaceId, second.namespaceId);
  assert.equal((await rows(f, 'SELECT last_step FROM h2_identities WHERE email = ?', [f.email]))[0].last_step, step);
  await assert.rejects(f.auth.completeLogin(result.selectionToken, f.tenant.tenantId, 'local'), denied);
});

test('Issue #146 item 3: one membership signs in immediately, including omitted/empty and explicit tenant IDs', async t => {
  const f = await authFixture(t);
  for (const id of [undefined, '', f.tenant.tenantId]) {
    const result = await f.auth.login(f.email, f.password, f.code(), id, 'local'); f.advance();
    assert.equal(result.tenantId, f.tenant.tenantId); assert.equal(result.selectionRequired, undefined); assert.ok(result.token);
    assert.equal((await f.auth.verify(result.token)).namespaceId, f.tenant.namespaceId);
  }
  assert.equal((await rows(f, 'SELECT * FROM h2_login_selections')).length, 0);
});

for (const kind of ['no-membership', 'suspended', 'wrong-totp']) test(`Issue #146 item 3: ${kind} has no new enumeration signal`, async t => {
  const f = await authFixture(t);
  if (kind === 'no-membership') await rows(f, "UPDATE h2_memberships SET status = 'removed'");
  if (kind === 'suspended') await rows(f, "UPDATE h1_tenants SET state = 'suspended'");
  await assert.rejects(f.auth.login(f.email, f.password, kind === 'wrong-totp' ? 'invalid' : f.code(), undefined, 'local'), denied);
  assert.equal((await rows(f, 'SELECT * FROM h2_sessions')).length, 0);
  assert.equal((await rows(f, 'SELECT * FROM h2_login_selections')).length, 0);
});

test('Issue #146 item 3: inactive memberships are filtered using the same admission as explicit login', async t => {
  const f = await authFixture(t), second = await member(f);
  for (const change of ["UPDATE h1_tenants SET state = 'suspended' WHERE tenant_id = ?", "UPDATE h2_memberships SET status = 'removed' WHERE tenant_id = ?"]) {
    await rows(f, "UPDATE h1_tenants SET state = 'active' WHERE tenant_id = ?", [second.tenantId]);
    await rows(f, change, [second.tenantId]);
    const result = await challenge(f); assert.ok(result.token); assert.equal(result.tenantId, f.tenant.tenantId);
  }
});

for (const kind of ['expired', 'suspended', 'membership-removed', 'identity-inactive', 'unknown-token', 'invalid-tenant']) test(`Issue #146 item 3: selection rejects ${kind} with the same 401`, async t => {
  const f = await authFixture(t), second = await member(f), result = await challenge(f);
  if (kind === 'expired') f.advance(result.selectionExpiresAt - f.clock());
  if (kind === 'suspended') await rows(f, "UPDATE h1_tenants SET state = 'suspended' WHERE tenant_id = ?", [second.tenantId]);
  if (kind === 'membership-removed') await rows(f, "UPDATE h2_memberships SET status = 'removed' WHERE tenant_id = ?", [second.tenantId]);
  if (kind === 'identity-inactive') await rows(f, "UPDATE h2_identities SET status = 'invited' WHERE email = ?", [f.email]);
  await assert.rejects(f.auth.completeLogin(kind === 'unknown-token' ? randomBytes(32).toString('base64url') : result.selectionToken,
    kind === 'invalid-tenant' ? 'invalid/id' : second.tenantId, 'local'), denied);
  assert.equal((await rows(f, 'SELECT * FROM h2_sessions')).length, 0);
});

test('Issue #146 item 3: disjoint identities see only their workspaces and cannot select each other’s tenants', async t => {
  const f = await authFixture(t), second = await member(f);
  const otherEmail = 'another@example.test', password = randomBytes(24).toString('base64');
  const other = await f.provisioning.provision('other', { name: 'Other identity', administrator: { email: otherEmail, name: 'Other' } });
  const invite = f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
  const enrollment = await f.auth.enroll(invite, password, 'other');
  await f.auth.accept(invite, password, totp(decode32(enrollment.secret), Math.floor(f.clock() / 30000)), 'other'); f.advance();
  const result = await challenge(f);
  assert.deepEqual(new Set(result.workspaces.map(w => w.tenantId)), new Set([f.tenant.tenantId, second.tenantId]));
  await assert.rejects(f.auth.completeLogin(result.selectionToken, other.tenantId, 'local'), denied);
  const otherSession = await f.auth.login(otherEmail, password, totp(decode32(enrollment.secret), Math.floor(f.clock() / 30000)), undefined, 'other');
  assert.equal(otherSession.tenantId, other.tenantId); assert.equal(otherSession.selectionRequired, undefined);
});

test('Issue #146 item 3: concurrent selection admits exactly one session', async t => {
  const f = await authFixture(t), second = await member(f), result = await challenge(f);
  const results = await Promise.allSettled([f.tenant.tenantId, second.tenantId].map(id => f.auth.completeLogin(result.selectionToken, id, 'local')));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'AUTHENTICATION_FAILED');
  assert.equal((await rows(f, 'SELECT * FROM h2_sessions')).length, 1);
});

for (const failingTable of ['h2_login_selections', 'h2_sessions']) test(`Issue #146 item 3: failed ${failingTable} insert rolls back consumption and leaves no partial session/challenge`, async t => {
  const f = await authFixture(t), second = await member(f);
  const faulty = { durable: true, transaction: work => f.db.transaction(c => work({ query: async (sql, args) => {
    if (sql.startsWith(`INSERT INTO ${failingTable}`)) { await c.query(sql, args); throw Error('injected insert failure'); }
    return c.query(sql, args);
  } })), close: async () => {} };
  const auth = await HostedAuth.create(faulty, f.config, f.clock);
  if (failingTable === 'h2_login_selections') {
    const before = await rows(f, 'SELECT last_step FROM h2_identities');
    await assert.rejects(auth.login(f.email, f.password, f.code(), undefined, 'local'), /injected insert failure/);
    assert.deepEqual(await rows(f, 'SELECT last_step FROM h2_identities'), before);
    assert.equal((await rows(f, 'SELECT * FROM h2_login_selections')).length, 0);
    assert.equal((await challenge(f)).selectionRequired, true);
  } else {
    const result = await challenge(f);
    await assert.rejects(auth.completeLogin(result.selectionToken, second.tenantId, 'local'), /injected insert failure/);
    assert.equal((await rows(f, 'SELECT consumed FROM h2_login_selections'))[0].consumed, 0);
    assert.equal((await rows(f, 'SELECT * FROM h2_sessions')).length, 0);
    assert.ok((await f.auth.completeLogin(result.selectionToken, second.tenantId, 'local')).token);
  }
});

test('Issue #146 item 3: selection attempts are limited by subject and peer with generic failures', async t => {
  const f = await authFixture(t); await member(f); const result = await challenge(f);
  const subject = (await rows(f, 'SELECT subject FROM h2_identities WHERE email = ?', [f.email]))[0].subject;
  for (let i = 0; i < 10; i++) await f.auth.limit(subject, 'local');
  await assert.rejects(f.auth.completeLogin(result.selectionToken, f.tenant.tenantId, 'different-peer'), denied);
  assert.equal((await rows(f, 'SELECT * FROM h2_sessions')).length, 0);
});
