import { planPreparedVisual, resolveSecurity, type RowPredicate, type SecurityContext } from '@opensight/query-engine';
import { MetadataError } from './metadata-db.js';
import { HostedAnalyses } from './hosted-analyses.js';
import { EmbedContent } from './embed-content.js';
import { object, resourceKey, type MetadataResource } from './metadata-resources.js';
import type { DashboardBackend, DashboardChange, DashboardRecord, DashboardVersion } from './dashboard-model.js';
import type { HostedDataRoutes } from './hosted-data-routes.js';
import type { TenantContext, Revisions } from './metadata.js';
import type { AssetGrant } from './organization.js';
import type { JsonObject } from './mapping.js';
import { boundColumns } from './source-schema.js';
import { containedWork, wireTable, type QueryResult } from './contained-work.js';

export class HostedDashboards implements DashboardBackend {
  readonly analyses: HostedAnalyses;
  private readonly content: EmbedContent;
  constructor(private readonly routes: HostedDataRoutes, private readonly context: TenantContext, private readonly recheck: () => Promise<void>) {
    this.analyses = new HostedAnalyses(routes, context, recheck); this.content = new EmbedContent(routes.data);
  }
  private get metadata() { return this.routes.data.sources.metadata; }
  async authorize(id?: string, mode: 'read' | 'write' | 'admin' = 'read') {
    await this.recheck();
    if (mode === 'write') await this.routes.data.sources.capability(this.context, 'build');
    if (mode === 'admin' && (await this.metadata.get(this.context, { kind: 'user', id: this.context.userId })).body.role !== 'administrator') throw new MetadataError('METADATA_WRITE_FORBIDDEN', 403);
    if (id) await this.content.access(this.context, await this.metadata.get(this.context, { kind: 'dashboard', id }), mode === 'write');
  }
  async list() {
    await this.authorize(); const result: DashboardRecord[] = [];
    for (const asset of await this.metadata.list(this.context, 'dashboard')) {
      if (!asset.body.published) continue;
      try { await this.content.access(this.context, asset); result.push(asset.body.published as DashboardRecord); }
      catch (e) { if (!(e instanceof MetadataError && e.code === 'RESOURCE_NOT_FOUND')) throw e; }
    }
    return result;
  }
  async get(id: string) {
    await this.authorize(id);
    const record = (await this.metadata.get(this.context, { kind: 'dashboard', id })).body.published as DashboardRecord | undefined;
    if (!record) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
    return record;
  }
  async accessSnapshot(id: string) { return this.metadata.get(this.context, { kind: 'dashboard', id }); }
  async authorizeRemoved(snapshot: unknown) { await this.authorize(undefined, 'write'); await this.content.access(this.context, snapshot as MetadataResource, true); }
  async revision(id: string) { return (await this.accessSnapshot(id)).version; }
  async grants(id: string) { await this.authorize(id, 'write'); return (await this.accessSnapshot(id)).body.grants as AssetGrant[] | undefined; }
  async change(id: string, change: DashboardChange, stamp: unknown) { await this.recheck(); return this.metadata.mutateDashboard(this.context, id, change, stamp as Revisions); }
  async query(v: DashboardVersion, definition: JsonObject, visualId: string) {
    const bindings = Object.values(v.datasetBindings);
    if (bindings.length !== 1) throw new MetadataError('DASHBOARD_DATASET_UNSUPPORTED', 422);
    const binding = bindings[0]!, data = this.routes.data, context = this.context;
    const dataSetArn = v.definition.dataSetIdentifierDeclarations[0]!.dataSetArn;
    const analysis = { ResourceType: 'Analysis', AnalysisId: 'published', Name: v.name, Definition: definition };
    if (binding.kind === 'prepared-dataset') {
      if (v.bindingOwnerId !== context.userId) throw new MetadataError('DASHBOARD_DATASET_ACCESS_DENIED', 403);
      return this.routes.prep.dashboardVisual(context, binding.id, analysis, visualId, dataSetArn);
    }
    // Follow the frozen binding, and admit as the reader. Never use EmbedSources' delegation.
    const dataset = await this.metadata.get(context, { kind: 'dataset', id: binding.id });
    if (!Array.isArray(dataset.body.sources) || dataset.body.sources.length !== 1) throw new MetadataError('UNRESOLVED_BINDING', 422);
    const source = resourceKey(object(dataset.body.sources[0]) as unknown as Parameters<typeof resourceKey>[0]);
    if (source.kind !== 'source' || source.ownerId !== context.userId) throw new MetadataError('DASHBOARD_DATASET_ACCESS_DENIED', 403);
    const policies = (await this.metadata.list(context, 'policy')).filter(p => p.body.datasetId === binding.id);
    const wire = object(dataset.body.definition), d = object(wire.DataSet ?? wire);
    if (policies.length > 1 || (d.RowLevelPermissionDataSet || d.ColumnLevelPermissionRules) && !policies.length) throw new MetadataError('SOURCE_POLICY_REQUIRED', 403);
    const admittedSource = await data.sources.get(context, source.id);
    const a = await data.admit(context, source.id, 'query', base => {
      if (!policies[0]) return base;
      const { datasetId: _id, ...policy } = policies[0].body;
      const schema = boundColumns(admittedSource.binding.columns);
      const first = resolveSecurity(base, schema, base.policy.dataSetArn);
      const second = resolveSecurity({ ...base, policy: { ...policy, namespaceId: context.namespaceId, dataSetArn: base.policy.dataSetArn } } as SecurityContext, schema, base.policy.dataSetArn);
      const predicates = [first.rowPredicate, second.rowPredicate].filter((p): p is RowPredicate => !!p);
      return { ...base, policy: { namespaceId: context.namespaceId, dataSetArn: base.policy.dataSetArn, rowLevel: !!predicates.length,
        rowRules: predicates.length ? [{ id: 'dashboard-intersection', principals: [{ type: 'user', id: context.userId }], predicate: { all: predicates } }] : [],
        protectedColumns: [...new Set([...first.deniedColumns, ...second.deniedColumns])], columnGrants: [] } };
    });
    const plan = planPreparedVisual(a.physical.columns, analysis, visualId, dataSetArn, a.security);
    return data.work(context, false, [a], async () => {
      const table = await data.table(context, a, data.read(a).columns);
      const result = await containedWork<QueryResult>(data.scope(context), { kind: 'visual', table: await wireTable(data.scope(context), table, { ...a.physical, columns: table.columns }), analysis, visualId, dataSetArn }, data.limits(context));
      return { ...result, bindings: Object.fromEntries([...plan.dimensions, ...plan.measures].map(f => [f.fieldId, f.outputName])) };
    });
  }
}
