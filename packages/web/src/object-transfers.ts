/** Browser-only transfer contract. Credentials belong to the control fetcher, never S3. */
export interface TransportCapabilities { directUploads?: { version: 1; maxBytes: number }; resultChunks?: { version: 1; maxBytes: number; maxResultBytes: number }; controlJsonBytes: number }
export interface OperationStatus { id: string; revision: number; kind: 'ingest' | 'result'; state: 'queued' | 'running' | 'completed' | 'cancelled' | 'expired' | 'failed'; expiresAt: string; resultAvailable: boolean; sourceId?: string; errorCode?: string }
export interface ReservationStatus { id: string; revision: number; state: string; expiresAt: string; sourceExpiresAt: string; operationId?: string; sourceId?: string }
export type UploadProgress = { stage: 'hashing' | 'reserving' | 'uploading' | 'accepting'; reservation?: ReservationStatus } | { stage: 'accepted'; operation: OperationStatus };
export class TransferError extends Error {
  constructor(readonly errorCode: string, message: string) { super(message); this.name = 'TransferError'; }
}
function invalid(): never { throw new TransferError('TRANSFER_RESPONSE_INVALID', 'The server returned an invalid transfer response.'); }
const record = (raw: unknown): Record<string, unknown> => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : invalid();
const identifier = (raw: unknown): string => typeof raw === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(raw) ? raw : invalid();
const date = (raw: unknown): string => typeof raw === 'string' && Number.isFinite(Date.parse(raw)) && new Date(raw).toISOString() === raw ? raw : invalid();
const positive = (raw: unknown, maximum = 2147483647): number => Number.isSafeInteger(raw) && Number(raw) > 0 && Number(raw) <= maximum ? Number(raw) : invalid();
const sha = (raw: unknown): string => typeof raw === 'string' && /^[a-f0-9]{64}$/.test(raw) ? raw : invalid();
const encoded = (bytes: Uint8Array): string => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
async function hash(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> { return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); }
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
export function transportCapabilities(raw: unknown): TransportCapabilities | undefined {
  if (raw === undefined) return undefined;
  const r = record(raw), capabilities: TransportCapabilities = { controlJsonBytes: positive(r.controlJsonBytes, 1048576) };
  if (r.directUploads !== undefined) {
    const direct = record(r.directUploads); if (direct.version !== 1 || direct.maxBytes !== 8388608) invalid();
    capabilities.directUploads = { version: 1, maxBytes: 8388608 };
  }
  if (r.resultChunks !== undefined) {
    const result = record(r.resultChunks); if (result.version !== 1 || result.maxBytes !== 1048576) invalid();
    capabilities.resultChunks = { version: 1, maxBytes: 1048576, maxResultBytes: positive(result.maxResultBytes) };
  }
  return capabilities;
}
export function operationStatus(raw: unknown): OperationStatus {
  const value = record(raw);
  if (!['ingest', 'result'].includes(String(value.kind)) || !['queued', 'running', 'completed', 'cancelled', 'expired', 'failed'].includes(String(value.state)) || typeof value.resultAvailable !== 'boolean') invalid();
  return { id: identifier(value.id), revision: positive(value.revision), kind: value.kind as OperationStatus['kind'], state: value.state as OperationStatus['state'],
    expiresAt: date(value.expiresAt), resultAvailable: value.resultAvailable, ...(value.sourceId === undefined ? {} : { sourceId: identifier(value.sourceId) }),
    ...(value.errorCode === undefined ? {} : { errorCode: typeof value.errorCode === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(value.errorCode) ? value.errorCode : invalid() }) };
}
export function reservationStatus(raw: unknown): ReservationStatus {
  const value = record(raw);
  if (!['reserved', 'accepted', 'completed', 'cancelled', 'expired', 'failed'].includes(String(value.state))) invalid();
  return { id: identifier(value.id), revision: positive(value.revision), state: String(value.state), expiresAt: date(value.expiresAt), sourceExpiresAt: date(value.sourceExpiresAt),
    ...(value.operationId === undefined ? {} : { operationId: identifier(value.operationId) }), ...(value.sourceId === undefined ? {} : { sourceId: identifier(value.sourceId) }) };
}
export type ControlRequest = (path: string, method: string, body?: unknown, signal?: AbortSignal, key?: string) => Promise<unknown>;
export async function directUpload(file: Blob, config: Readonly<Record<string, string>>, expiresAt: string,
  control: ControlRequest, fetcher: typeof fetch, check: () => void, progress: (value: UploadProgress) => void, signal?: AbortSignal): Promise<OperationStatus> {
  const mediaTypes: Record<string, string> = { csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  if (file.size < 1 || file.size > 8388608) throw new TransferError('UPLOAD_LIMIT_EXCEEDED', 'Choose a file between 1 byte and 8 MiB.');
  if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) throw new TransferError('UPLOAD_EXPIRY_REQUIRED', 'Choose when this upload should expire.');
  const mediaType = mediaTypes[config.format ?? '']; if (!mediaType) invalid();
  const active = () => { signal?.throwIfAborted(); check(); };
  active(); progress({ stage: 'hashing' });
  const checksum = encoded(await hash(new Uint8Array(await file.arrayBuffer()))); active(); progress({ stage: 'reserving' });
  const response = record(await control('/api/uploads/reservations', 'POST', { byteLength: file.size, sha256: checksum, mediaType, config,
    expiresAt: new Date(expiresAt).toISOString(), policy: { rowLevel: false, rowRules: [] } }, signal, crypto.randomUUID()));
  active(); const reservation = reservationStatus(response), put = record(response.put), headers = record(put.headers);
  if (put.method !== 'PUT' || typeof put.url !== 'string' || Date.parse(date(put.expiresAt)) <= Date.now() || reservation.state !== 'reserved') invalid();
  const url = new URL(put.url);
  if (url.protocol !== 'https:' || !/^s3\.(?:[a-z]{2}-[a-z]+-\d)\.amazonaws\.com$/.test(url.hostname) || url.port || url.username || url.password || url.hash
    || !/^\/[a-z0-9-]+\/objects\/v1\/[a-f0-9]{64}\/[a-f0-9-]{36}$/.test(url.pathname)) invalid();
  const expected = { 'content-length': String(file.size), 'content-type': mediaType, 'x-amz-checksum-sha256': checksum, 'if-none-match': '*', 'x-amz-server-side-encryption': 'AES256' };
  if (Object.keys(headers).sort().join() !== Object.keys(expected).sort().join() || Object.entries(expected).some(([key, value]) => headers[key] !== value)) invalid();
  progress({ stage: 'uploading', reservation });
  const { 'content-length': _length, ...signed } = expected;
  // Fetch sets Content-Length from this exact Blob. Script cannot set that forbidden header.
  const uploaded = await fetcher(url.href, { method: 'PUT', body: file, headers: signed, credentials: 'omit', redirect: 'error', cache: 'no-store', signal });
  active();
  if (!uploaded.ok) throw new TransferError('UPLOAD_TRANSFER_FAILED', 'The file transfer was not confirmed. Check status or cancel before starting another upload.');
  const versionId = uploaded.headers.get('x-amz-version-id');
  if (!versionId || versionId === 'null' || versionId.length > 1024 || /[\x00-\x20\x7f]/.test(versionId)) throw new TransferError('UPLOAD_VERSION_UNAVAILABLE', 'The upload version was not returned. Check status or cancel this reservation.');
  progress({ stage: 'accepting', reservation });
  const result = operationStatus(await control(`/api/uploads/reservations/${reservation.id}/complete`, 'POST', { versionId }, signal, crypto.randomUUID()));
  active(); progress({ stage: 'accepted', operation: result }); return result;
}

