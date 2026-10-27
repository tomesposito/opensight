import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { createHostedApiServer, createBuiltinHostedServer } from '../dist/hosted-server.js';
import { hostedConfig } from '../dist/hosted-config.js';
import { HostedAuth } from '../dist/hosted-auth.js';
import { authFixture, database, environment, decode32 } from './hosted-helpers.mjs';
import { digest, totp, unseal } from '../dist/auth-crypto.js';
import { StubMailTransport } from '../dist/mail.js';

function configEnv(config) {
  return { OPENSIGHT_PUBLIC_ORIGIN: config.origin, OPENSIGHT_AUTH_ISSUER: config.issuer, OPENSIGHT_AUTH_AUDIENCE: config.audience,
    OPENSIGHT_AUTH_KEY_ID: config.keyId, OPENSIGHT_AUTH_SIGNING_KEY: config.signingKey.toString('base64'), OPENSIGHT_AUTH_ENCRYPTION_KEY: config.encryptionKey.toString('base64'),
    OPENSIGHT_OPERATOR_KEY: config.operatorKey.toString('base64'), OPENSIGHT_SESSION_SECONDS: String(config.sessionSeconds), OPENSIGHT_INVITATION_SECONDS: String(config.invitationSeconds) };
}
async function serving(t, f, options = {}) {
  const server = await createHostedApiServer({ membershipDatabase: f.db, tenantDatabase: f.db, security: { authenticate: f.auth.authenticate }, builtinAuth: f.auth,
    env: configEnv(f.config), mailTransport: f.mail, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const request = async (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ port: server.address().port, host: '127.0.0.1', path, method,
      headers: { Host: new URL(f.config.origin).host, ...(bytes === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) }), ...headers } }, res => {
      const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    }); req.on('error', reject); req.end(bytes);
  });
  return { request, operator: { authorization: `Operator ${f.config.operatorKey.toString('base64url')}` } };
}
test('Issue #63: HQ-7 bounds hosted sessions to 15–600 minutes', () => {
  const env = environment();
  for (const seconds of ['900', '3600', '36000']) assert.equal(hostedConfig({ ...env, OPENSIGHT_SESSION_SECONDS: seconds }).sessionSeconds, Number(seconds));
  for (const seconds of [undefined, '0', '1', '899', '36001', '86400', '900.5', '0900']) {
    assert.throws(() => hostedConfig({ ...env, OPENSIGHT_SESSION_SECONDS: seconds }), { code: 'HOSTED_CONFIG_INVALID' });
  }
});
test('H2 hosted startup refuses missing verifier, durable stores, trusted origin and missing schema', async t => {
  const f = await database(t), env = configEnv(f.config);
  await assert.rejects(createHostedApiServer({ membershipDatabase: f.db, tenantDatabase: f.db, env }), { code: 'HOSTED_VERIFIER_REQUIRED' });
  await assert.rejects(createHostedApiServer({ membershipDatabase: {}, tenantDatabase: f.db, env, security: { authenticate: () => undefined } }), { code: 'DURABLE_MEMBERSHIP_STORE_REQUIRED' });
  await assert.rejects(createHostedApiServer({ membershipDatabase: f.db, tenantDatabase: f.db, env: {}, security: { authenticate: () => undefined } }), { code: 'HOSTED_CONFIG_INVALID' });
  const server = await createBuiltinHostedServer({ membershipDatabase: f.db, tenantDatabase: f.db, env }); server.close();
  await f.db.transaction(c => c.query('DROP TABLE h2_memberships'));
  await assert.rejects(createHostedApiServer({ membershipDatabase: f.db, tenantDatabase: f.db, env, security: { authenticate: () => undefined } }));
});
test('H2 HTTP rejects forged principal headers, body/subject claims, foreign host/origin and cross-tenant paths', async t => {
  const f = await authFixture(t), session = await f.login(), { request } = await serving(t, f), headers = { authorization: `Bearer ${session.token}` };
  let result = await request('/api/session', { headers });
  assert.equal(result.status, 200); assert.equal(result.body.tenantId, f.tenant.tenantId); assert.equal(result.body.role, 'administrator'); assert.equal(result.headers['cache-control'], 'no-store');
  for (const name of ['x-user', 'x-user-id', 'x-principal', 'x-groups', 'x-group-ids', 'x-namespace', 'x-namespace-id', 'x-tenant', 'x-tenant-id', 'x-subject', 'x-role', 'x-roles', 'x-capabilities']) {
    result = await request('/api/session', { headers: { ...headers, [name]: 'forged' } }); assert.equal(result.body.errorCode, 'FORGED_PRINCIPAL');
  }
  for (const forged of [{ Host: 'foreign.example' }, { origin: 'https://foreign.example' }, { 'x-forwarded-host': new URL(f.config.origin).host }, { forwarded: 'host=forged' }]) {
    result = await request('/api/session', { headers: { ...headers, ...forged } }); assert.equal(result.body.errorCode, 'UNTRUSTED_ORIGIN');
  }
  for (const field of ['subject', 'userId', 'namespaceId', 'issuer', 'audience', 'security']) {
    result = await request('/api/auth/login', { method: 'POST', body: { email: f.email, password: f.password, code: f.code(), tenantId: f.tenant.tenantId, [field]: 'forged' } }); assert.equal(result.body.errorCode, 'FORGED_PRINCIPAL');
  }
  assert.equal((await request('/api/session?userId=forged', { headers })).status, 400);
  assert.equal((await request('/api/session', { headers, body: { subject: 'forged' } })).status, 400);
  assert.equal((await request('/api/namespaces/foreign/session', { headers })).body.errorCode, 'RESOURCE_NOT_FOUND');
  assert.equal((await request(`/api/namespaces/${f.tenant.namespaceId}/session`, { headers })).status, 200);
});
test('H2 no unauthenticated fallback exists on fixture, embed, source, automation, unknown or session routes', async t => {
  const f = await authFixture(t), { request, operator } = await serving(t, f), session = await f.login();
  for (const path of ['/api/session', '/api/assets', '/analyses', '/api/datasets/sales/query', '/api/prep-sources', '/embed/forged', '/api/automation-status', '/unknown']) {
    for (const headers of [{}, { authorization: 'Bearer forged' }, operator]) assert.equal((await request(path, { headers })).status, 401, path);
    if (path !== '/api/session') {
      const authorized = await request(path, { headers: { authorization: `Bearer ${session.token}` } });
      if (path === '/api/prep-sources') assert.deepEqual(authorized.body, []);
      else if (path === '/api/automation-status') { assert.equal(authorized.status, 200); assert.equal(authorized.body.persistence, 'durable'); }
      else assert.equal(authorized.body.errorCode, path === '/api/datasets/sales/query' ? 'HOSTED_REQUEST_INVALID' : 'HOSTED_CAPABILITY_UNAVAILABLE');
    }
  }
});
test('H2 tenant administrators cannot provision or use operator credentials as tenant sessions', async t => {
  const f = await authFixture(t), { request, operator } = await serving(t, f), session = await f.login(), tenantHeaders = { authorization: `Bearer ${session.token}` };
  for (const [path, method] of [['/api/host/tenants', 'POST'], [`/api/host/tenants/${f.tenant.tenantId}/suspend`, 'POST'], [`/api/host/tenants/${f.tenant.tenantId}/resume`, 'POST'], [`/api/host/tenants/${f.tenant.tenantId}`, 'DELETE']]) {
    assert.equal((await request(path, { method, headers: tenantHeaders, body: {} })).body.errorCode, 'OPERATOR_REQUIRED');
  }
  for (const path of ['/api/namespaces/new', '/api/users/new']) assert.equal((await request(path, { method: 'PUT', headers: tenantHeaders, body: {} })).body.errorCode, 'OPERATOR_REQUIRED');
  assert.equal((await request('/api/invitations', { method: 'PUT', headers: tenantHeaders, body: {} })).status, 405);
  assert.equal((await request('/api/users', { headers: tenantHeaders })).status, 200);
  assert.equal((await request('/api/session', { headers: operator })).status, 401);
  assert.equal((await request(`/api/host/tenants/${f.tenant.tenantId}`, { headers: { ...operator, origin: f.config.origin } })).body.errorCode, 'OPERATOR_REQUIRED');
});
test('H2 HTTP onboarding, enrollment, login, switching, logout and lifecycle gates compose end to end', async t => {
  const f = await database(t), env = configEnv(f.config), mail = new StubMailTransport(); let now = Math.floor(Date.now() / 30000) * 30000;
  const auth = await HostedAuth.create(f.db, f.config, () => now);
  const { request, operator } = await serving(t, { ...f, auth, mail });
  const input = { name: 'Tenant', administrator: { email: 'http@example.test', name: 'Synthetic administrator' } };
  let result = await request('/api/host/tenants', { method: 'POST', headers: { ...operator, 'idempotency-key': 'onboard-http' }, body: input });
  assert.equal(result.status, 201); const tenant = result.body;
  assert.equal((await request('/api/host/tenants', { method: 'POST', headers: { ...operator, 'idempotency-key': 'onboard-http' }, body: input })).body.tenantId, tenant.tenantId);
  assert.equal((await request('/api/host/tenants', { method: 'POST', headers: { ...operator, 'idempotency-key': 'onboard-http' }, body: { ...input, name: 'Other' } })).status, 409);
  assert.equal((await request(`/api/host/operations/${tenant.operationId}`, { headers: operator })).body.status, 'complete');
  const invitationToken = mail.messages[0].html.match(/<code>([^<]+)<\/code>/)[1], password = randomBytes(24).toString('base64');
  result = await request('/api/auth/enroll', { method: 'POST', body: { invitationToken, password } }); assert.equal(result.status, 200);
  const secret = decode32(result.body.secret), code = () => totp(secret, Math.floor(now / 30000));
  assert.equal((await request('/api/auth/accept', { method: 'POST', body: { invitationToken, password, code: code() } })).status, 200); now += 30000;
  result = await request('/api/auth/login', { method: 'POST', body: { email: input.administrator.email, password, code: code(), tenantId: tenant.tenantId } }); assert.equal(result.status, 200);
  let headers = { authorization: `Bearer ${result.body.token}` };
  assert.equal((await request('/api/session', { headers })).status, 200);
  result = await request('/api/auth/switch', { method: 'POST', headers, body: { tenantId: tenant.tenantId } }); assert.equal(result.status, 200);
  assert.equal((await request('/api/session', { headers })).status, 401); headers = { authorization: `Bearer ${result.body.token}` };
  assert.equal((await request('/api/auth/logout', { method: 'POST', headers, body: {} })).status, 200);
  assert.equal((await request('/api/session', { headers })).status, 401); now += 30000;
  result = await request('/api/auth/login', { method: 'POST', body: { email: input.administrator.email, password, code: code(), tenantId: tenant.tenantId } }); headers = { authorization: `Bearer ${result.body.token}` };
  for (const [action, version] of [['suspend', 2], ['resume', 3], ['delete', 4]]) {
    result = await request(`/api/host/tenants/${tenant.tenantId}${action === 'delete' ? '' : `/${action}`}`, { method: action === 'delete' ? 'DELETE' : 'POST', headers: { ...operator, 'idempotency-key': action }, body: { expectedVersion: version } });
    assert.equal(result.status, 200); assert.equal((await request('/api/session', { headers })).status, 401);
  }
  now += 30000;
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: input.administrator.email, password, code: code(), tenantId: tenant.tenantId } })).status, 401);
  assert.equal((await request(`/api/host/tenants/${tenant.tenantId}`, { headers: operator })).body.state, 'deleting');
});
test('H2 verifier routing keeps current membership authoritative and never falls back after an adapter rejects', async t => {
  const f = await authFixture(t), token = (await f.login()).token, identity = await f.auth.verify(token);
  const { request } = await serving(t, f, { security: { authenticate: req => req.headers.authorization === 'Test verified' ? identity : undefined } });
  assert.equal((await request('/api/session')).status, 401);
  assert.equal((await request('/api/session', { headers: { authorization: `Bearer ${token}` } })).status, 401);
  assert.equal((await request('/api/session', { headers: { authorization: 'Test verified' } })).status, 200);
  await f.provisioning.removeMember(f.tenant.tenantId, identity.userId);
  assert.equal((await request('/api/session', { headers: { authorization: 'Test verified' } })).status, 401);
});
test('H2 CLI refuses accidental fixture fallback, malformed config and unsupported arguments before listening', async () => {
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const partialSettings = ['OPENSIGHT_AUTH_KEY_ID', 'OPENSIGHT_PUBLIC_ORIGIN', 'OPENSIGHT_OPERATOR_KEY', 'OPENSIGHT_SESSION_SECONDS', 'OPENSIGHT_INVITATION_SECONDS', 'OPENSIGHT_METADATA_DATABASE'].map(key => [{ [key]: 'present' }, [], 'HOSTED_MODE_REQUIRED']);
  for (const [env, args, expected] of [...partialSettings, [{ OPENSIGHT_MODE: 'hosted' }, [], 'HOSTED_CONFIG_INVALID'], [{ OPENSIGHT_MODE: 'unknown' }, [], 'HOSTED_MODE_REQUIRED'], [{ OPENSIGHT_MODE: 'fixture' }, ['rotate-auth-key'], 'CLI_ARGUMENT_INVALID']]) {
    const result = await new Promise(resolve => {
      const child = spawn(process.execPath, [cli, ...args], { env: { PATH: process.env.PATH, TZ: 'UTC', ...env } }); let out = '';
      child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { out += b; }); child.on('exit', status => resolve({ status, out }));
    });
    assert.equal(result.status, 1); assert.ok(result.out.includes(expected)); assert.ok(!result.out.includes('listening'));
  }
});

