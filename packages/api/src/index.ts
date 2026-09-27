import { randomUUID } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { DefinitionStore, RESOURCE_ID } from './store.js';
import { QueryEngineError } from '@opensight/query-engine';
import { readQuery, RequestError, SalesQuery } from './query.js';
import { AutomationStore } from './automation-store.js';
import { emptyRefreshState, RefreshService, validateRefreshState } from './refresh.js';
import { Scheduler } from './schedule.js';
import { refreshRoute } from './automation-routes.js';

export interface ApiOptions {
  /** Directory of local fixtures/bundles, or one .qs/.json file. Loaded at startup. */
  dataRoot: string;
  /** A single-process, atomic JSON resource store; omit for ephemeral library use. */
  automationStorePath?: string;
}

/** Loads a complete snapshot before returning an unbound HTTP server. */
export async function createApiServer(options: ApiOptions): Promise<Server> {
  const store = await DefinitionStore.load(options.dataRoot);
  const sales = await SalesQuery.load(options.dataRoot);
  const automation = await AutomationStore.load(emptyRefreshState(), options.automationStorePath, validateRefreshState);
  const refresh = new RefreshService(automation, new Map(sales ? [['sales', sales]] : []));
  await refresh.recover();
  const scheduler = new Scheduler(() => refresh.tick());
  const server = createServer((request, response) => {
    const requestId = randomUUID();
    const error = (status: number, type: string, message: string): void => {
      send(response, status, { Type: type, Message: message, RequestId: requestId });
    };
    const url = request.url ?? '';
    const queryOffset = url.indexOf('?');
    const path = queryOffset === -1 ? url : url.slice(0, queryOffset);
    const query = queryOffset === -1 ? '' : url.slice(queryOffset + 1);
    if (path === '/api/refresh-schedules' || /^\/api\/datasets\/[^/]+\/refresh-/.test(path)) {
      void refreshRoute(request, response, path, query, refresh).then(handled => {
        if (!handled) error(404, 'ResourceNotFoundException', 'Route not found');
      }).catch(cause => {
        request.resume();
        send(response, cause instanceof RequestError ? cause.status : 500, { Message: cause instanceof RequestError ? cause.message : 'Unable to process automation resource' });
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
          if (id !== 'sales' || !sales) throw new RequestError(404, 'Dataset has no resolved local sales CSV binding');
          send(response, 200, await sales.execute(await readQuery(request)));
        } catch (cause) {
          request.resume();
          if (cause instanceof QueryEngineError) send(response, 422, { errorCode: cause.code, message: cause.message, path: cause.path });
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
    const body = store.get(match[1] === 'analyses' ? 'analysis' : 'dashboard', id);
    if (!body) {
      error(404, 'ResourceNotFoundException', 'Definition not found');
      return;
    }
    try {
      send(response, 200, { ...body, RequestId: requestId });
    } catch {
      error(500, 'InternalFailureException', 'Unable to serialize definition');
    }
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
