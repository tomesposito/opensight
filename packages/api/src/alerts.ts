import { randomUUID } from 'node:crypto';
import type { QueryResult, ResultValue } from '@opensight/query-engine';
import type { AutomationStore } from './automation-store.js';
import type { RefreshRun, RefreshState } from './refresh.js';
import type { DefinitionStore } from './store.js';
import { enabled, id, invalid, record } from './schedule.js';
import { RequestError, type SalesQuery } from './query.js';
import { MailError, recipients, type MailTransport } from './mail.js';
import { escapeHtml } from './reports.js';

export type AlertCondition = { kind: 'above' | 'below'; threshold: number }
  | { kind: 'percent-change'; comparison: 'above' | 'below'; threshold: number; period: { columnName: string; unit: 'day' | 'week' | 'month' } };
export interface AlertRule { id: string; datasetId: string; dashboardId: string; visualId: string; fieldId: string; dimensions: Record<string, ResultValue>; enabled: boolean; recipients: string[]; condition: AlertCondition }
export interface AlertState { ruleId: string; state: 'ok' | 'triggered'; evaluatedAt: string | null; error: { code: string; message: string } | null }
export interface AlertWebhook {
  version: 1; type: 'opensight.alert.state_changed'; eventId: string; occurredAt: string;
  ruleId: string; datasetId: string; dashboardId: string; visualId: string; fieldId: string; refreshRunId: string;
  from: 'ok' | 'triggered'; to: 'ok' | 'triggered'; value: number; previousValue: number | null; percentChange: number | null; condition: AlertCondition;
}
export interface AlertRun { id: string; ruleId: string; refreshRunId: string; startedAt: string; finishedAt: string | null; state: 'running' | 'evaluated' | 'failed'; value: number | null; previousValue: number | null; percentChange: number | null; error: { code: string; message: string } | null; notification: 'not-needed' | 'pending' | 'sent' | 'failed'; notificationError: { code: string; message: string } | null }
export interface MetricProvider { validate(rule: AlertRule): void; measure(rule: AlertRule, now: Date): Promise<{ current: number; previous?: number }> }
export class MetricError extends Error { constructor(readonly code: string, message: string) { super(message); } }
function name(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\x00-\x1f]/.test(value)) invalid(path, 'expected a field name');
  return value;
}
export function validateAlert(ruleId: string, raw: unknown): AlertRule {
  const b = record(raw, ['datasetId', 'dashboardId', 'visualId', 'fieldId', 'dimensions', 'enabled', 'recipients', 'condition']);
  const c = record(b.condition, ['kind', 'threshold', 'comparison', 'period'], '$.condition');
  if (typeof c.threshold !== 'number' || !Number.isFinite(c.threshold)) invalid('$.condition.threshold', 'expected a finite number');
  let condition: AlertCondition;
  if (c.kind === 'above' || c.kind === 'below') { record(c, ['kind', 'threshold'], '$.condition'); condition = { kind: c.kind, threshold: c.threshold }; }
  else if (c.kind === 'percent-change') {
    if (c.comparison !== 'above' && c.comparison !== 'below') invalid('$.condition.comparison', 'expected above or below');
    const p = record(c.period, ['columnName', 'unit'], '$.condition.period');
    if (p.unit !== 'day' && p.unit !== 'week' && p.unit !== 'month') invalid('$.condition.period.unit', 'expected day, week or month');
    condition = { kind: c.kind, threshold: c.threshold, comparison: c.comparison, period: { columnName: name(p.columnName, '$.condition.period.columnName'), unit: p.unit } };
  } else invalid('$.condition.kind', 'expected above, below or percent-change');
  const dimensions = b.dimensions ?? {};
  if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions) || Object.keys(dimensions).length > 20) invalid('$.dimensions', 'expected up to 20 dimension selectors');
  for (const [key, value] of Object.entries(dimensions)) {
    name(key, '$.dimensions');
    if (value !== null && !(typeof value === 'string' && value.length <= 1000 && !value.includes('\0')) && !(typeof value === 'number' && Number.isFinite(value))) invalid('$.dimensions', 'expected string, number or null values');
  }
  return { id: ruleId, datasetId: id(b.datasetId, '$.datasetId'), dashboardId: id(b.dashboardId, '$.dashboardId'), visualId: id(b.visualId, '$.visualId'), fieldId: name(b.fieldId, '$.fieldId'), dimensions: dimensions as Record<string, ResultValue>, enabled: enabled(b.enabled), recipients: recipients(b.recipients), condition };
}