test('H2 operator invitations preprovision users, revoke stale sessions, and preserve global idempotency across routes', async t => {
  const f = await authFixture(t), { request, operator } = await serving(t, f), old = await f.login();
  const path = `/api/host/tenants/${f.tenant.tenantId}/invitations`, headers = { ...operator, 'idempotency-key': 'additional-member' };
  const input = { email: 'additional@example.test', name: 'Additional reader', role: 'reader' };
  const first = await request(path, { method: 'POST', headers, body: input }); assert.equal(first.status, 201);
  assert.deepEqual(Object.keys(first.body).sort(), ['operationId', 'tenantId']);
  assert.deepEqual((await request(path, { method: 'POST', headers, body: input })).body, first.body); assert.equal(f.mail.messages.length, 2);
  assert.equal((await request(path, { method: 'POST', headers, body: { ...input, role: 'administrator' } })).body.errorCode, 'OPERATION_ID_REUSED');
  assert.equal((await request(`/api/host/tenants/${f.tenant.tenantId}/suspend`, { method: 'POST', headers, body: { expectedVersion: 2 } })).body.errorCode, 'OPERATION_ID_REUSED');
  assert.equal((await request('/api/session', { headers: { authorization: `Bearer ${old.token}` } })).status, 401);
  const session = await f.login(), members = (await request('/api/users', { headers: { authorization: `Bearer ${session.token}` } })).body;
  assert.equal(members.length, 2); const invited = members.find(u => u.name === input.name); assert.ok(invited);
  const membership = (await f.db.transaction(c => c.query('SELECT status FROM h2_memberships WHERE user_id = ?', [invited.id])))[0]; assert.equal(membership.status, 'invited');
  const invitationToken = f.mail.messages[1].html.match(/<code>([^<]+)<\/code>/)[1], password = randomBytes(24).toString('base64');
  const enrolled = await request('/api/auth/enroll', { method: 'POST', body: { invitationToken, password } }); assert.equal(enrolled.status, 200);
  const readerSecret = decode32(enrolled.body.secret), readerCode = () => totp(readerSecret, Math.floor(f.clock() / 30000));
  assert.equal((await request('/api/auth/accept', { method: 'POST', body: { invitationToken, password, code: readerCode() } })).status, 200); f.advance();
  const reader = await request('/api/auth/login', { method: 'POST', body: { email: input.email, password, code: readerCode(), tenantId: f.tenant.tenantId } }); assert.equal(reader.status, 200);
  const readerHeaders = { authorization: `Bearer ${reader.body.token}` };
  assert.equal((await request('/api/users', { headers: readerHeaders })).body.errorCode, 'SECURITY_ADMIN_REQUIRED');
  assert.equal((await request('/api/session', { headers: readerHeaders })).body.role, 'reader');
  const remove = `/api/host/tenants/${f.tenant.tenantId}/users/${invited.id}`;
  assert.equal((await request(remove, { method: 'DELETE', headers: operator, body: {} })).status, 200);
  assert.equal((await request(remove, { method: 'DELETE', headers: operator, body: {} })).status, 200);
  assert.equal((await request('/api/session', { headers: readerHeaders })).status, 401);
  assert.equal((await request('/api/auth/enroll', { method: 'POST', body: { invitationToken, password: randomBytes(24).toString('base64') } })).status, 401);
  assert.equal((await request('/api/host/tenants', { method: 'POST', headers, body: f.input })).body.errorCode, 'OPERATION_ID_REUSED');
});

