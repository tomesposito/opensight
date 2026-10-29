import { MetadataError } from './metadata-db.js';
import type { SqlConnection } from './metadata-db.js';

/**
 * Process-local, ten-minute receipts shared by v1 datasets/queries and analyses.
 * Bytes are Buffer.byteLength(JSON.stringify(receipt)): the complete receipt,
 * including reply/body, retained record, access snapshot and fingerprint. Map
 * keys, timer/entry metadata and JavaScript object overhead are not JSON bytes.
 * Reservations count toward both entry limits while work is in flight; prepare
 * reserves the exact receipt bytes before an asynchronous commit/publication.
 * Only expired receipts are reclaimed. Callers must not mutate stored values.
 * The periodic prune timer runs only in long-lived server compositions
 * (`periodicPrune`); invocation-scoped (Lambda) stores start no timers and
 * rely on prune-on-access, matching the hosted expiry-timer pattern.
 */
export const RETRY_TTL_MS = 10 * 60 * 1000;
interface Usage { entries: number; bytes: number }
interface Entry { tenantId: string; bytes: number; value?: unknown; expiresAt?: number }
export interface RetryCommit { persist?(connection: SqlConnection): Promise<void> }
export interface RetryReservation<T> extends RetryCommit {
  prepare(value: T): void;
  commit(expiresAt?: number): void | Promise<void>;
  release(): void | Promise<void>;
}
export interface RetryAdapter {
  get<T>(key: string): T | undefined | Promise<T | undefined>;
  reserve<T>(tenantId: string, key: string): RetryReservation<T> | Promise<RetryReservation<T>>;
  close(): void;
}
export function retryLimits(env: NodeJS.ProcessEnv) {
  return { entries: positive(env, 'OPENSIGHT_RETRY_CACHE_MAX_ENTRIES', 1000), bytes: positive(env, 'OPENSIGHT_RETRY_CACHE_MAX_BYTES', 64 * 1024 * 1024),
    tenantEntries: positive(env, 'OPENSIGHT_RETRY_CACHE_PER_TENANT_MAX_ENTRIES', 250), tenantBytes: positive(env, 'OPENSIGHT_RETRY_CACHE_PER_TENANT_MAX_BYTES', 16 * 1024 * 1024) };
}
export function v1RateLimit(env: NodeJS.ProcessEnv): number {
  const limit = positive(env, 'OPENSIGHT_V1_RATE_LIMIT_PER_MINUTE', 600);
  if (limit > 100000) throw new Error('OPENSIGHT_V1_RATE_LIMIT_PER_MINUTE must be at most 100000');
  return limit;
}
function positive(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error(`${name} must be a positive integer`);
  return Number(raw);
}
function capacity(): never { throw new MetadataError('IDEMPOTENCY_CAPACITY_EXCEEDED', 429); }
function byteLength(value: unknown): number {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('Retry receipts must be JSON serializable');
  return Buffer.byteLength(json);
}

