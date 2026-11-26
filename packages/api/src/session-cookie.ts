import type { IncomingMessage } from 'node:http';
import { MetadataError } from './metadata-db.js';

export const REFRESH_COOKIE = 'opensight_refresh';
// /api covers both direct /api/auth and proxy-mounted /api/api/auth routes.
// No Domain attribute: credentials belong to the exact hosted origin.
export function refreshCookieHeader(token: string, expiresAt: number, origin: string, now: number): string {
  return `${REFRESH_COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Lax${new URL(origin).protocol === 'https:' ? '; Secure' : ''}; Max-Age=${Math.max(0, Math.floor((expiresAt - now) / 1000))}; Expires=${new Date(expiresAt).toUTCString()}`;
}

export function readRefreshCookie(request: IncomingMessage): string | undefined {
  const raw = request.headers.cookie;
  if (!raw) return undefined;
  if (raw.length > 8192) throw new MetadataError('AUTHENTICATION_FAILED', 401);
  const values = raw.split(';').map(part => part.trim()).filter(part => part.split('=')[0] === REFRESH_COOKIE);
  if (values.length === 0) return undefined;
  if (values.length !== 1 || !new RegExp(`^${REFRESH_COOKIE}=[A-Za-z0-9_-]{43}$`).test(values[0]!)) throw new MetadataError('AUTHENTICATION_FAILED', 401);
  return values[0]!.slice(REFRESH_COOKIE.length + 1);
}