test('Issue 150: tenant administrator creates all five roles, lists metadata only, and enrolls Reader AI without losing the admin session', async t => {
  const f = await authFixture(t);
  f.config = { ...f.config, invitationSeconds: 604800 };
  const { request } = await serving(t, f), session = await f.login();
  const administrator = await f.auth.verify(session.token);
  const headers = { authorization: `Bearer ${session.token}`, origin: f.config.origin };
  assert.deepEqual((await request('/api/invitations', { headers })).body, []);
  const created = [];
  for (const role of ['administrator', 'author', 'author_ai', 'reader', 'reader_ai']) {
    const input = { email: `${role}@example.test`, name: `Invited ${role}`, role };
    const before = Date.now();
    const result = await request('/api/invitations', { method: 'POST', headers, body: input });
    assert.equal(result.status, 201); assert.equal(result.headers['cache-control'], 'no-store');
    const { invitation, token } = result.body; created.push(result.body);
    assert.deepEqual(Object.keys(result.body).sort(), ['invitation', 'token']);
    assert.deepEqual(invitation, { id: invitation.id, namespaceId: f.tenant.namespaceId, ...input, expiresAt: invitation.expiresAt });
    assert.ok(Date.parse(invitation.expiresAt) >= before + 7 * 86400000);
    assert.ok(Date.parse(invitation.expiresAt) <= Date.now() + 7 * 86400000);
    assert.ok(/^[A-Za-z0-9_-]{43}$/.test(token));
    const [stored] = await f.db.transaction(c => c.query('SELECT * FROM h2_invitations WHERE invitation_id = ?', [invitation.id]));
    assert.equal(stored.token_hash, digest(token)); assert.ok(!JSON.stringify(stored).includes(token));
    assert.ok(unseal(stored.token_secret, f.config.encryptionKey, `invitation:${invitation.id}`) === token);
    assert.ok(f.mail.messages.at(-1).html.includes(token));
  }
  const pending = await request('/api/invitations', { headers });
  assert.equal(pending.status, 200); assert.equal(pending.body.length, 5);
  assert.deepEqual(new Set(pending.body.map(i => i.id)), new Set(created.map(c => c.invitation.id)));
  assert.ok(!/token|secret|hash/.test(JSON.stringify(pending.body)));
  assert.equal((await request('/api/session', { headers })).status, 200);
  const users = (await request('/api/users', { headers })).body;
  assert.equal(users.length, 6); assert.ok(users.every(u => u.namespaceId === f.tenant.namespaceId));
  const audit = await f.db.transaction(c => c.query('SELECT actor, detail FROM h8_audit WHERE tenant_id = ? AND action = ?', [f.tenant.tenantId, 'membership.invited']));
  assert.equal(audit.filter(a => a.actor === administrator.userId).length, 5);
  for (const { token } of created) assert.ok(!JSON.stringify(audit).includes(token));
  const { token: invitationToken, invitation } = created.at(-1), password = randomBytes(24).toString('base64');
  const enrolled = await request('/api/auth/enroll', { method: 'POST', body: { invitationToken, password } });
  assert.equal(enrolled.status, 200);
  const secret = decode32(enrolled.body.secret), code = () => totp(secret, Math.floor(f.clock() / 30000));
  // Possession of another identity's password cannot accept this invitation.
  assert.equal((await request('/api/auth/accept', { method: 'POST', body: { invitationToken, password: f.password, code: f.code() } })).status, 401);
  const accept = () => request('/api/auth/accept', { method: 'POST', body: { invitationToken, password, code: code() } });
  assert.deepEqual((await accept()).body, { accepted: true });
  // Existing authenticated replays acknowledge completion without issuing credentials.
  assert.deepEqual((await accept()).body, { accepted: true });
  f.advance();
  const login = await request('/api/auth/login', { method: 'POST', body: { email: invitation.email, password, code: code() } });
  assert.equal(login.status, 200); assert.equal(login.body.tenantId, f.tenant.tenantId);
  const readerHeaders = { authorization: `Bearer ${login.body.token}` };
  assert.equal((await request('/api/session', { headers: readerHeaders })).body.role, 'reader_ai');
  assert.equal((await request(`/api/invitations/${invitation.id}`, { method: 'DELETE', headers })).body.errorCode, 'RESOURCE_NOT_FOUND');
  assert.equal((await request('/api/invitations', { headers })).body.length, 4);
  assert.equal((await request('/api/users', { headers: readerHeaders })).body.errorCode, 'SECURITY_ADMIN_REQUIRED');
  const member = users.find(u => u.role === 'reader_ai');
  assert.equal((await request(`/api/users/${member.id}`, { method: 'DELETE', headers })).body.errorCode, 'OPERATOR_REQUIRED');
  assert.equal((await request(`/api/host/tenants/${f.tenant.tenantId}/users/${member.id}`, { method: 'DELETE', headers, body: {} })).body.errorCode, 'OPERATOR_REQUIRED');
});

