import { setImmediate as yieldTurn } from 'node:timers/promises';
import { containedWork, wireTable, type WireTable, type TableResult, type QueryResult } from './contained-work.js';
import { parseBundleResource, type BundleDataSet } from '@opensight/bundle-parser';
import { validatePrepPipeline, type PrepPipeline, type PrepInput } from '@opensight/bundle-parser/prep';
import { compilePrep, planPreparedQuery, planPreparedVisual, type PrepDataset } from '@opensight/query-engine';
import { HostedData, type Admission } from './hosted-data.js';
import { object, identifier } from './metadata-resources.js';
import { type TenantContext, type Revisions } from './metadata.js';
import { MetadataError } from './metadata-db.js';
import { sourceError } from './source-schema.js';
import { BlazeTable, executionSettings, directSettings, type ExecutionSettings } from './blaze.js';
import { materializationReason } from './blaze-policy.js';
import { validateQuery } from './query.js';
import type { JobStore } from './job-store.js';

const references = (p: PrepPipeline): PrepInput[] => [p.input, ...p.steps.flatMap(s => s.kind === 'append' ? [s.config.source] : s.kind === 'join' && !(typeof s.config.source !== 'string' && 'step' in s.config.source) ? [s.config.source as PrepInput] : [])];
interface Graph { pipeline: PrepPipeline; datasets: PrepDataset[]; leaves: Admission[]; revisions: Revisions; reason: string | null; modes: Map<string, { version: number; execution: ExecutionSettings }> }
/** Owner-only durable recipes. The complete graph is checked even when reading a cached output. */
export class HostedPrep {
  constructor(readonly data: HostedData, private readonly jobs?: JobStore) {}
  private key(context: TenantContext, id: string) { return { kind: 'prepared-dataset' as const, id: identifier(id), ownerId: context.userId }; }
  private cacheKey(context: TenantContext, id: string) { return JSON.stringify([context.tenantId, context.namespaceId, context.userId, 'prep', id]); }
  private async stored(context: TenantContext, id: string) {
    const r = await this.data.sources.metadata.get(context, this.key(context, id));
    const resource = parseBundleResource(r.body.resource);
    if (resource.resourceType !== 'dataset' || !resource.opensightPrep) sourceError('INVALID_PREP_PIPELINE');
    return { resource, version: r.version, execution: r.body.execution === undefined ? directSettings : executionSettings(r.body.execution) };
  }
  private async graph(context: TenantContext, id: string, pipeline: PrepPipeline): Promise<Graph> {
    const revisions = await this.data.sources.metadata.revisions(context);
    await this.data.sources.capability(context, 'build');
    const datasets: PrepDataset[] = [], leaves: Admission[] = [], done = new Set<string>(), active = new Set<string>(), modes = new Map<string, { version: number; execution: ExecutionSettings }>();
    let steps = 0;
    const visit = async (key: string, p: PrepPipeline, depth: number) => {
      if (active.has(key)) sourceError('INVALID_PREP_PIPELINE');
      if (depth > 16 || (steps += p.steps.length) > 500) sourceError('PREP_LIMIT_EXCEEDED');
      if (done.has(key)) return;
      active.add(key);
      for (const ref of references(p)) {
        if (typeof ref === 'string') {
          if (!leaves.some(a => a.source.id === ref)) leaves.push(await this.data.admit(context, ref, 'prep'));
        } else {
          if (ref.dataset === id || active.has(ref.dataset)) sourceError('INVALID_PREP_PIPELINE');
          const stored = await this.stored(context, ref.dataset), child = stored.resource.opensightPrep!;
          modes.set(ref.dataset, { version: stored.version, execution: stored.execution });
          if (!datasets.some(d => d.id === ref.dataset)) datasets.push({ id: ref.dataset, pipeline: child });
          await visit(ref.dataset, child, depth + 1);
        }
      }
      active.delete(key); done.add(key);
    };
    await visit(id, pipeline, 0);
    const reason = materializationReason(id, [{ id, pipeline, mode: 'DIRECT_QUERY' }, ...datasets.map(d => ({ ...d, mode: modes.get(d.id)!.execution.mode }))]);
    const graph = { pipeline, datasets, leaves, revisions, reason, modes };
    this.plan(graph, id); // Validate every stage, including branches outside the selected output.
    await this.data.finish(context, leaves, revisions); return graph;
  }
  private sources(g: Graph) { return g.leaves.map((a, i) => ({ ...a.physical, connectorId: 'file', schema: undefined, table: `leaf_${i}` })); }
  private plan(g: Graph, id: string, through?: string | null) {
    return compilePrep(g.pipeline, this.sources(g), { datasets: g.datasets, datasetId: id, ...(through === undefined ? {} : { through }) });
  }
  private async load(context: TenantContext, id: string, g: Graph, output: BlazeTable, through?: string | null) {
    const scope = this.data.scope(context);
    const tables: WireTable[] = [], sources = this.sources(g), datasets = structuredClone(g.datasets), needed = new Set<string>(), visited = new Set<string>();
    const visit = async (p: PrepPipeline): Promise<void> => {
      for (const ref of references(p)) {
        if (typeof ref === 'string') { needed.add(ref); continue; }
        if (visited.has(ref.dataset)) continue;
        visited.add(ref.dataset);
        const d = datasets.find(d => d.id === ref.dataset)!, mode = g.modes.get(ref.dataset)!;
        if (mode.execution.mode === 'BLAZE') {
          const key = this.cacheKey(context, ref.dataset), stamp = JSON.stringify([mode.version, g.revisions]);
          const table = await this.data.cache!.read(scope, key, stamp); scope.rows(table.rowCount);
          d.materialized = { id: `cached_${tables.length}`, table: `cached_${tables.length}`, connectorId: 'file', columns: table.columns, security: 'unrestricted' };
          tables.push(await wireTable(scope, table, d.materialized));
        } else await visit(d.pipeline);
      }
    };
    // Check every cache dependency before opening any leaf. Full graph policy checks already ran.
    await visit(g.pipeline);
    for (const [i, a] of g.leaves.entries()) if (needed.has(a.source.id)) {
      const table = await this.data.table(context, a, a.physical.columns.map(c => c.name));
      tables.push(await wireTable(scope, table, sources[i]!));
    }
    await this.data.finish(context, g.leaves, g.revisions);
    const result = await containedWork<TableResult>(scope, { kind: 'prep', pipeline: g.pipeline, sources, datasets, id, tables, ...(through === undefined ? {} : { through }) }, this.data.limits(context));
    const sink = this.data.sink(context, output); sink.start(result.columns);
    for (const [i, row] of result.rows.entries()) { if (i % 256 === 0) await yieldTurn(); sink.row(row); }
    await this.data.finish(context, g.leaves, g.revisions);
  }
  async save(context: TenantContext, id: string, input: unknown) {
    const raw = object(structuredClone(input), ['name', 'pipeline', 'expectedVersion']);
    if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 512) sourceError('INVALID_PREP_PIPELINE');
    const pipeline = validatePrepPipeline(raw.pipeline), graph = await this.graph(context, id, pipeline);
    const resource: BundleDataSet = { resourceType: 'dataset', dataSetId: identifier(id), name: raw.name, physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: pipeline };
    const execution: ExecutionSettings = graph.reason ? { mode: 'BLAZE', intervalMinutes: null } : directSettings;
    await this.data.sources.metadata.batch(context, [{ key: this.key(context, id), body: { resource, execution, updatedAt: new Date().toISOString() }, expectedVersion: raw.expectedVersion as number }], graph.revisions);
    await this.data.cache?.invalidate(this.cacheKey(context, id)); return { resource, version: Number(raw.expectedVersion) + 1, execution };
  }
  async import(context: TenantContext, input: unknown) {
    const raw = object(structuredClone(input), ['resource', 'expectedVersion']), resource = parseBundleResource(raw.resource);
    if (resource.resourceType !== 'dataset' || !resource.opensightPrep) sourceError('INVALID_PREP_PIPELINE');
    // Imported bindings/credentials/security assertions never populate a source grant.
    if (Object.keys(resource.physicalTableMap).length || resource.logicalTableMap && Object.keys(resource.logicalTableMap).length || resource.rowLevelPermissionDataSet || resource.columnLevelPermissionRules) sourceError('PREP_SECURITY_REJECTED', 403);
    return this.save(context, resource.dataSetId, { name: resource.name, pipeline: resource.opensightPrep, expectedVersion: raw.expectedVersion });
  }
  async get(context: TenantContext, id: string) {
    const stored = await this.stored(context, id), graph = await this.graph(context, id, stored.resource.opensightPrep!);
    await this.data.finish(context, graph.leaves, graph.revisions); return stored;
  }
  /** Headless v1 building block: schema columns, pipeline references and execution
   * settings without running any data. `inputs` are the direct PrepInputs
   * (source ids as strings, nested datasets as `{ dataset }`); callers walk
   * them transitively with their own cycle guard. */
  async describe(context: TenantContext, id: string) {
    const stored = await this.stored(context, id), graph = await this.graph(context, id, stored.resource.opensightPrep!);
    await this.data.finish(context, graph.leaves, graph.revisions);
    const pipeline = stored.resource.opensightPrep!;
    return { resource: stored.resource, version: stored.version, execution: stored.execution,
      columns: this.plan(graph, id).columns.map(c => ({ name: c.name, type: c.type })),
      steps: pipeline.steps.map(s => ({ id: s.id, kind: s.kind, name: s.name ?? null, from: s.from ?? null })),
      inputs: references(pipeline).map(r => typeof r === 'string' ? { kind: 'source' as const, id: r } : { kind: 'dataset' as const, id: r.dataset }) };
  }
  /** Stored prepared-dataset ids for the owner, read from storage only —
   * no graph admission, so unavailable datasets are included. */
  async storedDatasetIds(context: TenantContext): Promise<string[]> {
    return (await this.data.sources.metadata.list(context, 'prepared-dataset')).map(r => r.id);
  }
  /** Direct pipeline inputs of a prepared dataset, read from its stored
   * record only — no graph admission and no execution planning. Returns
   * null when the dataset no longer exists (RESOURCE_NOT_FOUND); any other
   * stored-record parse error propagates, so an unreadable recipe is never
   * silently treated as having no references. */
  async storedInputs(context: TenantContext, id: string): Promise<{ kind: 'source' | 'dataset'; id: string }[] | null> {
    let stored;
    try { stored = await this.stored(context, id); }
    catch (error) {
      if (error instanceof MetadataError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    }
    return references(stored.resource.opensightPrep!)
      .map(r => typeof r === 'string' ? { kind: 'source' as const, id: r } : { kind: 'dataset' as const, id: r.dataset });
  }
  /** Listing degrades per dataset like `HostedData.discover()` degrades per source:
   * a dataset that fails admission with a known unavailable code is listed as
   * unavailable instead of failing the whole catalog. Anything else still
   * throws (fail-closed: unknown errors are never swallowed into the catalog). */
  async list(context: TenantContext) {
    const rev = await this.data.sources.metadata.revisions(context), datasets: Awaited<ReturnType<HostedPrep['get']>>[] = [], unavailable: { id: string; errorCode: string }[] = [];
    for (const r of await this.data.sources.metadata.list(context, 'prepared-dataset')) {
      try { datasets.push(await this.get(context, r.id)); }
      catch (error) {
        if (!(error instanceof MetadataError) && !(error instanceof Error && 'code' in error)) throw error;
        const code = String((error as { code: unknown }).code);
        if (!['SOURCE_RETIRED', 'UPLOAD_EXPIRED', 'ROW_ACCESS_DENIED', 'SOURCE_POLICY_REQUIRED', 'SOURCE_ENDPOINT_DENIED', 'SOURCE_MIGRATION_REQUIRED'].includes(code)) throw error;
        unavailable.push({ id: r.id, errorCode: code });
      }
    }
    await this.data.sources.metadata.assertRevisions(context, rev); return { datasets, unavailable };
  }
  async remove(context: TenantContext, id: string, expectedVersion: number) {
    await this.data.sources.metadata.remove(context, this.key(context, id), expectedVersion); await this.data.cache?.invalidate(this.cacheKey(context, id));
  }
  async preview(context: TenantContext, id: string, input: unknown) {
    const raw = object(structuredClone(input), ['pipeline', 'through', 'limit']);
    const pipeline = validatePrepPipeline(raw.pipeline ?? (await this.stored(context, id)).resource.opensightPrep), graph = await this.graph(context, id, pipeline);
    const through = raw.through === undefined || raw.through === null ? raw.through : identifier(raw.through);
    const limit = raw.limit ?? 100;
    if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 500) sourceError('PREP_LIMIT_EXCEEDED');
    const plan = this.plan(graph, id, through), table = new BlazeTable(this.data.limits(context));
    return this.data.work(context, false, graph.leaves, async () => {
      await this.load(context, id, graph, table, through);
      await this.data.finish(context, graph.leaves, graph.revisions);
      return { columns: table.columns, rows: table.rows(Number(limit)), truncated: table.rowCount > Number(limit), stages: plan.stages, through: plan.through };
    }, graph.revisions);
  }
  async configure(context: TenantContext, id: string, input: unknown) {
    const raw = object(structuredClone(input), ['expectedVersion', 'mode', 'intervalMinutes']), settings = executionSettings({ mode: raw.mode, intervalMinutes: raw.intervalMinutes });
    if (settings.intervalMinutes !== null && !this.jobs) sourceError('HOSTED_AUTOMATION_UNAVAILABLE', 503);
    const stored = await this.stored(context, id), graph = await this.graph(context, id, stored.resource.opensightPrep!);
    if (settings.mode === 'DIRECT_QUERY' && graph.reason) sourceError('BLAZE_MATERIALIZATION_REQUIRED', 409);
    if (this.jobs) await this.jobs.configurePrepared(context, id, settings, raw.expectedVersion as number, graph.revisions);
    else await this.data.sources.metadata.batch(context, [{ key: this.key(context, id), body: { resource: stored.resource, execution: settings }, expectedVersion: raw.expectedVersion as number }], graph.revisions);
    await this.data.cache?.invalidate(this.cacheKey(context, id)); return settings;
  }
  async dashboardVisual(context: TenantContext, id: string, analysis: unknown, visualId: string, dataSetArn: string) {
    const columns = (await this.describe(context, id)).columns;
    const plan = planPreparedVisual(columns, analysis, visualId, dataSetArn);
    const result = await this.execute(context, id, 'rows', {}, { analysis, visualId, dataSetArn }) as QueryResult;
    return { ...result, bindings: Object.fromEntries([...plan.dimensions, ...plan.measures].map(f => [f.fieldId, f.outputName])) };
  }
  async execute(context: TenantContext, id: string, path: 'rows' | 'query' | 'refresh', input: unknown = {}, visual?: { analysis: unknown; visualId: string; dataSetArn: string }) {
    const stored = await this.stored(context, id), graph = await this.graph(context, id, stored.resource.opensightPrep!), key = this.cacheKey(context, id);
    const query = path === 'query' ? validateQuery(input) : undefined;
    if (!query) object(input, []);
    const columns = this.plan(graph, id).columns;
    if (query) planPreparedQuery(columns, query); // Query semantics are checked before loading data.
    if (visual) planPreparedVisual(columns, visual.analysis, visual.visualId, visual.dataSetArn);
    const stamp = JSON.stringify([stored.version, graph.revisions]);
    return this.data.work(context, path === 'refresh', graph.leaves, async () => {
      const scope = this.data.scope(context);
      let table: BlazeTable;
      if (path === 'refresh') {
        if (stored.execution.mode !== 'BLAZE') sourceError('BLAZE_MODE_REQUIRED', 409);
        await this.data.cache!.refresh(scope, key, stamp, async () => {
          const output = new BlazeTable(this.data.limits(context)); await this.load(context, id, graph, output);
          await this.data.finish(context, graph.leaves, graph.revisions); scope.check(); return output;
        });
        return { mode: 'BLAZE', state: 'ready' };
      }
      if (stored.execution.mode === 'BLAZE') {
        table = await this.data.cache!.read(scope, key, stamp); scope.rows(table.rowCount);
      } else {
        if (graph.reason) sourceError('BLAZE_MATERIALIZATION_REQUIRED', 409);
        table = new BlazeTable(this.data.limits(context)); await this.load(context, id, graph, table);
      }
      const result = visual ? await containedWork<QueryResult>(scope, { kind: 'visual', table: await wireTable(scope, table, { id, table: 'output', connectorId: 'file', columns: table.columns, security: 'unrestricted' }), ...visual }, this.data.limits(context)) : query ? await this.data.computeQuery(context, table, query) : { columns: table.columns, rows: table.rows(100), rowCount: table.rowCount, truncated: table.rowCount > 100 };
      await this.data.finish(context, graph.leaves, graph.revisions); return result;
    }, graph.revisions, path === 'refresh' ? {
      claim: { kind: 'prepared-dataset', id, version: stored.version },
      definitions: [...[...graph.modes].map(([id, mode]) => ({ kind: 'prepared-dataset' as const, id, version: mode.version })),
        ...graph.leaves.map(a => ({ kind: 'source' as const, id: a.source.id, version: a.source.version }))],
    } : undefined);
  }
}
