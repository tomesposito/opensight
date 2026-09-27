import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { compileVisual } from '@opensight/web/compiler';
import { method, routeId, send } from './automation-routes.js';
import { isObject } from './mapping.js';
import type { OrganizationService } from './organization.js';
import { readBody, RequestError, SecurityError, type SalesQuery } from './query.js';
import { id, invalid, record } from './schedule.js';
import type { Identity } from './security.js';

export interface EmbeddingOptions {
  /** Public API origin. HTTPS, except loopback development. Never derived from Host. */
  origin: string;
  /** Exact origins authorized to frame this API. No wildcards. */
  allowedParentOrigins: readonly string[];
}
interface Claims extends Identity {
  version: 1; audience: 'opensight-embed'; dashboardId: string; visualId?: string;
  parentOrigin: string; issuedAt: number; expiresAt: number; nonce: string;
}
export function embedOrigin(raw: unknown): string {
  if (typeof raw !== 'string') invalid('$.origin', 'expected an origin');
  let url: URL;
  try { url = new URL(raw); } catch { return invalid('$.origin', 'expected an origin'); }
  if (url.origin !== raw || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) invalid('$.origin', 'expected an exact HTTPS origin (or loopback HTTP)');
  return raw;
}
function unavailable(): never { throw new SecurityError(503, 'EMBEDDING_NOT_CONFIGURED', 'Embedding requires hosted configuration and an environment signing key'); }
function invalidToken(): never { throw new SecurityError(401, 'INVALID_EMBED_TOKEN', 'Invalid or expired embed URL'); }
function dashboardVisuals(definition: unknown) {
  if (!isObject(definition) || !Array.isArray(definition.Sheets)) throw new RequestError(422, 'Dashboard has no supported sheets');
  const result: { id: string; definition: Record<string, unknown>; path: string; sheet: string }[] = [];
  for (const [si, sheet] of definition.Sheets.entries()) {
    if (!isObject(sheet) || !Array.isArray(sheet.Visuals)) throw new RequestError(422, 'Invalid dashboard sheet');
    for (const [vi, visual] of sheet.Visuals.entries()) {
      if (!isObject(visual) || Object.keys(visual).length !== 1) throw new RequestError(422, 'Invalid dashboard visual');
      const body = Object.values(visual)[0];
      if (!isObject(body)) throw new RequestError(422, 'Invalid dashboard visual');
      const visualId = id(body.VisualId, '$.visualId');
      if (result.some(v => v.id === visualId) || result.length >= 256) throw new RequestError(422, 'Duplicate or excessive dashboard visuals');
      result.push({ id: visualId, definition: visual, path: `Definition.Sheets[${si}].Visuals[${vi}]`, sheet: typeof sheet.Name === 'string' ? sheet.Name : String(sheet.SheetId ?? si) });
    }
  }
  return result;
}
export class EmbeddingService {
  private readonly secret: string | undefined;
  private readonly options: EmbeddingOptions | undefined;
  constructor(options: EmbeddingOptions | undefined, private readonly organization: OrganizationService) {
    // There is deliberately no constructor option, default key, or client-side signer.
    this.secret = process.env.OPENSIGHT_EMBED_SECRET;
    if (options) {
      if (!Array.isArray(options.allowedParentOrigins) || !options.allowedParentOrigins.length || options.allowedParentOrigins.length > 64) throw new Error('Embedding requires allowed parent origins');
      this.options = { origin: embedOrigin(options.origin), allowedParentOrigins: options.allowedParentOrigins.map(embedOrigin) };
    }
  }
  private configured(): { options: EmbeddingOptions; secret: string } {
    if (!this.options || !this.secret || Buffer.byteLength(this.secret) < 32) unavailable();
    return { options: this.options, secret: this.secret };
  }
  private sign(payload: string): Buffer { return createHmac('sha256', this.configured().secret).update(`OpenSight:embed:v1:${payload}`).digest(); }
  private token(claims: Claims): string {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${payload}.${this.sign(payload).toString('base64url')}`;
  }
  private verify(token: string, dashboardId: string): Claims {
    const { options } = this.configured();
    try {
      if (token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) invalidToken();
      const [payload, mac] = token.split('.') as [string, string];
      const signature = Buffer.from(mac, 'base64url');
      if (signature.toString('base64url') !== mac || !timingSafeEqual(this.sign(payload), signature)) invalidToken();
      const bytes = Buffer.from(payload, 'base64url');
      if (bytes.toString('base64url') !== payload) invalidToken();
      const c = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), ['version', 'audience', 'namespaceId', 'userId', 'dashboardId', 'visualId', 'parentOrigin', 'issuedAt', 'expiresAt', 'nonce']);
      const now = Math.floor(Date.now() / 1000);
      if (c.version !== 1 || c.audience !== 'opensight-embed' || c.dashboardId !== dashboardId
        || !Number.isSafeInteger(c.issuedAt) || !Number.isSafeInteger(c.expiresAt) || Number(c.issuedAt) > now + 30 || Number(c.expiresAt) <= now
        || Number(c.expiresAt) <= Number(c.issuedAt) || Number(c.expiresAt) - Number(c.issuedAt) > 900
        || typeof c.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(c.nonce) || !options.allowedParentOrigins.includes(String(c.parentOrigin))) invalidToken();
      const claims: Claims = { version: 1, audience: 'opensight-embed', namespaceId: id(c.namespaceId, '$.namespaceId'), userId: id(c.userId, '$.userId'), dashboardId: id(c.dashboardId, '$.dashboardId'),
        ...(c.visualId === undefined ? {} : { visualId: id(c.visualId, '$.visualId') }), parentOrigin: embedOrigin(c.parentOrigin), issuedAt: Number(c.issuedAt), expiresAt: Number(c.expiresAt), nonce: c.nonce };
      if (!this.organization.security.store.read().users.some(u => u.namespaceId === claims.namespaceId && u.id === claims.userId)) invalidToken();
      return claims;
    } catch { return invalidToken(); }
  }
  /** Only URL issuance supports credentialed CORS, for the configured exact parent origins. */
  cors(request: IncomingMessage, response: ServerResponse, path: string): boolean {
    if (!/^\/(?:api\/)?dashboards\/[^/]+\/embed-url$/.test(path)) return false;
    const requestOrigin = request.headers.origin;
    if (requestOrigin !== undefined) {
      const { options } = this.configured();
      if (!options.allowedParentOrigins.includes(requestOrigin)) throw new SecurityError(403, 'EMBED_ORIGIN_DENIED', 'Parent origin is not allowed');
      response.setHeader('Access-Control-Allow-Origin', requestOrigin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Vary', 'Origin');
    }
    if (request.method !== 'OPTIONS') return false;
    if (!requestOrigin || request.headers['access-control-request-method'] !== 'POST'
      || String(request.headers['access-control-request-headers'] ?? '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean).some(h => !['authorization', 'content-type'].includes(h))) throw new RequestError(400, 'Unsupported embed preflight');
    response.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Cache-Control': 'no-store' });
    response.end(); return true;
  }
  async issue(request: IncomingMessage, response: ServerResponse, path: string, query: string, identity: Identity): Promise<boolean> {
    const match = /^\/(?:api\/)?dashboards\/([^/]+)\/embed-url$/.exec(path);
    if (!match) return false;
    method(request, response, ['POST']);
    if (query) throw new RequestError(400, 'Query parameters are not supported');
    const { options } = this.configured();
    const dashboardId = routeId(match[1]!);
    const body = record(await readBody(request), ['parentOrigin', 'visualId', 'expiresInSeconds']);
    const parentOrigin = embedOrigin(body.parentOrigin);
    if (request.headers.origin !== undefined && request.headers.origin !== parentOrigin) throw new SecurityError(403, 'EMBED_ORIGIN_DENIED', 'Parent origin must match the browser origin');
    if (!options.allowedParentOrigins.includes(parentOrigin)) throw new SecurityError(403, 'EMBED_ORIGIN_DENIED', 'Parent origin is not allowed');
    const ttl = body.expiresInSeconds ?? 300;
    if (!Number.isSafeInteger(ttl) || Number(ttl) < 60 || Number(ttl) > 900) invalid('$.expiresInSeconds', 'expected 60–900 whole seconds');
    const visualId = body.visualId === undefined ? undefined : id(body.visualId, '$.visualId');
    const dashboard = this.organization.requireRead(identity, 'dashboard', dashboardId);
    const visuals = dashboardVisuals(dashboard.Definition);
    if (visualId !== undefined && !visuals.some(v => v.id === visualId)) throw new RequestError(404, 'Visual not found');
    const issuedAt = Math.floor(Date.now() / 1000), expiresAt = issuedAt + Number(ttl);
    const claims: Claims = { version: 1, audience: 'opensight-embed', ...identity, dashboardId, ...(visualId === undefined ? {} : { visualId }), parentOrigin, issuedAt, expiresAt, nonce: randomBytes(16).toString('hex') };
    const url = new URL(`/embed/dashboards/${dashboardId}`, options.origin);
    url.searchParams.set('token', this.token(claims));
    send(response, 200, { url: url.href, expiresAt: new Date(expiresAt * 1000).toISOString() });
    return true;
  }
  /** Signed bearer URLs authorize only this renderer, never general API requests. */
  async render(request: IncomingMessage, response: ServerResponse, path: string, query: string, sources: ReadonlyMap<string, SalesQuery | undefined>): Promise<boolean> {
    const match = /^\/embed\/dashboards\/([^/]+)$/.exec(path);
    if (!match) return false;
    method(request, response, ['GET']);
    const params = new URLSearchParams(query);
    if ([...params.keys()].length !== 1 || !params.has('token')) invalidToken();
    const dashboardId = routeId(match[1]!), token = params.get('token')!;
    const claims = this.verify(token, dashboardId);
    const dashboard = this.organization.requireRead(claims, 'dashboard', dashboardId);
    const visuals = dashboardVisuals(dashboard.Definition).filter(v => claims.visualId === undefined || v.id === claims.visualId);
    if (claims.visualId !== undefined && !visuals.length) throw new RequestError(404, 'Visual not found');
    const sales = sources.get(claims.namespaceId);
    if (visuals.length && !sales) throw new RequestError(404, 'Dashboard source is not resolved');
    let template: string;
    try { template = await readFile(new URL('../../web/dist/opensight-embed.html', import.meta.url), 'utf8'); }
    catch { throw new SecurityError(503, 'EMBED_RENDERER_NOT_BUILT', 'Build the hosted embed renderer before using embed URLs'); }
    const rendered = [];
    for (const [index, visual] of visuals.entries()) {
      const result = await sales!.executeVisual(dashboard.Definition, visual.id, undefined, claims);
      const input = { source: 'api' as const, definition: visual.definition, rows: result.rows,
        bindings: Object.fromEntries([...result.plan.dimensions, ...result.plan.measures].map(f => [f.fieldId, f.outputName])), path: visual.path };
      try { compileVisual(input); } catch { throw new RequestError(422, 'Visual cannot be rendered with supported semantics'); }
      rendered.push({ ...input, id: visual.id, sheet: visual.sheet, placement: { column: 0, columns: 36, row: index * 6, rows: 6 } });
    }
    // Recheck expiry and resource grants after asynchronous data work.
    this.verify(token, dashboardId); this.organization.requireRead(claims, 'dashboard', dashboardId);
    const payload = JSON.stringify({ dashboardId, visualId: claims.visualId, title: typeof dashboard.Name === 'string' ? dashboard.Name : dashboardId,
      parentOrigin: claims.parentOrigin, expiresAt: claims.expiresAt, visuals: rendered }).replaceAll('<', '\\u003c').replaceAll('&', '\\u0026').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
    const nonce = randomBytes(24).toString('base64');
    const html = template.replace('<!--OPENSIGHT_EMBED_DATA-->', () => `<script type="application/json" id="opensight-embed-data">${payload}</script>`).replaceAll('<script', `<script nonce="${nonce}"`);
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors ${claims.parentOrigin}` });
    response.end(html); return true;
  }
}
