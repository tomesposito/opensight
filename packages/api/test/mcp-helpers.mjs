import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { authFixture } from './hosted-helpers.mjs';
import { serving } from './v1-helpers.mjs';
export const readScope = 'opensight/mcp.read', writeScope = 'opensight/mcp.write', allScopes = `${readScope} ${writeScope}`;
export async function mcpFixture(t, env = {}, options = {}) {
  const f = await authFixture(t), http = await serving(t, f, env, { clock: f.clock, ...options });
  let session = await f.login();
  const browser = (path, body, token = session.token) => http(path, { method: body === undefined ? 'GET' : 'POST', body, token, headers: { Origin: f.config.origin } });
  const form = (path, body) => http(path, { method: 'POST', rawBody: new URLSearchParams(body).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const register = async (body = {}) => {
    const result = await http('/api/mcp/register', { method: 'POST', body: { client_name: 'Synthetic connector', redirect_uris: ['https://connector.example/callback'], token_endpoint_auth_method: 'none', ...body } });
    assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body;
  };
  const interaction = async (client, scope = allScopes, overrides = {}, token) => {
    const verifier = randomBytes(32).toString('base64url');
    const params = { client_id: client.client_id, redirect_uri: client.redirect_uris[0], response_type: 'code', scope, state: randomBytes(12).toString('hex'), resource: `${f.config.origin}/api/mcp`,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', ...overrides };
    return { result: await browser('/api/mcp/oauth/interaction', params, token), params, verifier };
  };
  const grant = async (scope = allScopes, token) => {
    const client = await register(), i = await interaction(client, scope, {}, token);
    assert.equal(i.result.status, 200, JSON.stringify(i.result.body));
    const consent = await browser('/api/mcp/oauth/authorize', { id: i.result.body.id, action: 'approve', scope }, token);
    assert.equal(consent.status, 200, JSON.stringify(consent.body));
    const url = new URL(consent.body.redirect); assert.equal(url.searchParams.get('state'), i.params.state);
    const exchange = { grant_type: 'authorization_code', client_id: client.client_id, code: url.searchParams.get('code'), redirect_uri: client.redirect_uris[0], code_verifier: i.verifier };
    const result = await form('/api/mcp/oauth/token', exchange); assert.equal(result.status, 200, JSON.stringify(result.body));
    return { client, exchange, ...result.body };
  };
  const rpc = (token, method, params = {}) => http('/api/mcp', { method: 'POST', token, headers: { Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' }, body: { jsonrpc: '2.0', id: 1, method, params } });
  const call = async (token, name, args = {}) => { const r = await rpc(token, 'tools/call', { name, arguments: args }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; };
  return { ...f, http, browser, form, register, interaction, grant, rpc, call, token: () => session.token, renew: async () => { session = await f.login(); } };
}
