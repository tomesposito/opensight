import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, RequestError } from './query.js';
import { id } from './schedule.js';
import type { RefreshService } from './refresh.js';

export function send(response: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(json);
}
export function method(request: IncomingMessage, response: ServerResponse, allowed: string[]): string {
  if (!allowed.includes(request.method ?? '')) {
    response.setHeader('Allow', allowed.join(', ')); throw new RequestError(405, `Supported methods: ${allowed.join(', ')}`);
  }
  return request.method!;
}
export function routeId(raw: string): string {
  try { return id(decodeURIComponent(raw), '$.id'); }
  catch { throw new RequestError(400, 'Invalid resource ID'); }
}
export async function refreshRoute(request: IncomingMessage, response: ServerResponse, path: string, query: string, refresh: RefreshService): Promise<boolean> {
  const match = /^\/api\/datasets\/([^/]+)\/(refresh-schedule|refresh-status|refresh-runs)(?:\/([^/]+))?$/u.exec(path);
  if (path !== '/api/refresh-schedules' && !match) return false;
  if (query) throw new RequestError(400, 'Query parameters are not supported');
  if (!match) { method(request, response, ['GET']); send(response, 200, refresh.list()); return true; }
  const datasetId = routeId(match[1]!), resource = match[2]!, runId = match[3] === undefined ? undefined : routeId(match[3]);
  if (runId && resource !== 'refresh-runs') throw new RequestError(404, 'Route not found');
  if (resource === 'refresh-status') { method(request, response, ['GET']); send(response, 200, refresh.getStatus(datasetId)); }
  else if (resource === 'refresh-runs') {
    const verb = method(request, response, runId ? ['GET'] : ['GET', 'POST']);
    if (verb === 'POST') send(response, 200, await refresh.run(datasetId));
    else {
      const runs = refresh.history(datasetId), result = runId ? runs.find(r => r.id === runId) : runs;
      if (!result) throw new RequestError(404, 'Refresh run not found');
      send(response, 200, result);
    }
  } else {
    const verb = method(request, response, ['GET', 'PUT', 'DELETE']);
    if (verb === 'PUT') send(response, 200, await refresh.put(datasetId, await readBody(request)));
    else if (verb === 'DELETE') { await refresh.remove(datasetId); send(response, 200, { deleted: true }); }
    else {
      const schedule = refresh.list().find(s => s.datasetId === datasetId);
      if (!schedule) throw new RequestError(404, 'Refresh schedule not found');
      send(response, 200, schedule);
    }
  }
  return true;
}

export async function reportRoute(request: IncomingMessage, response: ServerResponse, path: string, query: string, reports: import('./reports.js').ReportService): Promise<boolean> {
  const match = /^\/api\/users\/([^/]+)\/subscriptions(?:\/([^/]+)(?:\/(runs)(?:\/([^/]+))?)?)?$/u.exec(path);
  if (!match) return false;
  if (query) throw new RequestError(400, 'Query parameters are not supported');
  const userId = routeId(match[1]!), subscriptionId = match[2] ? routeId(match[2]) : undefined;
  if (!subscriptionId) { method(request, response, ['GET']); send(response, 200, reports.list(userId)); }
  else if (match[3]) {
    const runId = match[4] ? routeId(match[4]) : undefined;
    const verb = method(request, response, runId ? ['GET'] : ['GET', 'POST']);
    if (verb === 'POST') send(response, 200, await reports.run(userId, subscriptionId));
    else {
      const runs = reports.history(userId, subscriptionId), result = runId ? runs.find(r => r.id === runId) : runs;
      if (!result) throw new RequestError(404, 'Report run not found');
      send(response, 200, result);
    }
  } else {
    const verb = method(request, response, ['GET', 'PUT', 'DELETE']);
    if (verb === 'PUT') send(response, 200, await reports.put(userId, subscriptionId, await readBody(request)));
    else if (verb === 'DELETE') { await reports.remove(userId, subscriptionId); send(response, 200, { deleted: true }); }
    else send(response, 200, reports.get(userId, subscriptionId));
  }
  return true;
}

export async function alertRoute(request: IncomingMessage, response: ServerResponse, path: string, query: string, alerts: import('./alerts.js').AlertService): Promise<boolean> {
  const match = /^\/api\/alert-rules(?:\/([^/]+)(?:\/(runs|state|transitions)(?:\/([^/]+))?)?)?$/u.exec(path);
  if (!match) return false;
  if (query) throw new RequestError(400, 'Query parameters are not supported');
  const ruleId = match[1] ? routeId(match[1]) : undefined;
  if (!ruleId) { method(request, response, ['GET']); send(response, 200, alerts.list()); }
  else if (match[2]) {
    method(request, response, ['GET']);
    if (match[4] || match[3] && match[2] !== 'runs') throw new RequestError(404, 'Route not found');
    if (match[2] === 'state') send(response, 200, alerts.state(ruleId));
    else if (match[2] === 'transitions') send(response, 200, alerts.transitions(ruleId));
    else {
      const runs = alerts.history(ruleId), runId = match[3] ? routeId(match[3]) : undefined;
      const result = runId ? runs.find(r => r.id === runId) : runs;
      if (!result) throw new RequestError(404, 'Alert run not found');
      send(response, 200, result);
    }
  } else {
    const verb = method(request, response, ['GET', 'PUT', 'DELETE']);
    if (verb === 'PUT') send(response, 200, await alerts.put(ruleId, await readBody(request)));
    else if (verb === 'DELETE') { await alerts.remove(ruleId); send(response, 200, { deleted: true }); }
    else send(response, 200, alerts.get(ruleId));
  }
  return true;
}
