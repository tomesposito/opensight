import { randomBytes, createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mcpScopes } from '@opensight/mcp-server/http';
import { digest, equal } from '../auth-crypto.js';
import { HostedAuth, type MemberDelegation } from '../hosted-auth.js';
import { MetadataError, type Database, type SqlConnection, type SqlRow } from '../metadata-db.js';
import { send, method } from '../automation-routes.js';
import { readBody } from '../query.js';
import { workspaceLabel } from '../workspace-naming.js';

const random = (prefix = '') => prefix + randomBytes(32).toString('base64url');
const hour = 3600000, lifetime = 30 * 24 * hour;
class OAuthError extends Error { constructor(readonly code = 'invalid_request', readonly status = 400) { super(code); } }
function invalid(): never { throw new OAuthError(); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) invalid();
  return value as Record<string, unknown>;
}
function str(value: unknown, max = 2048): string {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\x00-\x1f\x7f]/.test(value)) invalid();
  return value;
}
function scopes(value: unknown): string[] {
  const values = str(value, 128).split(' ');
  if (new Set(values).size !== values.length || values.some(v => !mcpScopes.some(s => s === v))) throw new OAuthError('invalid_scope');
  return values;
}
function redirect(value: unknown): string {
  const uri = str(value);
  try {
    const url = new URL(uri);
    if (url.username || url.password || url.hash || uri.includes('#') || !(url.protocol === 'https:' || url.protocol === 'http:' && url.port && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) invalid();
    return uri;
  } catch { return invalid(); }
}
async function form(request: IncomingMessage): Promise<Record<string, string>> {
  if (request.headers.authorization || request.headers.cookie || request.headers['content-type']?.split(';')[0]?.trim() !== 'application/x-www-form-urlencoded') invalid();
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = chunk as Buffer; size += bytes.length; if (size > 16384) throw new OAuthError('invalid_request', 413); chunks.push(bytes);
  }
  const params = new URLSearchParams(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks)));
  if ([...params.keys()].some(k => params.getAll(k).length !== 1)) invalid();
  return Object.fromEntries(params);
}
import { mcpDiscoveryPaths, mcpOAuthPaths } from './paths.js';

