import { eventContext } from './hosted-events.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { MetadataError } from './metadata-db.js';
import type { TenantContext } from './metadata.js';

export interface WorkLimits {
  running: number; queued: number; executionMs: number; queueMs: number;
  sourceRows: number; resultBytes: number; workingBytes: number; cacheBytes: number;
  workerRssBytes: number; workerHeapMb: number; duckdbMemoryMb: number; cellChars: number;
}
export interface BudgetConfig { node: WorkLimits & { refreshSlots: number }; defaults: WorkLimits; tenants: Record<string, WorkLimits> }
export function budgetError(code: string): never { throw new MetadataError(code, code === 'EXECUTION_CANCELLED' ? 409 : 429); }
const fields = ['running', 'queued', 'executionMs', 'queueMs', 'sourceRows', 'resultBytes', 'workingBytes', 'cacheBytes', 'workerRssBytes', 'workerHeapMb', 'duckdbMemoryMb', 'cellChars'] as const;
export function validateBudgets(raw: unknown): BudgetConfig {
  const invalid = (): never => { throw new MetadataError('BUDGET_CONFIG_INVALID', 503); };
  const object = (v: unknown): Record<string, unknown> => !v || typeof v !== 'object' || Array.isArray(v) ? invalid() : v as Record<string, unknown>;
  const config = object(raw), node = object(config.node), defaults = object(config.defaults), tenants = object(config.tenants);
  if (Object.keys(config).sort().join() !== 'defaults,node,tenants') invalid();
  const limits = (v: Record<string, unknown>, isNode = false) => {
    const allowed: readonly string[] = isNode ? [...fields, 'refreshSlots'] : fields;
    if (Object.keys(v).length !== allowed.length || Object.keys(v).some(k => !allowed.includes(k))) invalid();
    for (const k of allowed) if (!Number.isSafeInteger(v[k]) || Number(v[k]) < (['queued', 'refreshSlots'].includes(k) ? 0 : 1) || Number(v[k]) > 2_147_483_647) invalid();
    if (Number(v.resultBytes) > Number(v.workingBytes) || Number(v.workerHeapMb) * 1048576 > Number(v.workerRssBytes) || Number(v.duckdbMemoryMb) * 1048576 > Number(v.workerRssBytes)) invalid();
  };
  limits(node, true); limits(defaults);
  if (Number(node.refreshSlots) < 1 || Number(node.refreshSlots) >= Number(node.running)) invalid();
  for (const [id, value] of Object.entries(tenants)) { if (!/^[A-Za-z0-9_-]{1,512}$/.test(id)) invalid(); limits(object(value)); }
  for (const v of [defaults, ...Object.values(tenants).map(object)]) for (const k of fields) if (Number(v[k]) > Number(node[k])) invalid();
  return structuredClone(raw) as BudgetConfig;
}
export interface Usage {
  running: number; queued: number; completed: number; cancelled: number; rejected: number;
  executionMs: number; sourceRows: number; peakRunning: number; peakQueued: number;
  maxQueueMs: number; maxExecutionMs: number; peakWorkerRssBytes: number; peakWorkingBytes: number; workerExecutions: number;
}
const usage = (): Usage => ({ running: 0, queued: 0, completed: 0, cancelled: 0, rejected: 0, executionMs: 0, sourceRows: 0, peakRunning: 0, peakQueued: 0, maxQueueMs: 0, maxExecutionMs: 0, peakWorkerRssBytes: 0, peakWorkingBytes: 0, workerExecutions: 0 });
export class WorkScope {
  readonly controller = new AbortController();
  readonly started = performance.now();
  sourceRows = 0;
  workingBytes = 0;
  private readonly rollback: (() => void)[] = [];
  onFailure(work: () => void): void { this.rollback.push(work); }
  failed(): void { for (const work of this.rollback) work(); }
  constructor(readonly tenantId: string, readonly limits: WorkLimits, private readonly account: Usage) {}
  get signal(): AbortSignal { return this.controller.signal; }
  cancel(): void { this.controller.abort(); this.failed(); }
  check(): void {
    if (performance.now() - this.started >= this.limits.executionMs) this.cancel();
    if (this.signal.aborted) budgetError('EXECUTION_CANCELLED');
  }
  workerStarted(): void { this.account.workerExecutions++; }
  rows(count: number): void {
    this.check();
    if (!Number.isSafeInteger(count) || count < 0) budgetError('EXECUTOR_PRESSURE_INVALID');
    this.sourceRows += count; this.account.sourceRows += count;
    if (this.sourceRows > this.limits.sourceRows) budgetError('TENANT_BUDGET_EXCEEDED');
  }
  memory(bytes: number): void { this.check(); this.workingBytes += bytes; this.account.peakWorkingBytes = Math.max(this.account.peakWorkingBytes, this.workingBytes); if (this.workingBytes > this.limits.workingBytes) budgetError('TENANT_BUDGET_EXCEEDED'); }
  rss(bytes: number): void { this.account.peakWorkerRssBytes = Math.max(this.account.peakWorkerRssBytes, bytes); if (bytes > this.limits.workerRssBytes) this.cancel(); }
}
interface Job { tenantId: string; refresh: boolean; enqueued: number; start(): void; reject(error: unknown): void }
/** One scheduler per node. Queue entries hold closures only; sources open after dequeue/recheck. */
export class TenantBudgets {
  readonly config: BudgetConfig;
  private readonly local = new AsyncLocalStorage<WorkScope>();
  private readonly accounts = new Map<string, Usage>();
  private readonly queues = new Map<string, Job[]>();
  private readonly scopes = new Set<WorkScope>();
  private running = 0;
  private queries = 0;
  private queued = 0;
  private lastTenant = '';
  private closed = false;
  private readonly drained: (() => void)[] = [];
  async shutdown(): Promise<void> { this.close(); if (this.running) await new Promise<void>(resolve => this.drained.push(resolve)); }
  constructor(config: BudgetConfig, private readonly context: (context: TenantContext) => void) { this.config = validateBudgets(config); }
  limits(tenantId: string): WorkLimits { return Object.hasOwn(this.config.tenants, tenantId) ? this.config.tenants[tenantId]! : this.config.defaults; }
  aggregate(): Usage {
    const total = usage();
    for (const entry of this.accounts.values()) for (const key of Object.keys(total) as (keyof Usage)[]) {
      total[key] = key.startsWith('peak') || key.startsWith('max') ? Math.max(total[key], entry[key]) : total[key] + entry[key];
    }
    return total;
  }
  snapshot(tenantId: string): Usage { return { ...this.account(tenantId) }; }
  node(): { running: number; queued: number } { return { running: this.running, queued: this.queued }; }
  private account(id: string): Usage { let a = this.accounts.get(id); if (!a) { a = usage(); this.accounts.set(id, a); } return a; }
  current(context: TenantContext): WorkScope {
    this.context(context);
    const scope = this.local.getStore();
    if (!scope || scope.tenantId !== context.tenantId) budgetError('WORK_ADMISSION_REQUIRED');
    scope.check(); return scope;
  }
  close(): void {
    this.closed = true;
    for (const scope of this.scopes) scope.cancel();
    for (const queue of [...this.queues.values()]) for (const job of [...queue]) job.reject(new MetadataError('EXECUTION_CANCELLED'));
  }
  private slotAvailable(tenantId: string, refresh: boolean): boolean {
    return this.running < this.config.node.running && this.account(tenantId).running < this.limits(tenantId).running
      && (refresh || this.queries < this.config.node.running - this.config.node.refreshSlots);
  }
  private available(tenantId: string, refresh: boolean): boolean {
    const active = [...this.scopes];
    const limits = this.limits(tenantId);
    return active.reduce((n, s) => n + s.limits.workingBytes, 0) + limits.workingBytes <= this.config.node.workingBytes
      && active.reduce((n, s) => n + s.limits.workerRssBytes, 0) + limits.workerRssBytes <= this.config.node.workerRssBytes
      && this.slotAvailable(tenantId, refresh);
  }
  private drain(): void {
    if (this.closed) return;
    for (;;) {
      const ids = [...this.queues.keys()].sort();
      const after = ids.filter(id => id > this.lastTenant), order = [...after, ...ids.filter(id => id <= this.lastTenant)];
      let found = false;
      for (const id of order) {
        const queue = this.queues.get(id)!;
        // A reserved refresh can pass queries waiting for the general pool.
        const job = queue.find(j => this.slotAvailable(id, j.refresh));
        if (!job) continue;
        // Preserve this tenant's turn while existing memory reservations drain.
        // Refilling smaller jobs here could indefinitely starve a larger admitted job.
        if (!this.available(id, job.refresh)) return;
        this.lastTenant = id; job.start(); found = true; break;
      }
      if (!found) break;
    }
  }
  run<T>(context: TenantContext, refresh: boolean, recheck: () => Promise<void>, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.context(context); // Reject copied/missing contexts synchronously, before any allocation.
    const id = context.tenantId, a = this.account(id), limits = this.limits(id), telemetry = eventContext.getStore();
    const reject = (code: string): never => { a.rejected++; budgetError(code); };
    if (this.closed) reject('NODE_ADMISSION_REFUSED');
    if (signal?.aborted) reject('EXECUTION_CANCELLED');
    const immediate = this.queued === 0 && this.available(id, refresh);
    if (!immediate && a.queued >= limits.queued) reject('TENANT_BUDGET_EXCEEDED');
    if (!immediate && this.queued >= this.config.node.queued) reject('NODE_ADMISSION_REFUSED');
    return new Promise<T>((resolve, fail) => {
      let state: 'new' | 'queued' | 'running' | 'done' = 'new';
      let timer: ReturnType<typeof setTimeout> | undefined, scope: WorkScope | undefined;
      const remove = () => {
        if (timer) clearTimeout(timer);
        if (state === 'queued') {
          const q = this.queues.get(id)!; q.splice(q.indexOf(job), 1); if (!q.length) this.queues.delete(id);
          a.queued--; this.queued--;
        }
      };
      const abort = () => { if (state === 'running') scope!.cancel(); else job.reject(new MetadataError('EXECUTION_CANCELLED')); };
      const job: Job = { tenantId: id, refresh, enqueued: performance.now(),
        reject: error => {
          if (state === 'running' || state === 'done') return;
          remove(); state = 'done'; signal?.removeEventListener('abort', abort); a.rejected++; fail(error); this.drain();
        },
        start: () => {
          remove(); state = 'running'; this.lastTenant = id;
          a.maxQueueMs = Math.max(a.maxQueueMs, performance.now() - job.enqueued);
          a.running++; this.running++; if (!refresh) this.queries++;
          a.peakRunning = Math.max(a.peakRunning, a.running);
          scope = new WorkScope(id, limits, a); this.scopes.add(scope);
          timer = setTimeout(() => scope!.cancel(), limits.executionMs);
          void this.local.run(scope, async () => {
            try { scope!.check(); await recheck(); scope!.check(); const result = await work(); scope!.check(); await recheck(); scope!.check(); a.completed++; resolve(result); }
            catch (error) {
              if (error && typeof error === 'object' && 'code' in error && error.code === 'EXECUTION_CANCELLED') scope!.cancel();
              scope!.failed(); if (scope!.signal.aborted) { a.cancelled++; fail(new MetadataError('EXECUTION_CANCELLED')); } else fail(error); }
            finally {
              clearTimeout(timer); signal?.removeEventListener('abort', abort); state = 'done';
              const elapsed = performance.now() - scope!.started; a.executionMs += elapsed; a.maxExecutionMs = Math.max(a.maxExecutionMs, elapsed);
              if (telemetry?.usage) { telemetry.usage.executionMs += elapsed; telemetry.usage.sourceRows += scope!.sourceRows; telemetry.usage.workingBytes += scope!.workingBytes; }
              this.scopes.delete(scope!); a.running--; this.running--; if (!refresh) this.queries--; this.drain();
              if (!this.running) for (const resolve of this.drained.splice(0)) resolve();
            }
          });
        } };
      signal?.addEventListener('abort', abort, { once: true });
      if (immediate) job.start();
      else {
        state = 'queued'; const queue = this.queues.get(id) ?? []; queue.push(job); this.queues.set(id, queue);
        a.queued++; this.queued++; a.peakQueued = Math.max(a.peakQueued, a.queued);
        timer = setTimeout(() => job.reject(new MetadataError('QUEUE_WAIT_EXCEEDED', 429)), limits.queueMs);
        this.drain();
      }
    });
  }
}
