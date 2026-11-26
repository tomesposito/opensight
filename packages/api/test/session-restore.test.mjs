import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { authFixture } from './hosted-helpers.mjs';
import { HostedAuth, activateAuthKey } from '../dist/hosted-auth.js';
import { createHostedApiServer } from '../dist/hosted-server.js';
import { dispatchRuntimeRequest } from '../dist/runtime-http-bridge.js';
import { publicPath } from '../dist/runtime-ingress.js';
import { digest } from '../dist/auth-crypto.js';
import { REFRESH_COOKIE } from '../dist/session-cookie.js';

const rows = (f, sql, args = []) => f.db.transaction(c => c.query(sql, args));
const denied = { code: 'AUTHENTICATION_FAILED', status: 401 };
async function serving(t, f, invocation = false) {
  const c = f.config;
  const env = { OPENSIGHT_PUBLIC_ORIGIN: c.origin, OPENSIGHT_AUTH_ISSUER: c.issuer, OPENSIGHT_AUTH_AUDIENCE: c.audience,
    OPENSIGHT_AUTH_KEY_ID: c.keyId, OPENSIGHT_AUTH_SIGNING_KEY: c.signingKey.toString('base64'),
    OPENSIGHT_AUTH_ENCRYPTION_KEY: c.encryptionKey.toString('base64'), OPENSIGHT_OPERATOR_KEY: c.operatorKey.toString('base64'),
    OPENSIGHT_SESSION_SECONDS: String(c.sessionSeconds), OPENSIGHT_INVITATION_SECONDS: String(c.invitationSeconds) };
  const server = await createHostedApiServer({ membershipDatabase: f.db, tenantDatabase: f.db, security: { authenticate: f.auth.authenticate },
    builtinAuth: f.auth, env, clock: f.clock, mailTransport: f.mail,
    ...(invocation ? { invocation: { signal: new AbortController().signal } } : {}) });
  t.after(() => server.close());
  return async (path, { cookie, authorization, body = {}, headers = {}, method = 'POST' } = {}) => {
    const raw = await dispatchRuntimeRequest(server, { method, path, peer: '127.0.0.1', requestTime: f.clock(), body: Buffer.from(JSON.stringify(body)),
      headers: { host: new URL(c.origin).host, origin: c.origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(authorization ? { authorization } : {}), ...headers } }, new AbortController().signal);
    const text = Buffer.from(raw.body, raw.isBase64Encoded ? 'base64' : 'utf8').toString();
    return { ...raw, body: JSON.parse(text), text, cookie: raw.cookies?.[0]?.split(';')[0] };
  };
}
const signIn = (f, request, remember = false) => request('/api/auth/login', { body: { email: f.email, password: f.password, code: f.code(), remember } });
function rejected(result, status = 401, code = 'AUTHENTICATION_FAILED') {
  assert.equal(result.statusCode, status); assert.equal(result.body.errorCode, code);
  assert.equal(result.body.token, undefined); assert.equal(result.body.tenantId, undefined);
}

test('Issue #282: HTTP sign-in sets a private secure cookie; restore returns a fresh bearer, rotates once and preserves deadline', async t => {
  const f = await authFixture(t), request = await serving(t, f);
  const login = await signIn(f, request);
  assert.equal(login.statusCode, 200);
  assert.match(login.cookies[0], /; Path=\/api; HttpOnly; SameSite=Lax; Secure; Max-Age=900;/);
  const refresh = login.cookie.slice(REFRESH_COOKIE.length + 1);
  assert.match(refresh, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!login.cookie.includes(login.body.token)); assert.ok(!login.text.includes(refresh));
  assert.deepEqual(Object.keys(login.body).sort(), ['expiresAt', 'tenantId', 'token']);
  const [stored] = await rows(f, 'SELECT * FROM h2_refresh_tokens');
  assert.equal(stored.token_hash, digest(refresh)); assert.ok(!JSON.stringify(stored).includes(refresh));
  f.advance(60000);
  const restored = await request('/api/auth/restore', { cookie: login.cookie });
  assert.equal(restored.statusCode, 200); assert.notEqual(restored.body.token, login.body.token);
  assert.notEqual(restored.cookie, login.cookie); assert.equal(restored.body.expiresAt, login.body.expiresAt);
  assert.match(restored.cookies[0], /Max-Age=840;/);
  assert.ok(!restored.text.includes(restored.cookie.split('=')[1])); assert.ok(!restored.cookie.includes(restored.body.token));
  assert.equal((await f.auth.verify(restored.body.token)).namespaceId, f.tenant.namespaceId);
  await assert.rejects(f.auth.verify(login.body.token), denied);
  rejected(await request('/api/auth/restore', { cookie: login.cookie }));
  const session = await f.auth.restore(restored.cookie.split('=')[1]);
  assert.equal(session.tenantId, f.tenant.tenantId);
});

