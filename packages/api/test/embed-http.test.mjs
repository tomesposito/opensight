import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sessionFixture, request, parentOrigin } from './embed-session-helpers.mjs';
import { readerMember, seedEmbedContent } from './embed-content-helpers.mjs';
import { httpStack } from './embed-http-helpers.mjs';

test('H6 real HTTP issuance/redemption separates bootstrap, frame credential and API authority', async t => {
  const f = await sessionFixture(t), reader = await readerMember(f); await seedEmbedContent(f, reader);
  const { call } = await httpStack(t, f), api = `Bearer ${(await f.login()).token}`;
  const config = await call('/api/embedding/config', 'GET', undefined, api); assert.equal(config.status, 200); assert.equal(config.headers.etag, '"1"');
  const issued = await call('/api/embedding/GenerateEmbedUrlForRegisteredUser', 'POST', request({ UserArn: f.arn('user', reader.identity.userId) }), api);
  assert.equal(issued.status, 200); assert.equal(issued.headers['cache-control'], 'no-store'); assert.equal(issued.headers['set-cookie'], undefined);
  const id = issued.body.sessionId, url = new URL(issued.body.EmbedUrl), path = `/api/embed/sessions/${id}`;
  const shell = await call(url.pathname); assert.equal(shell.status, 200); assert.match(shell.headers['content-security-policy'], /frame-ancestors https:\/\/product.example/);
  assert.ok(!shell.body.includes(url.hash.slice(11))); assert.ok(!shell.body.includes(api));
  const body = { bootstrap: url.hash.slice(11), parentOrigin, channelId: randomBytes(24).toString('base64url') };
  assert.equal((await call(`${path}/redeem`, 'POST', body, undefined, { origin: 'https://evil.example' })).status, 403);
  const redeemed = await call(`${path}/redeem`, 'POST', body); assert.equal(redeemed.status, 200); const auth = `Embed ${redeemed.body.credential}`;
  assert.equal((await call(`${path}/redeem`, 'POST', body)).body.errorCode, 'EMBED_BOOTSTRAP_REPLAY');
  assert.equal((await call('/api/session', 'GET', undefined, auth)).status, 401);
  assert.equal((await call(`${path}/content`, 'GET', undefined, api)).body.errorCode, 'INVALID_EMBED_TOKEN');
  assert.equal((await call(`${path}/content`, 'GET', undefined, `Embed ${body.bootstrap}`)).body.errorCode, 'INVALID_EMBED_TOKEN');
  const content = await call(`${path}/content`, 'GET', undefined, auth); assert.equal(content.status, 200); assert.deepEqual(content.body.visuals[0].rows, [{ amount: 40 }]);
  assert.ok(!JSON.stringify(content.body).includes(redeemed.body.credential));
  assert.equal((await call(`${path}/save`, 'POST', {}, auth)).body.errorCode, 'EMBED_SCOPE_DENIED');
  assert.equal((await call(`/api/embedding/sessions/${id}/renew`, 'POST', {}, auth)).status, 401);
  assert.equal((await call(`/api/embedding/sessions/${id}`, 'DELETE', {}, api)).status, 200);
  assert.equal((await call(`${path}/status`, 'GET', undefined, auth)).body.errorCode, 'EMBED_SESSION_REVOKED');
});
test('H6 HTTP refuses broad browser issuance, forged identities, unconfigured features, and cross-tenant handles', async t => {
  const f = await sessionFixture(t); await seedEmbedContent(f);
  const { call } = await httpStack(t, f), api = `Bearer ${(await f.login()).token}`;
  for (const path of ['/api/embedding/sessions', '/api/embedding/GenerateEmbedUrlForRegisteredUser', '/api/embedding/GenerateEmbedUrlForAnonymousUser']) {
    assert.equal((await call(path, 'POST', request(), api, { origin: f.hostedConfig.origin })).body.errorCode, 'EMBED_BACKEND_REQUIRED');
    assert.equal((await call(path, 'POST', request(), api, { 'x-user': 'forged' })).body.errorCode, 'FORGED_PRINCIPAL');
  }
  assert.equal((await call('/api/embedding/sessions', 'POST', request({ namespaceId: 'forged' }), api)).status, 400);
  assert.equal((await call('/api/embedding/GenerateEmbedUrlForRegisteredUser?token=forged', 'POST', request(), api)).status, 400);
  const body = request({ Namespace: 'virtual', AuthorizedResourceArns: [f.arn('dashboard', 'dashboard')], SessionTags: [{ Key: 'region', Value: 'east' }] });
  assert.equal((await call('/api/embedding/GenerateEmbedUrlForAnonymousUser', 'POST', body, api)).status, 200);
  assert.equal((await call('/api/embedding/domains', 'POST', {}, api)).body.errorCode, 'EMBED_FEATURE_UNSUPPORTED');
  for (const feature of ['export', 'download', 'persistentReaderState']) {
    const config = structuredClone(f.config); config.features[feature] = true;
    assert.equal((await call('/api/embedding/config', 'PUT', config, api, { 'if-match': '"1"' })).body.errorCode, 'EMBED_FEATURE_UNSUPPORTED');
  }
});
