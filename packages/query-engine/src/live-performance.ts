import type { Aggregation, BoundColumn, Dimension, QueryPlan, QueryResult, ResultRow } from './types.js';
import { array, fail, keys, object, string, unique } from './validation.js';

/** Trusted caller-owned configuration; do not accept assertions from an imported asset. */
export interface AggregateTableDeclaration {
  readonly name: string;
  readonly tableName: string;
  readonly tableSchema?: string;
  readonly dimensions: readonly { readonly columnName: string; readonly granularity?: Dimension['granularity'] }[];
  readonly measures: readonly { readonly columnName: string; readonly aggregation: Aggregation }[];
  readonly countColumn?: string;
}

function identifier(value: unknown, path: string): string {
  const name = string(value, path);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail('INVALID_INPUT', path, 'expected a plain identifier');
  return name;
}

export function validateAggregates(value: unknown, columns: readonly BoundColumn[]): AggregateTableDeclaration[] {
  const names = new Set<string>();
  return array(value, '$.options.aggregates').map((raw, i) => {
    const path = `$.options.aggregates[${i}]`, declaration = object(raw, path);
    keys(declaration, ['name', 'tableName', 'tableSchema', 'dimensions', 'measures', 'countColumn'], path);
    const name = string(declaration.name, `${path}.name`);
    unique(names, name, `${path}.name`);
    const used = new Set<string>();
    const column = (value: unknown, path: string): BoundColumn => {
      const name = identifier(value, path);
      unique(used, name, path);
      const source = columns.find(c => c.name === name);
      if (!source) fail('UNRESOLVED_BINDING', path, `unknown source column: ${name}`);
      return source;
    };
    const dimensions = array(declaration.dimensions, `${path}.dimensions`).map((raw, j) => {
      const p = `${path}.dimensions[${j}]`, d = object(raw, p);
      keys(d, ['columnName', 'granularity'], p);
      const source = column(d.columnName, `${p}.columnName`);
      if (d.granularity === undefined) return { columnName: source.name };
      if (typeof d.granularity !== 'string' || !['YEAR', 'QUARTER', 'MONTH', 'DAY'].includes(d.granularity)) fail('INVALID_INPUT', `${p}.granularity`, 'unsupported date granularity');
      if (source.type !== 'DATETIME') fail('TYPE_MISMATCH', `${p}.granularity`, 'date granularity requires a datetime column');
      return { columnName: source.name, granularity: d.granularity as Dimension['granularity'] };
    });
    const measures = array(declaration.measures, `${path}.measures`).map((raw, j) => {
      const p = `${path}.measures[${j}]`, m = object(raw, p);
      keys(m, ['columnName', 'aggregation'], p);
      const source = column(m.columnName, `${p}.columnName`);
      if (source.scalarType !== 'number') fail('TYPE_MISMATCH', p, 'aggregate measure requires a numeric source column');
      if (typeof m.aggregation !== 'string' || !['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'].includes(m.aggregation)) fail('INVALID_INPUT', `${p}.aggregation`, 'unsupported aggregation');
      return { columnName: source.name, aggregation: m.aggregation as Aggregation };
    });
    const countColumn = declaration.countColumn === undefined ? undefined : identifier(declaration.countColumn, `${path}.countColumn`);
    if (countColumn !== undefined) unique(used, countColumn, `${path}.countColumn`);
    return { name, tableName: identifier(declaration.tableName, `${path}.tableName`), dimensions, measures,
      ...(declaration.tableSchema === undefined ? {} : { tableSchema: identifier(declaration.tableSchema, `${path}.tableSchema`) }),
      ...(countColumn === undefined ? {} : { countColumn }) };
  });
}

export function matchingAggregate(plan: Omit<QueryPlan, 'sql' | 'parameters'>, aggregates: readonly AggregateTableDeclaration[]): AggregateTableDeclaration | undefined {
  if (plan.calculations.length || plan.rowSecurity || plan.securityProtected || plan.postProcess) return;
  return aggregates.find(a =>
    plan.dimensions.every(d => a.dimensions.some(g => g.columnName === d.columnName && g.granularity === d.granularity)) &&
    plan.measures.every(m => m.aggregation === 'SUM'
      ? a.measures.some(s => s.columnName === m.columnName && s.aggregation === 'SUM')
      : m.aggregation === 'COUNT' && a.countColumn !== undefined) &&
    // Raw timestamp filters cannot in general be applied to pre-truncated values.
    plan.filters.every(f => a.dimensions.some(d => d.columnName === f.columnName && d.granularity === undefined)));
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) fail('INVALID_INPUT', path, 'expected a positive safe integer');
  return value;
}

export interface CachedLiveResult {
  readonly rows: ResultRow[];
  readonly cachedAt: string;
}

/**
 * Bounded FIFO result cache. Retained size is the UTF-8 byte length of
 * JSON.stringify(rows), not JS heap usage. Stored and returned rows are isolated
 * from caller mutation.
 */
