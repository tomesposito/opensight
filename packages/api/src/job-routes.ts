import type { IncomingMessage, ServerResponse } from 'node:http';
import { method, send } from './automation-routes.js';
import { readBody } from './query.js';
import { object } from './metadata-resources.js';
import type { TenantContext } from './metadata.js';
import { JobStore } from './job-store.js';
import type { JobExecutor } from './job-renderer.js';
import type { MailTransport } from './mail.js';

export async function jobRoute(request: IncomingMessage, response: ServerResponse, path: string, context: TenantContext, store: JobStore, executor: JobExecutor, mail: MailTransport): Promise<boolean> {
  if (path === '/api/automation-status') {
    method(request, response, ['GET']); await store.checked(context, async () => {});
    send(response, 200, { scheduler: 'single-api-process', smtp: mail.configured ? 'configured' : 'not-configured', persistence: 'durable', delivery: 'at-least-once' }); return true;
  }
  if (path === '/api/job-recipients') { method(request, response, ['GET']); send(response, 200, await store.recipients(context)); return true; }
  if (path === '/api/jobs') { method(request, response, ['GET']); send(response, 200, await store.list(context)); return true; }
  const match = /^\/api\/jobs\/([A-Za-z0-9_-]{1,512})(?:\/(runs|deliveries))?$/.exec(path);
  if (!match) return false;
  const id = match[1]!, action = match[2];
  if (action === 'runs') {
    method(request, response, ['GET', 'POST']);
    if (request.method === 'POST') { object(await readBody(request), []); send(response, 202, await store.enqueue(context, id)); }
    else send(response, 200, await store.history(context, id));
  } else if (action === 'deliveries') { method(request, response, ['GET']); send(response, 200, await store.deliveries(context, id)); }
  else {
    method(request, response, ['GET', 'PUT', 'DELETE']);
    if (request.method === 'GET') send(response, 200, await store.get(context, id));
    else if (request.method === 'DELETE') {
      const b = object(await readBody(request), ['expectedVersion']); await store.stop(context, id, b.expectedVersion as number); send(response, 200, { stopped: true });
    } else {
      const b = object(await readBody(request), ['spec', 'expectedVersion']);
      send(response, 200, await store.put(context, id, b.spec, b.expectedVersion as number, async (owner, spec) => {
        await executor.authorize(owner, spec);
        if (spec.kind !== 'refresh') for (const id of spec.recipients) await executor.authorize(await store.context(owner, id), spec);
      }));
    }
  }
  return true;
}
