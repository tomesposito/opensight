import { namespaceRoute, scopePath } from './namespace-routes.js';
import { SecurityService, SecurityError, type SecurityOptions } from './security.js';
import { randomUUID } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { DefinitionStore, RESOURCE_ID } from './store.js';
import { QueryEngineError } from '@opensight/query-engine';
import { readQuery, RequestError, SalesQuery } from './query.js';
import { AutomationStore } from './automation-store.js';
import { emptyRefreshState, RefreshService, validateRefreshState } from './refresh.js';
import { Scheduler } from './schedule.js';
import { AlertService, DashboardMetrics } from './alerts.js';
import { DashboardSnapshots, ReportService } from './reports.js';
import { smtpFromEnvironment, type MailTransport } from './mail.js';
import { refreshRoute, reportRoute, alertRoute, method } from './automation-routes.js';

export interface ApiOptions {
  security?: SecurityOptions;
  /** Trusted startup roots. Unconfigured namespaces start empty; IDs never become paths. */
  namespaceDataRoots?: Readonly<Record<string, string>>;
  /** Directory of local fixtures/bundles, or one .qs/.json file. Loaded at startup. */
  dataRoot: string;
  /** A single-process, atomic JSON resource store; omit for ephemeral library use. */
  automationStorePath?: string;
  /** Inject a stub in tests. Real SMTP configuration is environment-only. */
  mailTransport?: MailTransport;
}

