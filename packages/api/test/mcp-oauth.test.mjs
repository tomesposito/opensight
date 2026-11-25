import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mcpFixture, readScope, writeScope, allScopes } from './mcp-helpers.mjs';
import { HostedAuth } from '../dist/hosted-auth.js';
import { digest } from '../dist/auth-crypto.js';

const refresh = (f, g, overrides = {}) => f.form('/api/mcp/oauth/token', { grant_type: 'refresh_token', client_id: g.client.client_id, refresh_token: g.refresh_token, ...overrides });
test('discovery and standard public-client PKCE flow expose 58 governed tools and one-hour tokens', async t => {
  const f = await mcpFixture(t);
  const challenge = await f.http('/api/mcp', { method: 'POST', body: {} }); assert.equal(challenge.status, 401);
  assert.match(challenge.headers['www-authenticate'], /oauth-protected-resource\/api\/mcp/);
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/mcp']) {
    const d = await f.http(path); assert.equal(d.status, 200); assert.equal(d.body.resource, `${f.config.origin}/api/mcp`);
  }
  const metadata = (await f.http('/.well-known/oauth-authorization-server')).body;
  assert.equal(metadata.authorization_endpoint, `${f.config.origin}/?mcp_oauth=1`);
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['none']);
  const g = await f.grant(); assert.equal(g.expires_in, 3600); assert.equal(g.token_type, 'Bearer');
  assert.equal((await f.rpc(g.access_token, 'tools/list')).body.result.tools.length, 58);
  assert.equal((await f.call(g.access_token, 'list_datasets')).isError, undefined);
  const rows = await f.db.transaction(c => c.query('SELECT * FROM h2_mcp_tokens'));
  assert.ok(!JSON.stringify(rows).includes(g.access_token)); assert.ok(!JSON.stringify(rows).includes(g.refresh_token));
  const fresh = await HostedAuth.create(f.db, f.config, f.clock); assert.ok((await fresh.mcpAccess(g.access_token)).identity.userId);
  f.advance(3600000); assert.equal((await f.rpc(g.access_token, 'tools/list')).status, 401);
  assert.equal((await refresh(f, g)).status, 200);
});
test('registration/consent refuse unsafe redirects, secrets, PKCE downgrade, forged claims and scope escalation', async t => {
  const f = await mcpFixture(t);
  for (const uri of ['http://remote.example/callback', 'https://u:p@connector.example/cb', 'javascript:alert(1)', 'https://connector.example/cb#x']) {
    assert.equal((await f.http('/api/mcp/register', { method: 'POST', body: { redirect_uris: [uri] } })).status, 400);
  }
  const client = await f.register({ scope: readScope });
  for (const change of [{ redirect_uri: 'https://attacker.example/cb' }, { code_challenge_method: 'plain' }, { resource: 'https://attacker.example/api/mcp' }, { userId: 'admin' }, { scope: allScopes }]) {
    assert.equal((await f.interaction(client, readScope, change)).result.status, 400);
  }
  const i = await f.interaction(client, readScope); assert.equal(i.result.status, 200);
  assert.equal((await f.browser('/api/mcp/oauth/authorize', { id: i.result.body.id, action: 'approve', scope: allScopes })).status, 400);
  const deny = await f.browser('/api/mcp/oauth/authorize', { id: i.result.body.id, action: 'deny' });
  assert.equal(new URL(deny.body.redirect).searchParams.get('error'), 'access_denied');
  assert.equal((await f.browser('/api/mcp/oauth/authorize', { id: i.result.body.id, action: 'deny' })).status, 400);
});
test('code is bound to client, redirect and PKCE; successful replay revokes its connection', async t => {
  const f = await mcpFixture(t), client = await f.register(), other = await f.register(), i = await f.interaction(client);
  const consent = await f.browser('/api/mcp/oauth/authorize', { id: i.result.body.id, action: 'approve', scope: allScopes });
  const p = { grant_type: 'authorization_code', client_id: client.client_id, code: new URL(consent.body.redirect).searchParams.get('code'), redirect_uri: client.redirect_uris[0], code_verifier: i.verifier };
  for (const change of [{ client_id: other.client_id }, { redirect_uri: 'https://attacker.example/cb' }, { code_verifier: randomBytes(32).toString('base64url') }, { resource: 'https://elsewhere.example/api/mcp' }]) assert.equal((await f.form('/api/mcp/oauth/token', { ...p, ...change })).status, 400);
  const exchanged = await f.form('/api/mcp/oauth/token', p); assert.equal(exchanged.status, 200);
  assert.equal((await f.form('/api/mcp/oauth/token', p)).body.error, 'invalid_grant');
  assert.equal((await f.rpc(exchanged.body.access_token, 'tools/list')).status, 401);
});
test('refresh rotates atomically, rejects cross-client use, narrowing persists, and replay kills access and refresh', async t => {
  const f = await mcpFixture(t), g = await f.grant(), other = await f.register();
  assert.equal((await refresh(f, g, { client_id: other.client_id })).status, 400);
  const next = await refresh(f, g, { scope: readScope }); assert.equal(next.status, 200); assert.notEqual(next.body.refresh_token, g.refresh_token);
  assert.equal((await f.call(g.access_token, 'create_analysis')).structuredContent.errorCode, 'MCP_SCOPE_REQUIRED');
  assert.equal((await refresh(f, { ...g, ...next.body }, { scope: allScopes })).body.error, 'invalid_scope');
  assert.equal((await refresh(f, g)).body.error, 'invalid_grant');
  assert.equal((await f.rpc(next.body.access_token, 'tools/list')).status, 401);
  assert.equal((await refresh(f, { ...g, ...next.body })).body.error, 'invalid_grant');
});
test('concurrent refresh has one winner and a committed family revocation', async t => {
  const f = await mcpFixture(t), g = await f.grant();
  const results = await Promise.all([refresh(f, g), refresh(f, g)]); assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
  assert.equal((await f.rpc(results.find(r => r.status === 200).body.access_token, 'tools/list')).status, 401);
});
test('read scope and browser/MCP credential separation are enforced for HTTP and direct REST', async t => {
  const f = await mcpFixture(t), g = await f.grant(readScope);
  assert.equal((await f.rpc(f.token(), 'tools/list')).status, 401);
  const list = (await f.rpc(g.access_token, 'tools/list')).body.result.tools;
  assert.ok(!list.some(tool => tool.name === 'create_analysis'));
  assert.equal((await f.call(g.access_token, 'create_analysis')).structuredContent.errorCode, 'MCP_SCOPE_REQUIRED');
  assert.equal((await f.http('/api/v1/analyses', { method: 'POST', token: g.access_token, body: {} })).status, 403);
  for (const path of ['/api/session', '/api/auth/switch', '/api/mcp/connections', '/api/mcp/oauth/authorize']) assert.ok([401, 403].includes((await f.browser(path, {}, g.access_token)).status));
  assert.equal((await f.http('/api/mcp/oauth/authorize', { method: 'POST', token: f.token(), body: {} })).status, 403);
  assert.equal((await f.http('/api/mcp', { method: 'POST', token: g.access_token, body: {}, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await f.http('/api/mcp', { method: 'POST', token: g.access_token, body: {}, headers: { 'X-User': 'admin' } })).body.errorCode, 'FORGED_PRINCIPAL');
});
test('self-serve and RFC revocation end access and refresh; unknown tokens reveal nothing', async t => {
  const f = await mcpFixture(t), g = await f.grant(), listed = await f.browser('/api/mcp/connections');
  assert.equal(listed.body.connections.length, 1); assert.equal(listed.body.connections[0].clientName, 'Synthetic connector');
  const id = listed.body.connections[0].id;
  assert.equal((await f.browser('/api/mcp/connections', { id })).status, 200);
  assert.equal((await f.rpc(g.access_token, 'tools/list')).status, 401); assert.equal((await refresh(f, g)).body.error, 'invalid_grant');
  const second = await f.grant();
  for (const token of [randomBytes(32).toString('hex'), second.access_token]) assert.equal((await f.form('/api/mcp/oauth/revoke', { client_id: second.client.client_id, token })).status, 200);
  assert.equal((await refresh(f, second)).body.error, 'invalid_grant');
});
test('expired codes/interactions, wrong browser sessions and removed members fail closed', async t => {
  const f = await mcpFixture(t), client = await f.register(), i = await f.interaction(client);
  await f.renew(); assert.equal((await f.browser('/api/mcp/oauth/authorize', { id: i.result.body.id, action: 'approve', scope: allScopes })).status, 400);
  const g = await f.grant();
  await f.db.transaction(c => c.query("UPDATE h2_memberships SET status = 'removed', version = version + 1 WHERE tenant_id = ?", [f.tenant.tenantId]));
  assert.equal((await f.rpc(g.access_token, 'tools/list')).status, 401); assert.equal((await refresh(f, g)).body.error, 'invalid_grant');
});

test('expired interaction and code cannot mint tokens, duplicate form keys and secrets are rejected', async t => {
  const f = await mcpFixture(t), client = await f.register(), i = await f.interaction(client);
  await f.db.transaction(c => c.query('UPDATE h2_mcp_interactions SET expires_at = 0'));
  assert.equal((await f.browser('/api/mcp/oauth/authorize', { id: i.result.body.id, action: 'approve', scope: allScopes })).status, 400);
  const g = await f.grant();
  await f.db.transaction(c => c.query("UPDATE h2_mcp_tokens SET expires_at = 0 WHERE kind = 'code'"));
  assert.equal((await f.form('/api/mcp/oauth/token', g.exchange)).body.error, 'invalid_grant');
  assert.equal((await f.form('/api/mcp/oauth/token', { ...g.exchange, client_secret: 'forbidden' })).body.error, 'invalid_request');
  const duplicate = await f.http('/api/mcp/oauth/token', { method: 'POST', rawBody: 'grant_type=refresh_token&grant_type=authorization_code', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(duplicate.body.error, 'invalid_request');
});
