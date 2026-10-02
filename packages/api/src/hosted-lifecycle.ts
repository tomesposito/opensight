import { MetadataError } from './metadata-db.js';

export function boundedSetting(env: NodeJS.ProcessEnv, key: string, fallback: number, max: number): number {
  const value = env[key];
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > max) throw new MetadataError('HOSTED_CONFIG_INVALID', 503);
  return Number(value);
}
export class HostedLifecycle {
  private state: 'starting' | 'serving' | 'draining' = 'starting';
  private inflight = 0;
  private pendingProbe?: Promise<boolean>;
  private listeners = new Set<() => void>();
  constructor(private readonly probe: () => Promise<void>, readonly maximum = 64, readonly probeMs = 2000) {}
  start(): void { if (this.state === 'starting') this.state = 'serving'; }
  get draining(): boolean { return this.state === 'draining'; }
  get active(): number { return this.inflight; }
  assertServing(): void { if (this.state !== 'serving') throw new MetadataError('NODE_DRAINING', 503); }
  admit(): () => void {
    this.assertServing();
    if (this.inflight >= this.maximum) throw new MetadataError('NODE_ADMISSION_REFUSED', 503);
    this.inflight++; let released = false;
    return () => { if (released) return; released = true; this.inflight--; if (!this.inflight) for (const notify of this.listeners) notify(); };
  }
  async ready(): Promise<boolean> {
    if (this.state !== 'serving') return false;
    // Keep a hung authoritative probe single-flight even after a caller times out.
    this.pendingProbe ??= this.probe().then(() => true, () => false).finally(() => { this.pendingProbe = undefined; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([this.pendingProbe, new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), this.probeMs); })]) && this.state === 'serving'; }
    finally { clearTimeout(timer); }
  }
  beginDrain(): void { this.state = 'draining'; }
  async drain(ms: number, cleanup: () => Promise<void>): Promise<boolean> {
    this.beginDrain();
    let notify: () => void = () => {}, timer: ReturnType<typeof setTimeout> | undefined;
    const idle = this.inflight ? new Promise<void>(resolve => { notify = resolve; this.listeners.add(notify); }) : Promise.resolve();
    try {
      return await Promise.race([Promise.all([idle, cleanup()]).then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), ms); })]);
    } finally { this.listeners.delete(notify); clearTimeout(timer); }
  }
}
