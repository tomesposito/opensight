import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MetricDataset } from '@opensight/query-engine';
import { AssetCatalog, assetFail, type AssetBackend } from './asset-model.js';
import { MetricCatalog, metricDataset, metricRecord, type MetricSchema } from './metric-model.js';
import { identifier, object, type MetadataResource } from './metadata-resources.js';
import { method, send } from './automation-routes.js';
import { readBody } from './query.js';
import { RetryStore, type RetryAdapter } from './retry-store.js';
import type { AnalysisProtocol } from './analysis-routes.js';
export interface MetricBackend extends AssetBackend { metricSchema?(dataset: MetricDataset): Promise<MetricSchema> }
interface Reply { status: number; body: unknown; version?: number }
interface Receipt { fingerprint: string; reply: Reply; id: string }
function view(c: MetricCatalog, r: MetadataResource) {
  const b = metricRecord(r), canEdit = c.canEdit(r), latest = b.versions.at(-1)!, published = b.versions.find(v => v.version === b.publishedVersion);
  return { id: r.id, dataset: b.dataset, version: r.version, publishedVersion: b.publishedVersion,
    state: canEdit ? latest.state : 'published', definition: (canEdit ? latest : published)!.definition,
    published: published ? { id: r.id, version: published.version, ...published.definition } : null,
    permissions: { edit: canEdit, publish: c.canPublish(b.dataset) } };
}
export class MetricRoutes {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly protocol: AnalysisProtocol, private readonly receipts: RetryAdapter = new RetryStore({ periodicPrune: false })) {}
  matches(path: string) { return /^\/api\/v1\/metrics(?:\/|$)/.test(path) || /^\/api\/v1\/datasets\/[^/]+\/metrics$/.test(path); }
  async route(request: IncomingMessage, response: ServerResponse, path: string, backend: MetricBackend) {
    const scoped = /^\/api\/v1\/datasets\/([A-Za-z0-9_-]{1,512})\/metrics$/.exec(path);
    const match = /^\/api\/v1\/metrics(?:\/([A-Za-z0-9_-]{1,512})(?:\/(publish|versions|export))?)?$/.exec(path);
    if (!scoped && !match) assetFail('RESOURCE_NOT_FOUND', 404);
    const id = match?.[1], action = match?.[2], list = !!scoped || !id;
    const verb = method(request, response, scoped || action === 'versions' || action === 'export' ? ['GET'] : list ? ['GET', 'POST'] : action === 'publish' ? ['POST'] : ['GET', 'PUT']);
    const read = verb === 'GET', raw = read ? {} : object(await readBody(request), action === 'publish' ? [] : list ? ['id', 'dataset', 'definition'] : ['definition']);
    const expected = !read && !list ? this.protocol.ifMatch(request) : undefined;
    const keyHeader = request.headers['idempotency-key']; if (Array.isArray(keyHeader)) assetFail('INVALID_HEADER');
    const key = !read && keyHeader ? JSON.stringify(['metric', backend.scope, verb, path, identifier(keyHeader)]) : undefined;
    const fingerprint = createHash('sha256').update(JSON.stringify([raw, expected])).digest('hex');
    const page = (items: unknown[]) => { const { offset, limit } = this.protocol.paging(request); return { items: items.slice(offset, offset + limit), nextCursor: offset + limit < items.length ? Buffer.from(JSON.stringify({ offset: offset + limit })).toString('base64') : null }; };
    const run = async () => {
      const old = key ? await this.receipts.get<Receipt>(key) : undefined;
      if (old) {
        await backend.transaction(false, a => { const c = new MetricCatalog(a), r = c.get(old.id); a.build(); if (action === 'publish' ? !c.canPublish(metricRecord(r).dataset) : !c.canEdit(r)) assetFail('METRIC_EDIT_FORBIDDEN', 403); });
        if (old.fingerprint !== fingerprint) assetFail('IDEMPOTENCY_CONFLICT', 409);
        response.setHeader('Idempotent-Replayed', 'true'); this.send(response, old.reply); return;
      }
      const ref = !read ? list ? metricDataset(raw.dataset) : await backend.transaction(false, a => metricRecord(new MetricCatalog(a).get(id!)).dataset) : undefined;
      const snapshot = ref ? await backend.transaction(false, a => structuredClone(new MetricCatalog(a).dataset(ref))) : undefined;
      let schema: MetricSchema | undefined;
      if (ref) schema = backend.metricSchema ? await backend.metricSchema(ref) : await backend.transaction(false, a => new MetricCatalog(a).schema(ref));
      const reservation = key ? await this.receipts.reserve<Receipt>(backend.scope.tenantId, key) : undefined;
      const resultId = id ?? (!read ? identifier(raw.id) : '');
      const prepare = (reply: Reply) => { reservation?.prepare({ fingerprint, reply, id: resultId }); return reservation ?? {}; };
      try {
        const reply = await backend.transaction(!read, a => {
          const c = new MetricCatalog(a);
          if (snapshot && JSON.stringify(c.dataset(ref!)) !== JSON.stringify(snapshot)) assetFail('METRIC_DATASET_REVISED', 409);
          if (read && list) {
            // Dataset header distinguishes legacy/prepared and same-id owners. Never infer by field names.
            const header = request.headers['metric-dataset'];
            if (Array.isArray(header)) assetFail('INVALID_HEADER');
            let filter: MetricDataset | undefined;
            if (scoped) {
              if (header) { try { filter = metricDataset(JSON.parse(header)); } catch { assetFail('METRIC_INVALID_DATASET'); } if (filter!.id !== scoped[1]) assetFail('METRIC_INVALID_DATASET'); }
              else filter = { kind: 'prepared-dataset', id: scoped[1]!, ownerId: backend.scope.userId };
            }
            return { status: 200, body: { ...page(c.list(filter).sort((a,b) => a.id.localeCompare(b.id)).map(r => view(c,r))), ...(filter ? { canCreate: ['administrator', 'author', 'author_ai'].includes(String(a.user().body.role)), canPublish: c.canPublish(filter) } : {}) } };
          }
          if (read) {
            const r = c.get(id!);
            if (action) {
              if (!c.canEdit(r)) assetFail('METRIC_HISTORY_FORBIDDEN', 403);
              return { status: 200, version: r.version, body: action === 'versions' ? page(metricRecord(r).versions) : { resourceType: 'governed-metric', schemaVersion: 1, id: r.id, version: r.version, ...structuredClone(metricRecord(r)) } };
            }
            return { status: 200, version: r.version, body: view(c,r) };
          }
          const r = list ? c.create(resultId, ref!, raw.definition, schema!) : action === 'publish' ? c.publish(id!, expected!, schema!) : c.edit(id!, expected!, raw.definition, schema!);
          return { status: list ? 201 : 200, version: r.version, body: view(c,r) };
        }, prepare);
        prepare(reply); await reservation?.commit(); this.send(response, reply);
      } finally { await reservation?.release(); }
    };
    if (read) await run(); else { const pending = this.tail.then(run); this.tail = pending.catch(() => {}); await pending; }
  }
  private send(response: ServerResponse, reply: Reply) { if (reply.version) response.setHeader('ETag', `"${reply.version}"`); send(response, reply.status, reply.body); }
}