export class McpOAuth {
  readonly resource: string;
  constructor(private readonly db: Database, private readonly auth: HostedAuth, private readonly origin: string, private readonly clock = Date.now) { this.resource = `${origin}/api/mcp`; }
  private async client(c: SqlConnection, id: unknown): Promise<SqlRow> {
    const row = (await c.query('SELECT * FROM h2_mcp_clients WHERE client_id = ?', [str(id, 128)]))[0];
    if (!row) throw new OAuthError('invalid_client'); return row;
  }
  private resourceCheck(value: unknown): void { if (value !== undefined && value !== this.resource) throw new OAuthError('invalid_target'); }
  private async register(input: unknown): Promise<unknown> {
    const p = object(input, ['client_name', 'redirect_uris', 'token_endpoint_auth_method', 'grant_types', 'response_types', 'scope', 'client_uri', 'logo_uri']);
    const name = str(p.client_name ?? 'MCP client', 120);
    if (p.token_endpoint_auth_method !== undefined && p.token_endpoint_auth_method !== 'none') invalid();
    if (p.grant_types !== undefined && (!Array.isArray(p.grant_types) || p.grant_types.length !== 2 || !p.grant_types.includes('authorization_code') || !p.grant_types.includes('refresh_token'))) invalid();
    if (p.response_types !== undefined && (!Array.isArray(p.response_types) || p.response_types.length !== 1 || p.response_types[0] !== 'code')) invalid();
    if (!Array.isArray(p.redirect_uris) || !p.redirect_uris.length || p.redirect_uris.length > 10) invalid();
    const redirects = [...new Set(p.redirect_uris.map(redirect))], allowed = scopes(p.scope ?? mcpScopes.join(' ')), id = random('mcp_client_');
    await this.db.transaction(async c => {
      await c.query('UPDATE h2_control SET id = id WHERE id = 1');
      if (Number((await c.query('SELECT COUNT(*) AS count FROM h2_mcp_clients'))[0]?.count) >= 10000) throw new OAuthError('temporarily_unavailable', 429);
      await c.query('INSERT INTO h2_mcp_clients VALUES (?,?,?,?,?)', [id, name, JSON.stringify(redirects), allowed.join(' '), this.clock()]);
    });
    return { client_id: id, client_name: name, redirect_uris: redirects, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: allowed.join(' '), client_id_issued_at: Math.floor(this.clock() / 1000) };
  }
  private async interaction(input: unknown, token: string): Promise<unknown> {
    const p = object(input, ['client_id', 'redirect_uri', 'response_type', 'state', 'scope', 'resource', 'code_challenge', 'code_challenge_method']);
    this.resourceCheck(p.resource);
    if (p.response_type !== 'code' || p.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(str(p.code_challenge))) invalid();
    if (p.state !== undefined) str(p.state);
    const requested = scopes(p.scope ?? mcpScopes[0]);
    return this.db.transaction(async c => {
      const binding = await this.auth.delegate(c, token), client = await this.client(c, p.client_id);
      if (!(JSON.parse(String(client.redirects)) as string[]).includes(str(p.redirect_uri))) invalid();
      if (requested.some(s => !String(client.scopes).split(' ').includes(s))) throw new OAuthError('invalid_scope');
      const params = { ...p, scope: requested.join(' ') }, id = random();
      await c.query('DELETE FROM h2_mcp_interactions WHERE expires_at <= ?', [this.clock()]);
      await c.query('INSERT INTO h2_mcp_interactions VALUES (?,?,?,?)', [digest(id), digest(token), JSON.stringify(params), this.clock() + 600000]);
      const tenant = (await c.query('SELECT display_name FROM h1_tenants WHERE tenant_id = ?', [binding.tenantId]))[0];
      return { id, clientName: client.name, redirectUri: p.redirect_uri, scopes: requested, workspaceName: workspaceLabel(tenant?.display_name, binding.tenantId) };
    });
  }
  private async authorize(input: unknown, token: string): Promise<unknown> {
    const p = object(input, ['id', 'action', 'scope']), id = str(p.id, 128);
    if (!['approve', 'deny'].includes(String(p.action))) invalid();
    return this.db.transaction(async c => {
      const binding = await this.auth.delegate(c, token);
      const interaction = (await c.query('DELETE FROM h2_mcp_interactions WHERE interaction_id = ? AND session_hash = ? AND expires_at > ? RETURNING *', [digest(id), digest(token), this.clock()]))[0];
      if (!interaction) invalid();
      const params = JSON.parse(String(interaction.params)) as Record<string, string>;
      const client = await this.client(c, params.client_id);
      const url = new URL(params.redirect_uri!);
      if (params.state !== undefined) url.searchParams.set('state', params.state);
      if (p.action === 'deny') { url.searchParams.set('error', 'access_denied'); return { redirect: url.href }; }
      const chosen = scopes(p.scope);
      if (chosen.some(s => !params.scope!.split(' ').includes(s) || !String(client.scopes).split(' ').includes(s))) throw new OAuthError('invalid_scope');
      const grant = random('mcp_grant_'), code = random('mcp_c_');
      await c.query('INSERT INTO h2_mcp_grants VALUES (?,?,?,?,?,?,?,?,0)', [grant, binding.tenantId, binding.subject, String(client.client_id), JSON.stringify(binding), chosen.join(' '), this.clock(), this.clock() + lifetime]);
      await c.query("INSERT INTO h2_mcp_tokens VALUES (?,?,?,'code',?,?,0)", [digest(code), binding.tenantId, grant, JSON.stringify({ redirect: params.redirect_uri, challenge: params.code_challenge }), this.clock() + 60000]);
      url.searchParams.set('code', code); return { redirect: url.href };
    });
  }
  private async active(c: SqlConnection, id: string): Promise<SqlRow> {
    const grant = (await c.query('SELECT * FROM h2_mcp_grants WHERE grant_id = ?', [id]))[0];
    if (!grant || Number(grant.revoked) || Number(grant.expires_at) <= this.clock()) throw new OAuthError('invalid_grant');
    try { await this.auth.checkDelegation(c, JSON.parse(String(grant.binding)) as MemberDelegation); }
    catch { throw new OAuthError('invalid_grant'); }
    const current = (await c.query('UPDATE h2_mcp_grants SET revoked = revoked WHERE grant_id = ? AND revoked = 0 RETURNING *', [id]))[0];
    if (!current) throw new OAuthError('invalid_grant');
    return current;
  }
  private async exchange(p: Record<string, string>): Promise<unknown> {
    object(p, ['grant_type', 'client_id', 'code', 'redirect_uri', 'code_verifier', 'refresh_token', 'scope', 'resource']); this.resourceCheck(p.resource);
    const kind = p.grant_type === 'authorization_code' ? 'code' : p.grant_type === 'refresh_token' ? 'refresh' : undefined;
    if (!kind) throw new OAuthError('unsupported_grant_type');
    const credential = str(kind === 'code' ? p.code : p.refresh_token, 128);
    const result = await this.db.transaction(async c => {
      const client = await this.client(c, p.client_id);
      const row = (await c.query('SELECT * FROM h2_mcp_tokens WHERE token_hash = ? AND kind = ?', [digest(credential), kind]))[0];
      if (!row || Number(row.expires_at) <= this.clock()) throw new OAuthError('invalid_grant');
      const grant = await this.active(c, String(row.grant_id));
      if (grant.client_id !== client.client_id) throw new OAuthError('invalid_grant');
      if (kind === 'code') {
        const data = JSON.parse(String(row.data)) as { redirect: string; challenge: string };
        if (p.redirect_uri !== data.redirect || !/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier ?? '')
          || !equal(data.challenge, createHash('sha256').update(p.code_verifier!).digest('base64url'))) throw new OAuthError('invalid_grant');
      }
      const selected = p.scope === undefined ? String(grant.scopes).split(' ') : scopes(p.scope);
      if (selected.some(s => !String(grant.scopes).split(' ').includes(s))) throw new OAuthError('invalid_scope');
      if (!(await c.query('UPDATE h2_mcp_tokens SET consumed = 1 WHERE token_hash = ? AND consumed = 0 RETURNING token_hash', [digest(credential)])).length) {
        // Commit family revocation even though the exchange itself fails.
        await c.query('UPDATE h2_mcp_grants SET revoked = 1 WHERE grant_id = ?', [String(grant.grant_id)]); return null;
      }
      // Scope narrowing applies to the whole connection, including older access tokens.
      await c.query('UPDATE h2_mcp_grants SET scopes = ? WHERE grant_id = ?', [selected.join(' '), String(grant.grant_id)]);
      const access = random('mcp_a_'), refresh = random('mcp_r_'), expiry = Math.min(this.clock() + hour, Number(grant.expires_at));
      for (const [token, tokenKind, expires] of [[access, 'access', expiry], [refresh, 'refresh', Number(grant.expires_at)]] as const) {
        await c.query('INSERT INTO h2_mcp_tokens VALUES (?,?,?,?,?,?,0)', [digest(token), String(grant.tenant_id), String(grant.grant_id), tokenKind, '{}', expires]);
      }
      return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: Math.floor((expiry - this.clock()) / 1000), scope: selected.join(' ') };
    });
    if (!result) throw new OAuthError('invalid_grant'); return result;
  }
  private async revoke(p: Record<string, string>): Promise<void> {
    object(p, ['client_id', 'token', 'token_type_hint']); const token = str(p.token, 128);
    await this.db.transaction(async c => {
      const client = await this.client(c, p.client_id);
      const row = (await c.query('SELECT g.* FROM h2_mcp_tokens t JOIN h2_mcp_grants g ON g.grant_id = t.grant_id WHERE t.token_hash = ? AND g.client_id = ?', [digest(token), String(client.client_id)]))[0];
      if (!row) return;
      // Tenant before grant, matching access/refresh lock order. Revocation still works after removal.
      await c.query('UPDATE h1_tenants SET version = version WHERE tenant_id = ?', [String(row.tenant_id)]);
      await c.query('UPDATE h2_mcp_grants SET revoked = 1 WHERE grant_id = ?', [String(row.grant_id)]);
    });
  }
  private async connections(request: IncomingMessage, input?: unknown): Promise<unknown> {
    return this.db.transaction(async c => {
      const binding = await this.auth.delegate(c, this.auth.bearer(request));
      if (input !== undefined) {
        const p = object(input, ['id']);
        const rows = await c.query('UPDATE h2_mcp_grants SET revoked = 1 WHERE grant_id = ? AND tenant_id = ? AND subject = ? RETURNING grant_id', [str(p.id, 128), binding.tenantId, binding.subject]);
        if (!rows.length) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
        return { revoked: true };
      }
      const rows = await c.query(`SELECT g.grant_id, c.name, g.scopes, g.created_at, g.expires_at, g.revoked FROM h2_mcp_grants g
        JOIN h2_mcp_clients c ON c.client_id = g.client_id WHERE g.tenant_id = ? AND g.subject = ? ORDER BY g.created_at DESC`, [binding.tenantId, binding.subject]);
      return { connections: rows.map(r => ({ id: r.grant_id, clientName: r.name, scopes: String(r.scopes).split(' '), createdAt: Number(r.created_at), expiresAt: Number(r.expires_at), revoked: !!Number(r.revoked) })) };
    });
  }
  async route(request: IncomingMessage, response: ServerResponse, path: string): Promise<boolean> {
    if (!mcpDiscoveryPaths.includes(path) && !mcpOAuthPaths.includes(path)) return false;
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Pragma', 'no-cache'); response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (mcpDiscoveryPaths.includes(path)) {
        method(request, response, ['GET']);
        send(response, 200, path.includes('oauth-protected-resource') ? { resource: this.resource, authorization_servers: [this.origin], scopes_supported: mcpScopes, bearer_methods_supported: ['header'] }
          : { issuer: this.origin, authorization_endpoint: `${this.origin}/?mcp_oauth=1`, token_endpoint: `${this.resource}/oauth/token`, registration_endpoint: `${this.resource}/register`, revocation_endpoint: `${this.resource}/oauth/revoke`,
            response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], scopes_supported: mcpScopes }); return true;
      }
      method(request, response, path === '/api/mcp/connections' ? ['GET', 'POST'] : ['POST']);
      const browser = path.endsWith('/interaction') || path.endsWith('/authorize') || path.endsWith('/connections');
      if (browser) {
        if (request.method !== 'GET' && request.headers.origin !== this.origin) throw new MetadataError('UNTRUSTED_ORIGIN', 403);
        // This also refuses using an MCP token to approve another connection.
        await this.auth.verify(this.auth.bearer(request));
      }
      if (!path.endsWith('/connections')) await this.auth.limit(`mcp:${path}:${digest(request.headers.authorization ?? request.socket.remoteAddress ?? 'unknown')}`, request.socket.remoteAddress ?? 'unknown');
      if (path.endsWith('/register')) {
        if (request.headers.authorization || request.headers.cookie) invalid();
        send(response, 201, await this.register(await readBody(request, 16384)));
      } else if (path.endsWith('/interaction')) send(response, 200, await this.interaction(await readBody(request, 16384), this.auth.bearer(request)));
      else if (path.endsWith('/authorize')) send(response, 200, await this.authorize(await readBody(request, 16384), this.auth.bearer(request)));
      else if (path.endsWith('/token')) send(response, 200, await this.exchange(await form(request)));
      else if (path.endsWith('/revoke')) { await this.revoke(await form(request)); send(response, 200, {}); }
      else send(response, 200, await this.connections(request, request.method === 'POST' ? await readBody(request, 16384) : undefined));
    } catch (error) {
      request.resume();
      if (error instanceof MetadataError && error.code === 'AUTH_RATE_LIMITED') { response.setHeader('Retry-After', '900'); send(response, 429, { error: 'temporarily_unavailable' }); return true; }
      if (error instanceof MetadataError) throw error;
      send(response, error instanceof OAuthError ? error.status : 400, { error: error instanceof OAuthError ? error.code : 'invalid_request' });
    }
    return true;
  }
}