test('Issue 150: revoked and expired invitations cannot enroll or accept, including revocation during enrollment', async t => {
  const f = await authFixture(t), { request } = await serving(t, f);
  const headers = { authorization: `Bearer ${(await f.login()).token}` };
  for (const state of ['revoked', 'expired']) {
    const input = { email: `${state}@example.test`, name: state, role: 'reader_ai' };
    const result = await request('/api/invitations', { method: 'POST', headers, body: input }); assert.equal(result.status, 201);
    const { token: invitationToken, invitation } = result.body, password = randomBytes(24).toString('base64');
    const enrolled = await request('/api/auth/enroll', { method: 'POST', body: { invitationToken, password } }); assert.equal(enrolled.status, 200);
    const code = totp(decode32(enrolled.body.secret), Math.floor(f.clock() / 30000));
    if (state === 'revoked') {
      assert.deepEqual((await request(`/api/invitations/${invitation.id}`, { method: 'DELETE', headers })).body, { deleted: true });
      const [stored] = await f.db.transaction(c => c.query('SELECT token_secret FROM h2_invitations WHERE invitation_id = ?', [invitation.id]));
      assert.equal(stored.token_secret, '');
    } else await f.db.transaction(c => c.query('UPDATE h2_invitations SET expires_at = ? WHERE invitation_id = ?', [Math.min(Date.now(), f.clock()) - 1, invitation.id]));
    for (const endpoint of ['enroll', 'accept']) {
      const denied = await request(`/api/auth/${endpoint}`, { method: 'POST', body: { invitationToken, password, ...(endpoint === 'accept' ? { code } : {}) } });
      assert.equal(denied.status, 401); assert.equal(denied.body.errorCode, 'AUTHENTICATION_FAILED');
    }
    const replay = await request(`/api/invitations/${invitation.id}`, { method: 'DELETE', headers });
    assert.equal(replay.status, 404); assert.equal(replay.body.errorCode, 'RESOURCE_NOT_FOUND');
    assert.deepEqual((await request('/api/invitations', { headers })).body, []);
  }
  assert.equal((await request('/api/session', { headers })).status, 200);
});

