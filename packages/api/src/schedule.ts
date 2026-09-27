import { isObject } from './mapping.js';
import { RequestError } from './query.js';
import { RESOURCE_ID } from './store.js';

export type Schedule = { kind: 'interval'; minutes: number; timeZone: string }
  | { kind: 'daily'; at: string; timeZone: string }
  | { kind: 'weekly'; at: string; weekday: number; timeZone: string };

export function invalid(path: string, message: string): never { throw new RequestError(400, `${path}: ${message}`); }
export function record(value: unknown, allowed: readonly string[], path = '$'): Record<string, unknown> {
  if (!isObject(value) || Object.keys(value).some(k => !allowed.includes(k))) invalid(path, 'expected an object with supported properties');
  return value;
}
export function id(value: unknown, path: string): string {
  if (typeof value !== 'string' || !RESOURCE_ID.test(value)) invalid(path, 'invalid resource ID');
  return value;
}
export function enabled(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid('$.enabled', 'expected a boolean');
  return value;
}
export function validateSchedule(value: unknown): Schedule {
  const s = record(value, ['kind', 'minutes', 'at', 'weekday', 'timeZone'], '$.schedule');
  if (typeof s.timeZone !== 'string' || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(s.timeZone)) invalid('$.schedule.timeZone', 'expected an IANA timezone');
  try { new Intl.DateTimeFormat('en', { timeZone: s.timeZone }); }
  catch { invalid('$.schedule.timeZone', 'expected an IANA timezone'); }
  const timeZone = s.timeZone;
  if (s.kind === 'interval') {
    record(s, ['kind', 'minutes', 'timeZone'], '$.schedule');
    if (!Number.isSafeInteger(s.minutes) || Number(s.minutes) < 1 || Number(s.minutes) > 525600) invalid('$.schedule.minutes', 'expected 1–525600 whole minutes');
    return { kind: 'interval', minutes: Number(s.minutes), timeZone };
  }
  if (s.kind !== 'daily' && s.kind !== 'weekly') invalid('$.schedule.kind', 'expected interval, daily or weekly');
  record(s, s.kind === 'daily' ? ['kind', 'at', 'timeZone'] : ['kind', 'at', 'timeZone', 'weekday'], '$.schedule');
  if (typeof s.at !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s.at)) invalid('$.schedule.at', 'expected HH:MM');
  if (s.kind === 'daily') return { kind: 'daily', at: s.at, timeZone };
  if (!Number.isInteger(s.weekday) || Number(s.weekday) < 0 || Number(s.weekday) > 6) invalid('$.schedule.weekday', 'expected 0 (Sunday) through 6 (Saturday)');
  return { kind: 'weekly', at: s.at, weekday: Number(s.weekday), timeZone };
}

/** Strictly after the anchor. DST gaps are skipped; folds run once per local day. */
export function nextRun(schedule: Schedule, after: Date): string {
  if (schedule.kind === 'interval') return new Date(after.getTime() + schedule.minutes * 60000).toISOString();
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: schedule.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const parts = (time: number) => Object.fromEntries(formatter.formatToParts(time).map(p => [p.type, p.value]));
  const start = parts(after.getTime());
  const dateKey = (p: Record<string, string>) => `${p.year}-${p.month}-${p.day}`;
  const skipToday = `${start.hour}:${start.minute}` >= schedule.at;
  // Sixteen days covers a skipped weekly occurrence plus the next one, with DST slack.
  for (let time = Math.floor(after.getTime() / 60000) * 60000 + 60000, end = time + 16 * 86400000; time < end; time += 60000) {
    const p = parts(time);
    if (skipToday && dateKey(p) === dateKey(start)) continue;
    if (`${p.hour}:${p.minute}` === schedule.at && (schedule.kind === 'daily' || ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][schedule.weekday] === p.weekday)) return new Date(time).toISOString();
  }
  throw new Error('No schedule occurrence found');
}

/** Single-flight ticks; delayed ticks coalesce missed occurrences instead of replaying. */
export class Scheduler {
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  constructor(private readonly tick: () => Promise<void>, private readonly onError: () => void = () => console.error('OpenSight scheduler tick failed')) {}
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.run(); }, 1000);
    this.timer.unref();
    void this.run();
  }
  run(): Promise<void> {
    return this.pending ??= this.tick().catch(() => this.onError()).finally(() => { this.pending = undefined; });
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  async idle(): Promise<void> { await this.pending; }
}
