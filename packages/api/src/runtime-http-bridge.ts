import { IncomingMessage, ServerResponse, type Server } from 'node:http';
import { Socket } from 'node:net';
import { once } from 'node:events';
import { dispatchHostedRequest } from './hosted-server.js';
import type { RuntimeRequest, RuntimeResponse } from './runtime-ingress.js';
import { MetadataError } from './metadata-db.js';

/** In-memory Node HTTP streams preserve the existing route/security boundary. */
export async function dispatchRuntimeRequest(server: Server, input: RuntimeRequest, signal: AbortSignal): Promise<RuntimeResponse> {
  const socket = new Socket();
  Object.defineProperty(socket, 'remoteAddress', { value: input.peer });
  const request = new IncomingMessage(socket);
  request.method = input.method; request.url = input.path; request.headers = input.headers;
  request.rawHeaders = Object.entries(input.headers).flat();
  request.push(input.body); request.push(null);
  const response = new ServerResponse(request), chunks: Buffer[] = []; let bytes = 0;
  const capture = (chunk: Buffer, callback: (error?: Error | null) => void) => {
    bytes += chunk.length;
    if (bytes > 4 * 1024 * 1024) { callback(new MetadataError('RESPONSE_TOO_LARGE', 413)); return; }
    chunks.push(Buffer.from(chunk)); callback();
  };
  class MemorySocket extends Socket {
    override _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void { capture(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding), callback); }
    override _writev(chunks: { chunk: Buffer; encoding: BufferEncoding }[], callback: (error?: Error | null) => void): void { capture(Buffer.concat(chunks.map(c => Buffer.isBuffer(c.chunk) ? c.chunk : Buffer.from(c.chunk, c.encoding))), callback); }
  }
  const output = new MemorySocket();
  response.useChunkedEncodingByDefault = false; response.shouldKeepAlive = false;
  response.assignSocket(output);
  const abort = () => { request.emit('aborted'); output.destroy(new MetadataError('INVOCATION_DEADLINE_EXCEEDED', 503)); };
  const finished = once(response, 'finish');
  // Observe output errors even if route construction rejects before response.end().
  let outputError: Error | undefined;
  output.on('error', error => { outputError = error; response.emit('error', error); });
  void finished.catch(() => {});
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw new MetadataError('INVOCATION_DEADLINE_EXCEEDED', 503);
    await dispatchHostedRequest(server, request, response); await finished;
    if (outputError) throw outputError;
    const raw = Buffer.concat(chunks), separator = raw.indexOf('\r\n\r\n');
    if (separator < 0) throw new MetadataError('HOSTED_RESPONSE_INVALID', 503);
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(response.getHeaders())) if (value !== undefined && name !== 'set-cookie') headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
    headers['cache-control'] = 'no-store';
    const cookies = response.getHeader('set-cookie');
    return { statusCode: response.statusCode, headers, body: raw.subarray(separator + 4).toString('base64'), isBase64Encoded: true,
      ...(cookies === undefined ? {} : { cookies: Array.isArray(cookies) ? cookies : [String(cookies)] }) };
  } finally { signal.removeEventListener('abort', abort); response.detachSocket(output); request.destroy(); socket.destroy(); output.destroy(); }
}
