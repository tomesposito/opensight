import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform, type Stream } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { artifactColumns, artifactScalar, type PrepScalar } from '@opensight/query-engine';
import { BlazeTable } from './blaze.js';
import type { WorkScope } from './budgets.js';
import { containedWork, type ParquetWriteResult, type TableResult } from './contained-work.js';
import { InvocationScope } from './runtime-scope.js';
import type { InvocationAws } from './runtime-aws.js';
import { artifactDescriptor, artifactError, artifactFailure, artifactIdentity, artifactLimits, artifactProvenance, exactObject,
  type ArtifactDescriptor, type ArtifactIdentity, type ArtifactLimits, type ArtifactReference } from './artifact-schema.js';

export interface LocalArtifact { readonly descriptor: Readonly<ArtifactDescriptor>; close(): Promise<void> }
export interface PlannedArtifactWrite { readonly identity: Readonly<ArtifactIdentity>; readonly key: string; readonly descriptor: Readonly<ArtifactDescriptor> }
interface LocalFile { directory: string; path: string; descriptor: ArtifactDescriptor; closed: boolean; closing?: Promise<void> }
const contentType = 'application/vnd.apache.parquet';
const frameLimits = (limits: ArtifactLimits) => ({ maxBytes: limits.decodedBytes, datasetBytes: limits.decodedBytes, maxRows: limits.rows, cellChars: limits.cellChars });
const checksum = (descriptor: ArtifactDescriptor): string => Buffer.from(descriptor.sha256, 'hex').toString('base64');
const versionId = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.length || raw === 'null' || raw.length > 1024 || /[\x00-\x20\x7f]/.test(raw)) artifactError(); return raw;
};
function freezeDescriptor(descriptor: ArtifactDescriptor): ArtifactDescriptor {
  for (const c of descriptor.columns) Object.freeze(c); Object.freeze(descriptor.columns);
  for (const c of descriptor.cachedInputs) Object.freeze(c); Object.freeze(descriptor.cachedInputs);
  return Object.freeze(descriptor);
}

