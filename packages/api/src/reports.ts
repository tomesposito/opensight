import { randomUUID } from 'node:crypto';
import { compileVisual, displayCell, type CompiledVisual } from '@opensight/web/compiler';
import type { AutomationStore } from './automation-store.js';
import type { RefreshState } from './refresh.js';
import { enabled, id, nextRun, record, validateSchedule, type Schedule } from './schedule.js';
import { MailError, recipients, type MailTransport } from './mail.js';
import { RequestError, type SalesQuery } from './query.js';
import type { DefinitionStore } from './store.js';
import { isObject } from './mapping.js';

export interface Subscription { id: string; userId: string; dashboardId: string; recipients: string[]; enabled: boolean; schedule: Schedule; nextRun: string | null }
export interface ReportRun { id: string; subscriptionId: string; userId: string; startedAt: string; finishedAt: string | null; state: 'running' | 'sent' | 'failed'; error: { code: string; message: string } | null }
export interface DashboardSnapshot { dashboardId: string; title: string; capturedAt: string; visuals: CompiledVisual[] }
export interface SnapshotProvider { has(dashboardId: string): boolean; capture(dashboardId: string): Promise<DashboardSnapshot> }
export const escapeHtml = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/** Email-safe HTML uses the compiler's ordered cells, labels, visibility and options. */
export function assembleReport(snapshot: DashboardSnapshot): string {
  const sections = snapshot.visuals.map(visual => {
    const { model, table, state, option } = visual;
    const color = typeof option.backgroundColor === 'string' && /^#[a-f0-9]{6}$/i.test(option.backgroundColor) ? option.backgroundColor : '#ffffff';
    const title = model.titleVisible ? `<h2>${escapeHtml(model.title)}</h2>` : '';
    const cells = table.rows.map(row => `<tr>${row.map(value => `<td style="padding:6px;border:1px solid #dddddd">${escapeHtml(typeof value === 'number' && model.formatting?.decimalPlaces !== undefined ? value.toFixed(model.formatting.decimalPlaces) : displayCell(value))}</td>`).join('')}</tr>`).join('');
    const header = model.formatting?.headersVisible === false ? '' : `<thead><tr>${(table.visibleColumns ?? table.columns).map(c => `<th scope="col">${escapeHtml(c)}</th>`).join('')}</tr></thead>`;
    const body = state === 'unavailable' ? '<p>Data unavailable — needs a resolved hosted API source.</p>' : state === 'empty' ? '<p>No results.</p>' : `<table style="border-collapse:collapse">${header}<tbody>${cells}</tbody></table>`;
    const warnings = model.warnings.map(w => `<p>${escapeHtml(w)}</p>`).join('');
    return `<section style="background:${color};padding:16px">${title}${body}${warnings}</section>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(snapshot.title)}</title></head><body><h1>${escapeHtml(snapshot.title)}</h1><p>Dashboard snapshot · ${escapeHtml(snapshot.capturedAt)}</p>${sections || '<p>No visuals in this dashboard.</p>'}</body></html>`;
}

export class DashboardSnapshots implements SnapshotProvider {
  constructor(private readonly definitions: DefinitionStore, private readonly sales?: SalesQuery) {}
  has(dashboardId: string): boolean { return !!this.definitions.get('dashboard', dashboardId); }
  async capture(dashboardId: string): Promise<DashboardSnapshot> {
    const dashboard = this.definitions.get('dashboard', dashboardId);
    if (!dashboard) throw new RequestError(404, 'Dashboard not found');
    const definition = dashboard.Definition;
    if (!isObject(definition) || !Array.isArray(definition.Sheets) || !this.sales) throw new Error('Snapshot source is not resolved');
    const visuals: CompiledVisual[] = [];
    for (const [si, sheet] of definition.Sheets.entries()) {
      if (!isObject(sheet) || !Array.isArray(sheet.Visuals)) throw new Error('Invalid snapshot sheet');
      for (const [vi, visual] of sheet.Visuals.entries()) {
        if (!isObject(visual) || Object.keys(visual).length !== 1) throw new Error('Invalid snapshot visual');
        const body = Object.values(visual)[0];
        if (!isObject(body) || typeof body.VisualId !== 'string') throw new Error('Invalid snapshot visual');
        const result = await this.sales.executeVisual(definition, body.VisualId);
        visuals.push(compileVisual({ source: 'api', definition: visual, rows: result.rows, bindings: Object.fromEntries([...result.plan.dimensions, ...result.plan.measures].map(f => [f.fieldId, f.outputName])), path: `Definition.Sheets[${si}].Visuals[${vi}]` }));
      }
    }
    return { dashboardId, title: typeof dashboard.Name === 'string' ? dashboard.Name : dashboardId, capturedAt: new Date().toISOString(), visuals };
  }
}

export class ReportService {
  private readonly running = new Map<string, Promise<ReportRun>>();
  constructor(private readonly store: AutomationStore<RefreshState>, private readonly snapshots: SnapshotProvider, readonly mail: MailTransport, private readonly now = () => new Date()) {}
  list(userId: string): Subscription[] { return this.store.read().subscriptions.filter(s => s.userId === userId); }
  get(userId: string, subscriptionId: string): Subscription {
    const resource = this.list(userId).find(s => s.id === subscriptionId);
    if (!resource) throw new RequestError(404, 'Subscription not found');
    return resource;
  }
  history(userId: string, subscriptionId: string): ReportRun[] {
    // History remains addressable after deletion, scoped by the owning user.
    const runs = this.store.read().reportRuns.filter(r => r.subscriptionId === subscriptionId && r.userId === userId);
    if (!runs.length) this.get(userId, subscriptionId);
    return runs;
  }
  async put(userId: string, subscriptionId: string, raw: unknown): Promise<Subscription> {
    const body = record(raw, ['dashboardId', 'recipients', 'enabled', 'schedule']);
    const dashboardId = id(body.dashboardId, '$.dashboardId');
    if (!this.snapshots.has(dashboardId)) throw new RequestError(404, 'Dashboard not found');
    const active = enabled(body.enabled), schedule = validateSchedule(body.schedule);
    const resource: Subscription = { id: subscriptionId, userId, dashboardId, recipients: recipients(body.recipients), enabled: active, schedule, nextRun: active ? nextRun(schedule, this.now()) : null };
    return this.store.change(state => { state.subscriptions = state.subscriptions.filter(s => !(s.id === subscriptionId && s.userId === userId)); state.subscriptions.push(resource); return resource; });
  }
  async remove(userId: string, subscriptionId: string): Promise<void> {
    await this.store.change(state => {
      if (!state.subscriptions.some(s => s.id === subscriptionId && s.userId === userId)) throw new RequestError(404, 'Subscription not found');
      state.subscriptions = state.subscriptions.filter(s => !(s.id === subscriptionId && s.userId === userId));
    });
  }
  async recover(): Promise<void> {
    await this.store.change(state => { for (const run of state.reportRuns.filter(r => r.state === 'running')) Object.assign(run, { state: 'failed', finishedAt: this.now().toISOString(), error: { code: 'REPORT_INTERRUPTED', message: 'Report interrupted; delivery outcome unknown' } }); });
  }
  async tick(): Promise<void> {
    for (const s of this.store.read().subscriptions) {
      if (!s.enabled || !s.nextRun || s.nextRun > this.now().toISOString() || this.running.has(`${s.userId}/${s.id}`)) continue;
      const claimed = await this.store.change(state => {
        const current = state.subscriptions.find(r => r.id === s.id && r.userId === s.userId);
        if (!current?.enabled || current.nextRun !== s.nextRun) return false;
        current.nextRun = nextRun(current.schedule, this.now()); return true;
      });
      if (claimed) await this.run(s.userId, s.id);
    }
  }
  run(userId: string, subscriptionId: string): Promise<ReportRun> {
    const resource = this.get(userId, subscriptionId), key = `${userId}/${subscriptionId}`;
    const previous = this.running.get(key); if (previous) return previous;
    const promise = this.execute(resource).finally(() => this.running.delete(key)); this.running.set(key, promise); return promise;
  }
  private async execute(s: Subscription): Promise<ReportRun> {
    const run: ReportRun = { id: randomUUID(), subscriptionId: s.id, userId: s.userId, startedAt: this.now().toISOString(), finishedAt: null, state: 'running', error: null };
    await this.store.change(state => { state.reportRuns.push(run); });
    try {
      if (!this.mail.configured) throw new MailError('SMTP_NOT_CONFIGURED');
      const snapshot = await this.snapshots.capture(s.dashboardId);
      await this.mail.send({ to: s.recipients, subject: `OpenSight report: ${snapshot.title.replace(/[\r\n\0]/g, ' ').slice(0, 150)}`, html: assembleReport(snapshot) });
      run.state = 'sent';
    } catch (error) {
      run.state = 'failed'; run.error = error instanceof MailError ? { code: error.code, message: error.message } : { code: 'SNAPSHOT_FAILED', message: 'Unable to assemble dashboard snapshot from its configured source' };
    }
    run.finishedAt = this.now().toISOString();
    await this.store.change(state => { state.reportRuns[state.reportRuns.findIndex(r => r.id === run.id)] = run; });
    return run;
  }
}
