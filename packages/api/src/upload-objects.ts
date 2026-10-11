import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MetadataError } from './metadata-db.js';
import type { InvocationAws } from './runtime-aws.js';
import type { WorkScope } from './budgets.js';
import type { LedgerObject, VerifiedObject } from './object-ledger.js';

export interface UploadCapability { url: string; method: 'PUT'; headers: Record<string, string>; expiresAt: string }
const maximumBytes = 8 * 1024 * 1024;
function invalid(): never { throw new MetadataError('UPLOAD_OBJECT_INVALID', 400); }
const versionId = (value: string): string => {
  if (!value || value === 'null' || value.length > 1024 || /[\x00-\x20\x7f]/.test(value)) return invalid(); return value;
};
/** The caller authorizes the SQL ledger entry before and after I/O. No client-supplied bucket/key. */
export class UploadObjects {
  constructor(private readonly aws: InvocationAws, private readonly bucket: string, private readonly clock = Date.now) {
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new MetadataError('OBJECT_CONFIG_INVALID', 503);
  }
  private entry(entry: LedgerObject): void {
    this.aws.scope.check();
    if (entry.purpose !== 'raw-upload' || !['reserved', 'live'].includes(entry.state) || !Number.isSafeInteger(entry.capacityBytes)
      || entry.capacityBytes < 1 || entry.capacityBytes > maximumBytes || !entry.checksum || !/^[A-Za-z0-9+/]{43}=$/.test(entry.checksum)
      || Buffer.from(entry.checksum, 'base64').toString('base64') !== entry.checksum || !/^objects\/v1\/[a-f0-9]{64}\/[a-f0-9-]{36}$/.test(entry.key)) invalid();
  }
  async capability(entry: LedgerObject, until: number): Promise<UploadCapability> {
    this.entry(entry);
    const now = this.clock(), seconds = Math.floor((Math.min(until, entry.signatureUntil, entry.retentionUntil) - now) / 1000);
    if (entry.state !== 'reserved' || seconds < 1 || seconds > 60) throw new MetadataError('UPLOAD_EXPIRED', 409);
    const headers = { 'content-length': String(entry.capacityBytes), 'content-type': entry.mediaType,
      'x-amz-checksum-sha256': entry.checksum!, 'if-none-match': '*', 'x-amz-server-side-encryption': 'AES256' };
    const names = new Set(Object.keys(headers));
    const url = await this.aws.scope.stage(() => getSignedUrl(this.aws.s3, new PutObjectCommand({ Bucket: this.bucket, Key: entry.key,
      ContentLength: entry.capacityBytes, ContentType: entry.mediaType, ChecksumSHA256: entry.checksum, IfNoneMatch: '*', ServerSideEncryption: 'AES256' }),
      { expiresIn: seconds, signingDate: new Date(now), signableHeaders: names, unhoistableHeaders: names }), 2000, () => {}, 'OBJECT_SIGNING_TIMEOUT');
    const signed = new URL(url), actual = new Set((signed.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';'));
    if (signed.protocol !== 'https:' || signed.hostname !== `s3.${this.aws.region}.amazonaws.com` || signed.pathname !== `/${this.bucket}/${entry.key}`
      || [...names].some(name => !actual.has(name) || signed.searchParams.has(name))) throw new MetadataError('OBJECT_SIGNING_CONSTRAINT_REQUIRED', 503);
    return { url, method: 'PUT', headers, expiresAt: new Date(Math.floor(now / 1000) * 1000 + seconds * 1000).toISOString() };
  }
  private headers(entry: LedgerObject, version: string, raw: { VersionId?: string; ContentLength?: number; ContentType?: string; ChecksumSHA256?: string; ServerSideEncryption?: string; DeleteMarker?: boolean; ContentRange?: string }): VerifiedObject {
    if (raw.VersionId !== version || raw.ContentLength !== entry.capacityBytes || raw.ContentType !== entry.mediaType || raw.ChecksumSHA256 !== entry.checksum
      || raw.ServerSideEncryption !== 'AES256' || raw.DeleteMarker || raw.ContentRange !== undefined) invalid();
    return { version, bytes: raw.ContentLength!, checksum: raw.ChecksumSHA256! };
  }
  async head(entry: LedgerObject, rawVersion: string): Promise<VerifiedObject> {
    this.entry(entry); const version = versionId(rawVersion);
    const response = await this.aws.call(signal => this.aws.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: entry.key, VersionId: version, ChecksumMode: 'ENABLED' }), { abortSignal: signal }));
    return this.headers(entry, version, response);
  }
  async bytes(scope: WorkScope, entry: LedgerObject): Promise<Buffer> {
    this.entry(entry); scope.check();
    if (entry.state !== 'live' || !entry.version || entry.bytes !== entry.capacityBytes) invalid();
    const version = versionId(entry.version);
    // One fixed buffer and bounded stream high-water marks, never an unbounded chunk list.
    scope.memory(entry.capacityBytes + 3 * 65536); const output = Buffer.alloc(entry.capacityBytes);
    await this.aws.call(async signal => {
      const response = await this.aws.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: entry.key, VersionId: version, ChecksumMode: 'ENABLED' }), { abortSignal: AbortSignal.any([signal, scope.signal]) });
      if (!(response.Body instanceof Readable)) invalid();
      const body = response.Body; body.on('error', () => {});
      const closed = body.closed ? Promise.resolve() : new Promise<void>(resolve => body.once('close', resolve));
      const close = async () => { body.destroy(); await closed; };
      this.aws.scope.own({ close, force: () => body.destroy() });
      const abort = () => body.destroy(); scope.signal.addEventListener('abort', abort, { once: true });
      try {
        this.headers(entry, version, response);
        const hash = createHash('sha256'); let offset = 0;
        for await (const raw of body) {
          this.aws.scope.check(); scope.check();
          if (!(raw instanceof Uint8Array) || offset + raw.byteLength > output.length) invalid();
          output.set(raw, offset); hash.update(raw); offset += raw.byteLength;
        }
        scope.check(); if (offset !== output.length || hash.digest('base64') !== entry.checksum) invalid();
      } finally { scope.signal.removeEventListener('abort', abort); await close(); }
    });
    scope.check(); return output;
  }
}
