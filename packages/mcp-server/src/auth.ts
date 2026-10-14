import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { Credentials } from './types.js';

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
export interface RefreshOptions {
  tokenUrl: string;
  refreshToken: string;
  fetch?: typeof fetch;
  now?: () => number;
}
/** OAuth client only. No minting, caller identity claims, token persistence, or refresh endpoint invented here. */
export function refreshCredentials(options: RefreshOptions): Credentials {
  const url = new URL(options.tokenUrl);
  if (url.username || url.password || url.search || url.hash
    || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Invalid OPENSIGHT_MCP_TOKEN_URL');
  if (!options.refreshToken || /[\r\n\x00]/.test(options.refreshToken)) throw new Error('OPENSIGHT_MCP_REFRESH_TOKEN is required');
  const fetchImpl = options.fetch ?? fetch, now = options.now ?? Date.now;
  let refreshToken = options.refreshToken, accessToken = '', expiresAt = 0;
  let pending: Promise<string> | undefined;
  async function exchange(): Promise<string> {
    const startedAt = now();
    let response: Response, data: unknown;
    try {
      response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString() });
      // Never expose endpoint diagnostics: an auth response can contain tokens or echo the request.
      if (!response.ok) { accessToken = ''; expiresAt = 0; throw new Error('Credential exchange rejected'); }
      data = await response.json();
    } catch (error) {
      accessToken = ''; expiresAt = 0;
      if (error instanceof Error && error.message === 'Credential exchange rejected') throw new Error('Credential exchange rejected');
      throw new McpError(ErrorCode.InternalError, 'Credential exchange transport failed');
    }
    if (!record(data) || typeof data.access_token !== 'string' || !data.access_token || /[\r\n\x00]/.test(data.access_token)
      || typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer'
      || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0
      || data.refresh_token !== undefined && (typeof data.refresh_token !== 'string' || !data.refresh_token || /[\r\n\x00]/.test(data.refresh_token))) {
      accessToken = ''; expiresAt = 0;
      throw new McpError(ErrorCode.InternalError, 'Invalid credential exchange response');
    }
    expiresAt = startedAt + data.expires_in * 1000;
    if (!Number.isFinite(expiresAt) || expiresAt <= now()) throw new McpError(ErrorCode.InternalError, 'Expired credential exchange response');
    if (typeof data.refresh_token === 'string') refreshToken = data.refresh_token;
    accessToken = data.access_token;
    return accessToken;
  }
  return {
    async accessToken() {
      if (accessToken && now() < expiresAt - 1000) return accessToken;
      // Coalesce exchanges so concurrent tool calls cannot reuse a single-use refresh token.
      pending ??= exchange().finally(() => { pending = undefined; });
      return pending;
    },
    containsSecret(value) {
      return [options.refreshToken, refreshToken, accessToken].some(token => token.length > 0 && value.includes(token));
    },
    invalidate() { accessToken = ''; expiresAt = 0; },
  };
}
