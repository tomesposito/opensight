import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { MetadataError } from './metadata-db.js';
import type { InvocationAws } from './runtime-aws.js';
import type { WorkScope } from './budgets.js';
import type { LedgerObject, VerifiedObject } from './object-ledger.js';
export const resultChunkBytes = 1024 * 1024;
function invalid(): never { throw new MetadataError('RESULT_OBJECT_INVALID', 503); }
/** Immutable JSON byte fragments. Reads have no public or presigned capability. */
export class ResultObjects {
  constructor(private readonly aws: InvocationAws, private readonly bucket: string) {
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) invalid();
  }
  private entry(entry: LedgerObject): void {
    this.aws.scope.check();
    if (entry.purpose !== 'result' || !['reserved', 'live'].includes(entry.state) || entry.mediaType !== 'application/octet-stream'
      || !Number.isSafeInteger(entry.capacityBytes) || entry.capacityBytes < 1 || entry.capacityBytes > resultChunkBytes
      || !entry.checksum || !/^[A-Za-z0-9+/]{43}=$/.test(entry.checksum) || Buffer.from(entry.checksum, 'base64').toString('base64') !== entry.checksum
      || !/^objects\/v1\/[a-f0-9]{64}\/[a-f0-9-]{36}$/.test(entry.key)) invalid();
  }
  private headers(entry: LedgerObject, raw: { VersionId?: string; ContentLength?: number; ContentType?: string; ChecksumSHA256?: string; ServerSideEncryption?: string; DeleteMarker?: boolean; ContentRange?: string }, expected?: string): VerifiedObject {
    const version = raw.VersionId;
    if (!version || version === 'null' || version.length > 1024 || /[\x00-\x20\x7f]/.test(version) || expected && version !== expected
      || raw.ContentLength !== entry.capacityBytes || raw.ContentType !== entry.mediaType || raw.ChecksumSHA256 !== entry.checksum
      || raw.ServerSideEncryption !== 'AES256' || raw.DeleteMarker || raw.ContentRange !== undefined) invalid();
    return { version, bytes: raw.ContentLength!, checksum: raw.ChecksumSHA256! };
  }
  async write(scope: WorkScope, entry: LedgerObject, bytes: Buffer): Promise<VerifiedObject> {
    this.entry(entry); scope.check();
    if (entry.state !== 'reserved' || bytes.length !== entry.capacityBytes || createHash('sha256').update(bytes).digest('base64') !== entry.checksum) invalid();
    return this.aws.call(async signal => {
      const response = await this.aws.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: entry.key, Body: bytes, ContentLength: bytes.length,
        ContentType: entry.mediaType, ChecksumSHA256: entry.checksum, IfNoneMatch: '*', ServerSideEncryption: 'AES256' }), { abortSignal: AbortSignal.any([signal, scope.signal]) });
      if (!response.VersionId || response.VersionId === 'null' || response.ChecksumSHA256 !== entry.checksum) invalid();
      const verified = this.headers(entry, await this.aws.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: entry.key, VersionId: response.VersionId, ChecksumMode: 'ENABLED' }), { abortSignal: AbortSignal.any([signal, scope.signal]) }), response.VersionId);
      scope.check(); return verified;
    });
  }
  async read(entry: LedgerObject): Promise<Buffer> {
    this.entry(entry);
    if (entry.state !== 'live' || !entry.version || entry.bytes !== entry.capacityBytes) invalid();
    const output = Buffer.alloc(entry.capacityBytes);
    await this.aws.call(async signal => {
      const response = await this.aws.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: entry.key, VersionId: entry.version, ChecksumMode: 'ENABLED' }), { abortSignal: signal });
      if (!(response.Body instanceof Readable)) invalid();
      const body = response.Body; body.on('error', () => {});
      const closed = body.closed ? Promise.resolve() : new Promise<void>(resolve => body.once('close', resolve));
      const close = async () => { body.destroy(); await closed; }; this.aws.scope.own({ close, force: () => body.destroy() });
      try {
        this.headers(entry, response, entry.version); const hash = createHash('sha256'); let offset = 0;
        for await (const value of body) {
          this.aws.scope.check();
          if (!(value instanceof Uint8Array) || offset + value.byteLength > output.length) invalid();
          output.set(value, offset); hash.update(value); offset += value.byteLength;
        }
        if (offset !== output.length || hash.digest('base64') !== entry.checksum) invalid();
      } finally { await close(); }
    });
    this.aws.scope.check(); return output;
  }
}