test('Issue 150: all non-admin roles and unauthenticated callers are refused tenant invitations', async t => {
  const f = await authFixture(t), { request } = await serving(t, f), session = await f.login();
  const identity = await f.auth.verify(session.token), headers = { authorization: `Bearer ${session.token}` };
  const attempts = [['/api/invitations', 'GET'], ['/api/invitations', 'POST'], ['/api/invitations/pending', 'DELETE']];
  for (const role of ['author', 'author_ai', 'reader', 'reader_ai']) {
    await f.db.transaction(c => c.query("UPDATE h1_resources SET body = ? WHERE tenant_id = ? AND kind = 'user' AND resource_id = ?", [JSON.stringify({ name: 'Non-admin', role }), f.tenant.tenantId, identity.userId]));
    for (const [path, method] of attempts) {
      const result = await request(path, { method, headers, ...(method === 'POST' ? { body: { email: 'forbidden@example.test', name: 'Forbidden', role: 'administrator' } } : {}) });
      assert.equal(result.status, 403); assert.equal(result.body.errorCode, 'SECURITY_ADMIN_REQUIRED');
    }
  }
  for (const [path, method] of attempts) assert.equal((await request(path, { method })).status, 401);
  assert.equal(f.mail.messages.length, 1);
});

test('Issue 150: tenant invitation and user routes fail closed across tenants and forged scope inputs', async t => {
  const f = await authFixture(t), { request } = await serving(t, f);
  const other = await f.provisioning.provision('other-tenant', { name: 'Other workspace', administrator: { email: 'other-admin@example.test', name: 'Other administrator' } });
  await f.provisioning.inviteMember('other-invite', other.tenantId, { email: 'other-reader@example.test', name: 'Other reader', role: 'reader' });
  const [foreign] = await f.db.transaction(c => c.query('SELECT invitation_id, token_secret FROM h2_invitations WHERE tenant_id = ? AND accepted = 0 ORDER BY invitation_id', [other.tenantId]));
  const headers = { authorization: `Bearer ${(await f.login()).token}` }, input = { email: 'scoped@example.test', name: 'Scoped', role: 'reader_ai' };
  for (const [field, value] of [['tenantId', other.tenantId], ['namespaceId', other.namespaceId], ['userId', 'forged'], ['subject', 'forged']]) {
    const result = await request('/api/invitations', { method: 'POST', headers, body: { ...input, [field]: value } });
    assert.equal(result.status, 403); assert.equal(result.body.errorCode, 'FORGED_PRINCIPAL');
  }
  for (const [suffix, method] of [['invitations', 'GET'], ['users', 'GET'], ['invitations', 'POST'], [`invitations/${foreign.invitation_id}`, 'DELETE']]) {
    const result = await request(`/api/namespaces/${other.namespaceId}/${suffix}`, { method, headers, ...(method === 'POST' ? { body: input } : {}) });
    assert.equal(result.status, 404); assert.equal(result.body.errorCode, 'RESOURCE_NOT_FOUND');
  }
  assert.equal((await request(`/api/invitations/${foreign.invitation_id}`, { method: 'DELETE', headers })).body.errorCode, 'RESOURCE_NOT_FOUND');
  assert.equal((await request(`/api/invitations/${foreign.invitation_id}`, { method: 'DELETE', headers, body: { tenantId: other.tenantId } })).body.errorCode, 'FORGED_PRINCIPAL');
  assert.equal((await request(`/api/host/tenants/${other.tenantId}/invitations`, { method: 'POST', headers, body: input })).body.errorCode, 'OPERATOR_REQUIRED');
  const listed = await request('/api/invitations', { headers }); assert.deepEqual(listed.body, []);
  const users = (await request('/api/users', { headers })).body;
  assert.equal(users.length, 1); assert.ok(users.every(u => u.namespaceId === f.tenant.namespaceId));
  const [unchanged] = await f.db.transaction(c => c.query('SELECT token_secret FROM h2_invitations WHERE invitation_id = ?', [foreign.invitation_id]));
  assert.ok(unchanged.token_secret === foreign.token_secret);
  const own = await request(`/api/namespaces/${f.tenant.namespaceId}/invitations`, { method: 'POST', headers, body: input });
  assert.equal(own.status, 201); assert.equal(own.body.invitation.namespaceId, f.tenant.namespaceId);
  for (const bad of [{ ...input, role: 'operator' }, { ...input, email: 'bad' }, { ...input, name: '' }, { id: 'legacy', name: 'Legacy', role: 'reader' }]) {
    assert.equal((await request('/api/invitations', { method: 'POST', headers, body: bad })).status, 400);
  }
  assert.equal((await request('/api/invitations', { method: 'POST', headers, body: input })).body.errorCode, 'MEMBERSHIP_EXISTS');
});

