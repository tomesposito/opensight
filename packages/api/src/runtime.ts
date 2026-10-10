import { createServer, type Server } from 'node:http';
import { createBuiltinHostedServer, drainHostedServer } from './hosted-server.js';
import { MetadataError } from './metadata-db.js';
import { InvocationScope, invocationDeadline, type InvocationContext } from './runtime-scope.js';
import { invocationDatabases, type InvocationDatabases } from './runtime-postgres.js';
import { adaptGatewayRequest, runtimeError, validateLocalRequest, type RuntimeRequest, type RuntimeResponse } from './runtime-ingress.js';
import { dispatchRuntimeRequest } from './runtime-http-bridge.js';
import { runtimeReadiness, startupFailure, validateStartup } from './runtime-startup.js';

export interface RuntimeDependencies {
  databases?(scope: InvocationScope, env: NodeJS.ProcessEnv, connectMs: number): InvocationDatabases;
  readiness?(databases: InvocationDatabases, scope: InvocationScope, env: NodeJS.ProcessEnv): Promise<void>;
  application?(databases: InvocationDatabases, scope: InvocationScope, env: NodeJS.ProcessEnv): Promise<Server>;
}
export function runtimeMode(env: NodeJS.ProcessEnv): 'http' | 'lambda' {
  const mode = env.OPENSIGHT_RUNTIME ?? 'http';
  if (!['http', 'lambda'].includes(mode) || mode === 'lambda' && (env.OPENSIGHT_MODE !== 'hosted' || env.OPENSIGHT_REFERENCE !== undefined)) throw new MetadataError('RUNTIME_CONFIG_INVALID', 503);
  return mode as 'http' | 'lambda';
}

/** Configuration/factories may be reused. Resources and tenant authority may not. */
export function createRuntime(env: () => NodeJS.ProcessEnv = () => process.env, dependencies: RuntimeDependencies = {}) {
  const databases = dependencies.databases ?? invocationDatabases;
  const readiness = dependencies.readiness ?? runtimeReadiness;
  const application = dependencies.application ?? ((db, scope, config) => createBuiltinHostedServer({ membershipDatabase: db.membership, tenantDatabase: db.tenant, env: config, invocation: { signal: scope.signal } }));
  const invoke = async (request: RuntimeRequest, context: InvocationContext, config: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<RuntimeResponse> => {
    const startup = request.path === '/api/startup';
    try {
      if (startup) validateStartup(request);
      const scope = new InvocationScope(invocationDeadline(context, request.requestTime));
      const abort = () => scope.controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      try { return await scope.run(async scope => {
        const db = databases(scope, config, startup ? 18000 : 3000);
        // Connection wake time is separate from the 2s readiness statement budget.
        await db.prepare?.();
        await readiness(db, scope, config);
        if (startup) return { statusCode: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: '{"state":"ready"}' };
        const server = await application(db, scope, config);
        scope.own({ close: () => drainHostedServer(server), force: () => server.closeAllConnections() });
        return dispatchRuntimeRequest(server, request, scope.signal);
      }); } finally { signal?.removeEventListener('abort', abort); }
    } catch (error) {
      if (error instanceof MetadataError && ['INVOCATION_CLEANUP_FAILED', 'RUNTIME_QUARANTINED', 'HOSTED_REQUEST_INVALID'].includes(error.code)) return runtimeError(error);
      return startup ? startupFailure(error) : runtimeError(error);
    }
  };
  return {
    async lambda(event: unknown, context: InvocationContext): Promise<RuntimeResponse> {
      try {
        const config = env();
        if (runtimeMode(config) !== 'lambda') throw new MetadataError('LAMBDA_MODE_REQUIRED', 503);
        return await invoke(adaptGatewayRequest(event, config), context, config);
      } catch (error) { return runtimeError(error); }
    },
    /** Local/dev uses canonical Host directly; no proxy header is trusted. */
    http(): Server {
      const config = env();
      if (runtimeMode(config) !== 'http') throw new MetadataError('HTTP_MODE_REQUIRED', 503);
      const server = createServer(async (request, response) => {
        const requestTime = Date.now(), chunks: Buffer[] = []; let bytes = 0;
        const cancellation = new AbortController();
        request.once('aborted', () => cancellation.abort());
        response.once('close', () => { if (!response.writableFinished) cancellation.abort(); });
        try {
          const origin = config.OPENSIGHT_PUBLIC_ORIGIN;
          if (!origin || request.headers.host !== new URL(origin).host || request.headers.origin !== undefined && request.headers.origin !== origin
            || request.headers.forwarded || Object.keys(request.headers).some(h => h.startsWith('x-forwarded-') || h.startsWith('x-opensight-ingress-') || h === 'cloudfront-viewer-address')) throw new MetadataError('UNTRUSTED_ORIGIN', 403);
          const headers: Record<string, string> = {};
          for (let i = 0; i < request.rawHeaders.length; i += 2) {
            const name = request.rawHeaders[i]!.toLowerCase();
            if (Object.hasOwn(headers, name)) throw new MetadataError('HOSTED_REQUEST_INVALID', 400);
            headers[name] = request.rawHeaders[i + 1]!;
          }
          for await (const chunk of request) { const buffer = Buffer.from(chunk as Uint8Array); bytes += buffer.length; if (bytes > 4 * 1024 * 1024) throw new MetadataError('REQUEST_TOO_LARGE', 413); chunks.push(buffer); }
          const input = { path: request.url ?? '', method: request.method ?? '', peer: request.socket.remoteAddress ?? '', headers, body: Buffer.concat(chunks), requestTime };
          validateLocalRequest(input, origin);
          const result = await invoke(input, { getRemainingTimeInMillis: () => 28000 - (Date.now() - requestTime) }, config, cancellation.signal);
          response.writeHead(result.statusCode, { ...result.headers, ...(result.cookies ? { 'set-cookie': result.cookies } : {}) });
          response.end(Buffer.from(result.body, result.isBase64Encoded ? 'base64' : 'utf8'));
        } catch (error) { const result = runtimeError(error); response.writeHead(result.statusCode, result.headers); response.end(result.body); }
      });
      server.requestTimeout = 25000; server.headersTimeout = 10000; server.keepAliveTimeout = 1;
      return server;
    },
  };
}
