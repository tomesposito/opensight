import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { handleMcpHttp } from '@opensight/mcp-server/http';
import type { HostedAuth } from '../hosted-auth.js';
import { dispatchRuntimeRequest } from '../runtime-http-bridge.js';
import { MetadataError } from '../metadata-db.js';
import { send } from '../automation-routes.js';
import { isResultDescriptor, mcpResultBytes, mcpResultSizeError } from './results.js';

/** Only the generated v1 request crosses this in-process bridge; no network fetch or identity headers. */
export async function serveMcp(request: IncomingMessage, response: ServerResponse, server: Server, auth: HostedAuth, origin: string, signal?: AbortSignal): Promise<void> {
  let token: string, scopes: string[];
  try { token = auth.bearer(request); scopes = (await auth.mcpAccess(token)).scopes; }
  catch {
    response.setHeader('WWW-Authenticate', `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`);
    send(response, 401, { errorCode: 'AUTHENTICATION_FAILED' }); return;
  }
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  request.once('aborted', abort);
  const closed = () => { if (!response.writableFinished) abort(); }; response.once('close', closed);
  try {
    if (signal?.aborted) controller.abort();
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      bytes += (chunk as Buffer).length;
      if (bytes > 1024 * 1024) throw new MetadataError('CONTROL_PAYLOAD_TOO_LARGE', 413);
      chunks.push(chunk as Buffer);
    }
    const headers = new Headers();
    for (const name of ['content-type', 'accept', 'mcp-protocol-version', 'mcp-session-id']) {
      const value = request.headers[name]; if (typeof value === 'string') headers.set(name, value);
    }
    const result = await handleMcpHttp(new Request(`${origin}/api/mcp`, { method: request.method, headers,
      ...(!['GET', 'HEAD'].includes(request.method ?? 'GET') ? { body: Buffer.concat(chunks) } : {}), signal: controller.signal }), {
      baseUrl: `${origin}/api/v1`, scopes, credentials: { accessToken: async () => token, invalidate() {}, containsSecret: value => value.includes(token) },
      fetch: async (input, init) => {
        const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
        if (url.origin !== origin || !url.pathname.startsWith('/api/v1/') || url.search || url.hash) throw new MetadataError('MCP_ROUTE_INVALID', 403);
        const body = Buffer.from(typeof init?.body === 'string' ? init.body : '');
        let result: Awaited<ReturnType<typeof dispatchRuntimeRequest>>;
        try {
          result = await dispatchRuntimeRequest(server, { method: init?.method ?? 'GET', path: url.pathname,
            headers: { ...Object.fromEntries(new Headers(init?.headers)), host: new URL(origin).host, 'content-length': String(body.length) },
            body, peer: request.socket.remoteAddress ?? 'unknown', requestTime: Date.now() }, controller.signal);
        } catch (error) {
          if (error instanceof MetadataError && error.code === 'RESPONSE_TOO_LARGE') return Response.json(mcpResultSizeError, { status: 413 });
          throw error;
        }
        const bytes = Buffer.from(result.body, result.isBase64Encoded ? 'base64' : 'utf8');
        if (result.statusCode >= 200 && result.statusCode < 300) {
          const descriptor = result.headers['content-type']?.includes('application/json') && isResultDescriptor(JSON.parse(bytes.toString('utf8')) as unknown);
          if (bytes.length > mcpResultBytes || descriptor) return Response.json(mcpResultSizeError, { status: 413 });
        }
        return new Response(bytes, { status: result.statusCode, headers: result.headers });
      }
    });
    result.headers.forEach((value, name) => response.setHeader(name, value));
    response.setHeader('Cache-Control', 'no-store'); response.statusCode = result.status; response.end(Buffer.from(await result.arrayBuffer()));
  } finally { signal?.removeEventListener('abort', abort); request.off('aborted', abort); response.off('close', closed); }
}
