import { MetricCatalog } from './metric-model.js';
import { LocalAssets } from './local-assets.js';
import { MetadataError } from './metadata-db.js';
import { changeDashboard, changeDashboardGrants, describeDashboard, type DashboardBackend, type DashboardChange, type DashboardRecord, type DashboardVersion } from './dashboard-model.js';
import type { AnalysisBackend } from './analysis-model.js';
import type { DefinitionStore } from './store.js';
import type { SalesQuery } from './query.js';
import type { PrepRoutes } from './prep-routes.js';
import { validateOrganization, validateGrants, type OrganizationService, type OrganizedAsset } from './organization.js';
import type { Identity, SecurityState } from './security.js';
import type { JsonObject } from './mapping.js';
import { legacyWrite } from './metadata-maintenance.js';
import { grantAllows } from './embed-content.js';

export class LocalDashboards implements DashboardBackend {
  constructor(readonly analyses: AnalysisBackend, private readonly store: DefinitionStore | undefined, private readonly sales: SalesQuery | undefined,
    private readonly prep: PrepRoutes, private readonly identity: Identity, private readonly recheck: () => Promise<void>,
    private readonly organization?: OrganizationService, private readonly root?: string, private readonly durableSecurity = false) {}
  private access(id?: string, mode: 'read' | 'write' | 'admin' = 'read', state = this.organization?.security.store.read()) {
    if (!this.organization || !state) {
      if (mode === 'admin') throw new MetadataError('SECURITY_NOT_CONFIGURED', 503);
      return;
    }
    const security = this.organization.security;
    if (mode === 'admin') security.admin(this.identity, state);
    if (mode === 'write') security.require(this.identity, 'build', state);
    if (id !== undefined) {
      this.organization.requireRead(this.identity, 'dashboard', id, state);
      if (mode === 'write') {
        const asset = this.organization.asset(state, this.identity.namespaceId, 'dashboard', id);
        const groups = state.groups.filter(g => g.namespaceId === this.identity.namespaceId && g.userIds.includes(this.identity.userId)).map(g => g.id);
        const allows = (grants: unknown) => grantAllows(grants, this.identity.userId, groups, security.user(this.identity, state).role === 'administrator', true);
        const folder = asset?.folderId ? state.folders?.find(f => f.namespaceId === this.identity.namespaceId && f.id === asset.folderId) : undefined;
        if (!allows(asset?.grants) || !allows(folder?.grants)) throw new MetadataError('METADATA_WRITE_FORBIDDEN', 403);
      }
    }
    if (mode !== 'read' && !this.durableSecurity) throw new MetadataError('DASHBOARD_DURABLE_STORE_REQUIRED', 503);
  }
  async authorize(id?: string, mode: 'read' | 'write' | 'admin' = 'read') { await this.recheck(); this.access(id, mode); }
  async list() {
    await this.authorize();
    if (!this.organization) return this.store?.dashboards() ?? [];
    const state = this.organization.security.store.read();
    return (state.assets ?? []).filter(a => a.namespaceId === this.identity.namespaceId && a.dashboard && !a.deleted && this.organization!.canRead(this.identity, 'dashboard', a.id, state)).map(a => a.dashboard!);
  }
  async get(id: string) {
    await this.authorize(id);
    const found = (await this.list()).find(d => d.id === id);
    if (!found) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
    return found;
  }
  async accessSnapshot(id: string) { return this.organization?.asset(this.organization.security.store.read(), this.identity.namespaceId, 'dashboard', id) ?? null; }
  async authorizeRemoved(snapshot: unknown) {
    await this.authorize(undefined, 'write');
    if (!this.organization || !snapshot) return;
    const asset = snapshot as OrganizedAsset, state: SecurityState = this.organization.security.store.read();
    state.assets = [...(state.assets ?? []).filter(a => !(a.namespaceId === asset.namespaceId && a.kind === 'dashboard' && a.id === asset.id)), asset];
    this.access(asset.id, 'write', state);
  }
  async revision(id: string) { const asset = await this.accessSnapshot(id) as OrganizedAsset | null; return asset?.assetVersion ?? (this.store?.assetResources().find(r => r.kind === 'dashboard' && r.id === id)?.version) ?? (await this.get(id)).latest; }
  async grants(id: string) { await this.authorize(id, 'write'); return (await this.accessSnapshot(id) as OrganizedAsset | null)?.grants; }
  async change(id: string, change: DashboardChange, stamp: unknown) {
    await this.recheck();
    if (!this.organization) return this.store!.mutateDashboard(id, change, this.identity.userId);
    const organization = this.organization;
    if (!this.durableSecurity) throw new MetadataError('DASHBOARD_DURABLE_STORE_REQUIRED', 503);
    const commit = () => organization.security.store.change(state => {
      if (JSON.stringify(state) !== stamp) throw new MetadataError('METADATA_REVISED', 403);
      const prior = organization.asset(state, this.identity.namespaceId, 'dashboard', id);
      this.access(change.kind === 'publish' ? undefined : id, change.kind === 'share' ? 'admin' : change.kind === 'publish' ? 'read' : 'write', state);
      if (change.kind === 'publish') {
        const source = organization.asset(state, this.identity.namespaceId, 'analysis', change.source.id);
        if (!organization.definition(this.identity.namespaceId, 'analysis', change.source.id, state)) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
        if ((source?.analysisVersion ?? 1) !== change.source.version) throw new MetadataError('METADATA_CONFLICT', 409);
      }
      if (!prior?.dashboard && organization.definition(this.identity.namespaceId, 'dashboard', id, state)) throw new MetadataError('DASHBOARD_SOURCE_MISMATCH', 409);
      const next = changeDashboard(prior?.deleted ? undefined : prior?.dashboard, change, this.identity.userId);
      const asset: OrganizedAsset = prior ?? { id, kind: 'dashboard', namespaceId: this.identity.namespaceId, folderId: null, grants: [{ principal: { type: 'user', id: this.identity.userId }, role: 'co-owner' }] };
      if (!prior) (state.assets ??= []).push(asset);
      asset.assetVersion = (prior?.assetVersion ?? prior?.dashboard?.latest ?? 0) + 1;
      asset.updatedAt = new Date().toISOString();
      if (!next) { delete asset.grants; asset.deleted = true; delete asset.dashboard; delete asset.definition; }
      else { delete asset.deleted; asset.dashboard = next; asset.definition = describeDashboard(next); }
      if (change.kind === 'share') asset.grants = validateGrants(changeDashboardGrants(asset.grants, change), this.identity.namespaceId, state);
      validateOrganization(state); return next;
    });
    return this.root ? legacyWrite(this.root, commit) : commit();
  }
  async authorizeQuestion(id: string) { await this.authorize(id); this.organization?.security.require(this.identity, 'ai'); }
  async metricVocabulary(v: DashboardVersion) {
    if (Object.values(v.datasetBindings).length !== 1) return [];
    const ref = Object.values(v.datasetBindings)[0]!;
    const assets = new LocalAssets(this.store, this.prep, this.identity, this.recheck, this.organization, this.root, this.durableSecurity, this.sales);
    return assets.transaction(false, a => new MetricCatalog(a).vocabulary({ ...ref, ...(ref.kind === 'prepared-dataset' ? { ownerId: v.bindingOwnerId } : {}) }));
  }
  async query(v: DashboardVersion, definition: JsonObject, visualId: string) {
    const bindings = Object.values(v.datasetBindings);
    if (bindings.length !== 1) throw new MetadataError('DASHBOARD_DATASET_UNSUPPORTED', 422);
    const binding = bindings[0]!;
    if (binding.kind === 'prepared-dataset') {
      if (v.bindingOwnerId !== this.identity.userId) throw new MetadataError('DASHBOARD_DATASET_ACCESS_DENIED', 403);
      return this.prep.dashboardVisual(this.identity, binding.id, definition, visualId, v.definition.dataSetIdentifierDeclarations[0]!.dataSetArn);
    }
    if (binding.id !== 'sales' || !this.sales) throw new MetadataError('UNRESOLVED_BINDING', 422);
    const { plan, rows, metrics } = await this.sales.executeVisual(definition, visualId, undefined, this.organization ? this.identity : undefined);
    return { columns: [...plan.dimensions.map(f => ({ name: f.outputName, type: 'string' as const })), ...plan.measures.map(f => ({ name: f.outputName, type: 'number' as const }))], rows, ...(metrics ? { metrics } : {}),
      bindings: Object.fromEntries([...plan.dimensions, ...plan.measures].map(f => [f.fieldId, f.outputName])) };
  }
}
