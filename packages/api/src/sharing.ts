import type { IncomingMessage, ServerResponse } from 'node:http';
import { method, routeId, send } from './automation-routes.js';
import { validateGrants, validateOrganization, type OrganizationService, type OrganizedAsset } from './organization.js';
import { readBody, RequestError, type SalesQuery } from './query.js';
import { record } from './schedule.js';
import type { Identity } from './security.js';

/** Sharing grants access to the definition, never to the sharer's data-policy context. */
export async function sharingRoute(request: IncomingMessage, response: ServerResponse, path: string, query: string, identity: Identity, organization: OrganizationService, sales?: SalesQuery): Promise<boolean> {
  const shares = /^\/(?:api\/)?(analyses|dashboards)\/([^/]+)\/shares(?:\/(user|group)\/([^/]+))?$/.exec(path);
  const visual = /^\/(?:api\/)?(analyses|dashboards)\/([^/]+)\/visuals\/([^/]+)\/query$/.exec(path);
  if (!shares && !visual) return false;
  if (query) throw new RequestError(400, 'Query parameters are not supported');
  const match = (shares ?? visual)!;
  const kind = match[1] === 'analyses' ? 'analysis' : 'dashboard', assetId = routeId(match[2]!);
  if (visual) {
    method(request, response, ['POST']);
    const visualId = routeId(visual[3]!);
    record(await readBody(request), []);
    const definition = organization.requireRead(identity, kind, assetId);
    if (!sales) throw new RequestError(404, 'Dataset has no resolved sales binding');
    const { plan, rows } = await sales.executeVisual(definition.Definition, visualId, undefined, identity);
    send(response, 200, { columns: [...plan.dimensions.map(f => ({ name: f.outputName, type: 'string' })), ...plan.measures.map(f => ({ name: f.outputName, type: 'number' }))], rows });
    return true;
  }
  const service = organization.security;
  service.admin(identity);
  const principalType = shares![3], principalId = shares![4] === undefined ? undefined : routeId(shares![4]);
  const verb = method(request, response, principalId === undefined ? ['GET'] : ['GET', 'PUT', 'DELETE']);
  if (verb === 'GET') {
    const state = service.store.read(); organization.requireRead(identity, kind, assetId, state);
    const grants = organization.asset(state, identity.namespaceId, kind, assetId)?.grants;
    const grant = grants?.find(g => g.principal.type === principalType && g.principal.id === principalId);
    if (principalId !== undefined && !grant) throw new RequestError(404, 'Share not found');
    send(response, 200, principalId === undefined ? { access: grants === undefined ? 'inherited' : 'restricted', grants: grants ?? [] } : grant);
    return true;
  }
  const body = verb === 'PUT' ? record(await readBody(request), ['role']) : undefined;
  const result = await service.store.change(state => {
    service.admin(identity, state); organization.requireRead(identity, kind, assetId, state);
    const grant = body ? validateGrants([{ principal: { type: principalType, id: principalId }, role: body.role }], identity.namespaceId, state)[0]! : undefined;
    let asset = organization.asset(state, identity.namespaceId, kind, assetId);
    const existing = asset?.grants?.find(g => g.principal.type === principalType && g.principal.id === principalId);
    if (!grant && !existing) throw new RequestError(404, 'Share not found');
    if (!asset) {
      asset = { namespaceId: identity.namespaceId, kind, id: assetId, folderId: null } satisfies OrganizedAsset;
      (state.assets ??= []).push(asset);
    }
    asset.grants = (asset.grants ?? []).filter(g => !(g.principal.type === principalType && g.principal.id === principalId));
    if (grant) asset.grants.push(grant);
    validateOrganization(state);
    return grant ?? { deleted: true };
  });
  send(response, 200, result); return true;
}
