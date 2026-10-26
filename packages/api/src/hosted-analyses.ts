import { convertDefinition, projectDefinition, analysisFail, type AnalysisSchema } from '@opensight/web/analysis';
import { resolveSecurity } from '@opensight/query-engine';
import { EmbedContent } from './embed-content.js';
import { MetadataError } from './metadata-db.js';
import type { HostedDataRoutes } from './hosted-data-routes.js';
import type { TenantContext, Revisions } from './metadata.js';
import { object, resourceKey } from './metadata-resources.js';
import { boundColumns } from './source-schema.js';
import type { AnalysisBackend, AnalysisRecord, DatasetBindings } from './analysis-model.js';

export class HostedAnalyses implements AnalysisBackend {
  readonly scope: TenantContext;
  private readonly content: EmbedContent;
  constructor(private readonly routes: HostedDataRoutes, context: TenantContext, private readonly recheck: () => Promise<void>) {
    this.scope = context; this.content = new EmbedContent(routes.data);
  }
  private get metadata() { return this.routes.data.sources.metadata; }
  async authorize(id?: string, write = false): Promise<void> {
    await this.recheck(); await this.routes.data.sources.capability(this.scope, 'build');
    if (id !== undefined) await this.content.access(this.scope, await this.metadata.get(this.scope, { kind: 'analysis', id }), write);
  }
  async list() {
    await this.authorize(); const items: { kind: 'analysis'; id: string; name: string }[] = [];
    for (const asset of await this.metadata.list(this.scope, 'analysis')) {
      try { await this.content.access(this.scope, asset); items.push({ kind: 'analysis', id: asset.id, name: String(object(asset.body.definition).Name ?? asset.id) }); }
      catch (error) { if (!(error instanceof MetadataError && error.code === 'RESOURCE_NOT_FOUND')) throw error; }
    }
    return items;
  }
  async exists(id: string) { try { await this.metadata.get(this.scope, { kind: 'analysis', id }); return true; } catch (error) { if (error instanceof MetadataError && error.code === 'RESOURCE_NOT_FOUND') return false; throw error; } }
  async accessSnapshot(id: string) { return this.metadata.get(this.scope, { kind: 'analysis', id }); }
  async authorizeRemoved(snapshot: unknown) { await this.authorize(); await this.content.access(this.scope, snapshot as Awaited<ReturnType<typeof this.accessSnapshot>>, true); }
  async get(id: string): Promise<AnalysisRecord> {
    await this.authorize(id);
    const asset = await this.metadata.get(this.scope, { kind: 'analysis', id }), wire = object(asset.body.definition), definition = convertDefinition(wire.Definition);
    if (!Array.isArray(asset.body.datasets) || asset.body.datasets.length !== definition.dataSetIdentifierDeclarations.length) analysisFail('UNRESOLVED_BINDING', '$.datasetBindings', 'Stored dataset links are unresolved');
    const datasetBindings: DatasetBindings = Object.fromEntries(definition.dataSetIdentifierDeclarations.map((d, i) => {
      const ref = resourceKey(object((asset.body.datasets as unknown[])[i]) as unknown as Parameters<typeof resourceKey>[0]);
      if (ref.kind !== 'dataset' && ref.kind !== 'prepared-dataset' || ref.kind === 'prepared-dataset' && ref.ownerId !== this.scope.userId) analysisFail('SECURITY_REJECTED', `$.datasetBindings[${JSON.stringify(d.identifier)}]`, 'Dataset owner does not match authenticated user');
      return [d.identifier, { kind: ref.kind, id: ref.id }];
    }));
    return { id, name: String(wire.Name ?? id), definition, datasetBindings, version: asset.version, hasHadVisual: asset.body.hasHadVisual === true };
  }
  async resolve(bindings: DatasetBindings): Promise<Map<string, AnalysisSchema>> {
    const schemas = new Map<string, AnalysisSchema>();
    for (const [identifier, ref] of Object.entries(bindings)) {
      const path = `$.datasetBindings[${JSON.stringify(identifier)}]`;
      try {
        if (ref.kind === 'prepared-dataset') {
          const dataset = await this.routes.prep.describe(this.scope, ref.id); schemas.set(identifier, { columns: dataset.columns });
        } else {
          const dataset = await this.metadata.get(this.scope, { kind: 'dataset', id: ref.id });
          if (!Array.isArray(dataset.body.sources) || dataset.body.sources.length !== 1) analysisFail('UNRESOLVED_BINDING', path, 'Legacy dataset requires one resolved source');
          const source = resourceKey(object(dataset.body.sources[0]) as unknown as Parameters<typeof resourceKey>[0]);
          if (source.kind !== 'source' || source.ownerId !== this.scope.userId) analysisFail('SECURITY_REJECTED', path, 'Dataset source owner does not match authenticated user');
          const policies = (await this.metadata.list(this.scope, 'policy')).filter(p => p.body.datasetId === ref.id);
          const wire = object(dataset.body.definition), d = object(wire.DataSet ?? wire);
          if (policies.length > 1 || (d.RowLevelPermissionDataSet || d.ColumnLevelPermissionRules) && !policies.length) analysisFail('SECURITY_REJECTED', path, 'Dataset policy is unresolved');
          const a = await this.routes.data.admit(this.scope, source.id, 'query');
          let denied = a.deniedColumns;
          if (policies[0]) {
            const { datasetId: _id, ...policy } = policies[0].body;
            const scoped = { ...a.security, policy: { ...policy, namespaceId: this.scope.namespaceId, dataSetArn: a.security.policy.dataSetArn } } as typeof a.security;
            const additional = resolveSecurity(scoped, boundColumns(a.source.binding.columns), a.security.policy.dataSetArn);
            denied = [...new Set([...denied, ...additional.deniedColumns])];
          }
          schemas.set(identifier, { columns: a.physical.columns, deniedColumns: denied });
        }
      } catch (error) {
        if (error instanceof MetadataError) throw Object.assign(error, { path });
        throw error;
      }
    }
    return schemas;
  }
  async stamp() { return this.metadata.revisions(this.scope); }
  async check(stamp: unknown) { await this.recheck(); await this.routes.data.publication(this.scope, stamp as Revisions); }
  async save(record: AnalysisRecord, expectedVersion: number, stamp: unknown) {
    await this.recheck();
    await this.metadata.mutateAnalysis(this.scope, record.id, {
      hasHadVisual: record.hasHadVisual === true,
      definition: { AnalysisId: record.id, Name: record.name, Definition: projectDefinition(record.definition) },
      datasets: record.definition.dataSetIdentifierDeclarations.map(d => {
        const ref = record.datasetBindings[d.identifier]!;
        return { ...ref, ...(ref.kind === 'prepared-dataset' ? { ownerId: this.scope.userId } : {}) };
      }),
    }, expectedVersion, stamp as Revisions);
    this.routes.data.begin(this.scope);
  }
  async remove(id: string, expectedVersion: number, stamp: unknown) { await this.recheck(); await this.metadata.mutateAnalysis(this.scope, id, null, expectedVersion, stamp as Revisions); this.routes.data.begin(this.scope); }
}