test('Issue 150: invitation management is admitted in hosted invocation mode', async t => {
  const f = await authFixture(t);
  await serving(t, f); // Initialize the same durable schemas as a migrated deployment.
  const { request } = await serving(t, f, { invocation: { signal: new AbortController().signal } });
  const headers = { authorization: `Bearer ${(await f.login()).token}` };
  const created = await request('/api/invitations', { method: 'POST', headers, body: { email: 'invocation@example.test', name: 'Invocation', role: 'reader_ai' } });
  assert.equal(created.status, 201);
  assert.equal((await request('/api/invitations', { headers })).body.length, 1);
  assert.equal((await request(`/api/invitations/${created.body.invitation.id}`, { method: 'DELETE', headers })).status, 200);
});

test('H2 hosted CLI starts with private durable storage and its key-rotation command revokes a running process', async t => {
  const f = await authFixture(t), session = await f.login(), cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const env = { PATH: process.env.PATH, TZ: 'UTC', ...configEnv(f.config), OPENSIGHT_MODE: 'hosted', OPENSIGHT_METADATA_DATABASE: f.path, PORT: '0' };
  const child = spawn(process.execPath, [cli], { env });
  const exit = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => { child.kill('SIGTERM'); await exit; });
  const port = await new Promise((resolve, reject) => {
    let out = ''; const timeout = setTimeout(() => reject(Error('Hosted CLI did not start')), 15000);
    child.once('exit', () => { clearTimeout(timeout); reject(Error('Hosted CLI exited before listening')); });
    child.stdout.on('data', bytes => { out += bytes; const match = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(out); if (match) { clearTimeout(timeout); resolve(Number(match[1])); } });
    child.stderr.resume();
  });
  const inspect = () => new Promise((resolve, reject) => {
    const req = httpRequest({ port, hostname: '127.0.0.1', path: '/api/session', headers: { Host: new URL(f.config.origin).host, authorization: `Bearer ${session.token}` } }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.end();
  });
  assert.equal(await inspect(), 200); assert.equal((await stat(f.path)).mode & 0o777, 0o600);
  const rotation = spawn(process.execPath, [cli, 'rotate-auth-key'], { env: { ...env, OPENSIGHT_AUTH_KEY_ID: 'cli-rotated', OPENSIGHT_AUTH_SIGNING_KEY: randomBytes(32).toString('base64') } });
  rotation.stdout.resume(); rotation.stderr.resume();
  assert.equal(await new Promise(resolve => rotation.once('exit', resolve)), 0);
  assert.equal(await inspect(), 401);
});