/** Verify ordered fragments and the whole digest before any result reaches a renderer. */
export async function assembleResult(raw: unknown, maximum: number, get: (path: string) => Promise<unknown>, check: () => void): Promise<unknown> {
  const envelope = record(raw); if (envelope.operation === undefined) return raw;
  const op = operationStatus(envelope.operation), descriptor = record(record(envelope.operation).result);
  if (op.kind !== 'result' || op.state !== 'completed' || !op.resultAvailable || descriptor.version !== 1 || !Array.isArray(descriptor.chunks)) invalid();
  const length = positive(descriptor.byteLength, maximum), whole = sha(descriptor.sha256), expectedCount = Math.ceil(length / 1048576);
  if (descriptor.chunks.length !== expectedCount) invalid();
  const active = () => { check(); if (Date.parse(op.expiresAt) <= Date.now()) throw new TransferError('RESULT_EXPIRED', 'This result expired. Run the query again.'); };
  active(); const bytes = new Uint8Array(length); let offset = 0;
  for (const [index, value] of descriptor.chunks.entries()) {
    active(); const expected = record(value), size = positive(expected.byteLength, 1048576), checksum = sha(expected.sha256);
    if (expected.index !== index || size !== Math.min(1048576, length - offset)) invalid();
    const chunk = record(await get(`/api/operations/${op.id}/result/${index}`)); active();
    if (chunk.operationId !== op.id || chunk.revision !== op.revision || chunk.index !== index || chunk.byteLength !== size || chunk.sha256 !== checksum || chunk.expiresAt !== op.expiresAt
      || typeof chunk.data !== 'string' || chunk.data.length !== Math.ceil(size / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk.data)) invalid();
    const binary = atob(chunk.data); if (binary.length !== size || btoa(binary) !== chunk.data) invalid();
    const part = Uint8Array.from(binary, ch => ch.charCodeAt(0)); if (hex(await hash(part)) !== checksum) invalid();
    active(); bytes.set(part, offset); offset += size;
  }
  if (offset !== length || hex(await hash(bytes)) !== whole) invalid(); active();
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}
