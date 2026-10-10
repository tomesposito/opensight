import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { MetadataError } from './metadata-db.js';

export interface RuntimeRequest { method: string; path: string; headers: Record<string, string>; body: Buffer; peer: string; requestTime: number }
export interface RuntimeResponse { statusCode: number; headers: Record<string, string>; body: string; isBase64Encoded?: boolean; cookies?: string[] }
export interface IngressConfig { origin: string; domain: string; apiId: string; stage: string; route: string; keys: ReadonlyMap<string, string> }
function invalid(): never { throw new MetadataError('HOSTED_REQUEST_INVALID', 400); }
function denied(): never { throw new MetadataError('UNTRUSTED_INGRESS', 403); }
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid();
const singleton = new Set(['host', 'authorization', 'origin', 'content-type', 'content-length', 'idempotency-key', 'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since', 'range',
  'x-opensight-ingress-key-id', 'x-opensight-ingress-secret', 'x-opensight-ingress-origin', 'cloudfront-viewer-address']);
export const forgedPrincipalHeaders = ['x-user', 'x-user-id', 'x-principal', 'x-groups', 'x-group-ids', 'x-namespace', 'x-namespace-id', 'x-tenant', 'x-tenant-id', 'x-subject', 'x-role', 'x-roles', 'x-capabilities'];

export function ingressConfig(env: NodeJS.ProcessEnv): IngressConfig {
  try {
    const origin = env.OPENSIGHT_PUBLIC_ORIGIN!, url = new URL(origin), domain = env.OPENSIGHT_INGRESS_DOMAIN!;
    const apiId = env.OPENSIGHT_INGRESS_API_ID!, stage = env.OPENSIGHT_INGRESS_STAGE!, route = env.OPENSIGHT_INGRESS_ROUTE ?? '$default';
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || !domain || !/^[a-z0-9.-]+$/.test(domain)
      || domain === url.hostname || domain.endsWith('.execute-api.amazonaws.com') || !/^[A-Za-z0-9_-]+$/.test(apiId) || !/^[A-Za-z0-9_$-]+$/.test(stage) || route !== '$default') throw Error();
    const raw = JSON.parse(env.OPENSIGHT_INGRESS_KEYS ?? ''), keys = new Map<string, string>();
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 2) throw Error();
    for (const key of raw) {
      if (!key || Object.keys(key).sort().join() !== 'id,secret' || typeof key.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(key.id)
        || typeof key.secret !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(key.secret) || keys.has(key.id)) throw Error();
      keys.set(key.id, key.secret);
    }
    return { origin, domain, apiId, stage, route, keys };
  } catch { throw new MetadataError('INGRESS_CONFIG_INVALID', 503); }
}

