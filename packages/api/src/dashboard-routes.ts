import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { analysisObject, analysisId, validateAnalysisDefinition, type AnalysisDiagnostic } from '@opensight/web/analysis';
import { MetadataError } from './metadata-db.js';
import { identifier } from './metadata-resources.js';
import { method, send } from './automation-routes.js';
import { readBody } from './query.js';
import { dashboardVersion, describeDashboard, type DashboardBackend, type DashboardRecord, type DashboardChange } from './dashboard-model.js';
import { dashboardControls } from './dashboard-controls.js';
import { dashboardExport } from './dashboard-export.js';
import type { AnalysisProtocol } from './analysis-routes.js';

interface Reply { status: number; body: unknown; version?: number; bytes?: Buffer; contentType?: string; filename?: string }
interface Replay { fingerprint: string; reply: Reply; id: string; sourceId?: string; removed?: boolean; access?: unknown; expires: number; dataVersion?: number; dataStamp?: unknown }
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}
function fail(code: string, status = 422): never { throw new MetadataError(code, status); }
function keys(body: Record<string, unknown>, allowed: string[]) { if (Object.keys(body).some(k => !allowed.includes(k))) fail('DASHBOARD_INVALID_INPUT'); }
function version(raw: unknown): number { if (!Number.isSafeInteger(raw) || Number(raw) < 1) fail('DASHBOARD_VERSION_INVALID'); return Number(raw); }
export class DashboardRoutes {
  private readonly replay = new Map<string, Replay>();
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly cap?: number;
  constructor(private readonly protocol: Pick<AnalysisProtocol, 'paging'>, private readonly env: NodeJS.ProcessEnv) {
    const raw = env.OPENSIGHT_DASHBOARD_VERSION_CAP;
    if (raw !== undefined) { if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('OPENSIGHT_DASHBOARD_VERSION_CAP must be a positive integer'); this.cap = Number(raw); }
  }
  private async serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).then(work), tail = result.catch(() => {}); this.tails.set(key, tail);
    try { return await result; } finally { if (this.tails.get(key) === tail) this.tails.delete(key); }
  }
  private page<T>(request: IncomingMessage, all: T[]) {
    const { offset, limit } = this.protocol.paging(request), items = all.slice(offset, offset + limit);
    return { items, nextCursor: offset + items.length < all.length ? Buffer.from(JSON.stringify({ offset: offset + items.length })).toString('base64') : null };
  }
  private send(response: ServerResponse, reply: Reply) {
    if (reply.version !== undefined) response.setHeader('ETag', `"${reply.version}"`);
    if (reply.bytes) {
      response.writeHead(reply.status, { 'Content-Type': reply.contentType!, 'Content-Disposition': `attachment; filename="${reply.filename}"`, 'Content-Length': reply.bytes.length, 'Cache-Control': 'no-store' }); response.end(reply.bytes);
    } else send(response, reply.status, reply.body);
  }
  async route(request: IncomingMessage, response: ServerResponse, path: string, backend: DashboardBackend): Promise<void> {
    const publish = /^\/api\/v1\/analyses\/([A-Za-z0-9_-]{1,512})\/publish$/.exec(path);
    const match = /^\/api\/v1\/dashboards(?:\/([A-Za-z0-9_-]{1,512})(?:\/(versions)(?:\/([1-9]\d*)(?:\/visuals\/([A-Za-z0-9_-]{1,512})\/query)?)?|\/(exports)|\/shares\/(user|group)\/([A-Za-z0-9_-]{1,512}))?)?$/.exec(path);
    if (!publish && !match) fail('RESOURCE_NOT_FOUND', 404);
    const [, pathId, versions, rawVersion, visualId, exports, principalType, principalId] = match ?? [];
    const pinned = rawVersion === undefined ? undefined : version(Number(rawVersion));
    const verb = method(request, response, publish || visualId || exports ? ['POST'] : principalId ? ['GET', 'PUT', 'DELETE'] : !pathId || versions && !pinned ? ['GET'] : ['GET', 'DELETE']);
    if (verb === 'GET') {
      await backend.authorize(pathId, principalId ? 'admin' : 'read'); const stamp = await backend.analyses.stamp();
      let body: unknown, etag: number | undefined;
      if (!pathId) body = this.page(request, (await backend.list()).sort((a, b) => a.id.localeCompare(b.id)).map(d => {
        const v = dashboardVersion(d); return { kind: 'dashboard', id: d.id, name: v.name, version: v.version, publishedAt: v.publishedAt, sourceAnalysisId: v.sourceAnalysisId };
      }));
      else {
        const record = await backend.get(pathId);
        if (principalId) {
          body = (await backend.grants(pathId))?.find(g => g.principal.type === principalType && g.principal.id === principalId);
          if (!body) fail('RESOURCE_NOT_FOUND', 404);
        } else if (versions && !pinned) body = this.page(request, record.versions.map(v => ({ version: v.version, publishedAt: v.publishedAt, publishedBy: v.publishedBy })));
        else { body = describeDashboard(record, pinned); etag = pinned ?? await backend.revision(pathId); }
      }
      await backend.analyses.check(stamp); await backend.authorize(pathId, principalId ? 'admin' : 'read');
      this.send(response, { status: 200, body, version: etag }); return;
    }
    const raw: unknown = verb === 'DELETE' ? undefined : await readBody(request);
    if (verb === 'DELETE' && (request.headers['transfer-encoding'] || request.headers['content-length'] && request.headers['content-length'] !== '0')) fail('DASHBOARD_INVALID_INPUT');
    const body = verb === 'DELETE' ? {} : analysisObject(raw, '$');
    if (publish) keys(body, ['dashboardId']);
    if (exports) { keys(body, ['version', 'format']); if (body.format !== 'csv' && body.format !== 'pdf') fail('DASHBOARD_EXPORT_FORMAT_INVALID'); }
    if (principalId) { keys(body, ['role']); if (verb === 'PUT' && body.role !== 'viewer' && body.role !== 'co-owner') fail('DASHBOARD_INVALID_INPUT'); }
    const id = pathId ?? (body.dashboardId === undefined ? randomUUID() : analysisId(body.dashboardId, '$.dashboardId'));
    let expected: number | undefined;
    if (verb === 'DELETE' && !principalId) {
      const raw = request.headers['if-match'];
      if (typeof raw !== 'string' || !/^"[1-9]\d*"$/.test(raw) || !Number.isSafeInteger(Number(raw.slice(1, -1)))) fail('DASHBOARD_PRECONDITION_FAILED', 412);
      expected = Number(raw.slice(1, -1));
    }
    const keyHeader = request.headers['idempotency-key']; if (Array.isArray(keyHeader)) fail('INVALID_HEADER', 400);
    const scope = backend.analyses.scope, key = keyHeader === undefined ? undefined : canonical([scope.tenantId, scope.namespaceId, scope.userId, verb, path, identifier(keyHeader)]);
    const fingerprint = createHash('sha256').update(canonical([raw, expected])).digest('hex');
    const execute = () => this.serial(canonical([scope.tenantId, scope.namespaceId, publish ? `source:${publish[1]}` : id]), async () => {
      for (const [k, v] of this.replay) if (v.expires <= Date.now()) this.replay.delete(k);
      const seen = key === undefined ? undefined : this.replay.get(key);
      const authorize = async (dashboardId: string, removed = false, access?: unknown) => {
        if (publish) await backend.analyses.authorize(publish[1], true);
        if (removed) { if ((await backend.list()).some(d => d.id === dashboardId)) fail('IDEMPOTENCY_CONFLICT', 409); await backend.authorizeRemoved(access); }
        else if (!publish || body.dashboardId !== undefined || seen) await backend.authorize(dashboardId, principalId ? 'admin' : verb === 'DELETE' ? 'write' : 'read');
      };
      if (seen) {
        await authorize(seen.id, seen.removed, seen.access); const stamp = await backend.analyses.stamp();
        if (seen.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 409);
        if (publish) { const source = await backend.analyses.get(publish[1]!); await backend.analyses.resolve(source.datasetBindings); }
        if (seen.dataVersion) {
          const record = await backend.get(seen.id), v = dashboardVersion(record, seen.dataVersion);
          const definition = dashboardControls(v, visualId ? body : {});
          if (visualId) await backend.query(v, definition, visualId);
          else await dashboardExport(backend, record, v.version, String(body.format), this.env, true);
        }
        if (seen.dataVersion && canonical(seen.dataStamp) !== canonical(stamp)) fail('DASHBOARD_REPLAY_REVISED', 409);
        await backend.analyses.check(stamp); await authorize(seen.id, seen.removed, seen.access);
        response.setHeader('Idempotent-Replayed', 'true'); this.send(response, seen.reply); return;
      }
      if (key !== undefined && this.replay.size >= 1000) { response.setHeader('Retry-After', '60'); fail('IDEMPOTENCY_CAPACITY_EXCEEDED', 429); }
      await authorize(id); const stamp = await backend.analyses.stamp();
      let record: DashboardRecord | undefined, change: DashboardChange | undefined, reply: Reply, access: unknown, dataVersion: number | undefined;
      if (publish) {
        const source = await backend.analyses.get(publish[1]!);
        let diagnostics: AnalysisDiagnostic[];
        try {
          // D-49: drafts publish with their diagnostics attached; only unvalidatable definitions fail.
          diagnostics = validateAnalysisDefinition(source.definition, await backend.analyses.resolve(source.datasetBindings)).Errors;
        } catch (e) {
          if (e instanceof Error && !('diagnostics' in e) && 'code' in e) Object.assign(e, { diagnostics: [{ errorCode: e.code, message: e.message, path: 'path' in e ? e.path : '$.datasetBindings' }] });
          throw e;
        }
        if (body.dashboardId !== undefined) record = await backend.get(id);
        change = { kind: 'publish', dashboardId: id, create: body.dashboardId === undefined, source, publishedAt: new Date().toISOString(), cap: this.cap, errors: diagnostics };
        await backend.analyses.check(stamp);
        record = (await backend.change(id, change, stamp))!;
        const v = dashboardVersion(record); reply = { status: 201, body: { DashboardId: id, Version: v.version, PublishedAt: v.publishedAt, Errors: diagnostics }, version: v.version };
      } else {
        record = await backend.get(id);
        if (principalId) {
          change = { kind: 'share', principal: { type: principalType as 'user' | 'group', id: principalId }, ...(verb === 'PUT' ? { role: body.role as 'viewer' | 'co-owner' } : {}) };
          reply = { status: 200, body: verb === 'PUT' ? { principal: change.principal, role: change.role } : { deleted: true } };
        } else if (verb === 'DELETE') {
          access = await backend.accessSnapshot(id);
          change = pinned ? { kind: 'prune', version: pinned, expected: expected! } : { kind: 'delete', expected: expected! };
          reply = { status: 200, body: { id, ...(pinned ? { version: pinned } : {}), removed: true } };
        } else if (visualId) {
          const v = dashboardVersion(record, pinned), definition = dashboardControls(v, body); dataVersion = v.version;
          const { bindings: _bindings, ...result } = await backend.query(v, definition, visualId); reply = { status: 200, body: result, version: v.version };
        } else {
          const selected = body.version === undefined ? record.latest : version(body.version); dataVersion = selected;
          const artifact = await dashboardExport(backend, record, selected, String(body.format), this.env);
          reply = { status: 200, body: null, version: selected, ...artifact };
        }
        await backend.analyses.check(stamp);
        if (change) await backend.change(id, change, stamp);
      }
      if (key !== undefined && reply.bytes && [...this.replay.values()].reduce((size, r) => size + (r.reply.bytes?.length ?? 0), reply.bytes.length) > 64 * 1024 * 1024) { response.setHeader('Retry-After', '60'); fail('IDEMPOTENCY_CAPACITY_EXCEEDED', 429); }
      if (key !== undefined) this.replay.set(key, { fingerprint, reply, id, expires: Date.now() + 600000, removed: change?.kind === 'delete', access, dataVersion, ...(dataVersion ? { dataStamp: stamp } : {}) });
      if (dataVersion) dashboardVersion(await backend.get(id), dataVersion);
      await authorize(id, change?.kind === 'delete', access);
      this.send(response, reply);
    });
    if (key === undefined) await execute(); else await this.serial(`retry:${key}`, execute);
  }
}