import { polishEndpoints } from './polish-endpoints.mjs';
test('Issue #35: every query, O, upload and prep endpoint requires a verified hosted tenant session', async t => {
  const f = await authFixture(t), { request, operator } = await serving(t, f);
  for (const [path, method] of polishEndpoints) {
    const body = method === 'POST' || method === 'PUT' ? {} : undefined;
    for (const headers of [{}, { authorization: 'Bearer local' }, operator]) {
      const denied = await request(path, { method, body, headers });
      assert.equal(denied.status, 401, `${method} ${path}`);
      assert.equal(denied.body.errorCode, 'AUTHENTICATION_FAILED', path);
    }
    const forged = await request(path, { method, body, headers: { 'x-user-id': 'local' } });
    assert.equal(forged.status, 403, path); assert.equal(forged.body.errorCode, 'FORGED_PRINCIPAL', path);
  }
});

test('#91 hosted invocation exposes only the approved quota explanation after authentication', async t => {
  const { storageQuotaError } = await import('../dist/storage-breakdown.js');
  const { MetadataError } = await import('../dist/metadata-db.js');
  const { initializeEmbedding } = await import('../dist/embedding-config.js');
  const { initializeJobs } = await import('../dist/job-schema.js');
  const f = await authFixture(t); await initializeEmbedding(f.db); await initializeJobs(f.db);
  const session = await f.login(); let failure = storageQuotaError({ limitBytes: 1048576, totalBytes: 900000, metadataBytes: 0,
    liveBytes: 0, reservedBytes: 900000, pendingCleanupBytes: 900000, pendingCleanup: [{ id: 'private-object-id' }], nextReclamationAt: null, overdueCount: 0 }, 200000);
  const { request } = await serving(t, f, { invocation: { signal: new AbortController().signal, compose: () => ({ allows: () => true,
    route: async () => { throw failure; }, finish: async () => {} }) } });
  const path = '/api/uploads/reservations';
  const denied = await request(path, { method: 'POST', body: {} });
  assert.notEqual(denied.status, 429); assert.equal(denied.body.Message, undefined);
  const headers = { authorization: `Bearer ${session.token}` };
  const quota = await request(path, { method: 'POST', body: {}, headers });
  assert.equal(quota.status, 429); assert.equal(quota.body.errorCode, 'USAGE_LIMIT_EXCEEDED');
  assert.match(quota.body.Message, /Storage limit 1 MiB exceeded/); assert.match(quota.body.Message, /retained/);
  assert.doesNotMatch(JSON.stringify(quota.body), /private-object-id/); assert.equal(quota.body.detail, undefined);
  failure = new MetadataError('USAGE_LIMIT_EXCEEDED', 429, { summary: 'private hostname and key' });
  const forged = await request(path, { method: 'POST', body: {}, headers });
  assert.deepEqual(forged.body, { errorCode: 'USAGE_LIMIT_EXCEEDED' });
});

test('Issue #146 items 1/3/4: operator slug input and session workspace labels travel over HTTP', async t => {
  const f = await authFixture(t), { request, operator } = await serving(t, f);
  const created = await request('/api/host/tenants', { method: 'POST', headers: { ...operator, 'idempotency-key': 'named-http' }, body: { ...f.input, name: 'HTTP name', slug: 'explicit-http' } });
  assert.equal(created.status, 201);
  assert.equal((await f.db.transaction(c => c.query('SELECT slug FROM h1_tenants WHERE tenant_id = ?', [created.body.tenantId])))[0].slug, 'explicit-http');
  const session = await f.login(), headers = { authorization: `Bearer ${session.token}` };
  let result = await request('/api/session', { headers });
  assert.equal(result.body.workspaceName, 'Synthetic tenant'); assert.equal(result.body.workspaceSlug, 'synthetic-tenant');
  await f.db.transaction(c => c.query('UPDATE h1_tenants SET display_name = NULL, slug = NULL WHERE tenant_id = ?', [f.tenant.tenantId]));
  result = await request('/api/session', { headers });
  assert.equal(result.body.workspaceName, f.tenant.tenantId); assert.equal(result.body.workspaceSlug, null);
});

