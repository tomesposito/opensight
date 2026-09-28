import { isRole } from '@opensight/query-engine';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { method, routeId, send } from './automation-routes.js';
import { readBody, RequestError } from './query.js';
import { id, invalid, record } from './schedule.js';
import { SecurityError, validateSecurityState, type Identity, type SecurityService, type SecurityState, type User } from './security.js';

function label(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 512 || /[\x00-\x1f]/.test(raw)) invalid('$.name', 'expected a name');
  return raw;
}
/** Registry resources are always addressed relative to the authenticated namespace. */
export async function namespaceRoute(request: IncomingMessage, response: ServerResponse, path: string, query: string, identity: Identity, service: SecurityService): Promise<boolean> {
  const match = /^\/api\/(namespaces|users|groups)(?:\/([^/]+))?$/.exec(path);
  if (!match) return false;
  if (query) throw new RequestError(400, 'Query parameters are not supported');
  const kind = match[1]!, resourceId = match[2] === undefined ? undefined : routeId(match[2]);
  const verb = method(request, response, resourceId ? ['GET', 'PUT', 'DELETE'] : ['GET']);
  if (kind !== 'namespaces' || verb !== 'GET') service.admin(identity);
  const list = (state: SecurityState) => kind === 'namespaces' ? state.namespaces.filter(n => n.id === identity.namespaceId)
    : kind === 'users' ? state.users.filter(u => u.namespaceId === identity.namespaceId) : state.groups.filter(g => g.namespaceId === identity.namespaceId);
  const missing = (): never => { throw new RequestError(404, 'Resource not found'); };
  if (verb === 'GET') {
    const items = list(service.store.read()), result = resourceId ? items.find(r => r.id === resourceId) : items;
    if (!result) missing(); send(response, 200, result); return true;
  }
  const body = verb === 'PUT' ? record(await readBody(request), kind === 'users' ? ['name', 'role'] : kind === 'groups' ? ['name', 'userIds'] : ['name']) : undefined;
  const result = await service.store.change(state => {
    service.admin(identity, state);
    const existing = list(state).find(r => r.id === resourceId);
    if (verb === 'DELETE' && !existing) missing();
    if (kind === 'namespaces') {
      if (verb === 'DELETE') {
        if (resourceId === 'default' || state.folders?.some(f => f.namespaceId === resourceId) || state.assets?.some(a => a.namespaceId === resourceId) || service.hasAssets(resourceId!) || state.groups.some(g => g.namespaceId === resourceId) || state.datasets.some(d => d.namespaceId === resourceId) || state.users.some(u => u.namespaceId === resourceId && u.id !== identity.userId)) throw new RequestError(409, 'Namespace must contain only its deleting administrator and no assets or policies');
        state.invitations = state.invitations?.filter(i => i.namespaceId !== resourceId);
        state.namespaces = state.namespaces.filter(n => n.id !== resourceId);
        state.users = state.users.filter(u => u.namespaceId !== resourceId);
      } else {
        if (!existing && state.namespaces.some(n => n.id === resourceId)) missing();
        const resource = { id: resourceId!, name: label(body!.name) };
        if (existing) Object.assign(existing, resource);
        else {
          state.namespaces.push(resource);
          const owner = state.users.find(u => u.namespaceId === identity.namespaceId && u.id === identity.userId)!;
          state.users.push({ ...owner, namespaceId: resourceId!, role: 'administrator' });
        }
      }
    } else if (kind === 'users') {
      const namespaceId = identity.namespaceId;
      if (verb === 'DELETE') {
        if (state.groups.some(g => g.namespaceId === namespaceId && g.userIds.includes(resourceId!)) || referenced(state, namespaceId, 'user', resourceId!)) throw new RequestError(409, 'User is referenced by a group or policy');
        state.users = state.users.filter(u => !(u.namespaceId === namespaceId && u.id === resourceId));
        state.invitations = state.invitations?.filter(i => i.namespaceId !== namespaceId || i.invitedBy !== resourceId);
      } else {
        if (!isRole(body!.role)) invalid('$.role', 'expected a supported role');
        const resource: User = { id: resourceId!, namespaceId, name: label(body!.name), role: body!.role };
        if (state.invitations?.some(i => i.namespaceId === namespaceId && i.id === resourceId)) throw new RequestError(409, 'User has a pending invitation');
        if (existing) Object.assign(existing, resource); else state.users.push(resource);
      }
      if (!state.users.some(u => u.namespaceId === namespaceId && u.role === 'administrator')) throw new RequestError(409, 'Namespace requires an administrator');
    } else {
      const namespaceId = identity.namespaceId;
      if (verb === 'DELETE') {
        if (referenced(state, namespaceId, 'group', resourceId!)) throw new RequestError(409, 'Group is referenced by a policy');
        state.groups = state.groups.filter(g => !(g.namespaceId === namespaceId && g.id === resourceId));
      } else {
        if (!Array.isArray(body!.userIds) || body!.userIds.length > 256) invalid('$.userIds', 'expected user IDs');
        const resource = { id: resourceId!, namespaceId, name: label(body!.name), userIds: body!.userIds.map(v => id(v, '$.userIds')) };
        if (existing) Object.assign(existing, resource); else state.groups.push(resource);
      }
    }
    validateSecurityState(state, service.columns);
    return verb === 'DELETE' ? { deleted: true } : kind === 'namespaces' ? state.namespaces.find(n => n.id === resourceId)! : list(state).find(r => r.id === resourceId)!;
  });
  send(response, 200, result); return true;
}
function referenced(state: SecurityState, namespaceId: string, type: 'user' | 'group', id: string): boolean {
  if (state.assets?.some(a => a.namespaceId === namespaceId && a.grants?.some(g => g.principal.type === type && g.principal.id === id))) return true;
  if (state.folders?.some(f => f.namespaceId === namespaceId && f.grants?.some(g => g.principal.type === type && g.principal.id === id))) return true;
  return state.datasets.filter(d => d.namespaceId === namespaceId).some(d => [...d.rowRules, ...(d.columnGrants ?? [])].some(r => r.principals.some(p => p.type === type && p.id === id)));
}
export function scopePath(path: string, identity: Identity): string {
  const match = /^\/api\/namespaces\/([^/]+)\/(.+)$/.exec(path);
  if (!match) return path;
  if (routeId(match[1]!) !== identity.namespaceId) throw new SecurityError(404, 'RESOURCE_NOT_FOUND', 'Resource not found');
  const suffix = match[2]!;
  return /^(analyses|dashboards)(\/|$)/.test(suffix) ? `/${suffix}` : `/api/${suffix}`;
}
