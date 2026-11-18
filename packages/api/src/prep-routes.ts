import { compilePrepJoinSample, diagnosePrepJoinPostgres, PrepJoinBudget, PREP_JOIN_SAMPLE_LIMIT } from '@opensight/query-engine';
import { tableDownload, tableDownloadFormat, sendTableDownload } from './table-download.js';
import type { HostedUsage } from './hosted-usage.js';
import { StoredTableFiles, storedMaterialization, storedFailure, storedStatus, storedCapacity, checkStoredQuota, type StoredMaterialization } from './stored-tables.js';
import { metricQuery, metricDefinition, type MetricLookup } from './metric-consumption.js';
import { disabledAnalytics } from './analytics.js';
import { MetadataError } from './metadata-db.js';
import { randomUUID } from 'node:crypto';
import { materializationReason } from './blaze-policy.js';
import { BlazeStore, BlazeError, directSettings, executionSettings, BlazeTable, type ExecutionSettings, type CachedInput } from './blaze.js';
import { streamPrepPostgres, queryPrepared, planPreparedVisual, queryPreparedVisual, type PrepMemoryTable } from '@opensight/query-engine';
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
export interface StoredPrep { namespaceId: string; userId: string; resource: BundleDataSet; execution?: ExecutionSettings; materialization?: StoredMaterialization; version?: number; updatedAt?: string }
type Stored = StoredPrep;
export interface PrepState { version: 1; datasets: Stored[] }
type State = PrepState;
export function validatePrepState(raw: unknown): State {
  const s = prepObject(raw, ['version', 'datasets'], '$');
  if (s.version !== 1 || !Array.isArray(s.datasets) || s.datasets.length > 1000) prepFail('INVALID_PREP_PIPELINE', '$', 'Invalid prep store');
  const seen = new Set<string>();
  for (const entry of s.datasets) {
    const v = prepObject(entry, ['namespaceId', 'userId', 'resource', 'execution', 'materialization', 'version', 'updatedAt'], '$.datasets');
    prepName(v.namespaceId, '$.namespaceId'); prepName(v.userId, '$.userId');
    if (v.execution !== undefined) executionSettings(v.execution);
    if (v.materialization !== undefined) storedMaterialization(v.materialization);
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
  analytics = disabledAnalytics;
  downloadsEnabled = true;
  downloadUsage?: HostedUsage;
  /** Same entitlement snapshot supplied to the local composition; absent means unlimited. */
  storageLimit: (identity: Identity) => number = () => Number.MAX_SAFE_INTEGER;
  private async refreshStored(identity: Identity, id: string): Promise<void> {
    try { await this.publishStored(identity, id); }
    catch (error) {
      // Preserve the named pipeline error, and the last good generation.
      await this.store.change(draft => {
        const entry = draft.datasets.find(e => this.owned(identity, e) && e.resource.dataSetId === id);
        if (entry?.materialization && !(error instanceof BlazeError && error.code === 'STORED_REFRESH_IN_PROGRESS')) entry.materialization = storedFailure(entry.materialization, error);
      });
      throw error;
    }
    await this.invalidate(identity, id, false);
  }
  private async publishStored(identity: Identity, id: string): Promise<void> {
    await this.files.exclusive(identity.namespaceId, async () => {
      const entry = this.find(identity, id), capacity = storedCapacity(this.blaze.limits);
      const used = this.store.read().datasets.filter(e => e.namespaceId === identity.namespaceId)
        .reduce((n, e) => n + (this.key(e, e.resource.dataSetId) === this.key(identity, id) ? 0 : e.materialization?.bytes ?? 0), 0);
      checkStoredQuota(this.storageLimit(identity), used, capacity);
      const table = new BlazeTable(this.blaze.limits);
      await this.materialize(identity, id, table);
      const value = await this.files.write(this.key(identity, id), table, String(entry.version ?? 1), capacity);
      try {
        await this.store.change(draft => {
          const current = draft.datasets.find(e => this.owned(identity, e) && e.resource.dataSetId === id);
          if (!current || (current.version ?? 1) !== (entry.version ?? 1) || current.execution?.mode !== 'STORED') throw new BlazeError('STORED_DEFINITION_CHANGED', 'Dataset changed during publish; retry with the saved definition');
          current.materialization = value;
        });
      } catch (error) { await this.files.remove(this.key(identity, id), value); throw error; }
      await this.files.remove(this.key(identity, id), entry.materialization);
    });
  }
  metricLookup?: (identity: Identity) => MetricLookup;
  checkMetricDelete?: (identity: Identity, id: string) => Promise<void>;
  /** Issue #161: governed input tables exposed as prep sources (reference form `input-table-<id>`). */
  inputTableSources?: (identity: Identity) => PrepSource[];
  inputTableTables?: (identity: Identity) => PrepMemoryTable[];
  /** Optional bounded contract; old full-table hooks remain preview-only. Return only
   * requested sources, with at most limit rows, including the truncation probe. */
  inputTableSamples?: (identity: Identity, sourceIds: readonly string[], limit: number) => PrepMemoryTable[];
  private readonly blaze = new BlazeStore();
  private readonly configured = new Map<string, string>();
  private requirement(identity: Identity, id: string, state = this.store.read()): string | null {
    return materializationReason(id, state.datasets.filter(e => this.owned(identity, e)).map(e => ({ id: e.resource.dataSetId, pipeline: e.resource.opensightPrep!, mode: e.execution?.mode ?? 'DIRECT_QUERY' })));
  }
  private enforceModes(state: State): void {
    for (const entry of state.datasets) if ((!entry.execution || entry.execution.mode === 'DIRECT_QUERY') && this.requirement(entry, entry.resource.dataSetId, state)) entry.execution = { mode: 'BLAZE', intervalMinutes: null };
  }
  private syncModes(): void {
    for (const entry of this.store.read().datasets) {
      const key = this.key(entry, entry.resource.dataSetId), settings = entry.execution ?? directSettings, value = JSON.stringify(settings);
      if (this.configured.get(key) !== value) { this.blaze.configure(key, settings); this.configured.set(key, value); }
    }
  }
  private status(identity: Identity, id: string) {
    return { ...(this.find(identity, id).execution?.mode === 'STORED' ? storedStatus(this.find(identity, id).materialization) : this.blaze.status(this.key(identity, id))), downloadsEnabled: this.downloadsEnabled, materializationReason: this.requirement(identity, id) };
  }
  private requireDirect(identity: Identity, id: string, state = this.store.read()): void {
    const reason = this.requirement(identity, id, state);
    if (reason) throw new BlazeError('BLAZE_MATERIALIZATION_REQUIRED', reason);
  }
  private key(identity: Identity, id: string): string { return JSON.stringify([identity.namespaceId, identity.userId, id]); }
  private find(identity: Identity, id: string): Stored {
    return this.store.read().datasets.find(e => this.owned(identity, e) && e.resource.dataSetId === id) ?? prepFail('PREP_NOT_FOUND', '$.dataset', 'Prepared dataset not found');
  }
  async invalidate(identity: Identity, changed: string, includeSelf = true): Promise<void> {
    const datasets = this.datasets(identity), affected = new Set([changed]);
    let added = true;
    while (added) { added = false; for (const d of datasets) if (!affected.has(d.id) && this.references(d.pipeline).some(ref => affected.has(typeof ref === 'string' ? ref : ref.dataset))) { affected.add(d.id); added = true; } }
    if (!includeSelf) affected.delete(changed);
    for (const id of affected) this.blaze.invalidate(this.key(identity, id));
    await this.store.change(draft => {
      for (const entry of draft.datasets) if (this.owned(identity, entry) && affected.has(entry.resource.dataSetId) && entry.materialization) entry.materialization.state = 'stale';
    });
  }
  async invalidateInputTable(namespaceId: string, tableId: string): Promise<void> {
    const owners = new Set(this.store.read().datasets.filter(e => e.namespaceId === namespaceId).map(e => e.userId));
    for (const userId of owners) await this.invalidate({ namespaceId, userId }, `input-table-${tableId}`);
  }
  private references(pipeline: PrepPipeline): PrepInput[] {
    return [pipeline.input, ...pipeline.steps.flatMap(s => s.kind === 'append' ? [s.config.source] : s.kind === 'join' && !(typeof s.config.source !== 'string' && 'step' in s.config.source) ? [s.config.source as PrepInput] : [])];
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
  private async resolve(identity: Identity, pipeline: PrepPipeline, id: string, budget?: PrepJoinBudget) {
    this.graph(identity, id, pipeline);
    const datasets = this.datasets(identity), tables: PrepMemoryTable[] = [], cachedInputs = new Map<string, CachedInput>(), visited = new Set<string>();
    const visit = async (ref: PrepInput): Promise<void> => {
      if (typeof ref === 'string' || visited.has(ref.dataset)) return;
      visited.add(ref.dataset);
      const d = datasets.find(d => d.id === ref.dataset);
      if (!d) prepFail('PREP_SOURCE_NOT_FOUND', '$.input', 'Prepared dataset is unavailable');
      const key = this.key(identity, d.id);
      const stored = this.find(identity, d.id);
      if (stored.execution?.mode === 'STORED' || this.blaze.status(key).mode === 'BLAZE') {
        const { table, refreshedAt } = stored.execution?.mode === 'STORED'
          ? { table: budget ? await this.files.boundedSample(key, async () => this.find(identity, d.id).materialization, this.blaze.limits, () => budget.check()) : await this.files.read(key, stored.materialization, this.blaze.limits), refreshedAt: stored.materialization!.lastRefreshedAt }
          : budget ? this.blaze.boundedSample(key, () => budget.check()) : this.blaze.read(key);
        const source: PrepSource = { id: `blaze_${randomUUID().replaceAll('-', '')}`, table: `blaze_${randomUUID().replaceAll('-', '')}`, connectorId: 'file', columns: table.columns, security: 'unrestricted' };
        d.materialized = source; tables.push({ source, rowCount: table.rowCount, value: table.value });
        const add = (input: CachedInput) => {
          const key = JSON.stringify([input.datasetId, input.refreshedAt]);
          if (!cachedInputs.has(key) && cachedInputs.size >= 1000) throw new BlazeError('BLAZE_DATASET_TOO_LARGE', 'Cached input provenance exceeds 1000 snapshots');
          cachedInputs.set(key, input);
        };
        add({ datasetId: d.id, refreshedAt }); for (const input of table.cachedInputs) add(input);
      } else for (const r of this.references(d.pipeline)) await visit(r);
    };
    for (const ref of this.references(pipeline)) await visit(ref);
    // Issue #161: input tables referenced by source id (pipeline input or a join source)
    // ride the in-memory table path. Only same-namespace tables are returned by the hook,
    // so a foreign reference stays unresolved and context() fails closed below.
    const referenced = new Set(this.references(pipeline).filter((r): r is string => typeof r === 'string'));
    for (const dataset of datasets.filter(d => visited.has(d.id) && !d.materialized)) for (const ref of this.references(dataset.pipeline)) if (typeof ref === 'string') referenced.add(ref);
    for (const table of (budget ? [] : this.inputTableTables?.(identity)) ?? []) if (referenced.has(table.source.id) && !tables.some(t => t.source.id === table.source.id)) tables.push(table);
    return { ...await this.context(identity, pipeline.input, datasets), datasets, tables, cachedInputs: [...cachedInputs.values()] };
  }
  private async materialize(identity: Identity, id: string, table: BlazeTable): Promise<void> {
    const pipeline = this.find(identity, id).resource.opensightPrep!;
    const context = await this.resolve(identity, pipeline, id);
    const options = { datasets: context.datasets, datasetId: id };
    const limits = this.blaze.limits;
    if (context.binding) await streamPrepPostgres(pipeline, context.sources, context.binding.config, options, limits, table);
    else await this.connectors.streamPrep(identity, pipeline, options, limits, table, context.tables);
    table.setCachedInputs(context.cachedInputs);
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
    if (action === 'download') {
      method(request, response, ['POST']);
      const body = prepObject(await readBody(request), ['format'], '$'), format = tableDownloadFormat(body.format);
      if (!this.downloadsEnabled) throw new MetadataError('DOWNLOADS_DISABLED', 403);
      if (existing.execution?.mode !== 'STORED') throw new MetadataError('STORED_MODE_REQUIRED', 409);
      const table = await this.files.read(key, existing.materialization, this.blaze.limits);
      await sendTableDownload(response, tableDownload(id, table, format), this.downloadUsage ? { usage: this.downloadUsage, scope: { tenantId: identity.namespaceId, namespaceId: identity.namespaceId } } : undefined); return;
    }
    if (action === 'execution') {
      method(request, response, ['GET', 'PUT']);
      if (request.method === 'PUT') {
        const settings = executionSettings(await readBody(request));
        await this.store.change(draft => {
          const e = draft.datasets.find(e => this.owned(identity, e) && e.resource.dataSetId === id);
          if (!e) prepFail('PREP_NOT_FOUND', '$.dataset', 'Prepared dataset not found');
          if (settings.mode === 'DIRECT_QUERY') this.requireDirect(identity, id, draft);
          e.execution = settings; e.version = (e.version ?? 1) + 1; e.updatedAt = new Date().toISOString();
          this.enforceModes(draft);
        });
        const previous = this.blaze.status(key).mode;
        this.syncModes();
        if (previous !== settings.mode) await this.invalidate(identity, id);
      }
      send(response, 200, this.status(identity, id)); return;
    }
    if (action === 'refresh' || action === 'publish') {
      method(request, response, ['POST']); prepObject(await readBody(request), [], '$');
      if (existing.execution?.mode === 'STORED') await this.refreshStored(identity, id);
      else if (action === 'publish') throw new BlazeError('STORED_MODE_REQUIRED', 'Select stored mode before publishing');
      else await this.blaze.refresh(key, table => this.materialize(identity, id, table));
      send(response, 200, this.status(identity, id)); return;
    }
    method(request, response, action === 'query' ? ['POST'] : ['GET']);
    let metrics: readonly import('@opensight/query-engine').PublishedMetric[] | undefined;
    let body = action === 'query' ? await readQuery(request) : undefined;
    if (body && this.metricLookup) body = await metricQuery(body, { kind: 'prepared-dataset', id, ownerId: identity.userId }, this.metricLookup(identity), value => { metrics = value; });
    const use = (table: BlazeTable, refreshedAt: string | null) => ({
      ...(body ? queryPrepared(table.columns, table.rowCount, table.value, body) : { columns: table.columns, rows: table.rows(100), rowCount: table.rowCount, truncated: table.rowCount > 100 }),
      ...(metrics ? { metrics } : {}),
      execution: { mode: refreshedAt ? existing.execution?.mode ?? 'BLAZE' : 'DIRECT_QUERY', cached: !!refreshedAt, refreshedAt, cachedInputs: table.cachedInputs },
    });
    if (existing.execution?.mode === 'STORED') {
      const table = await this.files.read(key, existing.materialization, this.blaze.limits); send(response, 200, use(table, existing.materialization!.lastRefreshedAt));
    } else if (this.blaze.status(key).mode === 'BLAZE') {
      const { table, refreshedAt } = this.blaze.read(key); send(response, 200, use(table, refreshedAt));
    } else {
      this.requireDirect(identity, id);
      send(response, 200, await this.blaze.transient(table => this.materialize(identity, existing.resource.dataSetId, table), table => use(table, null)));
    }
  }

  async dashboardVisual(identity: Identity, id: string, definition: unknown, visualId: string, dataSetArn: string) {
    await this.analysisSchema(identity, id);
    let metrics: readonly import('@opensight/query-engine').PublishedMetric[] | undefined;
    if (this.metricLookup) {
      const wire = definition as Record<string, unknown>;
      definition = await metricDefinition(wire, Object.fromEntries(((wire.DataSetIdentifierDeclarations ?? []) as { Identifier: string }[]).map(d => [d.Identifier, { kind: 'prepared-dataset', id, ownerId: identity.userId }])), this.metricLookup(identity), value => { metrics = value; });
    }
    const analysis = { ResourceType: 'Analysis', AnalysisId: 'published', Name: 'Published dashboard', Definition: definition };
    const run = (table: BlazeTable) => {
      const plan = planPreparedVisual(table.columns, analysis, visualId, dataSetArn);
      return { ...(metrics ? { metrics } : {}), ...queryPreparedVisual(table.columns, table.rowCount, table.value, analysis, visualId, dataSetArn), bindings: Object.fromEntries([...plan.dimensions, ...plan.measures].map(f => [f.fieldId, f.outputName])) };
    };
    const entry = this.find(identity, id);
    if (entry.execution?.mode === 'STORED') return run(await this.files.read(this.key(identity, id), entry.materialization, this.blaze.limits));
    if (this.blaze.status(this.key(identity, id)).mode === 'BLAZE') return run(this.blaze.read(this.key(identity, id)).table);
    this.requireDirect(identity, id);
    return this.blaze.transient(table => this.materialize(identity, id, table), run);
  }

  private constructor(private readonly store: AutomationStore<State>, private readonly connectors: ConnectorRoutes, private readonly bindings: readonly PrepPostgresBinding[], private readonly persistent: boolean, private readonly files: StoredTableFiles) {}
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
    const routes = new PrepRoutes(await AutomationStore.load<State>({ version: 1, datasets: [] }, path, validatePrepState), connectors, structuredClone(bindings), !!path, new StoredTableFiles(path ? `${path}.tables` : undefined));
    const current = routes.store.read();
    if (current.datasets.some(e => (!e.execution || e.execution.mode === 'DIRECT_QUERY') && routes.requirement(e, e.resource.dataSetId, current))) await routes.store.change(draft => routes.enforceModes(draft));
    routes.syncModes();
    return routes;
  }
  assetResources(identity: Identity, workspace = false): import('./metadata-resources.js').MetadataResource[] {
    return this.store.read().datasets.filter(e => e.namespaceId === identity.namespaceId && (workspace || this.owned(identity, e))).map(e => ({ kind: 'prepared-dataset', id: e.resource.dataSetId, ownerId: e.userId, version: e.version ?? 1, body: { resource: e.resource, ...(e.updatedAt ? { updatedAt: e.updatedAt } : {}), ...(e.execution ? { execution: e.execution } : {}) } }));
  }
  async deleteAsset(identity: Identity, id: string, version: number, check: () => void): Promise<void> {
    if (!this.persistent) throw new MetadataError('ASSET_DURABLE_STORE_REQUIRED', 503);
    const materialization = this.find(identity, id).materialization;
    await this.store.change(state => {
      check();
      const entry = state.datasets.find(e => this.owned(identity, e) && e.resource.dataSetId === id);
      if (!entry) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
      if ((entry.version ?? 1) !== version) throw new MetadataError('ASSET_PRECONDITION_FAILED', 412);
      if (this.datasets(identity, state).some(d => this.references(d.pipeline).some(ref => typeof ref !== 'string' && ref.dataset === id))) throw new MetadataError('ASSET_DELETE_REFERENCED', 409);
      state.datasets = state.datasets.filter(e => e !== entry);
    });
    await this.files.remove(this.key(identity, id), materialization);
    this.blaze.remove(this.key(identity, id)); this.configured.delete(this.key(identity, id));
  }
  private owned(identity: Identity, entry: Pick<Stored, 'namespaceId' | 'userId'>): boolean { return identity.namespaceId === entry.namespaceId && identity.userId === entry.userId; }
  private async sources(identity: Identity): Promise<PrepSource[]> {
    return [...await this.connectors.prepSources(identity), ...this.bindings.filter(b => this.owned(identity, b)).map(b => b.source), ...(this.inputTableSources?.(identity) ?? [])];
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
  /** Notebook SQL never reaches connectors directly: only these caller-owned inputs. */
  async notebookSources(identity: Identity): Promise<PrepSource[]> {
    const sources = (await this.sources(identity)).filter(s => s.security === 'unrestricted');
    for (const dataset of this.datasets(identity)) {
      try { sources.push({ id: `prepared-${dataset.id}`, table: `prepared-${dataset.id}`, connectorId: 'file', security: 'unrestricted', columns: await this.analysisSchema(identity, dataset.id) }); }
      catch { /* A protected/unresolved dependency is not an accessible dataset. */ }
    }
    return sources;
  }
  async notebookTable(identity: Identity, ref: string): Promise<PrepMemoryTable> {
    const source = (await this.notebookSources(identity)).find(s => s.id === ref);
    if (!source) throw new SecurityError(403, 'NOTEBOOK_DATASET_ACCESS_DENIED', 'Dataset is unavailable to the executing identity.');
    const use = (table: BlazeTable): PrepMemoryTable => {
      const rows = table.rows();
      return { source: { ...source, table: ref, columns: table.columns }, rowCount: rows.length, value: (r, c) => rows[r]![table.columns[c]!.name]! };
    };
    if (ref.startsWith('prepared-') && this.datasets(identity).some(d => `prepared-${d.id}` === ref)) {
      const id = ref.slice('prepared-'.length);
      const entry = this.find(identity, id);
      if (entry.execution?.mode === 'STORED') return use(await this.files.read(this.key(identity, id), entry.materialization, this.blaze.limits));
      if (this.blaze.status(this.key(identity, id)).mode === 'BLAZE') return use(this.blaze.read(this.key(identity, id)).table);
      this.requireDirect(identity, id);
      return this.blaze.transient(table => this.materialize(identity, id, table), use);
    }
    const pipeline: PrepPipeline = { version: 1, input: ref, steps: [] };
    const context = await this.context(identity, ref, this.datasets(identity));
    return this.blaze.transient(async table => {
      if (context.binding) await streamPrepPostgres(pipeline, context.sources, context.binding.config, {}, this.blaze.limits, table);
      else await this.connectors.streamPrep(identity, pipeline, {}, this.blaze.limits, table, (this.inputTableTables?.(identity) ?? []).filter(t => t.source.id === ref));
    }, use);
  }
  /** Schema-only admission under the existing owner-private prep resolver. */
  async analysisSchema(identity: Identity, id: string) {
    const entry = this.find(identity, id);
    if (entry.execution?.mode === 'STORED') {
      if (!entry.materialization) throw new BlazeError('STORED_NOT_PUBLISHED', 'Publish this dataset before reading its stored schema');
      return entry.materialization.columns;
    }
    const context = await this.resolve(identity, entry.resource.opensightPrep!, id);
    return compilePrep(entry.resource.opensightPrep!, context.sources, { datasets: context.datasets, datasetId: id, dialect: context.dialect }).columns;
  }
  /** Create only: template application cannot overwrite an existing recipe. */
  async createFromTemplate(identity: Identity, id: string, name: string, raw: PrepPipeline, recheck: () => Promise<void>) {
    const pipeline = validatePrepPipeline(raw), datasets = this.datasets(identity);
    const context = await this.context(identity, pipeline.input, datasets);
    const resource: BundleDataSet = { resourceType: 'dataset', dataSetId: id, name: prepName(name, '$.name'), physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: pipeline };
    await recheck();
    await this.store.change(draft => {
      if (draft.datasets.some(e => this.owned(identity, e) && e.resource.dataSetId === id)) throw new MetadataError('TEMPLATE_DATASET_CONFLICT', 409);
      if (draft.datasets.length >= 1000 || draft.datasets.filter(e => this.owned(identity, e)).length >= 100) prepFail('PREP_LIMIT_EXCEEDED', '$.datasets', 'Prepared dataset limit reached');
      this.graph(identity, id, pipeline, draft);
      compilePrep(pipeline, context.sources, { dialect: context.dialect, datasets: this.datasets(identity, draft), datasetId: id });
      draft.datasets.push({ ...identity, resource, version: 1, updatedAt: new Date().toISOString() }); this.enforceModes(draft);
    });
    this.syncModes(); return { resource, version: 1, persistence: this.persistent ? 'file' : 'ephemeral' };
  }
  async route(request: IncomingMessage, response: ServerResponse, path: string, query: string, identity: Identity): Promise<void> {
    try {
      if (query) throw new RequestError(400, 'Query parameters are not supported');
      const execution = /^\/api\/datasets\/([A-Za-z0-9_-]{1,128})\/(execution|refresh|publish|rows|query|download)$/.exec(path);
      if (execution) { await this.executionRoute(request, response, execution[1]!, execution[2]!, identity); return; }
      if (path === '/api/prep-sources') {
        method(request, response, ['GET']);
        const owned = this.store.read().datasets.filter(e => this.owned(identity, e)), datasets = this.datasets(identity);
        const raw = (await this.sources(identity)).map(s => ({ id: s.id, connectorId: s.connectorId, columns: s.columns, available: s.security === 'unrestricted' }));
        const prepared = await Promise.all(owned.map(async ({ resource: r }) => {
          const execution = this.status(identity, r.dataSetId);
          const summary = { id: r.dataSetId, ref: { dataset: r.dataSetId }, name: r.name, execution };
          try {
            if (execution.mode === 'STORED') return { ...summary, connectorId: 'file', columns: this.find(identity, r.dataSetId).materialization?.columns ?? [], available: execution.rowCount !== null };
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
      const diagnostics = /^\/api\/datasets\/([A-Za-z0-9_-]{1,128})\/prep\/join-diagnostics$/.exec(path);
      if (diagnostics) {
        method(request, response, ['POST']);
        const id = diagnostics[1]!, body = prepObject(await readBody(request), ['pipeline', 'through'], '$');
        const pipeline = validatePrepPipeline(Object.hasOwn(body, 'pipeline') ? body.pipeline : this.find(identity, id).resource.opensightPrep);
        const step = prepName(body.through, '$.through');
        const budget = new PrepJoinBudget();
        const context = await this.resolve(identity, pipeline, id, budget), options = { datasets: context.datasets, datasetId: id };
        const plan = compilePrepJoinSample(pipeline, context.sources, step, { ...options, dialect: context.dialect });
        const tables = context.tables.filter(t => plan.sampleSources.some(s => s.id === t.source.id));
        const governed = plan.sampleSources.filter(s => s.id.startsWith('input-table-'));
        if (governed.length) {
          if (!this.inputTableSamples) prepFail('UNSUPPORTED_PREP_STEP', '$.joinDiagnostics', 'Governed input-table hook has no bounded sample contract');
          budget.check(); const samples = this.inputTableSamples(identity, governed.map(s => s.id), PREP_JOIN_SAMPLE_LIMIT + 1); budget.check();
          if (samples.length !== governed.length || governed.some(s => samples.filter(t => t.source.id === s.id).length !== 1)) prepFail('PREP_SOURCE_NOT_FOUND', '$.joinDiagnostics', 'Bounded input-table sample is missing or ambiguous');
          for (const table of samples) {
            const source = governed.find(s => s.id === table.source.id)!;
            if (source.table !== table.source.table || source.schema !== table.source.schema || source.connectorId !== table.source.connectorId || source.security !== table.source.security
              || source.columns.length !== table.source.columns.length || source.columns.some((c, i) => c.name !== table.source.columns[i]?.name || c.type !== table.source.columns[i]?.type)) prepFail('PREP_SCHEMA_MISMATCH', '$.joinDiagnostics', 'Bounded input-table schema changed');
            tables.push(table);
          }
        }
        if (tables.some(t => !Number.isSafeInteger(t.rowCount) || t.rowCount < 0 || t.rowCount > PREP_JOIN_SAMPLE_LIMIT + 1)) prepFail('PREP_EXECUTION_FAILED', '$.joinDiagnostics', 'Reader exceeded the bounded sample contract');
        budget.check();
        const result = context.binding ? await diagnosePrepJoinPostgres(pipeline, context.sources, context.binding.config, step, options, budget)
          : await this.connectors.joinDiagnostics(identity, pipeline, step, options, tables, budget);
        budget.check();
        send(response, 200, result); return;
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
            draft.datasets.push({ ...identity, resource, version: 1, updatedAt: new Date().toISOString() });
          } else draft.datasets[index] = { ...draft.datasets[index]!, resource, version: (draft.datasets[index]!.version ?? 1) + 1, updatedAt: new Date().toISOString() };
          this.enforceModes(draft);
          return index < 0;
        });
        this.analytics.track({ tenantId: identity.namespaceId, namespaceId: identity.namespaceId }, { name: 'dataset_prep_saved' });
        this.syncModes();
        await this.invalidate(identity, id);
        response.setHeader('ETag', `"${this.find(identity, id).version ?? 1}"`);
        send(response, created ? 201 : 200, { resource, persistence: this.persistent ? 'file' : 'ephemeral' }); return;
      }
      if (!existing) prepFail('PREP_NOT_FOUND', '$.dataset', 'Prepared dataset not found');
      if (request.method === 'GET') { response.setHeader('ETag', `"${existing.version ?? 1}"`); send(response, 200, { resource: existing.resource, persistence: this.persistent ? 'file' : 'ephemeral' }); return; }
      await this.checkMetricDelete?.(identity, id);
      await this.invalidate(identity, id); this.blaze.remove(this.key(identity, id));
      this.configured.delete(this.key(identity, id));
      await this.store.change(draft => { draft.datasets = draft.datasets.filter(e => !(this.owned(identity, e) && e.resource.dataSetId === id)); });
      await this.files.remove(this.key(identity, id), existing.materialization);
      send(response, 200, { deleted: true });
    } catch (e) {
      if (e instanceof QueryEngineError && path.endsWith('/query')) { request.resume(); send(response, 422, { errorCode: e.code, message: e.message, path: e.path }); return; }
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