test('Issue #146 item 3: HTTP selection uses the login boundary and completes through invocation gating', async t => {
  const f = await authFixture(t);
  const second = await f.provisioning.provision('http-second', { ...f.input, name: 'Second HTTP workspace' });
  const invite = f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
  await f.auth.accept(invite, f.password, f.code(), 'local'); f.advance();
  // Initialize auxiliary schemas, then exercise the serverless invocation boundary.
  await serving(t, f);
  const { request } = await serving(t, f, { invocation: { capabilities: {} } });
  const path = '/api/auth/login/select';
  for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await request(path, { method })).status, 405);
  for (const headers of [{ authorization: 'Bearer stale' }, { cookie: 'stale=1' }]) {
    const bad = await request(path, { method: 'POST', headers, body: {} });
    assert.equal(bad.status, 400); assert.equal(bad.body.errorCode, 'HOSTED_REQUEST_INVALID');
  }
  let result = await request('/api/auth/login', { method: 'POST', body: { email: f.email, password: f.password, code: f.code() } });
  assert.equal(result.status, 200); assert.equal(result.body.selectionRequired, true); assert.equal(result.body.token, undefined);
  const selectionToken = result.body.selectionToken;
  result = await request(path, { method: 'POST', body: { selectionToken, tenantId: 'nonmember' } });
  assert.equal(result.status, 401); assert.equal(result.body.errorCode, 'AUTHENTICATION_FAILED');
  result = await request(path, { method: 'POST', body: { selectionToken, tenantId: second.tenantId } });
  assert.equal(result.status, 200); assert.equal(result.body.tenantId, second.tenantId); assert.ok(result.body.token);
  const replay = await request(path, { method: 'POST', body: { selectionToken, tenantId: second.tenantId } });
  assert.equal(replay.status, 401); assert.equal(replay.body.errorCode, 'AUTHENTICATION_FAILED');
  const unavailable = await serving(t, f, { builtinAuth: undefined });
  assert.equal((await unavailable.request(path, { method: 'POST', body: {} })).body.errorCode, 'BUILTIN_AUTH_UNAVAILABLE');
});

test('Issue #152: an MFA session accepts its own second workspace invitation once, without resetting credentials or issuing a session', async t => {
  const f = await authFixture(t), login = await f.login(), { request } = await serving(t, f);
  const headers = {authorization:`Bearer ${login.token}`};
  const other = await f.provisioning.provision('browser-second', {name:'Second workspace',administrator:{email:f.email,name:'Existing admin'}});
  const token = f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
  const before = await f.db.transaction(c=>c.query('SELECT password_hash, totp_secret, last_step FROM h2_identities'));
  assert.deepEqual(await f.auth.enroll(token,f.password,'local'),{enrollmentRequired:false});
  const results = await Promise.all([1,2].map(()=>request('/api/invitations/accept',{method:'POST',headers,body:{token}})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.deepEqual(results.find(r=>r.status===200).body,{accepted:true});
  assert.equal(results.find(r=>r.status===409).body.errorCode,'INVITATION_USED');
  assert.deepEqual(await f.db.transaction(c=>c.query('SELECT password_hash, totp_secret, last_step FROM h2_identities')),before);
  assert.equal((await request('/api/session',{headers})).body.tenantId,f.tenant.tenantId);
  const selection = await request('/api/auth/login',{method:'POST',body:{email:f.email,password:f.password,code:f.code()}});
  assert.equal(selection.status,200); assert.equal(selection.body.selectionRequired,true);
  assert.ok(selection.body.workspaces.some(w=>w.tenantId===other.tenantId));
});

test('Issue #152: hosted session acceptance rejects forged identity, another user, expired/revoked links and suspended workspaces', async t => {
  const f = await authFixture(t), login = await f.login(), { request } = await serving(t, f);
  const headers = {authorization:`Bearer ${login.token}`};
  for (const state of ['foreign','expired','revoked','suspended']) {
    const other = await f.provisioning.provision(`accept-${state}`,{name:`Workspace ${state}`,administrator:{email:state==='foreign'?'foreign@example.test':f.email,name:'Admin'}});
    const token=f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
    if(state==='expired'||state==='revoked') await f.db.transaction(c=>c.query('UPDATE h2_invitations SET expires_at = ? WHERE tenant_id = ?',[state==='revoked'?0:f.clock()-1,other.tenantId]));
    if(state==='suspended') await f.provisioning.transition('suspend-accept',other.tenantId,'suspend',2);
    const result=await request('/api/invitations/accept',{method:'POST',headers,body:{token}});
    assert.equal(result.body.errorCode,{foreign:'SECURITY_INVITATION_PRINCIPAL_MISMATCH',expired:'INVITATION_EXPIRED',revoked:'INVITATION_REVOKED',suspended:'TENANT_UNAVAILABLE'}[state]);
    assert.equal((await f.db.transaction(c=>c.query('SELECT accepted FROM h2_invitations WHERE tenant_id = ?',[other.tenantId])))[0].accepted,0);
    assert.equal((await request('/api/invitations/accept',{method:'POST',headers,body:{token,subject:f.email}})).body.errorCode,'FORGED_PRINCIPAL');
    assert.equal((await request('/api/invitations/accept',{method:'POST',body:{token}})).status,401);
  }
});
