import { prepFail } from '@opensight/bundle-parser/prep';
import type { PrepSource, PrepPreview, PrepPreviewOptions } from '@opensight/query-engine';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { connectors, connectorState, connectConnector, ConnectorError, UploadStaging, UploadError, type UploadColumn } from '@opensight/query-engine';
import { readBody, RequestError } from './query.js';
import { method } from './automation-routes.js';
import type { Identity } from './security.js';

function record(raw: unknown, allowed: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !allowed.includes(k))) throw new RequestError(400, 'Invalid connector request fields');
  return raw as Record<string, unknown>;
}
function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body));
}
/** Staging is private to an authenticated user and namespace, and lasts until restart. */
export class ConnectorRoutes {
  private readonly sessions = new Map<string, Promise<UploadStaging>>();
  private readonly queues = new Map<string, Promise<unknown>>();
  async route(request: IncomingMessage, response: ServerResponse, path: string, query: string, identity: Identity): Promise<void> {
    try {
      if (query) throw new RequestError(400, 'Query parameters are not supported');
      if (path === '/api/connectors') {
        method(request, response, ['GET']);
        send(response, 200, connectors.map(c => ({ ...c, availability: connectorState(c.id, true) }))); return;
      }
      const connect = /^\/api\/connectors\/([a-z0-9-]+)\/connect$/.exec(path);
      if (connect) {
        method(request, response, ['POST']); const body = record(await readBody(request), ['config']);
        send(response, 200, connectConnector(connect[1]!, body.config, true)); return;
      }
      const owner = JSON.stringify([identity.namespaceId, identity.userId]);
      if (path === '/api/uploads') {
        method(request, response, ['POST']);
        const body = record(await readBody(request), ['config', 'base64', 'columns']);
        if (typeof body.base64 !== 'string' || !body.base64.length || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.base64)) throw new UploadError('INVALID_UPLOAD', '$.base64', 'Expected canonical base64 file bytes');
        const data = Buffer.from(body.base64, 'base64');
        if (data.toString('base64') !== body.base64) throw new UploadError('INVALID_UPLOAD', '$.base64', 'Expected canonical base64 file bytes');
        let session = this.sessions.get(owner);
        if (!session) {
          if (this.sessions.size >= 32) throw new UploadError('UPLOAD_LIMIT_EXCEEDED', '$.uploads', 'Server staging session limit reached');
          session = UploadStaging.create(); this.sessions.set(owner, session);
          void session.catch(() => this.sessions.delete(owner));
        }
        const selected = session;
        const operation = (this.queues.get(owner) ?? Promise.resolve()).catch(() => undefined).then(async () => (await selected).ingest({ config: body.config, data, ...(body.columns === undefined ? {} : { columns: body.columns as UploadColumn[] }) }));
        this.queues.set(owner, operation);
        try { send(response, 201, await operation); } finally { if (this.queues.get(owner) === operation) this.queues.delete(owner); }
        return;
      }
      const preview = /^\/api\/uploads\/(upload_[a-f0-9]{32})$/.exec(path);
      if (preview) {
        method(request, response, ['GET']);
        const session = this.sessions.get(owner);
        if (!session) throw new UploadError('UPLOAD_NOT_FOUND', '$.id', 'Upload not found');
        send(response, 200, await (await session).preview(preview[1]!)); return;
      }
      throw new RequestError(404, 'Connector resource not found');
    } catch (error) {
      if (error instanceof ConnectorError || error instanceof UploadError) {
        request.resume();
        send(response, error.code === 'UPLOAD_NOT_FOUND' || error.code === 'UNKNOWN_CONNECTOR' ? 404 : error.code === 'UPLOAD_LIMIT_EXCEEDED' ? 413 : error.code === 'UPLOAD_STAGING_FAILED' ? 500 : 400, { errorCode: error.code, Message: error.message, path: error.path }); return;
      }
      throw error;
    }
  }
  async prepSources(identity: Identity): Promise<PrepSource[]> {
    const session = this.sessions.get(JSON.stringify([identity.namespaceId, identity.userId]));
    return session ? (await session).prepSources() : [];
  }
  async previewPrep(identity: Identity, raw: unknown, options: PrepPreviewOptions): Promise<PrepPreview> {
    const owner = JSON.stringify([identity.namespaceId, identity.userId]), session = this.sessions.get(owner);
    if (!session) prepFail('PREP_SOURCE_NOT_FOUND', '$.input', 'Upload staging is unavailable; upload the source again');
    const operation = (this.queues.get(owner) ?? Promise.resolve()).catch(() => undefined).then(async () => (await session).previewPrep(raw, options));
    this.queues.set(owner, operation);
    try { return await operation; } finally { if (this.queues.get(owner) === operation) this.queues.delete(owner); }
  }
  async close(): Promise<void> {
    await Promise.allSettled(this.queues.values());
    for (const result of await Promise.allSettled(this.sessions.values())) if (result.status === 'fulfilled') result.value.close();
    this.sessions.clear(); this.queues.clear();
  }
}
