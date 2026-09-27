import type { IncomingMessage, ServerResponse } from 'node:http';
import { AutomationStore } from './automation-store.js';
import { method, routeId, send } from './automation-routes.js';
import { isObject, type JsonObject } from './mapping.js';
import { readBody, RequestError } from './query.js';
import { id, invalid, record } from './schedule.js';
import type { Identity, SecurityService, SecurityState } from './security.js';
import type { DefinitionStore, ResourceKind } from './store.js';

export interface AssetGrant { principal: { type: 'user' | 'group'; id: string }; role: 'viewer' | 'co-owner' }
export interface Folder { id: string; namespaceId: string; name: string; grants?: AssetGrant[] }
export interface OrganizedAsset {
  id: string; kind: ResourceKind; namespaceId: string; folderId: string | null;
  /** Copies own an immutable definition snapshot; imported assets stay in the startup store. */
  definition?: JsonObject;
  /** Undefined preserves inherited access; an empty list stays private after revocation. */
  grants?: AssetGrant[];
}
export function resourceName(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 512 || /[\x00-\x1f]/.test(raw)) invalid('$.name', 'expected a name');
  return raw;
}
function list(raw: unknown): unknown[] {
  if (!Array.isArray(raw) || raw.length > 4096) invalid('$', 'expected at most 4096 resources');
  return raw;
}
export function validateGrants(raw: unknown, namespaceId: string, state: SecurityState): AssetGrant[] {
  const grants = list(raw).map(value => {
    const g = record(value, ['principal', 'role']);
    const p = record(g.principal, ['type', 'id'], '$.principal');
    if (p.type !== 'user' && p.type !== 'group') invalid('$.principal.type', 'expected user or group');
    const principalId = id(p.id, '$.principal.id');
    if (!(p.type === 'user' ? state.users : state.groups).some(v => v.namespaceId === namespaceId && v.id === principalId)) invalid('$.principal', 'unresolved namespace principal');
    if (g.role !== 'viewer' && g.role !== 'co-owner') invalid('$.role', 'expected viewer or co-owner');
    return { principal: { type: p.type, id: principalId }, role: g.role } as AssetGrant;
  });
  if (new Set(grants.map(g => `${g.principal.type}/${g.principal.id}`)).size !== grants.length) invalid('$.grants', 'duplicate principal');
  return grants;
}
/** Called inside the security store transaction and at startup. */
export function validateOrganization(state: SecurityState): void {
  const folders = list(state.folders ?? []).map(raw => {
    const f = record(raw, ['id', 'namespaceId', 'name', 'grants']);
    const namespaceId = id(f.namespaceId, '$.namespaceId');
    return { id: id(f.id, '$.id'), namespaceId, name: resourceName(f.name), ...(f.grants === undefined ? {} : { grants: validateGrants(f.grants, namespaceId, state) }) };
  });
  const assets = list(state.assets ?? []).map(raw => {
    const a = record(raw, ['id', 'kind', 'namespaceId', 'folderId', 'definition', 'grants']);
    if (a.kind !== 'analysis' && a.kind !== 'dashboard') invalid('$.kind', 'expected analysis or dashboard');
    const assetId = id(a.id, '$.id'), namespaceId = id(a.namespaceId, '$.namespaceId');
    const folderId = a.folderId === null ? null : id(a.folderId, '$.folderId');
    if (folderId !== null && !folders.some(f => f.id === folderId && f.namespaceId === namespaceId)) invalid('$.folderId', 'unresolved folder');
    if (a.definition !== undefined) {
      const d = a.definition;
      if (!isObject(d) || d[a.kind === 'analysis' ? 'AnalysisId' : 'DashboardId'] !== assetId || !isObject(d.Definition)
        || !Array.isArray(d.Definition.DataSetIdentifierDeclarations) || d.Definition.DataSetIdentifierDeclarations.some(v => !isObject(v) || typeof v.Identifier !== 'string' || typeof v.DataSetArn !== 'string')) invalid('$.definition', 'invalid copied definition');
    }
    return { id: assetId, kind: a.kind, namespaceId, folderId, ...(a.grants === undefined ? {} : { grants: validateGrants(a.grants, namespaceId, state) }), ...(a.definition === undefined ? {} : { definition: a.definition as JsonObject }) } as OrganizedAsset;
  });
  for (const resources of [folders, assets]) {
    if (resources.some(r => !state.namespaces.some(n => n.id === r.namespaceId))) invalid('$.namespaceId', 'unknown namespace');
    const keys = resources.map(r => `${r.namespaceId}/${'kind' in r ? r.kind : ''}/${r.id}`);
    if (new Set(keys).size !== keys.length) invalid('$', 'duplicate organization resource');
  }
  if (state.folders !== undefined) state.folders = folders;
  if (state.assets !== undefined) state.assets = assets;
}
export class OrganizationService {
  constructor(readonly security: SecurityService, private readonly sources: ReadonlyMap<string, DefinitionStore>) {
    for (const a of security.store.read().assets ?? []) {
      const imported = sources.get(a.namespaceId)?.get(a.kind, a.id);
      if (a.definition ? imported : !imported) throw new Error('Unresolved or colliding organized asset');
    }
  }
  private store(): AutomationStore<SecurityState> { return this.security.store; }
  asset(state: SecurityState, namespaceId: string, kind: ResourceKind, assetId: string): OrganizedAsset | undefined {
    return state.assets?.find(a => a.namespaceId === namespaceId && a.kind === kind && a.id === assetId);
  }
  definition(namespaceId: string, kind: ResourceKind, assetId: string, state = this.store().read()): JsonObject | undefined {
    return this.asset(state, namespaceId, kind, assetId)?.definition ?? this.sources.get(namespaceId)?.get(kind, assetId);
  }
  grantsAllow(grants: AssetGrant[] | undefined, identity: Identity, state: SecurityState): boolean {
    if (!state.users.some(u => u.namespaceId === identity.namespaceId && u.id === identity.userId)) return false;
    if (state.users.some(u => u.namespaceId === identity.namespaceId && u.id === identity.userId && u.role === 'admin')) return true;
    return grants === undefined || grants.some(g => g.principal.type === 'user' ? g.principal.id === identity.userId
      : state.groups.some(group => group.namespaceId === identity.namespaceId && group.id === g.principal.id && group.userIds.includes(identity.userId)));
  }
  folder(state: SecurityState, identity: Identity, folderId: string): Folder {
    const folder = state.folders?.find(f => f.namespaceId === identity.namespaceId && f.id === folderId);
    if (!folder || !this.grantsAllow(folder.grants, identity, state)) throw new RequestError(404, 'Folder not found');
    return folder;
  }
  canRead(identity: Identity, kind: ResourceKind, assetId: string, state = this.store().read()): boolean {
    if (!this.definition(identity.namespaceId, kind, assetId, state) || !this.grantsAllow(undefined, identity, state)) return false;
    const asset = this.asset(state, identity.namespaceId, kind, assetId);
    const folder = asset?.folderId == null ? undefined : state.folders?.find(f => f.namespaceId === identity.namespaceId && f.id === asset.folderId);
    return asset?.folderId != null && !folder ? false : this.grantsAllow(folder?.grants, identity, state) && this.grantsAllow(asset?.grants, identity, state);
  }
  requireRead(identity: Identity, kind: ResourceKind, assetId: string, state = this.store().read()): JsonObject {
    if (!this.canRead(identity, kind, assetId, state)) throw new RequestError(404, 'Asset not found');
    return this.definition(identity.namespaceId, kind, assetId, state)!;
  }
  list(identity: Identity) {
    const state = this.store().read();
    const copies = (state.assets ?? []).filter(a => a.namespaceId === identity.namespaceId && a.definition).map(a => ({ kind: a.kind, id: a.id, name: typeof a.definition!.Name === 'string' ? a.definition!.Name : a.id }));
    return [...(this.sources.get(identity.namespaceId)?.list() ?? []), ...copies].filter(a => this.canRead(identity, a.kind, a.id, state));
  }
  async route(request: IncomingMessage, response: ServerResponse, path: string, query: string, identity: Identity): Promise<boolean> {
    const folderMatch = /^\/api\/folders(?:\/([^/]+)(?:\/(assets|permissions))?)?$/.exec(path);
    const transfer = /^\/api\/assets\/(analysis|dashboard)\/([^/]+)\/(move|copy)$/.exec(path);
    if (!folderMatch && !transfer) return false;
    if (query) throw new RequestError(400, 'Query parameters are not supported');
    if (transfer) {
      method(request, response, ['POST']); this.security.admin(identity);
      const kind = transfer[1] as ResourceKind, assetId = routeId(transfer[2]!), copy = transfer[3] === 'copy';
      const body = record(await readBody(request), copy ? ['folderId', 'newId', 'name'] : ['folderId']);
      const folderId = body.folderId === null ? null : id(body.folderId, '$.folderId');
      const newId = copy ? id(body.newId, '$.newId') : assetId;
      const name = body.name === undefined ? undefined : resourceName(body.name);
      const result = await this.store().change(state => {
        this.security.admin(identity, state);
        const original = this.requireRead(identity, kind, assetId, state);
        if (folderId !== null) this.folder(state, identity, folderId);
        if (copy && this.definition(identity.namespaceId, kind, newId, state)) throw new RequestError(409, 'Asset ID already exists');
        let asset = copy ? undefined : this.asset(state, identity.namespaceId, kind, assetId);
        if (!asset) { asset = { id: newId, kind, namespaceId: identity.namespaceId, folderId }; (state.assets ??= []).push(asset); }
        asset.folderId = folderId;
        if (copy) {
          const source = this.asset(state, identity.namespaceId, kind, assetId);
          if (source?.grants !== undefined) asset.grants = structuredClone(source.grants);
          // A local copy has its own ID; source ARN/version metadata cannot identify it.
          const { Arn, AnalysisId, DashboardId, Version, ...definition } = structuredClone(original);
          asset.definition = { ...definition, [kind === 'analysis' ? 'AnalysisId' : 'DashboardId']: newId, ...(name === undefined ? {} : { Name: name }) };
        }
        validateOrganization(state);
        return { kind, id: newId, folderId };
      });
      send(response, 200, result); return true;
    }
    const folderId = folderMatch![1] === undefined ? undefined : routeId(folderMatch![1]);
    const sub = folderMatch![2];
    const verb = method(request, response, !folderId || sub === 'assets' ? ['GET'] : sub === 'permissions' ? ['GET', 'PUT'] : ['GET', 'PUT', 'DELETE']);
    if (verb === 'GET') {
      const state = this.store().read();
      if (!folderId) send(response, 200, (state.folders ?? []).filter(f => f.namespaceId === identity.namespaceId && this.grantsAllow(f.grants, identity, state)).map(({ grants, ...f }) => f));
      else {
        const folder = this.folder(state, identity, folderId);
        if (sub === 'permissions') { this.security.admin(identity); send(response, 200, { inheritedFrom: identity.namespaceId, grants: folder.grants ?? null }); }
        else if (sub === 'assets') send(response, 200, this.list(identity).filter(a => this.asset(state, identity.namespaceId, a.kind, a.id)?.folderId === folderId));
        else { const { grants, ...resource } = folder; send(response, 200, resource); }
      }
      return true;
    }
    this.security.admin(identity);
    const body = verb === 'PUT' ? record(await readBody(request), sub === 'permissions' ? ['grants'] : ['name']) : undefined;
    const result = await this.store().change(state => {
      this.security.admin(identity, state);
      const existing = state.folders?.find(f => f.namespaceId === identity.namespaceId && f.id === folderId);
      if ((verb === 'DELETE' || sub) && !existing) throw new RequestError(404, 'Folder not found');
      if (verb === 'DELETE') {
        if (state.assets?.some(a => a.namespaceId === identity.namespaceId && a.folderId === folderId)) throw new RequestError(409, 'Folder must be empty');
        state.folders = state.folders!.filter(f => f !== existing);
        return { deleted: true };
      }
      if (sub === 'permissions') {
        if (body!.grants === null) delete existing!.grants;
        else existing!.grants = validateGrants(body!.grants, identity.namespaceId, state);
        return { inheritedFrom: identity.namespaceId, grants: existing!.grants ?? null };
      }
      const folder: Folder = { id: folderId!, namespaceId: identity.namespaceId, name: resourceName(body!.name) };
      if (existing) existing.name = folder.name; else (state.folders ??= []).push(folder);
      validateOrganization(state);
      return folder;
    });
    send(response, 200, result); return true;
  }
}
