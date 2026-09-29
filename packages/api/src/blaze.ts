import type { PrepColumn } from '@opensight/bundle-parser/prep';
import type { PrepScalar, PrepSink } from '@opensight/query-engine';

export type ExecutionMode = 'DIRECT_QUERY' | 'BLAZE';
export interface ExecutionSettings { mode: ExecutionMode; intervalMinutes: number | null }
export interface CachedInput { datasetId: string; refreshedAt: string }
export interface BlazeLimits { maxBytes: number; datasetBytes: number; maxRows: number; cellChars: number }
export class BlazeError extends Error {
  constructor(readonly code: string, message: string, readonly causeCode?: string) { super(message); this.name = 'BlazeError'; }
}
export function blazeLimits(env: NodeJS.ProcessEnv = process.env): BlazeLimits {
  const read = (name: string, fallback: number) => {
    const raw = env[name];
    if (raw !== undefined && (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)))) throw new BlazeError('BLAZE_CONFIG_INVALID', `${name} must be a positive safe integer`);
    return raw === undefined ? fallback : Number(raw);
  };
  const limits = { maxBytes: read('OPENSIGHT_BLAZE_MAX_BYTES', 64 * 1024 * 1024), datasetBytes: read('OPENSIGHT_BLAZE_DATASET_BYTES', 16 * 1024 * 1024), maxRows: read('OPENSIGHT_BLAZE_MAX_ROWS', 100_000), cellChars: read('OPENSIGHT_BLAZE_CELL_CHARS', 16384) };
  if (limits.datasetBytes > limits.maxBytes || limits.maxRows === Number.MAX_SAFE_INTEGER) throw new BlazeError('BLAZE_CONFIG_INVALID', 'Dataset capacity must fit total capacity and the row bound must allow a sentinel row');
  return limits;
}
export function executionSettings(raw: unknown): ExecutionSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BlazeError('BLAZE_CONFIG_INVALID', 'Expected execution settings');
  const v = raw as Record<string, unknown>;
  if (Object.keys(v).some(k => !['mode', 'intervalMinutes'].includes(k)) || !['DIRECT_QUERY', 'BLAZE'].includes(String(v.mode)) || v.intervalMinutes !== null && (!Number.isSafeInteger(v.intervalMinutes) || Number(v.intervalMinutes) < 1 || Number(v.intervalMinutes) > 525600) || v.mode === 'DIRECT_QUERY' && v.intervalMinutes !== null) throw new BlazeError('BLAZE_CONFIG_INVALID', 'Expected DIRECT_QUERY or BLAZE and an interval of 1–525600 minutes or null; direct mode has no refresh schedule');
  return { mode: v.mode as ExecutionMode, intervalMinutes: v.intervalMinutes as number | null };
}
export const directSettings: ExecutionSettings = { mode: 'DIRECT_QUERY', intervalMinutes: null };
export interface ExecutionStatus extends ExecutionSettings {
  state: 'direct' | 'empty' | 'running' | 'ready' | 'error' | 'evicted' | 'invalidated';
  lastRefreshedAt: string | null; rowCount: number | null; bytes: number; nextRefreshAt: string | null;
  error: { code: string; message: string; causeCode?: string } | null;
}
/** Conservative accounting for column arrays, slots, boxed scalars and UTF-16 strings. */
export class BlazeTable implements PrepSink {
  columns: PrepColumn[] = [];
  private vectors: PrepScalar[][] = [];
  rowCount = 0;
  bytes = 256;
  cachedInputs: CachedInput[] = [];
  constructor(private readonly limits: BlazeLimits) {}
  start(columns: PrepColumn[]): void {
    this.columns = structuredClone(columns); this.vectors = columns.map(() => []);
    this.bytes += columns.reduce((n, c) => n + 128 + 2 * c.name.length, 0); this.check();
  }
  oversized(): never { throw new BlazeError('BLAZE_DATASET_TOO_LARGE', 'Prepared output exceeds its configured row, text or memory limit'); }
  private check(): void { if (this.bytes > this.limits.datasetBytes || this.rowCount > this.limits.maxRows) this.oversized(); }
  row(values: PrepScalar[]): void {
    if (values.length !== this.columns.length || !values.length) throw new BlazeError('BLAZE_REFRESH_FAILED', 'Invalid materialized row shape');
    if (values.reduce<number>((n, v) => n + (typeof v === 'string' ? v.length : String(v ?? '').length), 0) > this.limits.cellChars) this.oversized();
    this.bytes += values.reduce<number>((n, v) => n + 24 + (typeof v === 'string' ? 32 + v.length * 2 : 8), 0);
    this.rowCount++; this.check(); // Refuse before appending any part of the offending row.
    values.forEach((v, i) => this.vectors[i]!.push(v));
  }
  value = (row: number, column: number): PrepScalar => this.vectors[column]![row]!;
  rows(limit = this.rowCount): Record<string, PrepScalar>[] { return Array.from({ length: Math.min(limit, this.rowCount) }, (_, r) => Object.fromEntries(this.columns.map((c, i) => [c.name, this.value(r, i)]))); }
}
interface Entry { status: ExecutionStatus; generation: number; table?: BlazeTable; used: number }
export class BlazeStore {
  private entries = new Map<string, Entry>();
  private busy = false;
  private sequence = 0;
  constructor(readonly limits = blazeLimits()) {}
  configure(key: string, settings: ExecutionSettings): void {
    const entry = this.entries.get(key);
    if (entry && entry.status.mode === settings.mode) {
      entry.status.intervalMinutes = settings.intervalMinutes;
      entry.status.nextRefreshAt = this.next(settings); return;
    }
    this.entries.set(key, { generation: (entry?.generation ?? 0) + 1, used: ++this.sequence,
      status: { ...settings, state: settings.mode === 'BLAZE' ? 'empty' : 'direct', lastRefreshedAt: null, rowCount: null, bytes: 0, nextRefreshAt: this.next(settings), error: null } });
  }
  private next(settings: ExecutionSettings): string | null { return settings.mode === 'BLAZE' && settings.intervalMinutes ? new Date(Date.now() + settings.intervalMinutes * 60000).toISOString() : null; }
  status(key: string): ExecutionStatus { return structuredClone(this.entry(key).status); }
  private entry(key: string): Entry { const e = this.entries.get(key); if (!e) throw new BlazeError('PREP_NOT_FOUND', 'Prepared dataset not found'); return e; }
  remove(key: string): void { this.invalidate(key); this.entries.delete(key); }
  invalidate(key: string): void {
    const e = this.entries.get(key); if (!e) return;
    e.generation++; e.table = undefined; e.status.bytes = 0; e.status.rowCount = null;
    if (e.status.mode === 'BLAZE') { e.status.state = 'invalidated'; e.status.error = { code: 'BLAZE_INVALIDATED', message: 'Dataset or dependency changed; refresh required' }; }
  }
  read(key: string): { table: BlazeTable; refreshedAt: string } {
    const e = this.entry(key);
    if (e.status.mode !== 'BLAZE') throw new BlazeError('BLAZE_MODE_REQUIRED', 'Dataset is not in Blaze mode');
    if (e.status.state !== 'ready' || !e.table) {
      const code = e.status.state === 'running' ? 'BLAZE_REFRESH_IN_PROGRESS' : e.status.error?.code ?? 'BLAZE_NOT_READY';
      throw new BlazeError(code, e.status.error?.message ?? 'Blaze snapshot is unavailable; refresh required', e.status.error?.causeCode);
    }
    e.used = ++this.sequence; return { table: e.table, refreshedAt: e.status.lastRefreshedAt! };
  }
  private reserve(): void {
    if (this.busy) throw new BlazeError('BLAZE_BUSY', 'Another prepared dataset read or refresh is running; retry shortly');
    this.busy = true;
    const stored = [...this.entries.values()].filter(e => e.table).sort((a, b) => a.used - b.used);
    let bytes = stored.reduce((n, e) => n + e.table!.bytes, 0);
    for (const e of stored) {
      if (bytes + this.limits.datasetBytes <= this.limits.maxBytes) break;
      bytes -= e.table!.bytes; e.table = undefined;
      e.status.state = 'evicted'; e.status.rowCount = null; e.status.bytes = 0;
      e.status.error = { code: 'BLAZE_EVICTED', message: 'Blaze snapshot was evicted for memory capacity; refresh required' };
    }
  }
  async transient<T>(load: (table: BlazeTable) => Promise<void>, use: (table: BlazeTable) => T): Promise<T> {
    this.reserve();
    try { const table = new BlazeTable(this.limits); await load(table); return use(table); } finally { this.busy = false; }
  }
  async refresh(key: string, load: (table: BlazeTable) => Promise<void>): Promise<ExecutionStatus> {
    const e = this.entry(key);
    if (e.status.mode !== 'BLAZE') throw new BlazeError('BLAZE_MODE_REQUIRED', 'Select Blaze mode before refreshing');
    if (this.busy) throw new BlazeError('BLAZE_BUSY', 'Another prepared dataset read or refresh is running; retry shortly');
    e.table = undefined; e.status.bytes = 0; e.status.rowCount = null;
    this.reserve();
    const generation = e.generation;
    e.status.state = 'running'; e.status.error = null;
    try {
      const table = new BlazeTable(this.limits); await load(table);
      if (this.entries.get(key) !== e || generation !== e.generation) throw new BlazeError('BLAZE_INVALIDATED', 'Dataset changed during refresh; refresh the current definition');
      e.table = table; e.used = ++this.sequence;
      Object.assign(e.status, { state: 'ready', lastRefreshedAt: new Date().toISOString(), rowCount: table.rowCount, bytes: table.bytes, error: null });
      return this.status(key);
    } catch (cause) {
      const code = cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string' ? cause.code : 'PREP_EXECUTION_FAILED';
      const invalid = ['INVALID_PREP_PIPELINE', 'PREP_SCHEMA_MISMATCH', 'PREP_SOURCE_NOT_FOUND', 'PREP_SECURITY_REJECTED', 'PREP_LIMIT_EXCEEDED', 'UNSUPPORTED_PREP_STEP'].includes(code);
      const error = cause instanceof BlazeError ? cause : new BlazeError(invalid ? 'BLAZE_PIPELINE_INVALID' : 'BLAZE_REFRESH_FAILED', invalid ? 'Saved pipeline no longer validates; repair its definition or source bindings' : 'Blaze refresh failed; no cached rows are available', code);
      if (this.entries.get(key) === e && generation === e.generation) { e.status.state = 'error'; e.status.error = { code: error.code, message: error.message, ...(error.causeCode ? { causeCode: error.causeCode } : {}) }; }
      throw error;
    } finally { this.busy = false; e.status.nextRefreshAt = this.next(e.status); }
  }
  async tick(refresh: (key: string) => Promise<unknown>): Promise<void> {
    if (this.busy) return;
    for (const [key, e] of this.entries) {
      if (this.busy) return;
      if (e.status.mode === 'BLAZE' && e.status.nextRefreshAt && Date.parse(e.status.nextRefreshAt) <= Date.now()) {
        try { await refresh(key); } catch { /* Refresh records a named failure; no stale reads. */ }
        // Authorization failures before refresh must not create a tight retry loop.
        e.status.nextRefreshAt = this.next(e.status);
      }
    }
  }
}