/** The most recently completed UTC period, and the complete period before it. */
export function periodWindows(unit: 'day' | 'week' | 'month', now: Date): { current: { start: string; end: string }; previous: { start: string; end: string } } {
  const boundary = new Date(now); boundary.setUTCHours(0, 0, 0, 0);
  if (unit === 'month') boundary.setUTCDate(1);
  if (unit === 'week') boundary.setUTCDate(boundary.getUTCDate() - (boundary.getUTCDay() + 6) % 7);
  const back = (date: Date) => { const result = new Date(date); if (unit === 'month') result.setUTCMonth(result.getUTCMonth() - 1); else result.setUTCDate(result.getUTCDate() - (unit === 'week' ? 7 : 1)); return result; };
  const current = back(boundary), previous = back(current);
  return { current: { start: current.toISOString(), end: new Date(boundary.getTime() - 1).toISOString() }, previous: { start: previous.toISOString(), end: new Date(current.getTime() - 1).toISOString() } };
}
export function evaluateCondition(condition: AlertCondition, current: number, previous?: number): { triggered: boolean; percentChange: number | null } {
  if (!Number.isFinite(current)) throw new MetricError('METRIC_UNAVAILABLE', 'Metric is not a finite number');
  let value = current, percentChange: number | null = null;
  if (condition.kind === 'percent-change') {
    if (previous === undefined || !Number.isFinite(previous)) throw new MetricError('PREVIOUS_PERIOD_UNAVAILABLE', 'Previous period has no finite metric');
    if (previous === 0) throw new MetricError('ZERO_BASELINE', 'Percent change is undefined for a zero previous period');
    percentChange = (current - previous) / Math.abs(previous) * 100;
    if (!Number.isFinite(percentChange)) throw new MetricError('METRIC_UNAVAILABLE', 'Percent change is not finite');
    value = percentChange;
  }
  return { triggered: (condition.kind === 'percent-change' ? condition.comparison : condition.kind) === 'above' ? value > condition.threshold : value < condition.threshold, percentChange };
}

export class DashboardMetrics implements MetricProvider {
  constructor(private readonly definitions: DefinitionStore, private readonly sales?: SalesQuery) {}
  private definition(rule: AlertRule): unknown {
    if (rule.datasetId !== 'sales' || !this.sales) throw new RequestError(404, 'Dataset has no configured local metric binding');
    const dashboard = this.definitions.get('dashboard', rule.dashboardId);
    if (!dashboard) throw new RequestError(404, 'Dashboard not found');
    return dashboard.Definition;
  }
  validate(rule: AlertRule): void {
    const definition = this.definition(rule);
    const window = rule.condition.kind === 'percent-change' ? { ...periodWindows(rule.condition.period.unit, new Date()).current, columnName: rule.condition.period.columnName } : undefined;
    const plan = this.sales!.planDefinition(definition, rule.visualId, window);
    if (!plan.measures.some(m => m.fieldId === rule.fieldId)) invalid('$.fieldId', 'metric must reference a visual measure');
    if (Object.keys(rule.dimensions).some(key => !plan.dimensions.some(d => d.fieldId === key))) invalid('$.dimensions', 'selector must reference a visual dimension field ID');
  }
  async measure(rule: AlertRule, now: Date): Promise<{ current: number; previous?: number }> {
    const definition = this.definition(rule);
    const metric = (result: QueryResult): number => {
      const matches = result.rows.filter(row => Object.entries(rule.dimensions).every(([key, value]) => row[result.plan.dimensions.find(d => d.fieldId === key)!.outputName] === value));
      const measure = result.plan.measures.find(m => m.fieldId === rule.fieldId);
      const value = measure && matches[0]?.[measure.outputName];
      if (matches.length !== 1 || typeof value !== 'number' || !Number.isFinite(value)) throw new MetricError('METRIC_UNAVAILABLE', 'Metric requires exactly one finite aggregate value; supply dimension selectors for grouped visuals');
      return value;
    };
    if (rule.condition.kind !== 'percent-change') return { current: metric(await this.sales!.executeVisual(definition, rule.visualId)) };
    const windows = periodWindows(rule.condition.period.unit, now), columnName = rule.condition.period.columnName;
    const current = metric(await this.sales!.executeVisual(definition, rule.visualId, { columnName, ...windows.current }));
    let previous: number;
    try { previous = metric(await this.sales!.executeVisual(definition, rule.visualId, { columnName, ...windows.previous })); }
    catch (error) { if (error instanceof MetricError) throw new MetricError('PREVIOUS_PERIOD_UNAVAILABLE', 'Previous period has no finite metric'); throw error; }
    return { current, previous };
  }
}

