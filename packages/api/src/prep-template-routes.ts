import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PrepPipeline } from '@opensight/bundle-parser/prep';
import { assetFail, type AssetBackend } from './asset-model.js';
import { PrepTemplateCatalog, templateRecord, templateSlots } from './prep-template-model.js';
import { identifier, object, type MetadataResource } from './metadata-resources.js';
import { method, send } from './automation-routes.js';
import { readBody } from './query.js';
import type { AnalysisProtocol } from './analysis-routes.js';
export interface TemplateBackend extends AssetBackend { createTemplateDataset?(id: string, name: string, pipeline: PrepPipeline): Promise<unknown> }
function view(c: PrepTemplateCatalog, r: MetadataResource) {
  const b = templateRecord(r), canEdit = c.canEdit(r), v = canEdit ? b.versions.at(-1)! : b.versions.find(v => v.version === b.publishedVersion)!;
  return { id: r.id, version: r.version, owner: b.owner, createdBy: b.createdBy, source: b.source, publishedVersion: b.publishedVersion, state: v.state, definition: v.definition,
    slots: templateSlots(v.definition.pipeline), publishedSlots: b.publishedVersion === null ? [] : templateSlots(b.versions.find(v => v.version === b.publishedVersion)!.definition.pipeline), permissions: { edit: canEdit, publish: c.canPublish(r) } };
}
export class PrepTemplateRoutes {
  constructor(private readonly protocol: AnalysisProtocol) {}
  matches(path: string) { return /^\/api\/v1\/prep-templates(?:\/|$)/.test(path); }
  async route(request: IncomingMessage, response: ServerResponse, path: string, backend: TemplateBackend) {
    const match = /^\/api\/v1\/prep-templates(?:\/([A-Za-z0-9_-]{1,512})(?:\/(publish|versions|export|datasets))?)?$/.exec(path);
    if (!match) assetFail('RESOURCE_NOT_FOUND', 404);
    const [, id, action] = match;
    const verb = method(request, response, !id ? ['GET', 'POST'] : action === 'publish' || action === 'datasets' ? ['POST'] : action ? ['GET'] : ['GET', 'PUT']);
    const read = verb === 'GET', raw = read ? {} : object(await readBody(request), !id ? ['id', 'datasetId', 'name'] : action === 'publish' ? [] : action === 'datasets' ? ['id', 'name', 'bindings'] : ['definition']);
    const expected = !read && id ? this.protocol.ifMatch(request) : undefined;
    if (action === 'datasets') {
      const datasetId = identifier(raw.id); if (datasetId.length > 128 || datasetId === 'sales') assetFail('TEMPLATE_INVALID_DATASET');
      if (typeof raw.name !== 'string' || !raw.name.trim()) assetFail('TEMPLATE_INVALID_NAME');
      if (!backend.createTemplateDataset) assetFail('HOSTED_API_REQUIRED', 503);
      const pipeline = await backend.transaction(false, a => new PrepTemplateCatalog(a).bind(id!, expected!, raw.bindings));
      try { const result = await backend.createTemplateDataset(datasetId, raw.name, pipeline); send(response, 201, result); }
      catch (e) {
        const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : '';
        if (/^(PREP_|INVALID_PREP_|UNSUPPORTED_PREP_|EXPRESSION_|UNKNOWN_FIELD|TYPE_MISMATCH|SOURCE_|UPLOAD_|RESOURCE_NOT_FOUND)/.test(code)) assetFail('TEMPLATE_BINDING_FAILED', 422);
        throw e;
      }
      return;
    }
    const result = await backend.transaction(!read, a => {
      const c = new PrepTemplateCatalog(a);
      const page = (items: unknown[]) => { const { offset, limit } = this.protocol.paging(request); return { items: items.slice(offset, offset + limit), nextCursor: offset + limit < items.length ? Buffer.from(JSON.stringify({ offset: offset + limit })).toString('base64') : null }; };
      if (read && !id) return { body: page(c.list().sort((a,b) => a.id.localeCompare(b.id)).map(r => view(c,r))) };
      if (read) {
        const r = c.get(id!);
        if (action) { if (!c.canEdit(r)) assetFail('TEMPLATE_HISTORY_FORBIDDEN', 403); return { version: r.version, body: action === 'versions' ? page(templateRecord(r).versions) : { id: r.id, version: r.version, ...templateRecord(r) } }; }
        return { version: r.version, body: view(c,r) };
      }
      const r = !id ? c.propose(identifier(raw.id), identifier(raw.datasetId), raw.name) : action === 'publish' ? c.publish(id, expected!) : c.edit(id, expected!, raw.definition);
      return { version: r.version, body: view(c,r) };
    });
    if (result.version) response.setHeader('ETag', `"${result.version}"`); send(response, !read && !id ? 201 : 200, result.body);
  }
}
