import { convertDefinition, projectDefinition, analysisFail, type AnalysisSchema } from '@opensight/web/analysis';
import { resolveSecurity } from '@opensight/query-engine';
import { MetadataError } from './metadata-db.js';
import type { AnalysisBackend, AnalysisRecord, DatasetBindings } from './analysis-model.js';
import { datasetBindings } from './analysis-model.js';
import type { DefinitionStore } from './store.js';
import type { SalesQuery } from './query.js';
import type { PrepRoutes } from './prep-routes.js';
import type { OrganizationService, AssetGrant } from './organization.js';
import { validateOrganization } from './organization.js';
import type { Identity, SecurityState } from './security.js';
import { legacyWrite } from './metadata-maintenance.js';

export class LocalAnalyses implements AnalysisBackend {
  readonly scope;
  constructor(private readonly store: DefinitionStore | undefined, private readonly sales: SalesQuery | undefined, private readonly prep: PrepRoutes,
    private readonly identity: Identity, private readonly recheck: () => Promise<void>, private readonly organization?: OrganizationService, private readonly root?: string, private readonly durableSecurity = false) {
    this.scope = { tenantId: identity.namespaceId, ...identity };
  }
  private access(id?: string, write = false, state = this.organization?.security.store.read()): void {
    if (!this.organization || !state) return;
    const security = this.organization.security;
    security.require(this.identity, 'build', state);
    if (id === undefined) return;
    this.organization.requireRead(this.identity, 'analysis', id, state);
    if (!write || security.user(this.identity, state).role === 'administrator') return;
    const allows = (grants?: AssetGrant[]) => grants === undefined || grants.some(g => g.role === 'co-owner' && (g.principal.type === 'user' ? g.principal.id === this.identity.userId : state.groups.some(group => group.namespaceId === this.identity.namespaceId && group.id === g.principal.id && group.userIds.includes(this.identity.userId))));
    const asset = this.organization.asset(state, this.identity.namespaceId, 'analysis', id);
    const folder = asset?.folderId ? state.folders?.find(f => f.namespaceId === this.identity.namespaceId && f.id === asset.folderId) : undefined;
    if (!allows(asset?.grants) || !allows(folder?.grants)) throw new MetadataError('METADATA_WRITE_FORBIDDEN', 403);
  }
  async authorize(id?: string, write = false) { await this.recheck(); this.access(id, write); if (write && this.organization && !this.durableSecurity) throw new MetadataError('ANALYSIS_DURABLE_STORE_REQUIRED', 503); }
  async list() {
    await this.authorize();
    return (this.organization ? this.organization.list(this.identity) : this.store?.list() ?? []).filter((a): a is { kind: 'analysis'; id: string; name: string } => a.kind === 'analysis');
  }
  async exists(id: string) { return !!(this.organization ? this.organization.definition(this.identity.namespaceId, 'analysis', id) : this.store?.get('analysis', id)); }
  async accessSnapshot(id: string) { return this.organization?.asset(this.organization.security.store.read(), this.identity.namespaceId, 'analysis', id) ?? null; }
  async authorizeRemoved(snapshot: unknown) {
    await this.authorize();
    if (!this.organization || !snapshot) return;
    const state = this.organization.security.store.read(), asset = snapshot as NonNullable<ReturnType<OrganizationService['asset']>>;
    const synthetic: SecurityState = structuredClone(state);
    synthetic.assets = [...(synthetic.assets ?? []).filter(a => a.kind !== 'analysis' || a.id !== asset.id || a.namespaceId !== asset.namespaceId), { ...asset, deleted: undefined, definition: { AnalysisId: asset.id, Name: asset.id, Definition: { DataSetIdentifierDeclarations: [] } } }];
    this.access(asset.id, true, synthetic);
  }
  async get(id: string): Promise<AnalysisRecord> {
    await this.authorize(id);
    const state = this.organization?.security.store.read(), asset = state && this.organization?.asset(state, this.identity.namespaceId, 'analysis', id);
    const wire = this.organization ? this.organization.definition(this.identity.namespaceId, 'analysis', id) : this.store?.get('analysis', id);
    if (!wire) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
    const stored = !this.organization && this.store?.analysisRecord(id);
    if (stored) return stored;
    if (asset?.datasetBindings && Object.values(asset.datasetBindings).some(b => b.kind === 'prepared-dataset') && asset.datasetBindingOwnerId !== this.identity.userId) {
      analysisFail('SECURITY_REJECTED', '$.datasetBindings', 'Dataset owner does not match authenticated user');
    }
    const definition = convertDefinition(wire.Definition);
    // Imported local fixtures have one trusted configured sales source, resolved
    // by exact startup ARN. An arbitrary request ARN never selects data.
    const bindings = asset?.datasetBindings ?? Object.fromEntries(definition.dataSetIdentifierDeclarations.map(d => {
      if (!this.sales || d.dataSetArn !== this.sales.securitySchema().localData.dataSetArn) analysisFail('UNRESOLVED_BINDING', '$.datasetBindings', 'Imported dataset has no configured binding');
      return [d.identifier, { kind: 'dataset', id: 'sales' }];
    }));
    return { id, name: String(wire.Name ?? id), definition, datasetBindings: datasetBindings(bindings, definition), version: asset?.analysisVersion ?? 1 };
  }
  async resolve(bindings: DatasetBindings): Promise<Map<string, AnalysisSchema>> {
    await this.authorize(); const result = new Map<string, AnalysisSchema>();
    for (const [name, binding] of Object.entries(bindings)) {
      if (binding.kind === 'prepared-dataset') result.set(name, { columns: await this.prep.analysisSchema(this.identity, binding.id) });
      else {
        if (binding.id !== 'sales' || !this.sales) analysisFail('UNRESOLVED_BINDING', `$.datasetBindings[${JSON.stringify(name)}]`, 'Legacy dataset is unresolved');
        const schema = this.sales.securitySchema();
        const security = this.organization ? resolveSecurity(this.organization.security.context(this.identity), schema.columns, schema.localData.dataSetArn) : undefined;
        if (schema.localData.security.dataset === 'protected' && !security?.protected) analysisFail('SECURITY_REJECTED', '$.datasetBindings', 'Protected dataset requires a policy');
        result.set(name, { columns: schema.columns, deniedColumns: security?.deniedColumns });
      }
    }
    return result;
  }
  async stamp() { return this.organization ? JSON.stringify(this.organization.security.store.read()) : null; }
  async check(stamp: unknown) { await this.recheck(); if (stamp !== await this.stamp()) throw new MetadataError('METADATA_REVISED', 403); }
  private async mutation(id: string, record: AnalysisRecord | null, version: number, stamp: unknown) {
    await this.recheck();
    if (!this.organization) {
      if (!this.store) throw new MetadataError('ANALYSIS_STORE_UNAVAILABLE', 503);
      await this.store.mutateAnalysis(id, record, version, () => this.access(version ? id : undefined, true)); return;
    }
    const organization = this.organization;
    const commit = () => organization.security.store.change(state => {
      const prior = organization.asset(state, this.identity.namespaceId, 'analysis', id);
      const exists = !!organization.definition(this.identity.namespaceId, 'analysis', id, state);
      this.access(exists ? id : undefined, true, state);
      const current = exists ? prior?.analysisVersion ?? 1 : 0;
      if (current !== version) throw new MetadataError('METADATA_CONFLICT');
      if (JSON.stringify(state) !== stamp) throw new MetadataError('METADATA_REVISED', 403);
      if (!record && !exists) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
      const asset = exists && prior ? prior : { id, kind: 'analysis' as const, namespaceId: this.identity.namespaceId, folderId: null,
        grants: [{ principal: { type: 'user' as const, id: this.identity.userId }, role: 'co-owner' as const }] };
      if (!prior) (state.assets ??= []).push(asset); else if (asset !== prior) state.assets![state.assets!.indexOf(prior)] = asset;
      asset.analysisVersion = version + 1;
      if (record) {
        delete asset.deleted;
        asset.definition = { AnalysisId: id, Name: record.name, Definition: projectDefinition(record.definition) };
        asset.datasetBindings = record.datasetBindings;
        if (Object.values(record.datasetBindings).some(b => b.kind === 'prepared-dataset')) asset.datasetBindingOwnerId = this.identity.userId;
        else delete asset.datasetBindingOwnerId;
      } else {
        for (const item of state.assets ?? []) if (item.namespaceId === this.identity.namespaceId && item.dashboard?.sourceAnalysisId === id) item.dashboard.sourceActive = false;
        asset.deleted = true; delete asset.definition; delete asset.datasetBindings; delete asset.datasetBindingOwnerId; }
      validateOrganization(state);
    });
    if (this.root) await legacyWrite(this.root, commit); else await commit();
  }
  async save(record: AnalysisRecord, version: number, stamp: unknown) { await this.mutation(record.id, record, version, stamp); }
  async remove(id: string, version: number, stamp: unknown) { await this.mutation(id, null, version, stamp); }
}
