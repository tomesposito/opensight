import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
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
const generationPattern = /^[a-f0-9-]{36}$/;
/** Immutable generations. The owning durable metadata store atomically changes
 * the pointer only after fsync. One process owns a local store (AutomationStore's
 * contract); leases prevent replacing a table from unlinking an active read.
 * A crash between writing a generation, swapping the metadata pointer, and
 * removing the previous generation leaves an unreferenced file (#309): the
 * metadata pointer is the durable truth, so reconciliation deletes every
 * generation it does not reference — at startup (`sweep`, no leases can exist)
 * and per key before a publish (`reconcileKey`). Deferred deletions of leased
 * generations are also persisted in a per-key journal so a restart cannot lose
 * track of them before reconciliation runs. */
export class StoredTableFiles {
  private readonly readers = new Map<string, number>();
  private readonly retired = new Map<string, string>();
  private readonly busy = new Set<string>();
  private readonly journalChains = new Map<string, Promise<void>>();
  constructor(private readonly root?: string) {}
  requireDurable(): void { if (!this.root) throw new MetadataError('STORED_DURABLE_STORE_REQUIRED', 503); }
  /** Whether a durable store directory is configured. Reconciliation is a
   * no-op without one: there are no files on disk to recover. */
  get durable(): boolean { return !!this.root; }
  /** Serialize journal read-modify-write sequences per key so concurrent
   * leases/releases cannot erase each other's deferrals (#309 review). */
  private enqueue<T>(key: string, work: () => Promise<T>): Promise<T> {
    const run = (this.journalChains.get(key) ?? Promise.resolve()).then(work, work);
    this.journalChains.set(key, run.then(() => undefined, () => undefined));
    return run;
  }
  private dir(key: string): string {
    this.requireDurable();
    return join(resolve(this.root!), createHash('sha256').update(key).digest('hex'));
  }
  private path(key: string, generation: string): string {
    if (!generationPattern.test(generation)) throw new BlazeError('STORED_ARTIFACT_INVALID', 'Invalid stored generation');
    return join(this.dir(key), `${generation}.parquet`);
  }
  /** Durable record of generations whose deletion is deferred behind a lease. */
  private journalPath(key: string): string { return join(this.dir(key), 'retired-generations.json'); }
  private async journal(key: string): Promise<string[]> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.journalPath(key), 'utf8'));
      return Array.isArray(raw) ? raw.filter((g): g is string => typeof g === 'string' && generationPattern.test(g)) : [];
    } catch { return []; }
  }
  private async saveJournal(key: string, generations: readonly string[]): Promise<void> {
    const path = this.journalPath(key);
    if (!generations.length) { await rm(path, { force: true }); return; }
    await mkdir(this.dir(key), { recursive: true, mode: 0o700 });
    // Atomic replacement: a crash mid-write must not truncate the journal.
    const temp = `${path}.tmp-${randomUUID()}`;
    await writeFile(temp, JSON.stringify([...new Set(generations)]), { mode: 0o600 });
    const file = await open(temp, 'r'); try { await file.sync(); } finally { await file.close(); }
    await rename(temp, path);
    const dir = await open(this.dir(key), 'r'); try { await dir.sync(); } finally { await dir.close(); }
  }
  /** Bytes of generations whose deletion is deferred behind a lease. They are
   * still on disk, so quota accounting charges them until unlink (#309). */
  async pendingBytes(key: string): Promise<number> {
    if (!this.root) return 0;
    let total = 0;
    for (const generation of await this.journal(key)) {
      try { total += (await stat(this.path(key, generation))).size; } catch { /* already gone */ }
    }
    return total;
  }
  /** Delete every generation file in one key directory that `keep` does not
   * reference. A leased generation is never unlinked: it is journaled as
   * retired and deleted when its last lease releases. Returns bytes removed. */
  private async reconcileDir(key: string, keep: ReadonlySet<string>): Promise<number> {
    let removed = 0;
    let entries: string[];
    try { entries = await readdir(this.dir(key)); } catch { return 0; }
    const journaled = new Set(await this.journal(key));
    let journalChanged = false;
    for (const entry of entries) {
      const match = /^([a-f0-9-]{36})\.parquet$/.exec(entry);
      if (!match || keep.has(match[1]!)) continue;
      const path = join(this.dir(key), entry);
      if (this.readers.has(key)) {
        if (!this.retired.has(path)) { this.retired.set(path, key); }
        if (!journaled.has(match[1]!)) { journaled.add(match[1]!); journalChanged = true; }
        continue;
      }
      try { removed += (await stat(path)).size; } catch { /* already gone */ }
      await rm(path, { force: true });
      if (journaled.delete(match[1]!)) journalChanged = true;
    }
    // Journal entries whose files no longer exist are settled.
    for (const generation of [...journaled]) {
      if (keep.has(generation)) { journaled.delete(generation); journalChanged = true; continue; }
      try { await stat(this.path(key, generation)); } catch { journaled.delete(generation); journalChanged = true; }
    }
    if (journalChanged) await this.saveJournal(key, [...journaled]);
    return removed;
  }
  /** Recover generations orphaned around a metadata swap for one key: keep
   * exactly the generations the caller's current metadata references. The
   * caller must pass a pointer read inside its own serialization (e.g. the
   * per-key publish lock), never a value captured before it — a stale keep
   * set would delete the generation a concurrent publish just committed. */
  async reconcileKey(key: string, keep: Iterable<string>): Promise<number> {
    if (!this.root) return 0;
    return this.enqueue(key, () => this.reconcileDir(key, new Set(keep)));
  }
  /** Startup reconciliation across the whole store. Directories whose key is
   * absent from `keepByKey` belong to deleted datasets and lose every
   * generation. Safe only before any lease is taken (process startup). */
  async sweep(keepByKey: ReadonlyMap<string, Iterable<string>>): Promise<number> {
    if (!this.root) return 0;
    let removed = 0;
    const expected = new Map<string, { key: string; keep: Set<string> }>();
    for (const [key, generations] of keepByKey) expected.set(createHash('sha256').update(key).digest('hex'), { key, keep: new Set(generations) });
    let dirs: string[];
    try { dirs = await readdir(resolve(this.root!)); } catch { return 0; }
    for (const dir of dirs) {
      if (!/^[a-f0-9]{64}$/.test(dir)) continue;
      const found = expected.get(dir);
      if (found) { removed += await this.enqueue(found.key, () => this.reconcileDir(found.key, found.keep)); continue; }
      // Unknown key: no metadata references anything under this directory.
      const path = join(resolve(this.root!), dir);
      let entries: string[];
      try { entries = await readdir(path); } catch { continue; }
      for (const entry of entries) {
        if (!/^[a-f0-9-]{36}\.parquet$/.test(entry)) continue;
        try { removed += (await stat(join(path, entry))).size; } catch { /* already gone */ }
        await rm(join(path, entry), { force: true });
      }
      await rm(join(path, 'retired-generations.json'), { force: true });
    }
    return removed;
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
    if (remaining) { this.readers.set(key, remaining); return; }
    this.readers.delete(key);
    await this.enqueue(key, async () => {
      const settled: string[] = [];
      for (const [path, owner] of this.retired) if (owner === key) {
        await rm(path, { force: true }); this.retired.delete(path);
        settled.push(path.slice(path.lastIndexOf('/') + 1, -'.parquet'.length));
      }
      if (settled.length) await this.saveJournal(key, (await this.journal(key)).filter(g => !settled.includes(g)));
    });
  }
  /** Returns true when the generation was unlinked now, false when its
   * deletion was deferred behind an active lease (journaled durably). */
  async remove(key: string, value?: StoredMaterialization): Promise<boolean> {
    if (!value) return true;
    const path = this.path(key, value.generation);
    return this.enqueue(key, async () => {
      if (this.readers.has(key)) {
        // Deferred behind a lease: persist the deferral so a crash cannot lose
        // it; reconciliation or the final release settles it (#309).
        this.retired.set(path, key);
        const journaled = await this.journal(key);
        if (!journaled.includes(value.generation)) await this.saveJournal(key, [...journaled, value.generation]);
        return false;
      }
      await rm(path, { force: true });
      const journaled = await this.journal(key);
      if (journaled.includes(value.generation)) await this.saveJournal(key, journaled.filter(g => g !== value.generation));
      return true;
    });
  }
}