/** Mechanism only: the future SQL manifest/recovery layer owns authorization and publication. */
export class ArtifactTransfer {
  private readonly invocation: InvocationScope;
  private readonly files = new WeakMap<LocalArtifact, LocalFile>();
  private readonly writes = new WeakMap<PlannedArtifactWrite, { handle: LocalArtifact; started: boolean }>();
  private readonly bucket?: string;
  private readonly prefix?: string;
  constructor(private readonly aws?: InvocationAws, config?: { bucket: string; prefix: string }) {
    const invocation = InvocationScope.current(); if (!invocation) artifactError('ARTIFACT_SCOPE_REQUIRED'); this.invocation = invocation;
    if (aws || config) {
      if (!aws || aws.scope !== invocation || !config || Object.keys(config).sort().join() !== 'bucket,prefix'
        || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket) || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(config.prefix)
        || config.prefix.length > 128) artifactError('ARTIFACT_CONFIG_INVALID');
      this.bucket = config.bucket; this.prefix = config.prefix;
    }
  }
  private check(scope: WorkScope): void {
    if (InvocationScope.current() !== this.invocation) artifactError('ARTIFACT_SCOPE_REQUIRED');
    this.invocation.check(); scope.check();
  }
  private async directory(): Promise<{ directory: string; path: string }> {
    const directory = await mkdtemp(join(await this.invocation.temporaryDirectory(), 'artifact-'));
    return { directory, path: join(directory, 'data.parquet') };
  }
  private ownStream(stream: Stream & { destroy(): void; closed?: boolean }): () => Promise<void> {
    stream.on('error', () => {});
    const closed = stream.closed ? Promise.resolve() : new Promise<void>(resolve => stream.once('close', resolve));
    const close = async () => { stream.destroy(); await closed; };
    this.invocation.own({ close, force: () => stream.destroy() }); return close;
  }
  private mint(file: { directory: string; path: string }, descriptor: ArtifactDescriptor): LocalArtifact {
    const entry: LocalFile = { ...file, descriptor: freezeDescriptor(descriptor), closed: false };
    const handle: LocalArtifact = Object.freeze({ descriptor: entry.descriptor, close: () => {
      entry.closed = true; return entry.closing ??= rm(entry.directory, { recursive: true, force: true });
    } });
    this.files.set(handle, entry); return handle;
  }
  private file(scope: WorkScope, handle: LocalArtifact): LocalFile {
    this.check(scope); const entry = this.files.get(handle); if (!entry || entry.closed) artifactError('ARTIFACT_HANDLE_INVALID'); return entry;
  }
  private async digest(scope: WorkScope, path: string, maximum: number): Promise<{ sha256: string; encodedBytes: number }> {
    this.check(scope); const details = await stat(path);
    if (!details.isFile() || details.size < 1 || details.size > maximum) artifactError();
    scope.memory(65536); const hash = createHash('sha256'), stream = createReadStream(path, { highWaterMark: 65536 });
    const close = this.ownStream(stream), abort = () => stream.destroy(); scope.signal.addEventListener('abort', abort, { once: true });
    let bytes = 0;
    try {
      for await (const chunk of stream) { this.check(scope); bytes += (chunk as Buffer).length; if (bytes > maximum) artifactError(); hash.update(chunk as Buffer); }
      this.check(scope); if (bytes !== details.size) artifactError(); return { sha256: hash.digest('hex'), encodedBytes: bytes };
    } finally { scope.signal.removeEventListener('abort', abort); await close(); }
  }
  async encode(scope: WorkScope, table: BlazeTable, rawLimits: ArtifactLimits): Promise<LocalArtifact> {
    let file: { directory: string; path: string } | undefined;
    try {
      this.check(scope); const limits = artifactLimits(scope, rawLimits), columns = artifactColumns(table.columns), cachedInputs = artifactProvenance(structuredClone(table.cachedInputs));
      if (columns.length > limits.columns || !Number.isSafeInteger(table.rowCount) || table.rowCount < 0 || table.rowCount > limits.rows) artifactError();
      const checked = new BlazeTable(frameLimits(limits)); checked.start(columns); checked.setCachedInputs(cachedInputs);
      scope.memory(checked.bytes * 2);
      const rows: PrepScalar[][] = [];
      for (let r = 0; r < table.rowCount; r++) {
        scope.check(); const row = columns.map((column, c) => artifactScalar(table.value(r, c), column)), before = checked.bytes;
        checked.row(row); scope.memory((checked.bytes - before) * 2); rows.push(row);
      }
      file = await this.directory(); this.check(scope);
      const result = await containedWork<ParquetWriteResult>(scope, { kind: 'parquet-write', path: file.path, columns, rows, cachedInputs }, frameLimits(limits));
      if (result.rowCount !== checked.rowCount || result.decodedBytes !== checked.bytes) artifactError();
      await chmod(file.path, 0o600);
      const descriptor = artifactDescriptor({ format: 'opensight-parquet-v1', columns, rowCount: result.rowCount, decodedBytes: result.decodedBytes,
        ...await this.digest(scope, file.path, limits.encodedBytes), cachedInputs }, limits);
      this.check(scope); return this.mint(file, descriptor);
    } catch (error) { if (file) await rm(file.directory, { recursive: true, force: true }); return artifactFailure(error); }
  }
  async decode(scope: WorkScope, handle: LocalArtifact, rawLimits: ArtifactLimits): Promise<BlazeTable> {
    try {
      const file = this.file(scope, handle), limits = artifactLimits(scope, rawLimits), descriptor = artifactDescriptor(file.descriptor, limits);
      const digest = await this.digest(scope, file.path, limits.encodedBytes);
      if (digest.sha256 !== descriptor.sha256 || digest.encodedBytes !== descriptor.encodedBytes) artifactError();
      const result = await containedWork<TableResult>(scope, { kind: 'parquet-read', path: file.path, columns: descriptor.columns,
        rowCount: descriptor.rowCount, decodedBytes: descriptor.decodedBytes, cachedInputs: descriptor.cachedInputs }, frameLimits(limits));
      const table = new BlazeTable(frameLimits(limits)); table.start(result.columns); table.setCachedInputs(descriptor.cachedInputs);
      for (const row of result.rows) { scope.check(); table.row(row); }
      if (table.rowCount !== descriptor.rowCount || table.bytes !== descriptor.decodedBytes) artifactError();
      scope.memory(table.bytes); this.check(scope); return table;
    } catch (error) { return artifactFailure(error); }
  }
  private transport(scope: WorkScope): InvocationAws {
    this.check(scope); if (!this.aws || !this.bucket || !this.prefix) artifactError('ARTIFACT_CONFIG_INVALID'); return this.aws;
  }
  private identity(scope: WorkScope, raw: ArtifactIdentity): { identity: ArtifactIdentity; prefix: string } {
    const identity = artifactIdentity(raw); if (identity.tenant !== scope.tenantId) artifactError();
    return { identity, prefix: `${this.prefix}/${createHash('sha256').update(JSON.stringify([identity.tenant, identity.namespace, identity.owner, identity.kind, identity.resource])).digest('hex')}/` };
  }
  private headers(response: { VersionId?: string; ContentLength?: number; ContentType?: string; ChecksumSHA256?: string; ContentRange?: string; DeleteMarker?: boolean }, descriptor: ArtifactDescriptor, version: string): void {
    if (response.VersionId !== version || response.ContentLength !== descriptor.encodedBytes || response.ContentType !== contentType
      || response.ChecksumSHA256 !== checksum(descriptor) || response.ContentRange !== undefined || response.DeleteMarker === true) artifactError();
  }
  /** Recovery of a server-allocated immutable key. A 404 is absence, never an authorization grant. */
  async inspect(scope: WorkScope, rawIdentity: ArtifactIdentity, key: string, rawDescriptor: ArtifactDescriptor, limits: ArtifactLimits): Promise<ArtifactReference | undefined> {
    const aws = this.transport(scope), { identity, prefix } = this.identity(scope, rawIdentity), descriptor = artifactDescriptor(rawDescriptor, artifactLimits(scope, limits));
    if (!key.startsWith(prefix) || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.parquet$/.test(key.slice(prefix.length))) artifactError();
    const response = await aws.call(async signal => {
      try { return await aws.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key, ChecksumMode: 'ENABLED' }), { abortSignal: AbortSignal.any([signal, scope.signal]) }); }
      catch (error) {
        if (error instanceof Error && ['NotFound', 'NoSuchKey'].includes(error.name) && '$metadata' in error && (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 404) return undefined;
        throw error;
      }
    });
    this.check(scope); if (!response) return undefined;
    const version = versionId(response.VersionId); this.headers(response, descriptor, version);
    if (response.ServerSideEncryption !== 'AES256') artifactError();
    return { identity, key, version, descriptor };
  }
  /** Allocate before durable recovery/reservation. The public description cannot mint a write. */
  planWrite(scope: WorkScope, rawIdentity: ArtifactIdentity, handle: LocalArtifact, reservedKey?: string): PlannedArtifactWrite {
    this.transport(scope);
    const { identity, prefix } = this.identity(scope, rawIdentity), file = this.file(scope, handle);
    if (reservedKey !== undefined && (!reservedKey.startsWith(prefix) || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.parquet$/.test(reservedKey.slice(prefix.length)))) artifactError('ARTIFACT_WRITE_HANDLE_INVALID');
    const plan = Object.freeze({ identity: Object.freeze(identity), key: reservedKey ?? `${prefix}${randomUUID()}.parquet`, descriptor: file.descriptor });
    this.writes.set(plan, { handle, started: false }); return plan;
  }
  async upload(scope: WorkScope, rawIdentity: ArtifactIdentity, handle: LocalArtifact, planned?: PlannedArtifactWrite): Promise<ArtifactReference> {
    try {
      const aws = this.transport(scope), { identity } = this.identity(scope, rawIdentity), file = this.file(scope, handle), descriptor = structuredClone(file.descriptor);
      const plan = planned ?? this.planWrite(scope, identity, handle), write = this.writes.get(plan);
      if (!write || write.handle !== handle || write.started || JSON.stringify(identity) !== JSON.stringify(plan.identity)) artifactError('ARTIFACT_WRITE_HANDLE_INVALID');
      // An uncertain PUT is recovered from its exact durable key, never retried in this invocation.
      write.started = true;
      const digest = await this.digest(scope, file.path, descriptor.encodedBytes);
      if (digest.sha256 !== descriptor.sha256 || digest.encodedBytes !== descriptor.encodedBytes) artifactError();
      const key = plan.key, stream = createReadStream(file.path, { highWaterMark: 65536 }), close = this.ownStream(stream);
      const abort = () => stream.destroy(); scope.signal.addEventListener('abort', abort, { once: true });
      let version: string;
      try {
        this.check(scope);
        const response = await aws.call(signal => aws.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: stream, ContentLength: descriptor.encodedBytes,
          ContentType: contentType, ChecksumSHA256: checksum(descriptor), IfNoneMatch: '*', ServerSideEncryption: 'AES256' }), { abortSignal: AbortSignal.any([signal, scope.signal]) }));
        version = versionId(response.VersionId);
        if (response.ChecksumSHA256 !== checksum(descriptor)) artifactError();
      } finally { scope.signal.removeEventListener('abort', abort); await close(); }
      this.check(scope);
      const head = await aws.call(signal => aws.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key, VersionId: version, ChecksumMode: 'ENABLED' }), { abortSignal: AbortSignal.any([signal, scope.signal]) }));
      this.headers(head, descriptor, version); this.check(scope); return { identity, key, version, descriptor };
    } catch (error) { this.check(scope); return artifactFailure(error); }
  }
  async download(scope: WorkScope, rawIdentity: ArtifactIdentity, rawReference: ArtifactReference, rawLimits: ArtifactLimits): Promise<LocalArtifact> {
    let file: { directory: string; path: string } | undefined;
    try {
      const aws = this.transport(scope), expected = this.identity(scope, rawIdentity), limits = artifactLimits(scope, rawLimits);
      const value = exactObject(structuredClone(rawReference), ['identity', 'key', 'version', 'descriptor']), actual = this.identity(scope, artifactIdentity(value.identity));
      const descriptor = artifactDescriptor(value.descriptor, limits), version = versionId(value.version), key = value.key;
      if (expected.prefix !== actual.prefix || typeof key !== 'string' || !key.startsWith(expected.prefix)
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.parquet$/.test(key.slice(expected.prefix.length))) artifactError();
      file = await this.directory(); const path = file.path; scope.memory(3 * 65536);
      await aws.call(async signal => {
        this.check(scope); const abortSignal = AbortSignal.any([signal, scope.signal]);
        const response = await aws.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, VersionId: version, ChecksumMode: 'ENABLED' }), { abortSignal });
        if (!(response.Body instanceof Readable)) artifactError();
        const body = response.Body, closeBody = this.ownStream(body);
        let closeOutput: (() => Promise<void>) | undefined;
        try {
          this.headers(response, descriptor, version);
          const hash = createHash('sha256'); let bytes = 0;
          const guard = new Transform({ transform: (chunk: Buffer, _encoding, done) => {
            try { this.check(scope); bytes += chunk.length; if (bytes > descriptor.encodedBytes) artifactError(); hash.update(chunk); done(null, chunk); }
            catch (error) { done(error instanceof Error ? error : new Error('ARTIFACT_INVALID')); }
          } });
          const output = createWriteStream(path, { flags: 'wx', mode: 0o600, highWaterMark: 65536 }); closeOutput = this.ownStream(output);
          await pipeline(body, guard, output, { signal: abortSignal });
          this.check(scope); if (bytes !== descriptor.encodedBytes || hash.digest('hex') !== descriptor.sha256) artifactError();
        } finally { await closeBody(); await closeOutput?.(); }
      });
      this.check(scope); return this.mint(file, descriptor);
    } catch (error) { if (file) await rm(file.directory, { recursive: true, force: true }); this.check(scope); return artifactFailure(error); }
  }
}