export class RetryStore {
  private readonly entries = new Map<string, Entry>();
  private readonly tenants = new Map<string, Usage>();
  private readonly total: Usage = { entries: 0, bytes: 0 };
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly perTenantMaxEntries: number;
  private readonly perTenantMaxBytes: number;
  private readonly now: () => number;
  private readonly timer?: ReturnType<typeof setInterval>;
  constructor({ env = process.env, now = () => Date.now(), periodicPrune = true }: { env?: NodeJS.ProcessEnv; now?: () => number; periodicPrune?: boolean } = {}) {
    this.maxEntries = positive(env, 'OPENSIGHT_RETRY_CACHE_MAX_ENTRIES', 1000);
    this.maxBytes = positive(env, 'OPENSIGHT_RETRY_CACHE_MAX_BYTES', 64 * 1024 * 1024);
    this.perTenantMaxEntries = positive(env, 'OPENSIGHT_RETRY_CACHE_PER_TENANT_MAX_ENTRIES', 250);
    this.perTenantMaxBytes = positive(env, 'OPENSIGHT_RETRY_CACHE_PER_TENANT_MAX_BYTES', 16 * 1024 * 1024);
    this.now = now;
    if (periodicPrune) { this.timer = setInterval(() => this.prune(), 60000); this.timer.unref(); }
  }
  close(): void { if (this.timer) clearInterval(this.timer); }
  /** Includes in-flight reservations; inspecting totals does not trigger pruning. */
  usage(tenantId?: string): Usage { return { ...(tenantId === undefined ? this.total : this.tenants.get(tenantId) ?? { entries: 0, bytes: 0 }) }; }
  /** Callers own disjoint key prefixes and the receipt type associated with each. */
  get<T>(key: string): T | undefined {
    this.prune();
    const entry = this.entries.get(key);
    return entry?.expiresAt === undefined ? undefined : entry.value as T;
  }
  private account(tenantId: string, entries: number, bytes: number): void {
    const tenant = this.tenants.get(tenantId) ?? { entries: 0, bytes: 0 };
    this.total.entries += entries; this.total.bytes += bytes;
    tenant.entries += entries; tenant.bytes += bytes;
    if (tenant.entries === 0) this.tenants.delete(tenantId); else this.tenants.set(tenantId, tenant);
  }
  private check(tenantId: string, bytes: number, previous?: Entry): void {
    const tenant = this.usage(tenantId), sameTenant = previous?.tenantId === tenantId;
    if (this.total.entries + (previous ? 0 : 1) > this.maxEntries
      || this.total.bytes - (previous?.bytes ?? 0) + bytes > this.maxBytes
      || tenant.entries + (sameTenant ? 0 : 1) > this.perTenantMaxEntries
      || tenant.bytes - (sameTenant ? previous.bytes : 0) + bytes > this.perTenantMaxBytes) capacity();
  }
  /** Reserve a new entry after a serialized replay miss, before executing work. */
  reserve<T>(tenantId: string, key: string): RetryReservation<T> {
    this.prune();
    if (this.entries.has(key)) throw new Error('Retry receipt key is already reserved or stored');
    if (this.total.bytes >= this.maxBytes || this.usage(tenantId).bytes >= this.perTenantMaxBytes) capacity();
    this.check(tenantId, 0);
    const entry: Entry = { tenantId, bytes: 0 };
    this.entries.set(key, entry); this.account(tenantId, 1, 0);
    let prepared = false, finished = false;
    const active = () => {
      if (finished || this.entries.get(key) !== entry) throw new Error('Retry receipt reservation is no longer active');
    };
    return {
      prepare: value => {
        active(); this.prune();
        const bytes = byteLength(value);
        this.check(tenantId, bytes, entry);
        this.account(tenantId, 0, bytes - entry.bytes);
        entry.bytes = bytes; entry.value = value; prepared = true;
      },
      commit: (expiresAt = this.now() + RETRY_TTL_MS) => {
        active();
        if (!prepared) throw new Error('Retry receipt must be prepared before commit');
        entry.expiresAt = expiresAt; finished = true;
      },
      release: () => {
        if (!finished && this.entries.get(key) === entry) this.delete(key);
        finished = true;
      },
    };
  }
  /** Atomic insert/replace for already available receipts; failure keeps the old value. */
  set(tenantId: string, key: string, value: unknown): void {
    this.prune();
    const previous = this.entries.get(key), bytes = byteLength(value);
    if (previous && previous.expiresAt === undefined) throw new Error('Retry receipt key is reserved');
    this.check(tenantId, bytes, previous);
    if (previous) this.account(previous.tenantId, -1, -previous.bytes);
    this.entries.set(key, { tenantId, bytes, value, expiresAt: this.now() + RETRY_TTL_MS });
    this.account(tenantId, 1, bytes);
  }
  delete(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key); this.account(entry.tenantId, -1, -entry.bytes); return true;
  }
  prune(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt !== undefined && entry.expiresAt <= now) this.delete(key);
  }
}
