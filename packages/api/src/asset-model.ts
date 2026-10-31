import { wireHasVisuals } from './analysis-model.js';
import { hasCapability, type Role } from '@opensight/query-engine';
import { MetadataError } from './metadata-db.js';
import { object, identifier, type MetadataResource, type ResourceKey } from './metadata-resources.js';
import { grantAllows } from './embed-content.js';
import { dashboardVersion, type DashboardRecord } from './dashboard-model.js';
import type { AssetGrant } from './organization.js';

export type AssetKind = 'analyses' | 'dashboards' | 'datasets';
export type AssetScope = { tenantId: string; namespaceId: string; userId: string };
export interface AssetBackend {
  readonly scope: AssetScope;
  /** Read/check or change in one durable transaction, with current identity. */
  transaction<T>(write: boolean, work: (catalog: AssetCatalog) => T, receipt?: (result: T) => import('./retry-store.js').RetryCommit): Promise<T>;
}
export const assetKey = (r: ResourceKey) => JSON.stringify([r.kind, r.ownerId ?? '', r.id]);
export function assetFail(code: string, status = 400): never { throw new MetadataError(code, status); }
export function assetKind(kind: string): AssetKind {
  if (!['analyses', 'dashboards', 'datasets'].includes(kind)) assetFail('RESOURCE_NOT_FOUND', 404);
  return kind as AssetKind;
}
export const storageKind = (kind: AssetKind) => kind === 'analyses' ? 'analysis' : kind === 'dashboards' ? 'dashboard' : 'prepared-dataset';
export function assetName(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 512 || /[\x00-\x1f]/.test(raw)) assetFail('ASSET_INVALID_INPUT');
  return raw;
}
export function summary(r: MetadataResource) {
  return { kind: r.kind === 'analysis' ? 'analyses' as const : r.kind === 'dashboard' ? 'dashboards' as const : 'datasets' as const,
    id: r.id, name: String(r.kind === 'prepared-dataset' ? object(r.body.resource).name : object(r.body.definition).Name ?? r.id), folderId: r.body.folderId as string | null ?? null };
}
/** Shared, definition-only authorization and transformations for both durable planes. */
export class AssetCatalog {
  constructor(readonly scope: AssetScope, readonly resources: MetadataResource[]) {}
  find(kind: ResourceKey['kind'], id: string, ownerId?: string) { return this.resources.find(r => r.kind === kind && r.id === id && r.ownerId === ownerId); }
  user() { return this.find('user', this.scope.userId) ?? assetFail('UNKNOWN_PRINCIPAL', 403); }
  build() { if (!hasCapability(this.user().body.role as Role, 'build')) assetFail('METADATA_WRITE_FORBIDDEN', 403); }
  allows(grants: unknown, write = false) {
    const groups = this.resources.filter(r => r.kind === 'group' && Array.isArray(r.body.userIds) && r.body.userIds.includes(this.scope.userId)).map(r => r.id);
    return grantAllows(grants, this.scope.userId, groups, this.user().body.role === 'administrator', write);
  }
  allowed(r: MetadataResource, write = false): boolean {
    if ((write || r.kind === 'analysis' || r.kind === 'prepared-dataset') && !hasCapability(this.user().body.role as Role, 'build')) return false;
    if (r.ownerId && r.ownerId !== this.scope.userId) return false;
    const folder = r.body.folderId == null ? undefined : this.find('folder', String(r.body.folderId));
    if (r.body.folderId != null && !folder) return false;
    return this.allows(r.body.grants, write) && this.allows(folder?.body.grants, write);
  }
  require(r: MetadataResource, write = false) {
    if (!this.allowed(r, write)) assetFail(write ? 'METADATA_WRITE_FORBIDDEN' : 'RESOURCE_NOT_FOUND', write ? 403 : 404);
    return r;
  }
  asset(kind: AssetKind, id: string, write = false) {
    const r = this.find(storageKind(kind), id, kind === 'datasets' ? this.scope.userId : undefined) ?? assetFail('RESOURCE_NOT_FOUND', 404);
    return this.require(r, write);
  }
  folder(id: string, write = false) { return this.require(this.find('folder', id) ?? assetFail('RESOURCE_NOT_FOUND', 404), write); }
  destination(id: string | null) {
    if (id === null) return;
    const folder = this.find('folder', id) ?? assetFail('ASSET_FOLDER_NOT_FOUND', 409);
    if (!this.allowed(folder)) assetFail('ASSET_FOLDER_FORBIDDEN', 403);
  }
  list() { return this.resources.filter(r => ['analysis', 'dashboard', 'prepared-dataset'].includes(r.kind) && this.allowed(r)); }
  match(r: MetadataResource, expected: number) { if (r.version !== expected) assetFail('ASSET_PRECONDITION_FAILED', 412); }
  touch(r: MetadataResource) { r.version++; r.body.updatedAt = new Date().toISOString(); }
  grants(raw: unknown): AssetGrant[] | undefined {
    if (raw === null) return undefined;
    if (!Array.isArray(raw) || raw.length > 4096) assetFail('ASSET_INVALID_GRANTS');
    const seen = new Set<string>();
    return raw.map(value => {
      const g = object(value, ['principal', 'role']), p = object(g.principal, ['type', 'id']);
      if (p.type !== 'user' && p.type !== 'group' || g.role !== 'viewer' && g.role !== 'co-owner') assetFail('ASSET_INVALID_GRANTS');
      const id = identifier(p.id), key = `${p.type}/${id}`;
      if (seen.has(key)) assetFail('ASSET_DUPLICATE_PRINCIPAL'); seen.add(key);
      if (!this.find(p.type, id)) assetFail('ASSET_PRINCIPAL_NOT_FOUND', 400);
      return { principal: { type: p.type, id }, role: g.role };
    });
  }
  move(r: MetadataResource, folderId: string | null) { this.require(r, true); this.destination(folderId); r.body.folderId = folderId; this.touch(r); }
  copy(r: MetadataResource, id: string, name: string | undefined, folderId: string | null) {
    this.require(r); this.destination(folderId);
    if (this.find(r.kind, id, r.ownerId)) assetFail('ASSET_ID_CONFLICT', 409);
    if (r.kind !== 'analysis' && r.kind !== 'dashboard') assetFail('ASSET_KIND_UNSUPPORTED', 409);
    const copy = structuredClone(r); copy.id = id; copy.version = 1;
    const { Arn: _arn, AnalysisId: _analysis, DashboardId: _dashboard, Version: _version, ...wire } = object(copy.body.definition);
    copy.body.definition = { ...wire, [r.kind === 'analysis' ? 'AnalysisId' : 'DashboardId']: id, Name: name ?? summary(r).name };
    copy.body.folderId = folderId; copy.body.grants = [{ principal: { type: 'user', id: this.scope.userId }, role: 'co-owner' }];
    if (copy.kind === 'analysis') copy.body.hasHadVisual = wireHasVisuals(copy.body.definition);
    copy.body.updatedAt = new Date().toISOString();
    if (copy.body.published) {
      const published = copy.body.published as DashboardRecord, latest = structuredClone(dashboardVersion(published));
      // A copied publication has its own history and no mutable link to the original analysis.
      latest.version = 1; latest.name = name ?? latest.name;
      copy.body.published = { ...published, id, sourceActive: false, latest: 1, versions: [latest] };
      object(copy.body.definition).Definition = structuredClone(latest.wireDefinition);
    }
    this.resources.push(copy); return copy;
  }
  share(r: MetadataResource, principal: AssetGrant['principal'], role?: AssetGrant['role']) {
    this.require(r, true);
    this.grants([{ principal, role: role ?? 'viewer' }]);
    const grants = (r.body.grants ?? []) as AssetGrant[];
    const matches = (g: AssetGrant) => g.principal.type === principal.type && g.principal.id === principal.id;
    if (!role && !grants.some(matches)) assetFail('RESOURCE_NOT_FOUND', 404);
    const next = [...grants.filter(g => !matches(g)), ...(role ? [{ principal, role }] : [])];
    if (next.length) r.body.grants = next; else delete r.body.grants;
    this.touch(r);
  }
  remove(r: MetadataResource) {
    this.require(r, true);
    if (r.kind === 'folder' && this.resources.some(a => a.body.folderId === r.id)) assetFail('FOLDER_NOT_EMPTY', 409);
    if (r.kind === 'prepared-dataset' && this.resources.some(m => m.kind === 'metric' && assetKey(m.body.dataset as ResourceKey) === assetKey(r))) assetFail('DATASET_DELETE_BLOCKED_BY_METRIC', 409);
    if (r.kind === 'prepared-dataset') {
      for (const analysis of this.resources.filter(a => a.kind === 'analysis')) {
        if (!Array.isArray(analysis.body.datasets)) assetFail('DATASET_REFERENCE_UNRESOLVED', 409);
        if (analysis.body.datasets.some(ref => { const d = object(ref); return d.kind === r.kind && d.id === r.id && d.ownerId === r.ownerId; })) assetFail('DATASET_DELETE_BLOCKED_BY_ANALYSIS', 409);
      }
    }
    if (r.kind === 'prepared-dataset' && this.resources.some(a => a.kind === 'dashboard' && (a.body.published as DashboardRecord | undefined)?.versions.some(v => v.bindingOwnerId === r.ownerId && Object.values(v.datasetBindings).some(b => b.kind === r.kind && b.id === r.id)))) assetFail('ASSET_DELETE_REFERENCED', 409);
    if (r.kind === 'analysis') for (const dashboard of this.resources.filter(a => a.kind === 'dashboard')) {
      const p = dashboard.body.published as DashboardRecord | undefined;
      if (p?.sourceAnalysisId === r.id && p.sourceActive) { p.sourceActive = false; this.touch(dashboard); }
    }
    this.resources.splice(this.resources.indexOf(r), 1);
  }
}
