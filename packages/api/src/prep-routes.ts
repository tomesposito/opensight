import { randomUUID } from 'node:crypto';
import { BlazeStore, BlazeError, directSettings, executionSettings, type BlazeTable, type ExecutionSettings, type CachedInput } from './blaze.js';
import { streamPrepPostgres, queryPrepared, type PrepMemoryTable } from '@opensight/query-engine';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseBundleResource, type BundleDataSet } from '@opensight/bundle-parser';
import { PrepError, prepFail, prepName, prepObject, validatePrepPipeline, type PrepInput, type PrepPipeline } from '@opensight/bundle-parser/prep';
import { compilePrep, prepSource, previewPrepPostgres, QueryEngineError, validateConnectorConfig, type PrepSource, type PrepPreviewOptions, type PrepDataset } from '@opensight/query-engine';
import { AutomationStore } from './automation-store.js';
import type { ConnectorRoutes } from './connector-routes.js';
import { readBody, readQuery, RequestError, SecurityError } from './query.js';
import { method } from './automation-routes.js';
import type { Identity } from './security.js';
import { RESOURCE_ID } from './store.js';

/** Trusted startup binding. Never populated from an HTTP body or imported bundle. */
export interface PrepPostgresBinding {
  namespaceId: string; userId: string; source: PrepSource; config: { connectionEnv: string };
}
interface Stored { namespaceId: string; userId: string; resource: BundleDataSet; execution?: ExecutionSettings }
interface State { version: 1; datasets: Stored[] }
function state(raw: unknown): State {
  const s = prepObject(raw, ['version', 'datasets'], '$');
  if (s.version !== 1 || !Array.isArray(s.datasets) || s.datasets.length > 1000) prepFail('INVALID_PREP_PIPELINE', '$', 'Invalid prep store');
  const seen = new Set<string>();
  for (const entry of s.datasets) {
    const v = prepObject(entry, ['namespaceId', 'userId', 'resource', 'execution'], '$.datasets');
    prepName(v.namespaceId, '$.namespaceId'); prepName(v.userId, '$.userId');
    if (v.execution !== undefined) executionSettings(v.execution);
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
  private readonly blaze = new BlazeStore();
  private key(identity: Identity, id: string): string { return JSON.stringify([identity.namespaceId, identity.userId, id]); }
  private find(identity: Identity, id: string): Stored {
    return this.store.read().datasets.find(e => this.owned(identity, e) && e.resource.dataSetId === id) ?? prepFail('PREP_NOT_FOUND', '$.dataset', 'Prepared dataset not found');
  }
  private invalidate(identity: Identity, changed: string): void {
    const datasets = this.datasets(identity), affected = new Set([changed]);
    let added = true;
    while (added) { added = false; for (const d of datasets) if (!affected.has(d.id) && this.references(d.pipeline).some(ref => typeof ref !== 'string' && affected.has(ref.dataset))) { affected.add(d.id); added = true; } }
    for (const id of affected) this.blaze.invalidate(this.key(identity, id));
  }
  private references(pipeline: PrepPipeline): PrepInput[] {
    return [pipeline.input, ...pipeline.steps.flatMap(s => s.kind === 'join' && !(typeof s.config.source !== 'string' && 'step' in s.config.source) ? [s.config.source as PrepInput] : [])];
  }
  private graph(identity: Identity, id: string, pipeline: PrepPipeline, state = this.store.read()): void {
    const datasets = this.datasets(identity, state), active = new Set<string>(), done = new Set<string>();
    const visit = (key: string, depth: number) => {
      if (active.has(key)) prepFail('INVALID_PREP_PIPELINE', '$.input', 'Prepared dataset cycle');
      if (depth > 16) prepFail('PREP_LIMIT_EXCEEDED', '$.input', 'At most 16 nested prepared datasets');
      if (done.has(key)) return;
      const p = key === id ? pipeline : datasets.find(d => d.id === key)?.pipeline;
      if (!p) prepFail('PREP_SOURCE_NOT_FOUND', '$.input', 'Prepared dataset is unavailable');
      active.add(key);
      for (const ref of this.references(p)) if (typeof ref !== 'string') visit(ref.dataset, depth + 1);
      active.delete(key); done.add(key);
    };
    visit(id, 0);
  }
  private async resolve(identity: Identity, pipeline: PrepPipeline, id: string) {
    this.graph(identity, id, pipeline);
    const datasets = this.datasets(identity), tables: PrepMemoryTable[] = [], cachedInputs: CachedInput[] = [], visited = new Set<string>();
    const visit = (ref: PrepInput) => {
      if (typeof ref === 'string' || visited.has(ref.dataset)) return;
      visited.add(ref.dataset);
      const d = datasets.find(d => d.id === ref.dataset);
      if (!d) prepFail('PREP_SOURCE_NOT_FOUND', '$.input', 'Prepared dataset is unavailable');
      const key = this.key(identity, d.id);
      if (this.blaze.status(key).mode === 'BLAZE') {
        const { table, refreshedAt } = this.blaze.read(key);
        const source: PrepSource = { id: `blaze_${randomUUID().replaceAll('-', '')}`, table: `blaze_${randomUUID().replaceAll('-', '')}`, connectorId: 'file', columns: table.columns, security: 'unrestricted' };
        d.materialized = source; tables.push({ source, rowCount: table.rowCount, value: table.value });
        cachedInputs.push({ datasetId: d.id, refreshedAt }, ...table.cachedInputs);
      } else for (const r of this.references(d.pipeline)) visit(r);
    };
    for (const ref of this.references(pipeline)) visit(ref);
    return { ...await this.context(identity, pipeline.input, datasets), datasets, tables, cachedInputs: cachedInputs.filter((v, i, a) => a.findIndex(x => x.datasetId === v.datasetId && x.refreshedAt === v.refreshedAt) === i) };
  }
  private async materialize(identity: Identity, id: string, table: BlazeTable): Promise<void> {
    const pipeline = this.find(identity, id).resource.opensightPrep!;
    const context = await this.resolve(identity, pipeline, id);
    const options = { datasets: context.datasets, datasetId: id };
    const limits = this.blaze.limits;
    if (context.binding) await streamPrepPostgres(pipeline, context.sources, context.binding.config, options, limits, table);
    else await this.connectors.streamPrep(identity, pipeline, options, limits, table, context.tables);
    table.cachedInputs = context.cachedInputs;
  }
  async tick(authorize: (identity: Identity) => void): Promise<void> {
    await this.blaze.tick(async key => {
      const entry = this.store.read().datasets.find(e => this.key(e, e.resource.dataSetId) === key);
      if (!entry) return;
      await this.blaze.refresh(key, async table => { authorize(entry); await this.materialize(entry, entry.resource.dataSetId, table); });
    });
  }
  private async executionRoute(request: IncomingMessage, response: ServerResponse, id: string, action: string, identity: Identity): Promise<void> {
    const existing = this.find(identity, id), key = this.key(identity, id);
    if (action === 'execution') {
      method(request, response, ['GET', 'PUT']);
      if (request.method === 'PUT') {
        const settings = executionSettings(await readBody(request));
        await this.store.change(draft => {
          const e = draft.datasets.find(e => this.owned(identity, e) && e.resource.dataSetId === id);
          if (!e) prepFail('PREP_NOT_FOUND', '$.dataset', 'Prepared dataset not found');
          e.execution = settings;
        });
        const previous = this.blaze.status(key).mode;
        this.blaze.configure(key, settings);
        if (previous !== settings.mode) this.invalidate(identity, id);
      }
      send(response, 200, this.blaze.status(key)); return;
    }
    if (action === 'refresh') {
      method(request, response, ['POST']); prepObject(await readBody(request), [], '$');
      await this.blaze.refresh(key, table => this.materialize(identity, id, table));
      send(response, 200, this.blaze.status(key)); return;
    }
    method(request, response, action === 'query' ? ['POST'] : ['GET']);
    const body = action === 'query' ? await readQuery(request) : undefined;
    const use = (table: BlazeTable, refreshedAt: string | null) => ({
      ...(body ? queryPrepared(table.columns, table.rowCount, table.value, body) : { columns: table.columns, rows: table.rows(100), rowCount: table.rowCount, truncated: table.rowCount > 100 }),
      execution: { mode: refreshedAt ? 'BLAZE' : 'DIRECT_QUERY', cached: !!refreshedAt, refreshedAt, cachedInputs: table.cachedInputs },
    });
    if (this.blaze.status(key).mode === 'BLAZE') {
      const { table, refreshedAt } = this.blaze.read(key); send(response, 200, use(table, refreshedAt));
    } else send(response, 200, await this.blaze.transient(table => this.materialize(identity, existing.resource.dataSetId, table), table => use(table, null)));
  }

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
    const routes = new PrepRoutes(await AutomationStore.load<State>({ version: 1, datasets: [] }, path, state), connectors, structuredClone(bindings), !!path);
    for (const entry of routes.store.read().datasets) routes.blaze.configure(routes.key(entry, entry.resource.dataSetId), entry.execution ?? directSettings);
    return routes;
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
      input = dataset.materialized?.id ?? dataset.pipeline.input;
    }
    const all = [...await this.sources(identity), ...datasets.flatMap(d => d.materialized ? [d.materialized] : [])], source = all.find(s => s.id === input);
    if (!source) prepFail('PREP_SOURCE_NOT_FOUND', '$.input', 'Connected source is unavailable');
    const binding = this.bindings.find(b => this.owned(identity, b) && b.source.id === input);
    const sources = binding ? this.bindings.filter(b => this.owned(identity, b) && b.config.connectionEnv === binding.config.connectionEnv).map(b => b.source) : all.filter(s => s.connectorId === 'file');
    return { sources, binding, dialect: binding ? 'postgres' as const : 'duckdb' as const };
  }
  async route(request: IncomingMessage, response: ServerResponse, path: string, query: string, identity: Identity): Promise<void> {
    try {
      if (query) throw new RequestError(400, 'Query parameters are not supported');
      const execution = /^\/api\/datasets\/([A-Za-z0-9_-]{1,128})\/(execution|refresh|rows|query)$/.exec(path);
      if (execution) { await this.executionRoute(request, response, execution[1]!, execution[2]!, identity); return; }
      if (path === '/api/prep-sources') {
        method(request, response, ['GET']);
        const owned = this.store.read().datasets.filter(e => this.owned(identity, e)), datasets = this.datasets(identity);
        const raw = (await this.sources(identity)).map(s => ({ id: s.id, connectorId: s.connectorId, columns: s.columns, available: s.security === 'unrestricted' }));
        const prepared = await Promise.all(owned.map(async ({ resource: r }) => {
          const execution = this.blaze.status(this.key(identity, r.dataSetId));
          const summary = { id: r.dataSetId, ref: { dataset: r.dataSetId }, name: r.name, execution };
          try {
            if (execution.mode === 'BLAZE') {
              const { table } = this.blaze.read(this.key(identity, r.dataSetId));
              return { ...summary, connectorId: 'file', columns: table.columns, available: true };
            }
            const context = await this.resolve(identity, r.opensightPrep!, r.dataSetId);
            const plan = compilePrep(r.opensightPrep, context.sources, { dialect: context.dialect, datasets: context.datasets, datasetId: r.dataSetId });
            return { ...summary, connectorId: context.binding ? 'postgresql' : 'file', columns: plan.columns, available: true };
          } catch (e) {
            if (!(e instanceof PrepError || e instanceof QueryEngineError || e instanceof BlazeError)) throw e;
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
      if (id === 'sales') prepFail('INVALID_PREP_PIPELINE', '$.dataset', 'The fixture dataset ID sales is reserved');
      method(request, response, preview ? ['POST'] : ['GET', 'PUT', 'DELETE']);
      const existing = this.store.read().datasets.find(e => this.owned(identity, e) && e.resource.dataSetId === id);
      if (preview || request.method === 'PUT') {
        const body = prepObject(await readBody(request), preview ? ['pipeline', 'through', 'limit'] : ['name', 'pipeline'], '$');
        if (preview && !Object.hasOwn(body, 'pipeline') && !existing) prepFail('PREP_NOT_FOUND', '$.dataset', 'Prepared dataset not found');
        const pipeline = validatePrepPipeline(Object.hasOwn(body, 'pipeline') ? body.pipeline : preview ? existing?.resource.opensightPrep : undefined);
        const context = await this.resolve(identity, pipeline, id);
        const options: PrepPreviewOptions = { datasets: context.datasets, datasetId: id };
        if (body.through !== undefined) { if (body.through !== null) prepName(body.through, '$.through'); options.through = body.through as string | null; }
        if (body.limit !== undefined) { if (typeof body.limit !== 'number') prepFail('PREP_LIMIT_EXCEEDED', '$.limit', 'Expected numeric limit'); options.limit = body.limit; }
        compilePrep(pipeline, context.sources, { dialect: context.dialect, ...options });
        if (preview) {
          const result = context.binding ? await previewPrepPostgres(pipeline, context.sources, context.binding.config, options) : await this.connectors.previewPrep(identity, pipeline, options, context.tables);
          send(response, 200, { ...result, cachedInputs: context.cachedInputs }); return;
        }
        const name = prepName(body.name, '$.name');
        const resource: BundleDataSet = { resourceType: 'dataset', dataSetId: id, name, physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: pipeline };
        const created = await this.store.change(draft => {
          // Serialize dependency validation with metadata writes: two concurrent replacements
          // must not create a cycle using each other's old definitions.
          this.graph(identity, id, pipeline, draft);
          const current = this.datasets(identity, draft).map(d => ({ ...d, materialized: context.datasets.find(c => c.id === d.id)?.materialized }));
          compilePrep(pipeline, context.sources, { dialect: context.dialect, datasets: current, datasetId: id });
          const index = draft.datasets.findIndex(e => this.owned(identity, e) && e.resource.dataSetId === id);
          if (index < 0) {
            if (draft.datasets.length >= 1000 || draft.datasets.filter(e => this.owned(identity, e)).length >= 100) prepFail('PREP_LIMIT_EXCEEDED', '$.datasets', 'Prepared dataset limit reached');
            draft.datasets.push({ ...identity, resource });
          } else draft.datasets[index] = { ...draft.datasets[index]!, resource };
          return index < 0;
        });
        if (created) this.blaze.configure(this.key(identity, id), directSettings);
        this.invalidate(identity, id);
        send(response, created ? 201 : 200, { resource, persistence: this.persistent ? 'file' : 'ephemeral' }); return;
      }
      if (!existing) prepFail('PREP_NOT_FOUND', '$.dataset', 'Prepared dataset not found');
      if (request.method === 'GET') { send(response, 200, { resource: existing.resource, persistence: this.persistent ? 'file' : 'ephemeral' }); return; }
      this.invalidate(identity, id); this.blaze.remove(this.key(identity, id));
      await this.store.change(draft => { draft.datasets = draft.datasets.filter(e => !(this.owned(identity, e) && e.resource.dataSetId === id)); });
      send(response, 200, { deleted: true });
    } catch (e) {
      if (e instanceof SecurityError) { request.resume(); send(response, e.status, { errorCode: e.code, Message: e.message }); return; }
      if (e instanceof BlazeError) {
        request.resume(); send(response, e.code === 'PREP_NOT_FOUND' ? 404 : e.code === 'BLAZE_CONFIG_INVALID' ? 400 : e.code === 'BLAZE_DATASET_TOO_LARGE' ? 413 : 409, { errorCode: e.code, Message: e.message, ...(e.causeCode ? { causeCode: e.causeCode } : {}) }); return;
      }
      if (e instanceof PrepError || e instanceof QueryEngineError) {
        request.resume(); send(response, e.code === 'PREP_NOT_FOUND' || e.code === 'PREP_SOURCE_NOT_FOUND' ? 404 : e.code === 'PREP_SECURITY_REJECTED' ? 403 : e.code === 'PREP_EXECUTION_FAILED' ? 422 : 400, { errorCode: e.code, Message: e.message, path: e.path }); return;
      }
      throw e;
    }
  }
}
