import { disabledAnalytics } from './analytics.js';
import { wireHasVisuals } from './analysis-model.js';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { method, send } from './automation-routes.js';
import { readBody } from './query.js';
import { identifier, object, type MetadataResource } from './metadata-resources.js';
import { AssetCatalog, assetFail, assetKind, assetName, summary, type AssetBackend } from './asset-model.js';
import type { AnalysisProtocol } from './analysis-routes.js';
import type { AssetGrant } from './organization.js';
import { RetryStore, type RetryAdapter } from './retry-store.js';

interface Reply { status: number; body: unknown; version?: number }
interface Receipt { fingerprint: string; reply: Reply; access: MetadataResource; removed: boolean; expires: number }
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, c]) => `${JSON.stringify(k)}:${canonical(c)}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}
const shareWire = (g: AssetGrant) => ({ Principal: { Type: g.principal.type, Id: g.principal.id }, Role: g.role });
const folderWire = (r: MetadataResource) => ({ Id: r.id, Name: r.body.name, Version: r.version });
export class AssetRoutes {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly protocol: AnalysisProtocol, private readonly analytics = disabledAnalytics,
    private readonly receipts: RetryAdapter = new RetryStore({ periodicPrune: false })) {}
  matches(path: string, verb?: string) {
    return /^\/api\/v1\/(assets|folders)(?:\/|$)/.test(path)
      || /^\/api\/v1\/(analyses|dashboards)\/[^/]+\/shares\//.test(path)
      || verb === 'DELETE' && /^\/api\/v1\/(analyses|dashboards|datasets)\/[^/]+$/.test(path);
  }
  private page(request: IncomingMessage, all: unknown[]) {
    const { offset, limit } = this.protocol.paging(request), items = all.slice(offset, offset + limit);
    return { items, nextCursor: offset + items.length < all.length ? Buffer.from(JSON.stringify({ offset: offset + items.length })).toString('base64') : null };
  }
  private send(response: ServerResponse, r: Reply) { if (r.version !== undefined) response.setHeader('ETag', `"${r.version}"`); send(response, r.status, r.body); }
  async route(request: IncomingMessage, response: ServerResponse, path: string, backend: AssetBackend) {
    const list = /^\/api\/v1\/assets(?:\/(analyses|dashboards|datasets|search))?$/.exec(path);
    const transfer = /^\/api\/v1\/assets\/([^/]+)\/([A-Za-z0-9_-]{1,512})\/(move|copy)$/.exec(path);
    const share = /^\/api\/v1\/(analyses|dashboards)\/([A-Za-z0-9_-]{1,512})\/shares\/(user|group)\/([A-Za-z0-9_-]{1,512})$/.exec(path);
    const folder = /^\/api\/v1\/folders(?:\/([A-Za-z0-9_-]{1,512})(?:\/(permissions|assets))?)?$/.exec(path);
    const deletion = /^\/api\/v1\/(analyses|dashboards|datasets)\/([A-Za-z0-9_-]{1,512})$/.exec(path);
    if (!list && !transfer && !share && !folder && !deletion) assetFail('RESOURCE_NOT_FOUND', 404);
    const verb = method(request, response, list ? [list[1] === 'search' ? 'POST' : 'GET'] : transfer ? ['POST'] : share ? ['GET', 'PUT', 'DELETE'] : folder ? !folder[1] || folder[2] === 'assets' ? ['GET'] : folder[2] ? ['GET', 'PUT'] : ['GET', 'PUT', 'DELETE'] : ['DELETE']);
    const read = list || verb === 'GET';
    const body = verb === 'GET' || verb === 'DELETE' ? {} : object(await readBody(request));
    if (verb === 'DELETE' && (request.headers['transfer-encoding'] || request.headers['content-length'] && request.headers['content-length'] !== '0')) assetFail('ASSET_INVALID_INPUT');
    let expected: number | undefined;
    if (deletion || verb === 'PUT' && (share || folder)) expected = this.protocol.ifMatch(request);
    if (list) {
      object(body, list[1] === 'search' ? ['query', 'kinds', 'scope'] : []);
      if (list[1] === 'search') {
        if (typeof body.query !== 'string' || body.query.length > 512) assetFail('ASSET_INVALID_QUERY');
        if (body.kinds !== undefined && (!Array.isArray(body.kinds) || body.kinds.some(k => !['analyses', 'dashboards', 'datasets'].includes(String(k))) || new Set(body.kinds).size !== body.kinds.length)) assetFail('ASSET_INVALID_KINDS');
        if (body.scope !== undefined) assetFail('ASSET_SCOPE_UNSPECIFIED', 422);
      }
    }
    let destination: string | null = null;
    if (transfer) {
      if (!['analyses', 'dashboards'].includes(transfer[1]!)) assetFail('ASSET_KIND_UNSUPPORTED', 409);
      object(body, transfer[3] === 'copy' ? ['folderId', 'newId', 'name'] : ['folderId']);
      destination = body.folderId === null || transfer[3] === 'copy' && body.folderId === undefined ? null : identifier(body.folderId);
      if (transfer[3] === 'copy') { identifier(body.newId); if (body.name !== undefined) assetName(body.name); }
    }
    if (share) { object(body, verb === 'PUT' ? ['role'] : []); if (verb === 'PUT' && body.role !== 'viewer' && body.role !== 'co-owner') assetFail('ASSET_INVALID_GRANTS'); }
    if (folder && verb === 'PUT') { object(body, folder[2] ? ['grants'] : ['name']); if (!folder[2]) assetName(body.name); }
    const keyHeader = request.headers['idempotency-key']; if (Array.isArray(keyHeader)) assetFail('INVALID_HEADER');
    const key = read || keyHeader === undefined ? undefined : canonical([backend.scope.tenantId, backend.scope.namespaceId, backend.scope.userId, verb, path, identifier(keyHeader)]);
    const fingerprint = createHash('sha256').update(canonical([body, expected])).digest('hex');
    const run = async () => {
      const receiptKey = key === undefined ? undefined : `asset:${key}`;
      const receipt = receiptKey === undefined ? undefined : await this.receipts.get<Receipt>(receiptKey);
      if (receipt) {
        await backend.transaction(false, c => {
          const old = receipt.access, current = c.find(old.kind, old.id, old.ownerId);
          if (receipt.removed && current) assetFail('IDEMPOTENCY_CONFLICT', 409);
          c.require(receipt.removed ? old : current ?? assetFail('RESOURCE_NOT_FOUND', 404), transfer?.[3] !== 'copy');
          if (transfer) c.destination(destination);
          if (receipt.fingerprint !== fingerprint) assetFail('IDEMPOTENCY_CONFLICT', 409);
        });
        response.setHeader('Idempotent-Replayed', 'true'); this.send(response, receipt.reply); return;
      }
      const reservation = receiptKey === undefined ? undefined : await this.receipts.reserve<Receipt>(backend.scope.tenantId, receiptKey);
      try {
      let access: MetadataResource | undefined, removed = false;
      const expires = Date.now() + 600000;
      const prepare = (reply: Reply) => {
        reservation?.prepare({ fingerprint, reply, access: access!, removed, expires });
        return reservation ?? {};
      };
      const reply = await backend.transaction(!read, c => {
        if (list) {
          let all = c.list();
          if (list[1] && list[1] !== 'search') all = all.filter(r => summary(r).kind === list[1]);
          if (list[1] === 'search') all = all.filter(r => summary(r).name.toLowerCase().includes(String(body.query).toLowerCase()) && (body.kinds === undefined || (body.kinds as string[]).includes(summary(r).kind)));
          all.sort(list[1] === 'search' ? (a, b) => String(b.body.updatedAt ?? '').localeCompare(String(a.body.updatedAt ?? '')) || a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind) : (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
          return { status: 200, body: this.page(request, all.map(summary)) };
        }
        if (folder && !folder[1]) return { status: 200, body: this.page(request, c.resources.filter(r => r.kind === 'folder' && c.allowed(r)).sort((a,b) => a.id.localeCompare(b.id)).map(folderWire)) };
        const r = folder ? c.folder(folder[1]!, verb !== 'GET' || folder[2] === 'permissions') : c.asset(assetKind((transfer ?? share ?? deletion)![1]!), (transfer ?? share ?? deletion)![2]!, !!share || !!deletion || transfer?.[3] === 'move');
        access = structuredClone(r);
        if (expected !== undefined) c.match(r, expected);
        if (folder) {
          if (folder[2] === 'assets') return { status: 200, body: this.page(request, c.list().filter(a => a.body.folderId === r.id).map(summary)) };
          if (verb === 'DELETE') { c.remove(r); removed = true; return { status: 200, body: { Id: r.id, Removed: true } }; }
          if (verb === 'PUT') {
            if (folder[2] === 'permissions') { const grants = c.grants(body.grants); if (grants?.length) r.body.grants = grants; else delete r.body.grants; }
            else r.body.name = assetName(body.name);
            c.touch(r);
          }
          return { status: 200, version: r.version, body: folder[2] === 'permissions' ? { InheritedFrom: c.scope.namespaceId, Grants: r.body.grants === undefined ? null : (r.body.grants as AssetGrant[]).map(shareWire) } : folderWire(r) };
        }
        if (transfer) {
          const next = transfer[3] === 'move' ? (c.move(r, destination), r) : c.copy(r, identifier(body.newId), body.name as string | undefined, destination);
          return { status: transfer[3] === 'copy' ? 201 : 200, version: next.version, body: { Kind: assetKind(transfer[1]!), Id: next.id, Name: summary(next).name, FolderId: next.body.folderId } };
        }
        if (share) {
          const principal = { type: share[3] as 'user' | 'group', id: share[4]! };
          if (verb !== 'GET') c.share(r, principal, body.role as AssetGrant['role'] | undefined);
          const grant = (r.body.grants as AssetGrant[] | undefined)?.find(g => g.principal.type === principal.type && g.principal.id === principal.id);
          if (verb === 'GET' && !grant) assetFail('RESOURCE_NOT_FOUND', 404);
          return { status: 200, version: r.version, body: verb === 'DELETE' ? { Deleted: true } : shareWire(grant!) };
        }
        c.remove(r); removed = true; return { status: 200, body: { id: r.id, removed: true } };
      }, prepare);
      if (share?.[1] === 'dashboards' && verb === 'PUT') this.analytics.track(backend.scope, { name: 'dashboard_shared' });
      if (transfer?.[1] === 'analyses' && transfer[3] === 'copy') {
        this.analytics.track(backend.scope, { name: 'analysis_created' });
        if (wireHasVisuals(access?.body.definition)) this.analytics.track(backend.scope, { name: 'analysis_first_visual' });
      }
      prepare(reply); await reservation?.commit();
      this.send(response, reply);
      } finally { await reservation?.release(); }
    };
    if (read) await run();
    else { const operation = this.tail.then(run); this.tail = operation.catch(() => {}); await operation; }
  }
}
