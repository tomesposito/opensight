import { S3Client, GetObjectCommand, ListObjectsV2Command, type S3ClientConfig } from '@aws-sdk/client-s3';
import { ConnectorError, validateConnectorConfig, type ConnectorConfig } from './connectors.js';
import { MAX_UPLOAD_BYTES, UploadError, type UploadRequest } from './upload.js';
import { ExecutionCancelledError } from './prep-stream.js';

export type S3SourceErrorCode = 'S3_BUCKET_NOT_FOUND' | 'S3_OBJECT_NOT_FOUND' | 'S3_ACCESS_DENIED' | 'S3_REQUEST_FAILED' | 'S3_INVALID_RESPONSE' | 'S3_LIST_LIMIT_EXCEEDED' | 'S3_TIMEOUT';
export class S3SourceError extends Error {
  constructor(readonly code: S3SourceErrorCode) { super(code); this.name = 'S3SourceError'; }
}
/** Real SDK command boundary; no parser, transport or credential-provider imitation in tests. */
export interface S3SourceClient {
  send(command: GetObjectCommand | ListObjectsV2Command, options: { abortSignal: AbortSignal }): Promise<{
    Body?: unknown; ContentLength?: number; Contents?: { Key?: string; Size?: number }[];
    IsTruncated?: boolean; NextContinuationToken?: string;
  }>;
  destroy(): void;
}
export interface S3SourceOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  clientFactory?: (config: S3ClientConfig) => S3SourceClient;
  signal?: AbortSignal;
  /** May lower the hard 30-second request/stream deadline. */
  timeoutMs?: number;
}
function fail(code: S3SourceErrorCode): never { throw new S3SourceError(code); }
const oversized = (): never => { throw new UploadError('UPLOAD_LIMIT_EXCEEDED', '$.data', 'File exceeds 8 MiB'); };
function settings(config: ConnectorConfig, environment: S3SourceOptions['environment'] = process.env): S3ClientConfig {
  const value = (key: string) => {
    const result = environment[config[key]!];
    if (!result || result.length > 8192 || /[\x00-\x20\x7f]/.test(result)) throw new ConnectorError('CONNECTOR_NOT_CONFIGURED', `$.config.${key}`, 'Required server environment value is missing or invalid');
    return result;
  };
  const region = value('regionEnv');
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region)) throw new ConnectorError('CONNECTOR_NOT_CONFIGURED', '$.config.regionEnv', 'Invalid AWS region');
  return { region, credentials: { accessKeyId: value('accessKeyIdEnv'), secretAccessKey: value('secretAccessKeyEnv'),
    ...(config.sessionTokenEnv ? { sessionToken: value('sessionTokenEnv') } : {}) }, maxAttempts: 1,
    // Operator environment must not redirect authenticated SDK requests to arbitrary endpoints.
    ignoreConfiguredEndpointUrls: true, followRegionRedirects: false };
}
function errorCode(error: unknown): never {
  if (error instanceof S3SourceError || error instanceof UploadError || error instanceof ConnectorError || error instanceof ExecutionCancelledError) throw error;
  const name = error instanceof Error ? error.name : undefined;
  if (name === 'NoSuchBucket') fail('S3_BUCKET_NOT_FOUND');
  if (name === 'NoSuchKey' || name === 'NotFound') fail('S3_OBJECT_NOT_FOUND');
  if (['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'ExpiredToken', 'InvalidToken'].includes(name ?? '')) fail('S3_ACCESS_DENIED');
  return fail('S3_REQUEST_FAILED');
}
async function withClient<T>(raw: unknown, options: S3SourceOptions, work: (client: S3SourceClient, config: ConnectorConfig, signal: AbortSignal) => Promise<T>): Promise<T> {
  const config = validateConnectorConfig('s3', raw), clientSettings = settings(config, options.environment);
  const timeout = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30_000) throw new ConnectorError('INVALID_CONNECTOR_CONFIG', '$.timeoutMs', 'Expected 1–30000 milliseconds');
  if (options.signal?.aborted) throw new ExecutionCancelledError();
  const controller = new AbortController();
  let client: S3SourceClient | undefined, timedOut = false;
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; cancel(); }, timeout);
  const cancelled = () => timedOut ? new S3SourceError('S3_TIMEOUT') : new ExecutionCancelledError();
  let rejectAbort: () => void = () => {};
  const stopped = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(cancelled()); });
  controller.signal.addEventListener('abort', rejectAbort, { once: true });
  try {
    client = options.clientFactory ? options.clientFactory(clientSettings) : (() => {
      const sdk = new S3Client(clientSettings);
      return { send: (command, sendOptions) => command instanceof GetObjectCommand ? sdk.send(command, sendOptions) : sdk.send(command, sendOptions), destroy: () => sdk.destroy() } satisfies S3SourceClient;
    })();
    return await Promise.race([stopped, work(client, config, controller.signal)]);
  } catch (error) { if (controller.signal.aborted) throw cancelled(); return errorCode(error); }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); controller.signal.removeEventListener('abort', rejectAbort); controller.abort(); client?.destroy(); }
}
type BodyStream = AsyncIterable<unknown> & { destroy?: () => void };
function stream(body: unknown): BodyStream {
  if (!body || typeof body !== 'object' || !(Symbol.asyncIterator in body) || typeof body[Symbol.asyncIterator] !== 'function') return fail('S3_INVALID_RESPONSE');
  return body as BodyStream;
}
/** Return the existing upload request, so parseUpload/UploadStaging enforce every format guard. */
export async function readS3Upload(raw: unknown, fileConfig: unknown, options: S3SourceOptions = {}): Promise<UploadRequest> {
  const config = validateConnectorConfig('file', fileConfig);
  return withClient(raw, options, async (client, source, signal) => {
    const response = await client.send(new GetObjectCommand({ Bucket: source.bucket, Key: source.key }), { abortSignal: signal });
    const body = stream(response.Body), close = () => body.destroy?.();
    signal.addEventListener('abort', close, { once: true });
    try {
      if (signal.aborted) throw new ExecutionCancelledError();
      if (response.ContentLength !== undefined && (!Number.isSafeInteger(response.ContentLength) || response.ContentLength < 0)) fail('S3_INVALID_RESPONSE');
      if ((response.ContentLength ?? 0) > MAX_UPLOAD_BYTES) oversized();
      const chunks: Uint8Array[] = []; let bytes = 0;
      for await (const chunk of body) {
        if (signal.aborted) throw new ExecutionCancelledError();
        if (!(chunk instanceof Uint8Array)) fail('S3_INVALID_RESPONSE');
        bytes += chunk.byteLength;
        if (bytes > MAX_UPLOAD_BYTES) oversized();
        chunks.push(Buffer.from(chunk));
      }
      if (response.ContentLength !== undefined && response.ContentLength !== bytes) fail('S3_INVALID_RESPONSE');
      return { config, data: Buffer.concat(chunks, bytes) };
    } finally { signal.removeEventListener('abort', close); close(); }
  });
}
export interface S3ObjectSummary { key: string; size: number }
/** Complete bounded listing, never partial success or object contents. */
export async function listS3Objects(raw: unknown, options: S3SourceOptions = {}): Promise<S3ObjectSummary[]> {
  return withClient(raw, options, async (client, source, signal) => {
    const result: S3ObjectSummary[] = [], tokens = new Set<string>(), keys = new Set<string>();
    let token: string | undefined;
    for (let page = 0; page < 10; page++) {
      const response = await client.send(new ListObjectsV2Command({ Bucket: source.bucket, Prefix: source.prefix ?? '', MaxKeys: 100,
        ...(token ? { ContinuationToken: token } : {}) }), { abortSignal: signal });
      if (signal.aborted) throw new ExecutionCancelledError();
      if (response.Contents !== undefined && !Array.isArray(response.Contents)) fail('S3_INVALID_RESPONSE');
      for (const object of response.Contents ?? []) {
        if (!object || typeof object.Key !== 'string' || !object.Key || object.Key.includes('\0') || Buffer.byteLength(object.Key) > 1024 || !object.Key.startsWith(source.prefix ?? '') || !Number.isSafeInteger(object.Size) || object.Size! < 0 || keys.has(object.Key)) fail('S3_INVALID_RESPONSE');
        if (result.length >= 1000) fail('S3_LIST_LIMIT_EXCEEDED');
        keys.add(object.Key); result.push({ key: object.Key, size: object.Size! });
      }
      if (response.IsTruncated === false && response.NextContinuationToken === undefined) return result;
      if (response.IsTruncated !== true || typeof response.NextContinuationToken !== 'string' || !response.NextContinuationToken || response.NextContinuationToken.length > 8192 || tokens.has(response.NextContinuationToken)) fail('S3_INVALID_RESPONSE');
      token = response.NextContinuationToken; tokens.add(token);
    }
    return fail('S3_LIST_LIMIT_EXCEEDED');
  });
}
