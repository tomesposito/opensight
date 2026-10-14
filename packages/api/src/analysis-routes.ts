import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { analysisFail, analysisObject, analysisId, checkAnalysisInput, validateAnalysisDefinition, visualIdentity, projectDefinition } from '@opensight/web/analysis';
import type { BundleDefinition } from '@opensight/bundle-parser';
import { MetadataError } from './metadata-db.js';
import { identifier } from './metadata-resources.js';
import { method, send } from './automation-routes.js';
import { readBody } from './query.js';
import { analysisName, datasetBindings, describeAnalysis, type AnalysisRecord, type AnalysisBackend } from './analysis-model.js';

interface Reply { status: number; body: unknown; version?: number }
interface Replay { fingerprint: string; reply: Reply; record: AnalysisRecord; removed: boolean; access: unknown; expires: number }
export interface AnalysisProtocol {
  paging(request: IncomingMessage): { limit: number; offset: number };
  ifMatch(request: IncomingMessage): number;
}
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, child]) => `${JSON.stringify(k)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}
function conflict(): never { throw new MetadataError('METADATA_CONFLICT', 409); }
function unknown(): never { throw new MetadataError('RESOURCE_NOT_FOUND', 404); }
function bodyKeys(body: Record<string, unknown>, keys: string[]): void {
  for (const key of Object.keys(body)) if (!keys.includes(key)) analysisFail('INVALID_INPUT', `$.${key}`, 'Unknown request property');
  for (const key of keys) if (!Object.hasOwn(body, key)) analysisFail('INVALID_INPUT', `$.${key}`, 'Required property');
}
/** One working version and one shared admission path for all approved verbs. */
export class AnalysisRoutes {
  private readonly replay = new Map<string, Replay>();
  private readonly tails = new Map<string, Promise<unknown>>();
  constructor(private readonly protocol: AnalysisProtocol) {}
  private async serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).then(work), tail = result.catch(() => {});
    this.tails.set(key, tail);
    try { return await result; } finally { if (this.tails.get(key) === tail) this.tails.delete(key); }
  }
  private async describe(record: AnalysisRecord, backend: AnalysisBackend) {
    const checked = validateAnalysisDefinition(record.definition, await backend.resolve(record.datasetBindings));
    return describeAnalysis(record, projectDefinition(checked.definition), checked.Errors);
  }
  async route(request: IncomingMessage, response: ServerResponse, path: string, backend: AnalysisBackend): Promise<void> {
    const match = /^\/api\/v1\/analyses(?:\/([A-Za-z0-9_-]{1,512})(?:\/(?:sheets\/([A-Za-z0-9_-]{1,512})\/(visuals|layouts)(?:\/([A-Za-z0-9_-]{1,512}))?|(filter-groups|calculated-fields)(?:\/([A-Za-z0-9_-]{1,512}))?))?)?$/.exec(path);
    if (!match) unknown();
    const [, pathId, sheetId, sheetAction, visualId, collection, groupId] = match;
    if (sheetAction === 'layouts' && visualId || collection === 'calculated-fields' && groupId) unknown();
    const allowed = !pathId ? ['GET', 'POST'] : !sheetAction && !collection ? ['GET', 'PUT', 'DELETE']
      : sheetAction === 'layouts' || collection === 'calculated-fields' ? ['PUT'] : visualId || groupId ? ['PUT', 'DELETE'] : ['POST'];
    const verb = method(request, response, allowed);
    if (verb === 'GET') {
      await backend.authorize(pathId); const stamp = await backend.stamp();
      if (pathId) {
        const record = await backend.get(pathId), body = await this.describe(record, backend);
        await backend.check(stamp); response.setHeader('ETag', `"${record.version}"`); send(response, 200, body);
      } else {
        const { offset, limit } = this.protocol.paging(request), all = await backend.list(), items = all.slice(offset, offset + limit);
        await backend.check(stamp);
        send(response, 200, { items, nextCursor: offset + items.length < all.length ? Buffer.from(JSON.stringify({ offset: offset + items.length })).toString('base64') : null });
      }
      return;
    }
    const version = pathId ? this.protocol.ifMatch(request) : 0;
    let raw: unknown;
    if (verb === 'DELETE') {
      if (request.headers['transfer-encoding'] || request.headers['content-length'] && request.headers['content-length'] !== '0') analysisFail('INVALID_INPUT', '$', 'Delete takes no body');
    } else raw = await readBody(request);
    checkAnalysisInput(raw);
    const id = pathId ?? analysisId(analysisObject(raw, '$').analysisId, '$.analysisId');
    const keyHeader = request.headers['idempotency-key'];
    if (Array.isArray(keyHeader)) throw new MetadataError('INVALID_HEADER', 400);
    const key = keyHeader === undefined ? undefined : canonical([backend.scope.tenantId, backend.scope.namespaceId, backend.scope.userId, verb, path, identifier(keyHeader)]);
    const fingerprint = createHash('sha256').update(canonical([raw, version])).digest('hex');
    const scopedId = canonical([backend.scope.tenantId, backend.scope.namespaceId, id]);
    const execute = () => this.serial(`analysis:${scopedId}`, async () => {
      for (const [k, v] of this.replay) if (v.expires <= Date.now()) this.replay.delete(k);
      const seen = key === undefined ? undefined : this.replay.get(key);
      if (seen) {
        const stamp = await backend.stamp();
        if (seen.removed) {
          // An ID recreated after deletion is a new resource, never an old replay.
          if (await backend.exists(id)) conflict();
          await backend.authorizeRemoved(seen.access);
        } else {
          await backend.authorize(seen.record.id, true);
          await this.describe(await backend.get(seen.record.id), backend);
        }
        // Validate the replay's definition against current data access too.
        await this.describe(seen.record, backend);
        if (seen.fingerprint !== fingerprint) throw new MetadataError('IDEMPOTENCY_CONFLICT', 409);
        await backend.check(stamp);
        response.setHeader('Idempotent-Replayed', 'true'); this.publish(response, seen.reply); return;
      }
      await backend.authorize(pathId, true);
      const stamp = await backend.stamp();
      const previous = pathId ? await backend.get(id) : undefined;
      if (previous && previous.version !== version) conflict();
      // Rebinding cannot be used to bypass access to the current owner's data.
      if (previous) await backend.resolve(previous.datasetBindings);
      const access = previous ? await backend.accessSnapshot(id) : null;
      let record: AnalysisRecord;
      const removed = verb === 'DELETE' && !sheetAction && !collection;
      if (removed) record = previous!;
      else if (!sheetAction && !collection) {
        const body = analysisObject(raw, '$'); bodyKeys(body, pathId ? ['name', 'definition', 'datasetBindings'] : ['analysisId', 'name', 'definition', 'datasetBindings']);
        const definition = analysisObject(body.definition, '$.definition') as unknown as BundleDefinition;
        record = { id, name: analysisName(body.name), definition, datasetBindings: datasetBindings(body.datasetBindings, definition), version: version + 1 };
      } else {
        record = structuredClone(previous!); record.version = version + 1;
        const d = record.definition;
        if (sheetAction) {
          const sheet = d.sheets?.find(s => s.sheetId === sheetId); if (!sheet) unknown();
          if (sheetAction === 'layouts') {
            if (!Array.isArray(raw)) analysisFail('INVALID_INPUT', '$.definition.sheets.layouts', 'Expected complete layouts array');
            sheet.layouts = raw;
          } else {
            const visuals = sheet.visuals ??= [];
            const index = visualId === undefined ? -1 : visuals.findIndex(v => visualIdentity(v, '$.definition.sheets.visuals') === visualId);
            if (visualId !== undefined && index < 0) unknown();
            if (verb === 'DELETE') visuals.splice(index, 1);
            else {
              const id = visualIdentity(raw, '$.definition.sheets.visuals');
              if (visualId !== undefined && id !== visualId) analysisFail('INVALID_INPUT', '$.definition.sheets.visuals.visualId', 'Identity must match path');
              if (verb === 'POST') visuals.push(raw as typeof visuals[number]); else visuals[index] = raw as typeof visuals[number];
            }
          }
        } else if (collection === 'calculated-fields') {
          if (!Array.isArray(raw)) analysisFail('INVALID_INPUT', '$.definition.calculatedFields', 'Expected complete calculated fields array');
          d.calculatedFields = raw;
        } else {
          const groups = d.filterGroups ??= [], index = groupId === undefined ? -1 : groups.findIndex(g => analysisObject(g, '$.definition.filterGroups').filterGroupId === groupId);
          if (groupId !== undefined && index < 0) unknown();
          if (verb === 'DELETE') groups.splice(index, 1);
          else {
            const g = analysisObject(raw, '$.definition.filterGroups');
            if (groupId !== undefined && g.filterGroupId !== groupId) analysisFail('INVALID_INPUT', '$.definition.filterGroups.filterGroupId', 'Identity must match path');
            if (verb === 'POST') groups.push(g); else groups[index] = g;
          }
        }
      }
      const body = await this.describe(record, backend);
      await backend.check(stamp);
      if (removed) await backend.remove(id, version, stamp); else await backend.save(record, version, stamp);
      const reply: Reply = removed ? { status: 200, body: { id, removed: true } } : { status: pathId ? 200 : 201, body, version: record.version };
      // Store after commit, before writing the response: disconnected clients can retry.
      if (key !== undefined) this.replay.set(key, { fingerprint, reply, record, removed, access, expires: Date.now() + 600000 });
      const publication = await backend.stamp();
      if (removed) await backend.authorizeRemoved(access); else await backend.authorize(id, true);
      await this.describe(record, backend); await backend.check(publication);
      this.publish(response, reply);
    });
    // Create requests share one route but can target different analysis IDs.
    // Reserve the retry key before taking the resource lock, so different
    // payloads cannot both commit while the first response is being recorded.
    if (key === undefined) await execute(); else await this.serial(`retry:${key}`, execute);
  }
  private publish(response: ServerResponse, reply: Reply) { if (reply.version !== undefined) response.setHeader('ETag', `"${reply.version}"`); send(response, reply.status, reply.body); }
}
