import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ChildProcess } from 'node:child_process';
import { MetadataError } from './metadata-db.js';

export interface InvocationContext { getRemainingTimeInMillis(): number }
export interface InvocationResource { close(): Promise<void>; force(): void }
const current = new AsyncLocalStorage<InvocationScope>();
const directories = new Set<string>();
let poisoned = false;

/** No success may escape this scope until every owned resource has settled. */
export class InvocationScope {
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private readonly resources: InvocationResource[] = [];
  private readonly pending = new Set<Promise<unknown>>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private closing?: Promise<void>;
  private stopped = false;
  private directory?: string;
  constructor(readonly deadline: number, readonly cleanupMs = 3000) {
    if (poisoned) throw new MetadataError('RUNTIME_QUARANTINED', 503);
    if (!Number.isFinite(deadline) || !Number.isInteger(cleanupMs) || cleanupMs < 1 || cleanupMs > 3000) throw new MetadataError('RUNTIME_CONFIG_INVALID', 503);
  }
  static current(): InvocationScope | undefined { return current.getStore(); }
  check(): void {
    if (this.stopped || this.signal.aborted || Date.now() >= this.deadline - this.cleanupMs) throw new MetadataError('INVOCATION_DEADLINE_EXCEEDED', 503);
  }
  remaining(): number { this.check(); return this.deadline - this.cleanupMs - Date.now(); }
  own<T extends InvocationResource>(resource: T): T {
    try { this.check(); } catch (error) { resource.force(); this.track(resource.close()); throw error; }
    this.resources.push(resource); return resource;
  }
  track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    void promise.then(() => this.pending.delete(promise), () => this.pending.delete(promise));
    return promise;
  }
  /** Cancellation closes the underlying resource; cleanup also awaits late settlement. */
  async stage<T>(work: () => Promise<T>, maximumMs: number, cancel: () => void, code = 'INVOCATION_DEADLINE_EXCEEDED'): Promise<T> {
    const duration = Math.min(this.remaining(), maximumMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort = () => {};
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => { try { cancel(); } finally { reject(new MetadataError(code, 503)); } };
      timer = setTimeout(abort, duration); this.timers.add(timer);
      this.signal.addEventListener('abort', abort, { once: true });
    });
    try { const result = await Promise.race([this.track(Promise.resolve().then(() => { this.check(); return work(); })), interrupted]); this.check(); return result; }
    finally { clearTimeout(timer); this.timers.delete(timer!); this.signal.removeEventListener('abort', abort); }
  }
  worker(child: ChildProcess): void {
    const exited = this.track(new Promise<void>(resolve => child.once('close', () => resolve())));
    const force = () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); };
    this.own({ close: async () => { force(); await exited; }, force });
  }
  async temporaryDirectory(): Promise<string> {
    this.check();
    if (this.directory) return this.directory;
    const root = join(tmpdir(), 'opensight-invocations');
    await mkdir(root, { recursive: true, mode: 0o700 });
    // Lambda /tmp can survive process replacement. Only this runtime's private
    // namespace is swept, and live local invocations are never touched.
    for (const entry of await readdir(root)) if (entry.startsWith('inv-') && !directories.has(join(root, entry))) await rm(join(root, entry), { recursive: true, force: true });
    this.directory = await mkdtemp(join(root, 'inv-')); directories.add(this.directory);
    return this.directory;
  }
  async run<T>(work: (scope: InvocationScope) => Promise<T>): Promise<T> {
    return current.run(this, async () => {
      try { this.check(); return await this.stage(() => work(this), this.remaining(), () => this.controller.abort()); }
      finally { await this.close(); }
    });
  }
  close(): Promise<void> { return this.closing ??= this.dispose(); }
  private async dispose(): Promise<void> {
    this.stopped = true; this.controller.abort();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    let forceTimer: ReturnType<typeof setTimeout> | undefined, deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const force = () => { for (const resource of this.resources) { try { resource.force(); } catch { poisoned = true; } } };
    const remaining = Math.max(1, Math.min(this.cleanupMs, this.deadline - Date.now()));
    forceTimer = setTimeout(force, Math.max(1, Math.floor(remaining / 2)));
    try {
      const cleanup = (async () => {
        const results = await Promise.allSettled(this.resources.map(r => Promise.resolve().then(() => r.close())));
        await Promise.allSettled([...this.pending]);
        if (this.directory) { await rm(this.directory, { recursive: true, force: true }); directories.delete(this.directory); }
        if (results.some(r => r.status === 'rejected')) throw new MetadataError('INVOCATION_CLEANUP_FAILED', 503);
      })();
      await Promise.race([cleanup, new Promise<never>((_, reject) => {
        deadlineTimer = setTimeout(() => reject(new MetadataError('INVOCATION_CLEANUP_FAILED', 503)), remaining);
      })]);
    } catch { force(); poisoned = true; throw new MetadataError('INVOCATION_CLEANUP_FAILED', 503); }
    finally { clearTimeout(forceTimer); clearTimeout(deadlineTimer); }
  }
}

export function invocationDeadline(context: InvocationContext, requestTime = Date.now(), maximumMs = 25000): number {
  const now = Date.now(), remaining = context.getRemainingTimeInMillis();
  if (!Number.isFinite(remaining) || remaining <= 0 || !Number.isSafeInteger(requestTime) || requestTime > now) throw new MetadataError('INVOCATION_DEADLINE_EXCEEDED', 503);
  return Math.min(requestTime + maximumMs, now + remaining - 3000);
}