export class AlertService {
  private readonly running = new Set<string>();
  constructor(private readonly store: AutomationStore<RefreshState>, private readonly metrics: MetricProvider, private readonly mail: MailTransport, private readonly now = () => new Date()) {}
  list(): AlertRule[] { return this.store.read().alertRules; }
  get(ruleId: string): AlertRule { const rule = this.list().find(r => r.id === ruleId); if (!rule) throw new RequestError(404, 'Alert rule not found'); return rule; }
  state(ruleId: string): AlertState { this.get(ruleId); return this.store.read().alertStates.find(s => s.ruleId === ruleId)!; }
  history(ruleId: string): AlertRun[] { const runs = this.store.read().alertRuns.filter(r => r.ruleId === ruleId); if (!runs.length) this.get(ruleId); return runs; }
  transitions(ruleId: string): AlertWebhook[] { const events = this.store.read().alertTransitions.filter(r => r.ruleId === ruleId); if (!events.length) this.get(ruleId); return events; }
  async put(ruleId: string, raw: unknown): Promise<AlertRule> {
    const rule = validateAlert(ruleId, raw); this.metrics.validate(rule);
    return this.store.change(state => {
      if (this.running.has(ruleId)) throw new RequestError(409, 'Alert evaluation is in progress');
      state.alertRules = state.alertRules.filter(r => r.id !== ruleId); state.alertRules.push(rule);
      if (!state.alertStates.some(s => s.ruleId === ruleId)) state.alertStates.push({ ruleId, state: 'ok', evaluatedAt: null, error: null });
      return rule;
    });
  }
  async remove(ruleId: string): Promise<void> {
    await this.store.change(state => {
      if (this.running.has(ruleId)) throw new RequestError(409, 'Alert evaluation is in progress');
      if (!state.alertRules.some(r => r.id === ruleId)) throw new RequestError(404, 'Alert rule not found');
      state.alertRules = state.alertRules.filter(r => r.id !== ruleId); state.alertStates = state.alertStates.filter(r => r.ruleId !== ruleId);
    });
  }
  async recover(): Promise<void> {
    await this.store.change(state => { for (const run of state.alertRuns) {
      if (run.state === 'running') { run.state = 'failed'; run.finishedAt = this.now().toISOString(); run.error = { code: 'ALERT_INTERRUPTED', message: 'Alert evaluation interrupted' }; }
      if (run.notification === 'pending') { run.notification = 'failed'; run.notificationError = { code: 'NOTIFICATION_INTERRUPTED', message: 'Delivery outcome unknown after restart' }; }
    } });
  }
  async afterRefresh(datasetId: string, refresh: RefreshRun): Promise<void> {
    if (refresh.state !== 'succeeded') return;
    for (const rule of this.list().filter(r => r.datasetId === datasetId && r.enabled)) {
      if (this.running.has(rule.id)) continue;
      this.running.add(rule.id);
      try { await this.evaluate(rule, refresh); } finally { this.running.delete(rule.id); }
    }
  }
  private async evaluate(rule: AlertRule, refresh: RefreshRun): Promise<void> {
    const run: AlertRun = { id: randomUUID(), ruleId: rule.id, refreshRunId: refresh.id, startedAt: this.now().toISOString(), finishedAt: null, state: 'running', value: null, previousValue: null, percentChange: null, error: null, notification: 'not-needed', notificationError: null };
    await this.store.change(state => { state.alertRuns.push(run); });
    let event: AlertWebhook | undefined;
    try {
      const { current, previous } = await this.metrics.measure(rule, this.now());
      const result = evaluateCondition(rule.condition, current, previous);
      run.value = current; run.previousValue = previous ?? null; run.percentChange = result.percentChange; run.state = 'evaluated';
      const from = this.state(rule.id).state, to = result.triggered ? 'triggered' : 'ok';
      if (from !== to) {
        event = { version: 1, type: 'opensight.alert.state_changed', eventId: randomUUID(), occurredAt: this.now().toISOString(), ruleId: rule.id, datasetId: rule.datasetId, dashboardId: rule.dashboardId, visualId: rule.visualId, fieldId: rule.fieldId, refreshRunId: refresh.id, from, to, value: current, previousValue: previous ?? null, percentChange: result.percentChange, condition: structuredClone(rule.condition) };
        if (to === 'triggered') run.notification = 'pending';
      }
    } catch (error) {
      run.state = 'failed'; run.error = error instanceof MetricError ? { code: error.code, message: error.message } : { code: 'METRIC_UNAVAILABLE', message: 'Unable to evaluate metric from its configured source' };
    }
    run.finishedAt = this.now().toISOString();
    await this.store.change(state => {
      state.alertRuns[state.alertRuns.findIndex(r => r.id === run.id)] = run;
      const current = state.alertStates.find(s => s.ruleId === rule.id)!;
      current.evaluatedAt = run.finishedAt; current.error = run.error;
      if (event) { current.state = event.to; state.alertTransitions.push(event); }
    });
    // Webhook events are persisted for inspection; Phase 3a makes no HTTP delivery.
    if (event?.to === 'triggered') {
      try {
        await this.mail.send({ to: rule.recipients, subject: `OpenSight alert: ${rule.id.slice(0, 150)}`, html: `<h1>Alert triggered</h1><p>${escapeHtml(rule.id)} · ${escapeHtml(rule.dashboardId)} / ${escapeHtml(rule.visualId)}</p><p>Metric: ${escapeHtml(rule.fieldId)} = ${run.value}</p>${run.percentChange === null ? '' : `<p>Previous period: ${run.previousValue}; change: ${run.percentChange}%</p>`}<p>Refreshed ${escapeHtml(refresh.finishedAt ?? refresh.startedAt)}</p>` });
        run.notification = 'sent';
      } catch (error) { run.notification = 'failed'; run.notificationError = error instanceof MailError ? { code: error.code, message: error.message } : { code: 'SMTP_SEND_FAILED', message: 'SMTP delivery failed' }; }
      await this.store.change(state => { state.alertRuns[state.alertRuns.findIndex(r => r.id === run.id)] = run; });
    }
  }
}
