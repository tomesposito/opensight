import { IncomingMessage, ServerResponse, type Server } from 'node:http';
import { Socket } from 'node:net';
import { once } from 'node:events';
import { dispatchHostedRequest } from './hosted-server.js';
import { applicationEnvelopeBytes, type RuntimeRequest, type RuntimeResponse } from './runtime-ingress.js';
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
    if (bytes > Math.floor(applicationEnvelopeBytes * 3 / 4) - 16384) { callback(new MetadataError('RESPONSE_TOO_LARGE', 413)); return; }
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
    if (separator > 16384) throw new MetadataError('HOSTED_RESPONSE_INVALID', 503);
    // writeHead(status, headers) need not populate getHeaders(). Read the wire
    // headers so CSP, nonce, referrer policy and content type survive unchanged.
    const headers: Record<string, string> = {}, cookies: string[] = [];
    for (const line of raw.subarray(0, separator).toString('latin1').split('\r\n').slice(1)) {
      const colon = line.indexOf(':');
      if (colon < 1) throw new MetadataError('HOSTED_RESPONSE_INVALID', 503);
      const name = line.slice(0, colon).toLowerCase(), value = line.slice(colon + 1).trim();
      if (name === 'set-cookie') cookies.push(value);
      else if (!['connection', 'keep-alive', 'transfer-encoding'].includes(name)) headers[name] = headers[name] === undefined ? value : `${headers[name]}, ${value}`;
    }
    headers['cache-control'] = 'no-store';
    const result: RuntimeResponse = { statusCode: response.statusCode, headers, body: raw.subarray(separator + 4).toString('base64'), isBase64Encoded: true,
      ...(cookies.length ? { cookies } : {}) };
    if (Buffer.byteLength(JSON.stringify(result)) > applicationEnvelopeBytes) throw new MetadataError('RESPONSE_TOO_LARGE', 413);
    return result;
  } finally { signal.removeEventListener('abort', abort); response.detachSocket(output); request.destroy(); socket.destroy(); output.destroy(); }
}
