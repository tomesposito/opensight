import { randomUUID } from 'node:crypto';
import type { Scope } from './metadata-resources.js';
import type { AnalyticsStore } from './analytics-store.js';
import type { SourceBinding } from './source-schema.js';

export const rowCountBuckets = ['0', '1-99', '100-999', '1000-9999', '10000+'] as const;
export type RowCountBucket = typeof rowCountBuckets[number];
export function rowCountBucket(count: number): RowCountBucket {
  return count === 0 ? '0' : count < 100 ? '1-99' : count < 1000 ? '100-999' : count < 10000 ? '1000-9999' : '10000+';
}
type EmptyEventName = 'tenant_provisioned' | 'user_invited' | 'user_activated' | 'dataset_prep_saved'
  | 'analysis_created' | 'analysis_first_visual' | 'dashboard_viewed' | 'dashboard_shared' | 'embed_viewed' | 'sample_data_opted_in';
export type AnalyticsEvent = { name: EmptyEventName; props?: Record<string, never> }
  | { name: 'dataset_uploaded'; props: { sourceType: SourceBinding['connectorId']; rowCountBucket: RowCountBucket } }
  | { name: 'ask_o_asked'; props: { count: number } };
export interface AnalyticsRow { id: string; tenantId: string; namespaceId: string; name: AnalyticsEvent['name']; props: Record<string, string | number>; createdAt: string }
const emptyNames: readonly string[] = ['tenant_provisioned', 'user_invited', 'user_activated', 'dataset_prep_saved', 'analysis_created',
  'analysis_first_visual', 'dashboard_viewed', 'dashboard_shared', 'embed_viewed', 'sample_data_opted_in'];
/** Inspect descriptors, never invoke getters or toJSON supplied by a caller. Copy only schema fields. */
export function validateAnalyticsEvent(raw: unknown): Pick<AnalyticsRow, 'name' | 'props'> | undefined {
  const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const keys = (v: object, allowed: string[]) => Reflect.ownKeys(v).every(k => typeof k === 'string' && allowed.includes(k) && 'value' in Object.getOwnPropertyDescriptor(v, k)!);
  if (!plain(raw) || !keys(raw, ['name', 'props'])) return;
  const name = raw.name, props = raw.props === undefined ? {} : raw.props;
  if (!plain(props)) return;
  if (typeof name === 'string' && emptyNames.includes(name) && keys(props, [])) return { name: name as EmptyEventName, props: {} };
  if (name === 'dataset_uploaded' && keys(props, ['sourceType', 'rowCountBucket']) && typeof props.sourceType === 'string' && ['file', 'postgresql'].includes(props.sourceType) && rowCountBuckets.includes(props.rowCountBucket as RowCountBucket)) {
    return { name, props: { sourceType: props.sourceType, rowCountBucket: props.rowCountBucket as RowCountBucket } };
  }
  if (name === 'ask_o_asked' && keys(props, ['count']) && typeof props.count === 'number' && Number.isSafeInteger(props.count) && props.count > 0) return { name, props: { count: props.count } };
}
export type AnalyticsTransport = (url: string, init: RequestInit) => Promise<{ ok: boolean }>;
export interface AnalyticsOptions {
  enabled?: boolean;
  /** Local composition maps namespaces to opaque installation tenant IDs. */
  localScopes?: ReadonlyMap<string, Scope>;
  vendorKey?: string;
  vendorHost?: string;
  maxBuffered?: number;
  transport?: AnalyticsTransport;
  timeoutMs?: number;
}
export function analyticsFromEnvironment(env: NodeJS.ProcessEnv = process.env): AnalyticsOptions {
  return { enabled: env.ANALYTICS_ENABLED === '1', vendorKey: env.ANALYTICS_VENDOR_KEY, vendorHost: env.ANALYTICS_VENDOR_HOST ?? 'https://us.i.posthog.com' };
}
export function analyticsHost(raw = 'https://us.i.posthog.com'): string | undefined {
  try { const url = new URL(raw); if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/') return url.origin; } catch { /* Honest off for invalid configuration. */ }
}
/** Server-only door. Scopes come from authentication/provisioning, never HTTP bodies. */
export class Analytics {
  readonly stats = { invalid: 0, dropped: 0, failed: 0, recorded: 0 };
  readonly configured: boolean;
  readonly defaultEnabled: boolean;
  private readonly queue: { scope: Scope; event: Pick<AnalyticsRow, 'name' | 'props'>; id: string; createdAt: string }[] = [];
  private running?: Promise<void>;
  private closed = false;
  constructor(readonly store?: AnalyticsStore, private readonly options: AnalyticsOptions = {}) {
    this.defaultEnabled = options.enabled === true;
    this.configured = !!store && !!options.vendorKey?.trim() && !!analyticsHost(options.vendorHost);
  }
  track(scope: Scope, event: AnalyticsEvent): void {
    try {
      if (this.closed || !this.configured) return;
      const checked = validateAnalyticsEvent(event);
      if (!checked) { this.stats.invalid++; return; }
      if (this.queue.length >= (this.options.maxBuffered ?? 256)) { this.stats.dropped++; return; }
      const trusted = this.options.localScopes ? this.options.localScopes.get(scope.namespaceId) : scope;
      if (!trusted) { this.stats.dropped++; return; }
      this.queue.push({ scope: { tenantId: trusted.tenantId, namespaceId: trusted.namespaceId }, event: checked, id: randomUUID(), createdAt: new Date().toISOString() });
      this.start();
    } catch { this.stats.invalid++; }
  }
  private start(): void {
    this.running ??= Promise.resolve().then(async () => {
      while (this.queue.length) {
        const entry = this.queue.shift()!;
        try {
          const row: AnalyticsRow = { ...entry.event, ...entry.scope, id: entry.id, createdAt: entry.createdAt };
          if (!await this.store!.append(row, this.defaultEnabled)) continue;
          this.stats.recorded++;
          if (await this.store!.enabled(entry.scope, this.defaultEnabled)) await this.deliver(row);
        } catch { this.stats.failed++; }
      }
    }).catch(() => { this.stats.failed++; }).finally(() => { this.running = undefined; if (this.queue.length) this.start(); });
  }
  private async deliver(row: AnalyticsRow): Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('ANALYTICS_TIMEOUT')); }, this.options.timeoutMs ?? 2000);
      });
      const response = await Promise.race([deadline, (this.options.transport ?? fetch)(`${analyticsHost(this.options.vendorHost)}/capture/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: controller.signal,
        body: JSON.stringify({ api_key: this.options.vendorKey, event: row.name, timestamp: row.createdAt, uuid: row.id,
          properties: { ...row.props, distinct_id: row.tenantId, $groups: { tenant: row.tenantId }, $process_person_profile: false } }),
      })]);
      if (!response.ok) throw new Error('ANALYTICS_DELIVERY_FAILED');
    } finally { clearTimeout(timer); }
  }
  async flush(): Promise<void> { while (this.running) await this.running; }
  async close(): Promise<void> { this.closed = true; await this.flush(); }
}
export const disabledAnalytics = new Analytics();