/** Loads a complete snapshot before returning an unbound HTTP server. */
export async function createApiServer(options: ApiOptions): Promise<Server> {
  const store = await DefinitionStore.load(options.dataRoot);
  const sales = await SalesQuery.load(options.dataRoot);
  const schema = options.security && sales ? sales.securitySchema() : undefined;
  const security = options.security ? await SecurityService.load(options.security, schema?.columns ?? [], schema?.localData.dataSetArn ?? '') : undefined;
  if (sales) sales.security = security;
  const namespaceStores = new Map([['default', store]]);
  const namespaceQueries = new Map([['default', sales]]);
  for (const [namespaceId, root] of Object.entries(options.namespaceDataRoots ?? {})) {
    if (!security || namespaceId === 'default' || !RESOURCE_ID.test(namespaceId) || !security.store.read().namespaces.some(n => n.id === namespaceId)) throw new Error('Namespace data root requires a registered non-default namespace');
    const definitions = await DefinitionStore.load(root), source = await SalesQuery.load(root);
    if (source && JSON.stringify(source.securitySchema().columns) !== JSON.stringify(schema?.columns)) throw new Error('Namespace sales schemas must match the configured sales binding');
    if (source) source.security = security;
    namespaceStores.set(namespaceId, definitions); namespaceQueries.set(namespaceId, source);
  }
  if (security) security.hasAssets = namespaceId => !!namespaceStores.get(namespaceId)?.list().length || !!namespaceQueries.get(namespaceId);
  const automation = await AutomationStore.load(emptyRefreshState(), options.automationStorePath, validateRefreshState);
  const refresh = new RefreshService(automation, new Map(sales ? [['sales', sales]] : []));
  await refresh.recover();
  const mail = options.mailTransport ?? smtpFromEnvironment();
  const reports = new ReportService(automation, new DashboardSnapshots(store, sales), mail);
  await reports.recover();
  const alerts = new AlertService(automation, new DashboardMetrics(store, sales), mail);
  await alerts.recover();
  refresh.onSuccess = (datasetId, run) => alerts.afterRefresh(datasetId, run);
  const scheduler = new Scheduler(async () => { await refresh.tick(); await reports.tick(); });
  const server = createServer((request, response) => {
    void (async () => {
      const requestId = randomUUID();
      const error = (status: number, type: string, message: string): void => {
        send(response, status, { Type: type, Message: message, RequestId: requestId });
      };
      const url = request.url ?? '';
      const queryOffset = url.indexOf('?');
      let path = queryOffset === -1 ? url : url.slice(0, queryOffset);
      const query = queryOffset === -1 ? '' : url.slice(queryOffset + 1);
      if (['x-user', 'x-user-id', 'x-principal', 'x-groups', 'x-group-ids', 'x-namespace', 'x-namespace-id'].some(k => request.headers[k] !== undefined)) throw new SecurityError(403, 'FORGED_PRINCIPAL', 'Caller-supplied principal headers are not supported');
      if (!security && request.headers.authorization) throw new SecurityError(503, 'SECURITY_NOT_CONFIGURED', 'Credential verification is not configured');
      const identity = await security?.authenticate(request);
      if (identity) path = scopePath(path, identity);
      const namespaceId = identity?.namespaceId ?? 'default';
      const scopedStore = namespaceStores.get(namespaceId), scopedSales = namespaceQueries.get(namespaceId);
      if (/^\/api\/(namespaces|groups|users)(?:\/[^/]+)?$/.test(path)) {
        if (!security || !identity) throw new SecurityError(503, 'SECURITY_NOT_CONFIGURED', 'Needs a hosted API with authentication configured');
        if (await namespaceRoute(request, response, path, query, identity, security)) return;
      }
      if (['/api/assets', '/analyses', '/dashboards', '/api/datasets'].includes(path)) {
        method(request, response, ['GET']);
        if (query) throw new RequestError(400, 'Query parameters are not supported');
        const assets = [...(scopedStore?.list() ?? []), ...(scopedSales ? [{ kind: 'dataset', id: 'sales', name: 'Sales' }] : [])];
        send(response, 200, assets.filter(a => path === '/api/assets' || path === '/analyses' && a.kind === 'analysis' || path === '/dashboards' && a.kind === 'dashboard' || path === '/api/datasets' && a.kind === 'dataset'));
        return;
      }
      if (/^\/api\/datasets\/[^/]+\/(row-rules|column-grants)/.test(path)) {
        if (!security || !identity) throw new SecurityError(503, 'SECURITY_NOT_CONFIGURED', 'Needs a hosted API with authentication configured');
        if (!scopedSales) throw new RequestError(404, 'Dataset not found');
        if (await security.route(request, response, path, query, identity)) return;
      }
      if (path === '/api/automation-status' || path.startsWith('/api/users/') || path.startsWith('/api/alert-rules') || path === '/api/refresh-schedules' || /^\/api\/datasets\/[^/]+\/refresh-/.test(path)) {
        if (security && identity) {
          if (namespaceId !== 'default') throw new SecurityError(404, 'RESOURCE_NOT_FOUND', 'Resource not found');
          security.admin(identity);
        }
        void (async () => {
          if (path === '/api/automation-status') {
            method(request, response, ['GET']);
            if (query) throw new RequestError(400, 'Query parameters are not supported');
            send(response, 200, { scheduler: 'api-process', smtp: mail.configured ? 'configured' : 'not-configured', persistence: options.automationStorePath ? 'file' : 'ephemeral' });
            return true;
          }
          return await refreshRoute(request, response, path, query, refresh) || await reportRoute(request, response, path, query, reports) || await alertRoute(request, response, path, query, alerts);
        })().then(handled => {
          if (!handled) error(404, 'ResourceNotFoundException', 'Route not found');
        }).catch(cause => {
          request.resume();
          if (cause instanceof QueryEngineError) send(response, 422, { errorCode: cause.code, message: cause.message, path: cause.path });
          else send(response, cause instanceof RequestError ? cause.status : 500, { Message: cause instanceof RequestError ? cause.message : 'Unable to process automation resource' });
        });
        return;
      }
      const queryMatch = /^\/api\/datasets\/([^/]+)\/query$/u.exec(path);
      if (queryMatch) {
        void (async () => {
          try {
            if (request.method !== 'POST') {
              response.setHeader('Allow', 'POST');
              throw new RequestError(405, 'Only POST is supported');
            }
            let id: string;
            try { id = decodeURIComponent(queryMatch[1]!); }
            catch { throw new RequestError(400, 'Invalid dataset ID encoding'); }
            if (!RESOURCE_ID.test(id)) throw new RequestError(400, 'Invalid dataset ID');
            if (query) throw new RequestError(400, 'Query parameters are not supported');
            if (id !== 'sales' || !scopedSales) throw new RequestError(404, 'Dataset has no resolved local sales CSV binding');
            send(response, 200, await scopedSales.execute(await readQuery(request), identity));
          } catch (cause) {
            request.resume();
            if (cause instanceof QueryEngineError) send(response, 422, { errorCode: cause.code, message: cause.message, path: cause.path });
            else if (cause instanceof SecurityError) send(response, cause.status, { errorCode: cause.code, Message: cause.message });
            else if (cause instanceof RequestError) send(response, cause.status, { Message: cause.message });
            else send(response, 500, { Message: 'Unable to execute local query' });
          }
        })();
        return;
      }
      const match = /^\/(analyses|dashboards)\/([^/]+)\/definition$/u.exec(path);
      if (!match) {
        error(404, 'ResourceNotFoundException', 'Route not found');
        return;
      }
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        error(405, 'MethodNotAllowed', 'Only GET is supported');
        return;
      }
      let id: string;
      try {
        id = decodeURIComponent(match[2]!);
      } catch {
        error(400, 'InvalidParameterValueException', 'Invalid resource ID encoding');
        return;
      }
      if (!RESOURCE_ID.test(id)) {
        error(400, 'InvalidParameterValueException', 'Invalid resource ID');
        return;
      }
      // Version/alias selection and other query semantics have no local implementation.
      if (query !== '') {
        error(400, 'InvalidParameterValueException', 'Query parameters are not supported');
        return;
      }
      const body = scopedStore?.get(match[1] === 'analyses' ? 'analysis' : 'dashboard', id);
      if (!body) {
        error(404, 'ResourceNotFoundException', 'Definition not found');
        return;
      }
      try {
        send(response, 200, { ...body, RequestId: requestId });
      } catch {
        error(500, 'InternalFailureException', 'Unable to serialize definition');
      }
    })().catch(cause => {
      request.resume();
      if (cause instanceof SecurityError) send(response, cause.status, { errorCode: cause.code, Message: cause.message });
      else if (cause instanceof RequestError) send(response, cause.status, { Message: cause.message });
      else send(response, 500, { Message: 'Unable to process request' });
    });
  });
  server.once('listening', () => scheduler.start());
  server.once('close', () => scheduler.stop());
  return server;
}

function send(response: ServerResponse, status: number, body: object): void {
  // Serialize before committing headers so failures can still return JSON/500.
  const json = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(json);
}

export { StubMailTransport } from './mail.js';
export type { MailTransport, MailMessage } from './mail.js';

export { emptySecurityState } from './security.js';
export type { SecurityOptions, SecurityState, Identity } from './security.js';
