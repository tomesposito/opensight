import type { IncomingMessage, ServerResponse } from 'node:http';
import { method, send } from './automation-routes.js';
import { readBody, validateQuery, RequestError, type SalesQuery } from './query.js';
import { SecurityError, type SecurityService, type Identity } from './security.js';
import type { OrganizationService } from './organization.js';
import { id, record } from './schedule.js';
import { isObject } from './mapping.js';

/** Reader AI requests must name an accessible published dashboard bound to this dataset. */
export function requireOScope(body: Record<string, unknown>, identity: Identity, security: SecurityService, organization: OrganizationService, sales?: SalesQuery): void {
  security.require(identity, 'ai');
  if (body.dashboardId === undefined) security.require(identity, 'build');
  else {
    const definition = organization.requireRead(identity, 'dashboard', id(body.dashboardId, '$.dashboardId'));
    const declarations = isObject(definition.Definition) ? definition.Definition.DataSetIdentifierDeclarations : undefined;
    if (!sales || !Array.isArray(declarations) || !declarations.some(d => isObject(d) && d.DataSetArn === sales.securitySchema().localData.dataSetArn)) throw new SecurityError(403, 'SECURITY_DATASET_SCOPE', 'Dashboard has no resolved sales dataset');
  }
  if (!sales) throw new RequestError(404, 'Dataset has no resolved local sales binding');
}
export async function oRoute(request: IncomingMessage, response: ServerResponse, path: string, query: string, identity: Identity, security: SecurityService, organization: OrganizationService, sales?: SalesQuery): Promise<boolean> {
  if (path !== '/api/o/query') return false;
  security.require(identity, 'ai');
  method(request, response, ['POST']);
  if (query) throw new RequestError(400, 'Query parameters are not supported');
  const body = record(await readBody(request), ['dashboardId', 'query']);
  requireOScope(body, identity, security, organization, sales);
  send(response, 200, await sales!.execute(validateQuery(body.query), identity));
  return true;
}