test('Issue #282: remember-me lifetime is enforced server-side, including workspace selection and loopback cookie posture', async t => {
  const f = await authFixture(t);
  f.config = { ...f.config, sessionSeconds: 36000, origin: 'http://localhost:3000' };
  f.auth = await HostedAuth.create(f.db, f.config, f.clock);
  const request = await serving(t, f);
  for (const remember of [false, true]) {
    const result = await signIn(f, request, remember);
    assert.equal(result.statusCode, 200); assert.equal(result.body.expiresAt - f.clock(), (remember ? 36000 : 900) * 1000);
    assert.doesNotMatch(result.cookies[0], /; Secure/); assert.match(result.cookies[0], /HttpOnly; SameSite=Lax/);
    f.advance();
  }
  const second = await f.provisioning.provision('second', { ...f.input, name: 'Second', displayName: 'Second' });
  const invite = f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
  await f.auth.accept(invite, f.password, f.code(), 'local'); f.advance();
  const challenge = await signIn(f, request, true);
  assert.equal(challenge.body.selectionRequired, true); assert.equal(challenge.cookies, undefined);
  const selected = await request('/api/auth/login/select', { body: { selectionToken: challenge.body.selectionToken, tenantId: second.tenantId, remember: true } });
  assert.equal(selected.statusCode, 200); assert.equal(selected.body.expiresAt - f.clock(), 36000000);
  assert.equal((await request('/api/auth/restore', { cookie: selected.cookie })).body.tenantId, second.tenantId);
  rejected(await request('/api/auth/login', { body: { email: f.email, password: f.password, code: f.code(), remember: 'true' } }), 400, 'HOSTED_REQUEST_INVALID');
});

test('Issue #282: missing, malformed, duplicate, unknown and tampered cookies fail closed; no alternate credential or tenant selector', async t => {
  const f = await authFixture(t), request = await serving(t, f), login = await signIn(f, request);
  for (const cookie of [undefined, 'unrelated=1', `${REFRESH_COOKIE}=garbage`, `${REFRESH_COOKIE}=${randomBytes(32).toString('base64url')}`,
    `${REFRESH_COOKIE}=%41${'a'.repeat(42)}`, `${login.cookie}; ${login.cookie}`, `${login.cookie}x`]) {
    const result = await request('/api/auth/restore', { cookie }); rejected(result); assert.match(result.cookies[0], /Max-Age=0;/);
  }
  rejected(await request('/api/auth/restore', { authorization: `Bearer ${login.body.token}` }), 400, 'HOSTED_REQUEST_INVALID');
  rejected(await request('/api/auth/restore', { cookie: login.cookie, body: { tenantId: 'other-tenant' } }), 400, 'METADATA_INVALID');
  rejected(await request('/api/auth/restore', { cookie: login.cookie, headers: { 'x-tenant-id': 'other-tenant' } }), 403, 'FORGED_PRINCIPAL');
  rejected(await request('/api/auth/restore', { cookie: login.cookie, headers: { origin: 'https://foreign.example' } }), 403, 'UNTRUSTED_ORIGIN');
  assert.notEqual((await request('/api/auth/restore', { cookie: login.cookie, headers: { 'content-type': 'text/plain' } })).statusCode, 200);
  rejected(await request('/api/namespaces/foreign/auth/restore', { cookie: login.cookie }));
  assert.equal((await request('/api/auth/restore', { cookie: login.cookie })).statusCode, 200, 'rejected bypasses must not consume the cookie');
});