export class LiveResultCache {
  private readonly entries = new Map<string, CachedLiveResult & { expiresAt: number; bytes: number }>();
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly maxEntryBytes: number;
  private hits = 0;
  private misses = 0;
  private stores = 0;
  private retainedBytes = 0;

  constructor(options: { now?: () => number; maxEntries?: number; maxBytes?: number; maxEntryBytes?: number } = {}) {
    const opts = object(options, '$.cache');
    keys(opts, ['now', 'maxEntries', 'maxBytes', 'maxEntryBytes'], '$.cache');
    this.maxEntries = positiveInteger(opts.maxEntries === undefined ? 100 : opts.maxEntries, '$.cache.maxEntries');
    this.maxBytes = positiveInteger(opts.maxBytes === undefined ? 32 * 1024 * 1024 : opts.maxBytes, '$.cache.maxBytes');
    this.maxEntryBytes = positiveInteger(opts.maxEntryBytes === undefined ? 8 * 1024 * 1024 : opts.maxEntryBytes, '$.cache.maxEntryBytes');
    if (this.maxEntryBytes > this.maxBytes) fail('INVALID_INPUT', '$.cache.maxEntryBytes', 'per-entry budget must fit total byte budget');
    if (opts.now !== undefined && typeof opts.now !== 'function') fail('INVALID_INPUT', '$.cache.now', 'expected a clock function');
    this.now = options.now ?? Date.now;
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      this.retainedBytes -= entry.bytes;
      this.entries.delete(key);
    }
  }

  private purgeExpired(now: number): void {
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.remove(key);
  }

  get(key: string): CachedLiveResult | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= this.now()) {
      if (entry) this.remove(key);
      this.misses++;
      return;
    }
    this.hits++;
    return { rows: entry.rows.map(row => ({ ...row })), cachedAt: entry.cachedAt };
  }

  set(key: string, rows: readonly ResultRow[], ttlMs: number): void {
    positiveInteger(ttlMs, '$.liveCache.ttlMs');
    const now = this.now();
    this.purgeExpired(now);
    // A replacement must not leave stale rows available if the new result bypasses caching.
    this.remove(key);
    let bytes: number;
    try {
      // Account before copying. TextEncoder keeps this shared planner module browser-safe.
      const serialized = JSON.stringify(rows);
      if (typeof serialized !== 'string') return;
      bytes = new TextEncoder().encode(serialized).byteLength;
      if (!Number.isSafeInteger(bytes) || bytes < 0) return;
    } catch {
      // Accounting failure must not fail the caller's otherwise successful query.
      return;
    }
    if (bytes > this.maxEntryBytes || bytes > this.maxBytes) return;
    // Subtraction avoids overflowing a safe-integer budget when comparing totals.
    while (this.retainedBytes > this.maxBytes - bytes || this.entries.size >= this.maxEntries) {
      this.remove(this.entries.keys().next().value!);
    }
    const entry = { rows: rows.map(row => ({ ...row })), cachedAt: new Date(now).toISOString(), expiresAt: now + ttlMs, bytes };
    this.entries.set(key, entry);
    this.retainedBytes += bytes;
    this.stores++;
  }

  invalidate(prefix?: string): void {
    if (prefix === undefined) {
      this.entries.clear();
      this.retainedBytes = 0;
    } else for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.remove(key);
  }

  stats(): { hits: number; misses: number; stores: number; entries: number; retainedBytes: number } {
    this.purgeExpired(this.now());
    return { hits: this.hits, misses: this.misses, stores: this.stores, entries: this.entries.size, retainedBytes: this.retainedBytes };
  }
}

/** Trusted caller-owned configuration; do not accept assertions from an imported asset. */
export interface LiveCachePolicy {
  readonly cache: LiveResultCache;
  readonly ttlMs: number;
}

export function validateLiveCache(value: unknown): LiveCachePolicy | undefined {
  if (value === undefined) return;
  const policy = object(value, '$.options.liveCache');
  keys(policy, ['cache', 'ttlMs'], '$.options.liveCache');
  if (!(policy.cache instanceof LiveResultCache)) fail('INVALID_INPUT', '$.options.liveCache.cache', 'expected a LiveResultCache instance');
  return { cache: policy.cache, ttlMs: positiveInteger(policy.ttlMs, '$.options.liveCache.ttlMs') };
}

/** Includes the JSON delimiter so similar dataset ARNs cannot share a prefix. */
export function liveDatasetCachePrefix(dataSetArn: string): string {
  return `${JSON.stringify([dataSetArn]).slice(0, -1)},`;
}

export function liveResultCacheKey(plan: QueryPlan): string {
  return JSON.stringify([plan.localData.dataSetArn, plan.visualId, plan.dialect, plan.sql, plan.parameters]);
}

export function liveProvenance(plan: QueryPlan): QueryResult['provenance'] {
  return plan.executionSource.kind === 'aggregate' ? { source: 'aggregate', aggregateName: plan.executionSource.name } : { source: 'live' };
}
