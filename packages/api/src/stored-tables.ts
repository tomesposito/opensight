import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { artifactColumns, artifactSample, decodeArtifactSample, readArtifactParquet, writeArtifactParquet, type ArtifactSample } from '@opensight/query-engine';
import { prepFail } from '@opensight/bundle-parser/prep';
import type { PrepColumn } from '@opensight/bundle-parser/prep';
import { BlazeError, BlazeTable, type BlazeLimits, type ExecutionStatus } from './blaze.js';
import { MetadataError } from './metadata-db.js';
import { storageQuotaError } from './storage-breakdown.js';

export interface StoredMaterialization {
  generation: string; columns: PrepColumn[]; rowCount: number; bytes: number; sha256: string;
  lastRefreshedAt: string; state: 'current' | 'stale' | 'refresh-failed';
  error: { code: string; message: string } | null; failedAt: string | null;
  /** Definition/source revision fingerprint, excluding materialization status writes. */
  stamp: string;
  sample?: ArtifactSample;
}
export function storedMaterialization(raw: unknown): StoredMaterialization {
  const bad = (): never => { throw new BlazeError('STORED_ARTIFACT_INVALID', 'Stored table metadata is invalid'); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const v = raw as Record<string, unknown>;
  if (Object.keys(v).some(k => !['generation', 'columns', 'rowCount', 'bytes', 'sha256', 'lastRefreshedAt', 'state', 'error', 'failedAt', 'stamp', 'sample'].includes(k))
    || typeof v.generation !== 'string' || !/^[a-f0-9-]{36}$/.test(v.generation)
    || !Number.isSafeInteger(v.rowCount) || Number(v.rowCount) < 0 || !Number.isSafeInteger(v.bytes) || Number(v.bytes) < 1
    || typeof v.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.sha256)
    || typeof v.lastRefreshedAt !== 'string' || !Number.isFinite(Date.parse(v.lastRefreshedAt))
    || !['current', 'stale', 'refresh-failed'].includes(String(v.state)) || typeof v.stamp !== 'string'
    || v.failedAt !== null && (typeof v.failedAt !== 'string' || !Number.isFinite(Date.parse(v.failedAt)))) return bad();
  if (v.error !== null && (!v.error || typeof v.error !== 'object' || !('code' in v.error) || typeof v.error.code !== 'string' || !('message' in v.error) || typeof v.error.message !== 'string')) return bad();
  try { artifactColumns(v.columns); if (v.sample !== undefined) artifactSample(v.sample, Number(v.bytes)); } catch { return bad(); }
  return structuredClone(raw) as StoredMaterialization;
}
export function storedStatus(value?: StoredMaterialization): ExecutionStatus {
  return { mode: 'STORED', intervalMinutes: null, state: value?.state ?? 'empty', lastRefreshedAt: value?.lastRefreshedAt ?? null,
    rowCount: value?.rowCount ?? null, bytes: value?.bytes ?? 0, nextRefreshAt: null, error: value?.error ?? null, failedAt: value?.failedAt ?? null };
}
export function storedFailure(value: StoredMaterialization, cause: unknown): StoredMaterialization {
  const code = cause instanceof Error && 'code' in cause && typeof cause.code === 'string' ? cause.code : 'PREP_EXECUTION_FAILED';
  return { ...value, state: 'refresh-failed', failedAt: new Date().toISOString(), error: { code, message: cause instanceof Error ? cause.message : code } };
}
/** Reserve the bounded output capacity before executing an arbitrary pipeline.
 * Parquet's exact compressed size cannot be known before execution. The extra
 * MiB accommodates its schema/pages; oversized encodings are refused at write. */
export const storedCapacity = (limits: BlazeLimits): number => limits.datasetBytes + 1024 * 1024;
export function checkStoredQuota(limitBytes: number, usedBytes: number, requestedBytes: number): void {
  if (usedBytes + requestedBytes <= limitBytes) return;
  throw storageQuotaError({ deployment: 'stored', tenantId: '', namespaceId: '', at: new Date().toISOString(), limitBytes,
    metadataBytes: 0, liveBytes: usedBytes, reservedBytes: 0, totalBytes: usedBytes, pendingCleanupBytes: 0,
    nextReclamationAt: null, overdueCount: 0, pendingCleanup: [], protectedObjects: [], protectedBytes: 0 }, requestedBytes);
}
/** Immutable generations. The owning durable metadata store atomically changes
 * the pointer only after fsync. One process owns a local store (AutomationStore's
 * contract); leases prevent replacing a table from unlinking an active read. */
