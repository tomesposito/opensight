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
import { totp } from '../dist/auth-crypto.js';
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
      else assert.equal(authorized.body.errorCode, path === '/api/datasets/sales/query' ? 'HOSTED_REQUEST_INVALID' : 'HOSTED_CAPABILITY_UNAVAILABLE');
    }
  }
});
test('H2 tenant administrators cannot provision or use operator credentials as tenant sessions', async t => {
  const f = await authFixture(t), { request, operator } = await serving(t, f), session = await f.login(), tenantHeaders = { authorization: `Bearer ${session.token}` };
  for (const [path, method] of [['/api/host/tenants', 'POST'], [`/api/host/tenants/${f.tenant.tenantId}/suspend`, 'POST'], [`/api/host/tenants/${f.tenant.tenantId}/resume`, 'POST'], [`/api/host/tenants/${f.tenant.tenantId}`, 'DELETE']]) {
    assert.equal((await request(path, { method, headers: tenantHeaders, body: {} })).body.errorCode, 'OPERATOR_REQUIRED');
  }
  for (const path of ['/api/namespaces/new', '/api/users/new', '/api/invitations']) assert.equal((await request(path, { method: 'PUT', headers: tenantHeaders, body: {} })).body.errorCode, 'OPERATOR_REQUIRED');
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
