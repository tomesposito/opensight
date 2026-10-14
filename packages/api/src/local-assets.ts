import { dashboardVersion } from './dashboard-model.js';
import { AssetCatalog, assetKey, type AssetBackend } from './asset-model.js';
import { MetadataError } from './metadata-db.js';
import type { MetadataResource } from './metadata-resources.js';
import type { DefinitionStore } from './store.js';
import type { OrganizationService, OrganizedAsset } from './organization.js';
import { validateOrganization } from './organization.js';
import type { Identity, SecurityState } from './security.js';
import type { PrepRoutes } from './prep-routes.js';
import { legacyWrite } from './metadata-maintenance.js';
import type { JsonObject } from './mapping.js';
import { object } from './metadata-resources.js';

export function localResource(id: string, kind: 'analysis' | 'dashboard', definition: JsonObject, asset?: OrganizedAsset): MetadataResource {
  const declarations = object(definition.Definition).DataSetIdentifierDeclarations as { Identifier: string }[];
  const published = asset?.dashboard ? dashboardVersion(asset.dashboard) : undefined;
  return { kind, id, version: kind === 'analysis' ? asset?.analysisVersion ?? 1 : asset?.assetVersion ?? asset?.dashboard?.latest ?? 1,
    body: { definition: structuredClone(definition), folderId: asset?.folderId ?? null,
      ...(asset?.grants === undefined ? {} : { grants: asset.grants }), ...(asset?.updatedAt || published ? { updatedAt: asset?.updatedAt ?? published!.publishedAt } : {}),
      ...(asset?.dashboard ? { published: asset.dashboard } : {}),
      datasets: declarations.map(d => {
        const ref = published?.datasetBindings[d.Identifier] ?? asset?.datasetBindings?.[d.Identifier] ?? { kind: 'dataset', id: 'sales' };
        return { ...ref, ...(ref.kind === 'prepared-dataset' ? { ownerId: published?.bindingOwnerId ?? asset?.datasetBindingOwnerId } : {}) };
      }) } };
}
export function organizedResource(r: MetadataResource, namespaceId: string): OrganizedAsset {
  const definition = object(r.body.definition), declarations = object(definition.Definition).DataSetIdentifierDeclarations as { Identifier: string }[];
  const refs = r.body.datasets as { kind: 'dataset' | 'prepared-dataset'; id: string; ownerId?: string }[];
  return { id: r.id, kind: r.kind as 'analysis' | 'dashboard', namespaceId, folderId: r.body.folderId as string | null,
    definition, grants: r.body.grants as OrganizedAsset['grants'], updatedAt: r.body.updatedAt as string | undefined,
    ...(r.kind === 'analysis' ? { analysisVersion: r.version } : { assetVersion: r.version }),
    ...(r.body.published ? { dashboard: r.body.published as OrganizedAsset['dashboard'] } : {}),
    datasetBindings: Object.fromEntries(declarations.map((d, i) => [d.Identifier, { kind: refs[i]!.kind, id: refs[i]!.id }])),
    ...(refs.some(r => r.kind === 'prepared-dataset') ? { datasetBindingOwnerId: refs.find(r => r.kind === 'prepared-dataset')!.ownerId } : {}) };
}
export class LocalAssets implements AssetBackend {
  readonly scope;
  constructor(private readonly store: DefinitionStore | undefined, private readonly prep: PrepRoutes, private readonly identity: Identity,
    private readonly recheck: () => Promise<void>, private readonly organization?: OrganizationService, private readonly root?: string, private readonly durable = false) {
    this.scope = { tenantId: identity.namespaceId, ...identity };
  }
  private entries(state: SecurityState): MetadataResource[] {
    const ns = this.identity.namespaceId, organization = this.organization!;
    const resources: MetadataResource[] = [
      ...state.users.filter(u => u.namespaceId === ns).map(u => ({ kind: 'user' as const, id: u.id, version: 1, body: { name: u.id, role: u.role } })),
      ...state.groups.filter(g => g.namespaceId === ns).map(g => ({ kind: 'group' as const, id: g.id, version: 1, body: { name: g.id, userIds: g.userIds } })),
      ...(state.folders ?? []).filter(f => f.namespaceId === ns).map(f => ({ kind: 'folder' as const, id: f.id, version: f.version ?? 1, body: { name: f.name, ...(f.grants === undefined ? {} : { grants: f.grants }), ...(f.updatedAt ? { updatedAt: f.updatedAt } : {}) } })),
    ];
    const keys = new Map([...(this.store?.list() ?? []), ...(state.assets ?? []).filter(a => a.namespaceId === ns)].map(a => [`${a.kind}/${a.id}`, a]));
    for (const { kind, id } of keys.values()) {
      const definition = organization.definition(ns, kind, id, state);
      if (definition) resources.push(localResource(id, kind, definition, organization.asset(state, ns, kind, id)));
    }
    return resources;
  }
  async transaction<T>(write: boolean, work: (catalog: AssetCatalog) => T): Promise<T> {
    await this.recheck();
    if (write) {
      const snapshot = () => new AssetCatalog(this.scope, [
        ...(this.organization ? this.entries(this.organization.security.store.read()) : [...this.store?.assetResources() ?? [], { kind: 'user' as const, id: this.identity.userId, version: 1, body: { name: this.identity.userId, role: 'administrator' } }]),
        ...this.prep.assetResources(this.identity),
      ]);
      const draft = snapshot(), before = draft.resources.filter(r => r.kind === 'prepared-dataset');
      const result = work(draft), removed = before.find(r => !draft.resources.includes(r));
      if (removed) {
        const commit = () => this.prep.deleteAsset(this.identity, removed.id, removed.version, () => { work(snapshot()); });
        if (this.root) await legacyWrite(this.root, commit); else await commit();
        return result;
      }
    }
    if (!this.organization) {
      if (!this.store) throw new MetadataError('ASSET_STORE_UNAVAILABLE', 503);
      return this.store.assetTransaction(this.scope, write, work, this.prep.assetResources(this.identity));
    }
    if (write && !this.durable) throw new MetadataError('ASSET_DURABLE_STORE_REQUIRED', 503);
    const operation = (state: SecurityState) => {
      const entries = this.entries(state), prep = this.prep.assetResources(this.identity);
      const catalog = new AssetCatalog(this.scope, [...structuredClone(entries), ...prep]), result = work(catalog);
      if (!write) return result;
      const after = new Map(catalog.resources.map(r => [assetKey(r), r]));
      // Prepared data has a separate durable store. Its delete is handled below under the same root fence.
      for (const r of catalog.resources) {
        const old = entries.find(e => assetKey(e) === assetKey(r));
        if (r.kind === 'prepared-dataset' || JSON.stringify(old) === JSON.stringify(r)) continue;
        if (r.kind === 'folder') {
          state.folders = (state.folders ?? []).filter(f => f.namespaceId !== this.identity.namespaceId || f.id !== r.id);
          state.folders.push({ id: r.id, namespaceId: this.identity.namespaceId, name: String(r.body.name), grants: r.body.grants as OrganizedAsset['grants'], version: r.version, updatedAt: r.body.updatedAt as string });
        } else if (r.kind === 'analysis' || r.kind === 'dashboard') {
          state.assets = (state.assets ?? []).filter(a => a.namespaceId !== this.identity.namespaceId || a.kind !== r.kind || a.id !== r.id);
          state.assets.push(organizedResource(r, this.identity.namespaceId));
        }
      }
      for (const r of entries.filter(e => !after.has(assetKey(e)))) {
        if (r.kind === 'folder') state.folders = state.folders?.filter(f => f.namespaceId !== this.identity.namespaceId || f.id !== r.id);
        else if (r.kind === 'analysis' || r.kind === 'dashboard') {
          state.assets = (state.assets ?? []).filter(a => a.namespaceId !== this.identity.namespaceId || a.kind !== r.kind || a.id !== r.id);
          state.assets.push({ id: r.id, kind: r.kind, namespaceId: this.identity.namespaceId, folderId: null, deleted: true });
        }
      }
      if (prep.some(r => !after.has(assetKey(r)))) throw new MetadataError('ASSET_LOCAL_DATASET_DELETE_UNAVAILABLE', 503);
      validateOrganization(state); return result;
    };
    if (!write) return operation(this.organization.security.store.read());
    const commit = () => this.organization!.security.store.change(operation);
    return this.root ? legacyWrite(this.root, commit) : commit();
  }
}