/** Literal routes only: percent encoding is unnecessary for the API's identifier grammar. */
export function publicPath(path: unknown): string {
  if (typeof path !== 'string' || path.length > 4096 || !/^\/[A-Za-z0-9_./-]*$/.test(path) || path.includes('//') || path.split('/').some(p => p === '.' || p === '..')) invalid();
  let internal: string;
  if (path.startsWith('/api/api/')) internal = path.slice(4);
  else if (/^\/api\/embed\/sessions\/[A-Za-z0-9_-]+\/(redeem|status|content|question|analysis|save)$/.test(path) || /^\/embed\/sessions\/[A-Za-z0-9_-]+$/.test(path)) internal = path;
  else throw new MetadataError('RESOURCE_NOT_FOUND', 404);
  if (path.startsWith('/api/api/embed/') || /^\/api\/namespaces\/[^/]+\/(startup|auth|embed)(?:\/|$)/.test(internal)) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
  if (/^\/api\/(?:host|api|healthz|readyz|metrics|migrate|migration|drain)(?:\/|$)/.test(internal)) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
  const unscoped = internal.replace(/^\/api\/namespaces\/[A-Za-z0-9_-]+\//, '/api/');
  if (!/^\/embed\/sessions\/[A-Za-z0-9_-]+$/.test(unscoped)
    && !/^\/api\/(?:startup|session|namespaces|users|groups|connectors|sources|prep-sources|uploads|prep-datasets|automation-status|job-recipients|jobs)$/.test(unscoped)
    && !/^\/api\/auth\/(?:enroll|accept|login|switch|logout)$/.test(unscoped)
    && !/^\/api\/sources\/[A-Za-z0-9_-]+(?:\/(?:bind|rotate|preview|rows|output|query|refresh|policy))?$/.test(unscoped)
    && !/^\/api\/(?:uploads\/[A-Za-z0-9_-]+|ai\/sources(?:\/[A-Za-z0-9_-]+\/schema)?|prep-datasets\/import)$/.test(unscoped)
    && !/^\/api\/datasets\/[A-Za-z0-9_-]+\/(?:prep(?:\/preview)?|execution|refresh|rows|query|share|permissions|embed)$/.test(unscoped)
    && !/^\/api\/jobs\/[A-Za-z0-9_-]+(?:\/(?:runs|deliveries))?$/.test(unscoped)
    && !/^\/api\/embedding\/(?:config|sessions(?:\/[A-Za-z0-9_-]+(?:\/renew)?)?|GenerateEmbedUrlForRegisteredUser|GenerateEmbedUrlForAnonymousUser)$/.test(unscoped)
    && !/^\/api\/embed\/sessions\/[A-Za-z0-9_-]+\/(?:redeem|status|content|question|analysis|save)$/.test(unscoped)) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
  return internal;
}

function routeMethod(path: string, method: string): void {
  const p = path.replace(/^\/api\/namespaces\/[A-Za-z0-9_-]+\//, '/api/');
  let allowed: readonly string[] = ['GET'];
  if (p === '/api/startup' || p.startsWith('/api/auth/') || /^\/api\/embedding\/(?:sessions$|Generate)/.test(p) || p.endsWith('/renew')) allowed = ['POST'];
  else if (p === '/api/embedding/config') allowed = ['GET', 'PUT'];
  else if (/^\/api\/embedding\/sessions\//.test(p)) allowed = ['DELETE'];
  else if (/^\/api\/embed\/sessions\//.test(p)) allowed = /\/(status|content)$/.test(p) ? ['GET'] : ['POST'];
  else if (p === '/api/uploads' || p === '/api/prep-datasets/import') allowed = ['POST'];
  else if (/^\/api\/uploads\//.test(p)) allowed = ['GET'];
  else if (/^\/api\/jobs\/[A-Za-z0-9_-]+$/.test(p)) allowed = ['GET', 'PUT', 'DELETE'];
  else if (/^\/api\/jobs\/[A-Za-z0-9_-]+\/runs$/.test(p)) allowed = ['GET', 'POST'];
  else if (/^\/api\/sources\/[A-Za-z0-9_-]+$/.test(p)) allowed = ['GET', 'PUT', 'DELETE'];
  else if (/^\/api\/sources\/[^/]+\//.test(p)) allowed = p.endsWith('/policy') ? ['GET'] : ['POST'];
  else if (/^\/api\/datasets\//.test(p)) allowed = p.endsWith('/prep') ? ['GET', 'PUT', 'DELETE'] : p.endsWith('/rows') ? ['GET'] : p.endsWith('/execution') ? ['GET', 'PUT'] : ['POST'];
  if (!allowed.includes(method)) invalid();
}

function headers(raw: unknown): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>; let bytes = 0;
  for (const [key, value] of Object.entries(record(raw))) {
    const name = key.toLowerCase();
    if (!/^[a-z0-9-]+$/.test(name) || typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value) || Object.hasOwn(result, name)) invalid();
    // HTTP-date conditionals contain one comma; they cannot contain a joined pair.
    if (singleton.has(name) && value.includes(',') && !(['if-modified-since', 'if-unmodified-since'].includes(name) && /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value))) invalid();
    bytes += Buffer.byteLength(key) + Buffer.byteLength(value); if (bytes > 16384) invalid();
    result[name] = value;
  }
  if (forgedPrincipalHeaders.some(h => Object.hasOwn(result, h))) throw new MetadataError('FORGED_PRINCIPAL', 403);
  if (result.forwarded !== undefined || result['x-forwarded-host'] !== undefined || result['transfer-encoding'] !== undefined) invalid();
  for (const name of Object.keys(result)) if (name.startsWith('x-opensight-ingress-') && !['x-opensight-ingress-key-id', 'x-opensight-ingress-secret', 'x-opensight-ingress-origin'].includes(name)) denied();
  return result;
}

export function viewerPeer(value: unknown): string {
  if (typeof value !== 'string') return denied();
  const match = /^(?:\[([^\]]+)\]|([^:]+)):(\d{1,5})$/.exec(value);
  if (!match || Number(match[3]) < 1 || Number(match[3]) > 65535) return denied();
  const ip = match[1] ?? match[2]!;
  if (isIP(ip) === 4 && !match[1]) return ip;
  if (isIP(ip) !== 6 || !match[1]) return denied();
  const normalized = new URL(`http://[${ip}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(normalized);
  if (mapped) { const a = parseInt(mapped[1]!, 16), b = parseInt(mapped[2]!, 16); return [a >> 8, a & 255, b >> 8, b & 255].join('.'); }
  return normalized;
}

function trusted(raw: unknown, config: IngressConfig): { event: Record<string, unknown>; context: Record<string, unknown>; h: Record<string, string>; method: string; path: string } {
  const event = record(raw), context = record(event.requestContext), http = record(context.http), h = headers(event.headers);
  if (event.version !== '2.0' || event.routeKey !== config.route || context.routeKey !== config.route || context.apiId !== config.apiId || context.stage !== config.stage
    || context.domainName !== config.domain || h.host !== config.domain || h['x-opensight-ingress-origin'] !== config.origin) denied();
  const secret = config.keys.get(h['x-opensight-ingress-key-id'] ?? '');
  const hash = (v: string) => createHash('sha256').update(v).digest();
  if (!secret || !timingSafeEqual(hash(secret), hash(h['x-opensight-ingress-secret'] ?? ''))) denied();
  if (h.origin !== undefined && h.origin !== config.origin) throw new MetadataError('UNTRUSTED_ORIGIN', 403);
  if (h['x-forwarded-proto'] !== undefined && h['x-forwarded-proto'] !== 'https') denied();
  if (h['x-forwarded-port'] !== undefined && h['x-forwarded-port'] !== '443') denied();
  const method = http.method;
  if (typeof method !== 'string' || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) invalid();
  const path = publicPath(event.rawPath);
  if (http.path !== event.rawPath || event.rawQueryString !== '' || event.queryStringParameters !== undefined || event.multiValueHeaders !== undefined) invalid();
  viewerPeer(h['cloudfront-viewer-address']);
  return { event, context, h, method, path };
}

/** DB-free authorizer. Configuration is read for each call so retired keys stay retired. */
export function authorizeIngress(event: unknown, env: NodeJS.ProcessEnv = process.env): { isAuthorized: boolean; context?: { version: string; canonicalOrigin: string } } {
  try { const config = ingressConfig(env); trusted(event, config); return { isAuthorized: true, context: { version: '1', canonicalOrigin: config.origin } }; }
  catch { return { isAuthorized: false }; }
}

export function adaptGatewayRequest(raw: unknown, env: NodeJS.ProcessEnv): RuntimeRequest {
  const config = ingressConfig(env), { event, context, h, method, path } = trusted(raw, config);
  const authorizer = record(record(context.authorizer).lambda);
  if (authorizer.version !== '1' || authorizer.canonicalOrigin !== config.origin) denied();
  const requestTime = context.timeEpoch;
  if (!Number.isSafeInteger(requestTime) || Number(requestTime) > Date.now()) invalid();
  if (event.body !== undefined && typeof event.body !== 'string' || typeof event.isBase64Encoded !== 'boolean') invalid();
  const rawBody = (event.body ?? '') as string;
  if (Buffer.byteLength(rawBody) > 6 * 1024 * 1024) throw new MetadataError('REQUEST_TOO_LARGE', 413);
  const body = Buffer.from(rawBody, event.isBase64Encoded ? 'base64' : 'utf8');
  if (event.isBase64Encoded && body.toString('base64') !== rawBody) invalid();
  if (body.length > 4 * 1024 * 1024) throw new MetadataError('REQUEST_TOO_LARGE', 413);
  if (['GET', 'HEAD'].includes(method) && body.length || h['content-length'] !== undefined && (!/^\d+$/.test(h['content-length']) || Number(h['content-length']) !== body.length)) invalid();
  routeMethod(path, method);
  const forwarded: Record<string, string> = { host: new URL(config.origin).host, 'content-length': String(body.length) };
  for (const name of ['authorization', 'content-type', 'origin', 'idempotency-key', 'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since', 'range', 'accept']) if (h[name] !== undefined) forwarded[name] = h[name];
  if (event.cookies !== undefined) {
    if (h.cookie !== undefined) invalid();
    if (!Array.isArray(event.cookies) || event.cookies.some(c => typeof c !== 'string' || /[\r\n\x00]/.test(c)) || Buffer.byteLength(event.cookies.join('; ')) > 8192) invalid();
    forwarded.cookie = event.cookies.join('; ');
  } else if (h.cookie) forwarded.cookie = h.cookie;
  return { method, path, headers: forwarded, body, peer: viewerPeer(h['cloudfront-viewer-address']), requestTime: Number(requestTime) };
}

export function validateLocalRequest(request: RuntimeRequest, origin: string): void {
  const h = headers(request.headers);
  if (h.host !== new URL(origin).host || h.origin !== undefined && h.origin !== origin
    || Object.keys(h).some(k => k.startsWith('x-forwarded-') || k.startsWith('x-opensight-ingress-') || k === 'cloudfront-viewer-address')) denied();
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(request.method)
    || ['GET', 'HEAD'].includes(request.method) && request.body.length
    || h['content-length'] !== undefined && (!/^\d+$/.test(h['content-length']) || Number(h['content-length']) !== request.body.length)) invalid();
  const path = publicPath(request.path.startsWith('/embed/') || request.path.startsWith('/api/embed/') ? request.path : `/api${request.path}`);
  routeMethod(path, request.method);
}

/** Pure viewer-boundary contract for the later CloudFront packaging slice. */
export function validateViewerRequest(raw: unknown, origin: string): void {
  const request = record(raw), values: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(record(request.headers))) {
    const value = record(rawValue);
    if (value.multiValue !== undefined) invalid();
    if (typeof value.value !== 'string') invalid();
    values[key] = value.value;
  }
  const h = headers(values);
  if (h.host !== new URL(origin).host || request.protocol !== 'https') denied();
  if (Object.keys(h).some(k => k.startsWith('x-opensight-ingress-') || k === 'cloudfront-viewer-address' || k === 'x-forwarded-for' || k === 'x-forwarded-proto' || k === 'x-forwarded-port')) denied();
  if (h.origin !== undefined && h.origin !== origin) denied();
  publicPath(request.uri);
  if (Object.keys(record(request.querystring)).length) invalid();
}

export function runtimeError(error: unknown): RuntimeResponse {
  return { statusCode: error instanceof MetadataError ? error.status : 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify({ errorCode: error instanceof MetadataError ? error.code : 'WORKSPACE_UNAVAILABLE' }) };
}
