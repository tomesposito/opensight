import { DigestComputation } from './digest-computation.js';
import type { HostedData } from './hosted-data.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { method, send } from './automation-routes.js';
import { readBody } from './query.js';
import type { DigestStore } from './digest-store.js';
import type { TenantContext } from './metadata.js';
import { MetadataError } from './metadata-db.js';

const id = '[A-Za-z0-9_-]{1,512}';
export const digestPath = (path: string) => new RegExp(`^/api/v1/(?:metrics/${id}/subscriptions|metric-subscriptions/${id}(?:/preview)?)$`).test(path);
export async function digestRoute(request: IncomingMessage, response: ServerResponse, path: string, context: TenantContext, store: DigestStore, data: HostedData) {
  const list = new RegExp(`^/api/v1/metrics/(${id})/subscriptions$`).exec(path);
  if (list) {
    method(request, response, ['GET', 'POST']);
    if (request.method === 'POST') send(response, 201, await store.create(context, list[1]!, await readBody(request)));
    else send(response, 200, { items: await store.list(context, list[1]!) });
    return;
  }
  const preview = new RegExp(`^/api/v1/metric-subscriptions/(${id})/preview$`).exec(path);
  if (preview) {
    method(request, response, ['GET']);
    const job = await store.jobs.get(context, preview[1]!);
    if (job.spec.kind !== 'digest' || job.spec.subscriberId !== context.userId) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
    await data.sources.metadata.usage?.consume(data.sources.metadata, context, 'computeAttempts');
    send(response, 200, await new DigestComputation(data).compute(context, job.spec, store.jobs.clock())); return;
  }
  const remove = new RegExp(`^/api/v1/metric-subscriptions/(${id})$`).exec(path);
  if (!remove) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
  method(request, response, ['DELETE']); await store.remove(context, remove[1]!); send(response, 200, { unsubscribed: true });
}
export const unsubscribePath = (path: string) => new RegExp(`^/api/v1/metric-unsubscribe/(${id})/(${id})/(${id})/([a-f0-9]{64})$`).exec(path);
export async function unsubscribeRoute(request: IncomingMessage, response: ServerResponse, path: string, store: DigestStore): Promise<boolean> {
  const match = unsubscribePath(path); if (!match) return false;
  method(request, response, ['GET', 'POST']);
  await store.unsubscribe({ tenantId: match[1]!, namespaceId: match[2]! }, match[3]!, match[4]!);
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
  response.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Unsubscribed</title><h1>Unsubscribed</h1><p>This metric digest subscription has stopped.</p></html>'); return true;
}