export class StoredTableFiles {
  private readonly readers = new Map<string, number>();
  private readonly retired = new Map<string, string>();
  private readonly busy = new Set<string>();
  constructor(private readonly root?: string) {}
  requireDurable(): void { if (!this.root) throw new MetadataError('STORED_DURABLE_STORE_REQUIRED', 503); }
  private path(key: string, generation: string): string {
    this.requireDurable();
    if (!/^[a-f0-9-]{36}$/.test(generation)) throw new BlazeError('STORED_ARTIFACT_INVALID', 'Invalid stored generation');
    return join(resolve(this.root!), createHash('sha256').update(key).digest('hex'), `${generation}.parquet`);
  }
  async exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
    this.requireDurable();
    if (this.busy.has(key)) throw new BlazeError('STORED_REFRESH_IN_PROGRESS', 'A stored table publish or refresh is already running');
    this.busy.add(key); try { return await work(); } finally { this.busy.delete(key); }
  }
  async write(key: string, table: BlazeTable, stamp: string, capacity: number): Promise<StoredMaterialization> {
    const generation = randomUUID(), path = this.path(key, generation);
    await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
    try {
      const rows = Array.from({ length: table.rowCount }, (_, r) => table.columns.map((_, c) => table.value(r, c)));
      const sample = await writeArtifactParquet(path, table.columns, rows, 128);
      const bytes = (await stat(path)).size;
      if (bytes > capacity) throw new BlazeError('STORED_ARTIFACT_TOO_LARGE', 'Encoded table exceeds its admitted storage capacity');
      const file = await open(path, 'r'); try { await file.sync(); } finally { await file.close(); }
      const dir = await open(resolve(path, '..'), 'r'); try { await dir.sync(); } finally { await dir.close(); }
      return { generation, columns: table.columns, rowCount: table.rowCount, bytes, sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
        lastRefreshedAt: new Date().toISOString(), state: 'current', error: null, failedAt: null, stamp, sample };
    } catch (error) { await rm(path, { force: true }); throw error; }
  }
  async read(key: string, value: StoredMaterialization | undefined, limits: BlazeLimits): Promise<BlazeTable> {
    if (!value) throw new BlazeError('STORED_NOT_PUBLISHED', 'Publish this dataset before reading its stored table');
    const checked = storedMaterialization(value), path = this.path(key, checked.generation);
    this.readers.set(key, (this.readers.get(key) ?? 0) + 1);
    try {
      const bytes = await readFile(path);
      if (bytes.length !== checked.bytes || createHash('sha256').update(bytes).digest('hex') !== checked.sha256) throw Error();
      const table = new BlazeTable(limits);
      await readArtifactParquet(path, checked.columns, checked.rowCount, limits.cellChars, table, 128); return table;
    } catch { throw new BlazeError('STORED_ARTIFACT_INVALID', 'Stored table is missing or corrupt; explicitly refresh to replace it'); }
    finally {
      await this.release(key);
    }
  }
  /** Lease before fetching a metadata pointer; concurrent refresh cannot retire
   * the generation between the metadata read and opening its Parquet file. */
  async readCurrent(key: string, current: () => Promise<StoredMaterialization | undefined>, limits: BlazeLimits): Promise<BlazeTable> {
    this.readers.set(key, (this.readers.get(key) ?? 0) + 1);
    try { return await this.read(key, await current(), limits); } finally { await this.release(key); }
  }
  async boundedSample(key: string, current: () => Promise<StoredMaterialization | undefined>, limits: BlazeLimits, check: () => void): Promise<BlazeTable> {
    this.readers.set(key, (this.readers.get(key) ?? 0) + 1);
    try {
      check(); const value = await current();
      if (!value) throw new BlazeError('STORED_NOT_PUBLISHED', 'Publish this dataset before reading its stored table');
      const checked = storedMaterialization(value), sample = checked.sample;
      if (!sample) prepFail('UNSUPPORTED_PREP_STEP', '$.joinDiagnostics', 'Stored artifact has no bounded sample; explicitly refresh it');
      if (sample.bytes > storedCapacity(limits)) throw new BlazeError('STORED_ARTIFACT_TOO_LARGE', 'Stored sample exceeds its admitted capacity');
      const table = new BlazeTable(limits);
      try {
        const file = await open(this.path(key, checked.generation), 'r');
        try {
          if ((await file.stat()).size !== checked.bytes) throw Error();
          const bytes = Buffer.alloc(sample.bytes); let offset = 0;
          while (offset < bytes.length) {
            check(); const read = await file.read(bytes, offset, bytes.length - offset, sample.offset + offset);
            if (!read.bytesRead) throw Error(); offset += read.bytesRead;
          }
          table.start(checked.columns);
          for (const row of decodeArtifactSample(bytes, sample, checked.columns, checked.rowCount)) { check(); table.row(row); }
        } finally { await file.close(); }
      } catch (error) {
        check();
        if (error instanceof BlazeError) throw error;
        throw new BlazeError('STORED_ARTIFACT_INVALID', 'Stored sample is missing or corrupt; explicitly refresh to replace it');
      }
      check();
      if (JSON.stringify(await current()) !== JSON.stringify(value)) throw new BlazeError('STORED_DEFINITION_CHANGED', 'Stored snapshot changed during diagnostics');
      return table;
    } finally { await this.release(key); }
  }
  private async release(key: string): Promise<void> {
    const remaining = this.readers.get(key)! - 1;
    if (remaining) this.readers.set(key, remaining);
    else {
      this.readers.delete(key);
      for (const [path, owner] of this.retired) if (owner === key) { await rm(path, { force: true }); this.retired.delete(path); }
    }
  }
  async remove(key: string, value?: StoredMaterialization): Promise<void> {
    if (!value) return;
    const path = this.path(key, value.generation);
    if (this.readers.has(key)) this.retired.set(path, key); else await rm(path, { force: true });
  }
}