for (const kind of ['expired', 'revoked', 'bearer-revoked', 'suspended', 'resumed', 'removed-user', 'inactive-user', 'authorization', 'policy', 'key-rotation', 'foreign-origin', 'foreign-audience', 'foreign-issuer', 'cross-tenant-row']) {
  test(`Issue #282: restore rejects ${kind} without partial authority`, async t => {
    const f = await authFixture(t), request = await serving(t, f), login = await signIn(f, request);
    if (kind === 'expired') f.advance(900000);
    if (kind === 'revoked') await rows(f, 'UPDATE h2_refresh_tokens SET revoked = 1');
    if (kind === 'bearer-revoked') await rows(f, 'UPDATE h2_sessions SET revoked = 1');
    if (['suspended', 'resumed'].includes(kind)) {
      const state = await f.provisioning.operator.tenant(f.tenant.tenantId);
      await f.provisioning.operator.transition('suspend', state.tenantId, 'suspend', state.version);
      if (kind === 'resumed') await f.provisioning.operator.transition('resume', state.tenantId, 'resume', state.version + 1);
    }
    if (kind === 'removed-user') await f.provisioning.removeMember(f.tenant.tenantId, (await f.auth.verify(login.body.token)).userId);
    if (kind === 'inactive-user') await rows(f, "UPDATE h2_identities SET status = 'invited'");
    if (['authorization', 'policy'].includes(kind)) await rows(f, `UPDATE h1_revisions SET "${kind}" = "${kind}" + 1`);
    if (kind === 'key-rotation') await activateAuthKey(f.db, { ...f.config, keyId: 'rotated', signingKey: randomBytes(32) });
    if (kind.startsWith('foreign-')) await rows(f, `UPDATE h2_sessions SET ${kind.slice(8)} = ?`, ['foreign']);
    if (kind === 'cross-tenant-row') await rows(f, 'UPDATE h2_refresh_tokens SET tenant_id = ?', ['other']);
    rejected(await request('/api/auth/restore', { cookie: login.cookie }), 401, kind === 'key-rotation' ? 'AUTH_KEY_REVOKED' : 'AUTHENTICATION_FAILED');
  });
}

test('Issue #282: concurrent rotation has exactly one winner and survives auth process restart', async t => {
  const f = await authFixture(t), login = await f.login();
  const restarted = await HostedAuth.create(f.db, f.config, f.clock);
  const attempts = await Promise.allSettled([f.auth.restore(login.refreshToken), restarted.restore(login.refreshToken)]);
  assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(x => x.status === 'rejected').reason.code, 'AUTHENTICATION_FAILED');
  const rotated = attempts.find(x => x.status === 'fulfilled').value;
  assert.ok(await restarted.restore(rotated.refreshToken));
});

for (const mode of ['cookie', 'bearer', 'expired', 'suspended']) test(`Issue #282: ${mode} logout clears and revokes refresh credentials`, async t => {
  const f = await authFixture(t), request = await serving(t, f), login = await signIn(f, request);
  if (mode === 'expired') f.advance(900000);
  if (mode === 'suspended') await rows(f, "UPDATE h1_tenants SET state = 'suspended'");
  const result = await request('/api/auth/logout', mode === 'bearer' ? { authorization: `Bearer ${login.body.token}` } : { cookie: login.cookie });
  assert.equal(result.statusCode, 200); assert.equal(result.body.loggedOut, true);
  assert.match(result.cookies[0], /opensight_refresh=; Path=\/api; HttpOnly; SameSite=Lax; Secure; Max-Age=0; Expires=Thu, 01 Jan 1970/);
  assert.equal((await rows(f, 'SELECT revoked FROM h2_refresh_tokens'))[0].revoked, 1);
  rejected(await request('/api/auth/restore', { cookie: login.cookie }));
  await assert.rejects(f.auth.verify(login.body.token), denied);
});

test('Issue #282: workspace switch replaces cookie binding and old refresh cannot switch it back', async t => {
  const f = await authFixture(t), second = await f.provisioning.provision('switch', { ...f.input, name: 'Switch', displayName: 'Switch' });
  await f.auth.accept(f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1], f.password, f.code(), 'local'); f.advance();
  const request = await serving(t, f), login = await f.login();
  const switched = await request('/api/auth/switch', { authorization: `Bearer ${login.token}`, body: { tenantId: second.tenantId } });
  assert.equal(switched.statusCode, 200); assert.equal(switched.body.expiresAt, login.expiresAt);
  await assert.rejects(f.auth.restore(login.refreshToken), denied);
  assert.equal((await request('/api/auth/restore', { cookie: switched.cookie })).body.tenantId, second.tenantId);
});

test('Issue #282: hosted invocation admits the public restore route and preserves Set-Cookie through the HTTP bridge', async t => {
  const f = await authFixture(t);
  await serving(t, f); // owner initialization; invocation itself performs no DDL
  const request = await serving(t, f, true), login = await signIn(f, request);
  assert.equal(login.statusCode, 200);
  const path = publicPath('/api/api/auth/restore');
  assert.equal(path, '/api/auth/restore');
  const restored = await request(path, { cookie: login.cookie });
  assert.equal(restored.statusCode, 200); assert.match(restored.cookies[0], /HttpOnly/);
  assert.throws(() => publicPath('/api/api/namespaces/other/auth/restore'), { code: 'RESOURCE_NOT_FOUND' });
});
