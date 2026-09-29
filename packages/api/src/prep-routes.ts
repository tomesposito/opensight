import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseBundleResource, type BundleDataSet } from '@opensight/bundle-parser';
import { PrepError, prepFail, prepName, prepObject, validatePrepPipeline, type PrepInput } from '@opensight/bundle-parser/prep';
import { compilePrep, prepSource, previewPrepPostgres, QueryEngineError, validateConnectorConfig, type PrepSource, type PrepPreviewOptions, type PrepDataset } from '@opensight/query-engine';
import { AutomationStore } from './automation-store.js';
import type { ConnectorRoutes } from './connector-routes.js';
import { readBody, RequestError } from './query.js';
import { method } from './automation-routes.js';
import type { Identity } from './security.js';
import { RESOURCE_ID } from './store.js';

/** Trusted startup binding. Never populated from an HTTP body or imported bundle. */
export interface PrepPostgresBinding {
  namespaceId: string; userId: string; source: PrepSource; config: { connectionEnv: string };
}
interface Stored { namespaceId: string; userId: string; resource: BundleDataSet }
interface State { version: 1; datasets: Stored[] }
function state(raw: unknown): State {
  const s = prepObject(raw, ['version', 'datasets'], '$');
  if (s.version !== 1 || !Array.isArray(s.datasets) || s.datasets.length > 1000) prepFail('INVALID_PREP_PIPELINE', '$', 'Invalid prep store');
  const seen = new Set<string>();
  for (const entry of s.datasets) {
    const v = prepObject(entry, ['namespaceId', 'userId', 'resource'], '$.datasets');
    prepName(v.namespaceId, '$.namespaceId'); prepName(v.userId, '$.userId');
    const r = parseBundleResource(v.resource);
    if (r.resourceType !== 'dataset' || !RESOURCE_ID.test(r.dataSetId) || !r.opensightPrep) prepFail('INVALID_PREP_PIPELINE', '$.resource', 'Expected a prepared dataset');
    const key = JSON.stringify([v.namespaceId, v.userId, r.dataSetId]);
    if (seen.has(key)) prepFail('INVALID_PREP_PIPELINE', '$.datasets', 'Duplicate prepared dataset'); seen.add(key);
  }
  return structuredClone(raw) as State;
}
function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body));
}
export class PrepRoutes {
  private constructor(private readonly store: AutomationStore<State>, private readonly connectors: ConnectorRoutes, private readonly bindings: readonly PrepPostgresBinding[], private readonly persistent: boolean) {}
  static async create(connectors: ConnectorRoutes, path?: string, bindings: readonly PrepPostgresBinding[] = []): Promise<PrepRoutes> {
    const seen = new Set<string>();
    for (const b of bindings) {
      prepName(b.namespaceId, '$.namespaceId'); prepName(b.userId, '$.userId'); prepName(b.source.id, '$.source.id');
      validateConnectorConfig('postgresql', b.config);
      if (b.source.connectorId !== 'postgresql') prepFail('INVALID_PREP_PIPELINE', '$.source', 'Expected PostgreSQL connector');
      if (b.source.security === 'unrestricted') prepSource(b.source.id, [b.source], 'postgres');
      const key = JSON.stringify([b.namespaceId, b.userId, b.source.id]);
      if (seen.has(key)) prepFail('INVALID_PREP_PIPELINE', '$.source', 'Duplicate source binding'); seen.add(key);
    }
    return new PrepRoutes(await AutomationStore.load<State>({ version: 1, datasets: [] }, path, state), connectors, structuredClone(bindings), !!path);
  }
  private owned(identity: Identity, entry: Pick<Stored, 'namespaceId' | 'userId'>): boolean { return identity.namespaceId === entry.namespaceId && identity.userId === entry.userId; }
  private async sources(identity: Identity): Promise<PrepSource[]> {
    return [...await this.connectors.prepSources(identity), ...this.bindings.filter(b => this.owned(identity, b)).map(b => b.source)];
  }
  private datasets(identity: Identity, state = this.store.read()): PrepDataset[] {
    return state.datasets.filter(e => this.owned(identity, e)).map(e => ({ id: e.resource.dataSetId, pipeline: e.resource.opensightPrep! }));
  }
  private async context(identity: Identity, ref: PrepInput, datasets: readonly PrepDataset[]) {
    const visited = new Set<string>();
    let input = ref;
    while (typeof input !== 'string') {
      const id = input.dataset;
      if (visited.has(id)) prepFail('INVALID_PREP_PIPELINE', '$.input', `Prepared dataset cycle: ${id}`);
      if (visited.size >= 16) prepFail('PREP_LIMIT_EXCEEDED', '$.input', 'At most 16 nested prepared datasets');
      visited.add(id);
      const dataset = datasets.find(d => d.id === id);
      if (!dataset) prepFail('PREP_SOURCE_NOT_FOUND', '$.input', `Prepared dataset is unavailable: ${id}`);
      input = dataset.pipeline.input;
    }
    const all = await this.sources(identity), source = all.find(s => s.id === input);
    if (!source) prepFail('PREP_SOURCE_NOT_FOUND', '$.input', 'Connected source is unavailable');
    const binding = this.bindings.find(b => this.owned(identity, b) && b.source.id === input);
    const sources = binding ? this.bindings.filter(b => this.owned(identity, b) && b.config.connectionEnv === binding.config.connectionEnv).map(b => b.source) : all.filter(s => s.connectorId === 'file');
    return { sources, binding, dialect: binding ? 'postgres' as const : 'duckdb' as const };
  }
  async route(request: IncomingMessage, response: ServerResponse, path: string, query: string, identity: Identity): Promise<void> {
    try {
      if (query) throw new RequestError(400, 'Query parameters are not supported');
      if (path === '/api/prep-sources') {
        method(request, response, ['GET']);
        const owned = this.store.read().datasets.filter(e => this.owned(identity, e)), datasets = this.datasets(identity);
        const raw = (await this.sources(identity)).map(s => ({ id: s.id, connectorId: s.connectorId, columns: s.columns, available: s.security === 'unrestricted' }));
        const prepared = await Promise.all(owned.map(async ({ resource: r }) => {
          const summary = { id: r.dataSetId, ref: { dataset: r.dataSetId }, name: r.name };
          try {
            const context = await this.context(identity, r.opensightPrep!.input, datasets);
            const plan = compilePrep(r.opensightPrep, context.sources, { dialect: context.dialect, datasets, datasetId: r.dataSetId });
            return { ...summary, connectorId: context.binding ? 'postgresql' : 'file', columns: plan.columns, available: true };
          } catch (e) {
            if (!(e instanceof PrepError || e instanceof QueryEngineError)) throw e;
            return { ...summary, connectorId: 'prepared', columns: [], available: false, errorCode: e.code };
          }
        }));
        send(response, 200, [...raw, ...prepared]); return;
      }
      if (path === '/api/prep-datasets') {
        method(request, response, ['GET']);
        send(response, 200, { datasets: this.store.read().datasets.filter(e => this.owned(identity, e)).map(e => e.resource), persistence: this.persistent ? 'file' : 'ephemeral' }); return;
      }
      const match = /^\/api\/datasets\/([A-Za-z0-9_-]{1,128})\/prep(?:\/(preview))?$/.exec(path);
      if (!match) throw new RequestError(404, 'Prep resource not found');
      const id = match[1]!, preview = !!match[2];
      method(request, response, preview ? ['POST'] : ['GET', 'PUT', 'DELETE']);
      const existing = this.store.read().datasets.find(e => this.owned(identity, e) && e.resource.dataSetId === id);
      if (preview || request.method === 'PUT') {
        const body = prepObject(await readBody(request), preview ? ['pipeline', 'through', 'limit'] : ['name', 'pipeline'], '$');
        if (preview && !Object.hasOwn(body, 'pipeline') && !existing) prepFail('PREP_NOT_FOUND', '$.dataset', 'Prepared dataset not found');
        const pipeline = validatePrepPipeline(Object.hasOwn(body, 'pipeline') ? body.pipeline : preview ? existing?.resource.opensightPrep : undefined);
        const datasets = this.datasets(identity);
        const context = await this.context(identity, pipeline.input, datasets);
        const options: PrepPreviewOptions = { datasets, datasetId: id };
        if (body.through !== undefined) { if (body.through !== null) prepName(body.through, '$.through'); options.through = body.through as string | null; }
        if (body.limit !== undefined) { if (typeof body.limit !== 'number') prepFail('PREP_LIMIT_EXCEEDED', '$.limit', 'Expected numeric limit'); options.limit = body.limit; }
        compilePrep(pipeline, context.sources, { dialect: context.dialect, ...options });
        if (preview) {
          send(response, 200, context.binding ? await previewPrepPostgres(pipeline, context.sources, context.binding.config, options) : await this.connectors.previewPrep(identity, pipeline, options)); return;
        }
        const name = prepName(body.name, '$.name');
        const resource: BundleDataSet = { resourceType: 'dataset', dataSetId: id, name, physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: pipeline };
        const created = await this.store.change(draft => {
          // Serialize dependency validation with metadata writes: two concurrent replacements
          // must not create a cycle using each other's old definitions.
          compilePrep(pipeline, context.sources, { dialect: context.dialect, datasets: this.datasets(identity, draft), datasetId: id });
          const index = draft.datasets.findIndex(e => this.owned(identity, e) && e.resource.dataSetId === id);
          if (index < 0) {
            if (draft.datasets.length >= 1000 || draft.datasets.filter(e => this.owned(identity, e)).length >= 100) prepFail('PREP_LIMIT_EXCEEDED', '$.datasets', 'Prepared dataset limit reached');
            draft.datasets.push({ ...identity, resource });
          } else draft.datasets[index] = { ...identity, resource };
          return index < 0;
        });
        send(response, created ? 201 : 200, { resource, persistence: this.persistent ? 'file' : 'ephemeral' }); return;
      }
      if (!existing) prepFail('PREP_NOT_FOUND', '$.dataset', 'Prepared dataset not found');
      if (request.method === 'GET') { send(response, 200, { resource: existing.resource, persistence: this.persistent ? 'file' : 'ephemeral' }); return; }
      await this.store.change(draft => { draft.datasets = draft.datasets.filter(e => !(this.owned(identity, e) && e.resource.dataSetId === id)); });
      send(response, 200, { deleted: true });
    } catch (e) {
      if (e instanceof PrepError || e instanceof QueryEngineError) {
        request.resume(); send(response, e.code === 'PREP_NOT_FOUND' || e.code === 'PREP_SOURCE_NOT_FOUND' ? 404 : e.code === 'PREP_SECURITY_REJECTED' ? 403 : e.code === 'PREP_EXECUTION_FAILED' ? 422 : 400, { errorCode: e.code, Message: e.message, path: e.path }); return;
      }
      throw e;
    }
  }
}
