import { CliError, record } from './errors.js';

export interface Credentials {
  accessToken(): Promise<string>;
  containsSecret(text: string): boolean;
}

function endpoint(value: string, variable: string): URL {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash
      || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw Error();
    return url;
  } catch { throw new CliError('CLI_CONFIGURATION_INVALID', `${variable} must be an HTTPS URL (HTTP allowed on loopback), without credentials, query or fragment.`); }
}

export function apiBase(env: NodeJS.ProcessEnv): string {
  if (!env.OPENSIGHT_API_URL) throw new CliError('CLI_CONFIGURATION_INVALID', 'OPENSIGHT_API_URL is required.');
  const url = endpoint(env.OPENSIGHT_API_URL, 'OPENSIGHT_API_URL');
  // Match the SDK root (/api), accepting the full v1 root used by MCP as well.
  const path = url.pathname.replace(/\/+$/, '');
  if (!['/api', '/api/v1'].includes(path)) throw new CliError('CLI_CONFIGURATION_INVALID', 'OPENSIGHT_API_URL must end in /api or /api/v1.');
  url.pathname = '/api';
  return url.href.replace(/\/$/, '');
}

/** D-73 / D-70: operator refresh exchange, process memory only, no guessed endpoint. */
export function credentials(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch): Credentials {
  const refreshToken = env.OPENSIGHT_TOKEN;
  if (!refreshToken || /[\r\n\x00]/.test(refreshToken)) throw new CliError('CLI_CONFIGURATION_INVALID', 'OPENSIGHT_TOKEN is required and must be a valid refresh credential.');
  const secrets = new Set([refreshToken]);
  let pending: Promise<string> | undefined;
  return {
    containsSecret: text => [...secrets].some(secret => text.includes(secret)),
    accessToken() {
      pending ??= (async () => {
        if (!env.OPENSIGHT_TOKEN_URL) throw new CliError('CLI_TOKEN_EXCHANGE_REQUIRED', 'Configure OPENSIGHT_TOKEN_URL with the operator refresh endpoint; this API does not supply a default exchange.');
        const url = endpoint(env.OPENSIGHT_TOKEN_URL, 'OPENSIGHT_TOKEN_URL');
        const startedAt = Date.now();
        let data: unknown;
        try {
          const response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString() });
          if (!response.ok) throw Error();
          data = await response.json();
        } catch { throw new CliError('AUTHENTICATION_FAILED', 'Credential exchange failed.'); }
        if (record(data)) for (const name of ['access_token', 'refresh_token']) {
          const token = data[name]; if (typeof token === 'string' && token) secrets.add(token);
        }
        if (!record(data) || typeof data.access_token !== 'string' || !data.access_token || /[\r\n\x00]/.test(data.access_token)
          || typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer'
          || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0
          || !Number.isFinite(startedAt + data.expires_in * 1000) || startedAt + data.expires_in * 1000 <= Date.now()
          || data.refresh_token !== undefined && (typeof data.refresh_token !== 'string' || !data.refresh_token || /[\r\n\x00]/.test(data.refresh_token))) {
          throw new CliError('AUTHENTICATION_FAILED', 'Invalid credential exchange response.');
        }
        return data.access_token;
      })();
      return pending;
    },
  };
}
