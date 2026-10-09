import { streamPrepDuckDb, previewPrepDuckDb, withPrepMemory, type PrepSink, type PrepReadLimits, type PrepMemoryTable } from '@opensight/query-engine';
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
/** Authenticated owner staging, or an explicitly enabled shared local workspace. */
export class ConnectorRoutes {
  constructor(private readonly local = false) {}
  async openLocal(databasePath: string): Promise<void> {
    if (!this.local) throw new Error('LOCAL_DATA_MODE_CONFLICT');
    const session = await UploadStaging.create({ ttlMs: 24 * 60 * 60 * 1000 }, databasePath);
    this.sessions.set(JSON.stringify(['local', 'local']), Promise.resolve(session));
  }
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
        const body = record(await readBody(request, this.local ? 12 * 1024 * 1024 : undefined), ['config', 'base64', 'columns']);
        // Avoid a repeated-group regexp over megabytes of attacker-controlled input.
        if (typeof body.base64 !== 'string' || !body.base64.length || body.base64.length % 4 || /[^A-Za-z0-9+/=]/.test(body.base64)) throw new UploadError('INVALID_UPLOAD', '$.base64', 'Expected canonical base64 file bytes');
        if (body.base64.length > 4 * Math.ceil(8 * 1024 * 1024 / 3)) throw new UploadError('UPLOAD_LIMIT_EXCEEDED', '$.base64', 'File exceeds 8 MiB');
        const data = Buffer.from(body.base64, 'base64');
        if (data.byteLength > 8 * 1024 * 1024) throw new UploadError('UPLOAD_LIMIT_EXCEEDED', '$.base64', 'File exceeds 8 MiB');
        if (data.toString('base64') !== body.base64) throw new UploadError('INVALID_UPLOAD', '$.base64', 'Expected canonical base64 file bytes');
        let session = this.sessions.get(owner);
        if (!session) {
          if (this.sessions.size >= 32) throw new UploadError('UPLOAD_LIMIT_EXCEEDED', '$.uploads', 'Server staging session limit reached');
          session = UploadStaging.create(this.local ? { ttlMs: 24 * 60 * 60 * 1000 } : undefined); this.sessions.set(owner, session);
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
        send(response, 200, await this.queued(owner, async () => (await session).preview(preview[1]!))); return;
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
  private async queued<T>(owner: string, work: () => Promise<T>): Promise<T> {
    const operation = (this.queues.get(owner) ?? Promise.resolve()).catch(() => undefined).then(work);
    this.queues.set(owner, operation);
    try { return await operation; } finally { if (this.queues.get(owner) === operation) this.queues.delete(owner); }
  }
  async expire(): Promise<void> {
    for (const [owner, session] of this.sessions) await this.queued(owner, async () => (await session).expire());
  }
  async prepSources(identity: Identity): Promise<PrepSource[]> {
    const session = this.sessions.get(JSON.stringify([identity.namespaceId, identity.userId]));
    return session ? (await session).prepSources() : [];
  }
  async previewPrep(identity: Identity, raw: unknown, options: PrepPreviewOptions, tables: readonly PrepMemoryTable[] = []): Promise<PrepPreview> {
    const owner = JSON.stringify([identity.namespaceId, identity.userId]), session = this.sessions.get(owner);
    if (!session) return withPrepMemory(tables, c => previewPrepDuckDb(c, raw, tables.map(t => t.source), options));
    const operation = (this.queues.get(owner) ?? Promise.resolve()).catch(() => undefined).then(async () => (await session).previewPrep(raw, options, tables));
    this.queues.set(owner, operation);
    try { return await operation; } finally { if (this.queues.get(owner) === operation) this.queues.delete(owner); }
  }
  async streamPrep(identity: Identity, raw: unknown, options: PrepPreviewOptions, limits: PrepReadLimits, sink: PrepSink, tables: readonly PrepMemoryTable[]): Promise<void> {
    const owner = JSON.stringify([identity.namespaceId, identity.userId]), session = this.sessions.get(owner);
    if (!session) return withPrepMemory(tables, c => streamPrepDuckDb(c, raw, tables.map(t => t.source), options, limits, sink));
    const operation = (this.queues.get(owner) ?? Promise.resolve()).catch(() => undefined).then(async () => (await session).streamPrep(raw, options, limits, sink, tables));
    this.queues.set(owner, operation);
    try { await operation; } finally { if (this.queues.get(owner) === operation) this.queues.delete(owner); }
  }
  async close(): Promise<void> {
    await Promise.allSettled(this.queues.values());
    for (const result of await Promise.allSettled(this.sessions.values())) if (result.status === 'fulfilled') result.value.close();
    this.sessions.clear(); this.queues.clear();
  }
}
