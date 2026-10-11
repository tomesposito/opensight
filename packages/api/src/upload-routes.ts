import type { IncomingMessage, ServerResponse } from 'node:http';
import { method, send } from './automation-routes.js';
import { readBody } from './query.js';
import { MetadataError } from './metadata-db.js';
import type { TenantContext } from './metadata.js';
import { DurableUploads } from './durable-uploads.js';

/** Only the invocation adapter installs these routes and negotiates their capability. */
export class DurableUploadRoutes {
  constructor(private readonly uploads: DurableUploads) {}
  async route(request: IncomingMessage, response: ServerResponse, path: string, context: TenantContext, recheck: () => Promise<void>): Promise<boolean> {
    const key = () => {
      const value = request.headers['idempotency-key'];
      if (typeof value !== 'string') throw new MetadataError('IDEMPOTENCY_KEY_REQUIRED', 400); return value;
    };
    if (path === '/api/uploads/reservations') {
      method(request, response, ['POST']); send(response, 201, await this.uploads.reserve(context, await readBody(request), key(), recheck)); return true;
    }
    const reservation = /^\/api\/uploads\/reservations\/([A-Za-z0-9_-]+)(?:\/(complete))?$/.exec(path);
    if (reservation) {
      const id = reservation[1]!;
      if (reservation[2]) {
        method(request, response, ['POST']); send(response, 202, await this.uploads.complete(context, id, await readBody(request), key(), recheck));
      } else {
        method(request, response, ['GET', 'DELETE']);
        send(response, 200, request.method === 'GET' ? await this.uploads.reservation(context, id, recheck)
          : await this.uploads.cancel(context, 'reservation', id, await readBody(request), recheck));
      }
      return true;
    }
    const operation = /^\/api\/operations\/([A-Za-z0-9_-]+)$/.exec(path);
    if (operation) {
      method(request, response, ['GET', 'DELETE']);
      send(response, 200, request.method === 'GET' ? await this.uploads.status(context, operation[1]!, recheck)
        : await this.uploads.cancel(context, 'operation', operation[1]!, await readBody(request), recheck)); return true;
    }
    return false;
  }
}
