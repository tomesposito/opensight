import type { DatasetStatus, RefreshRun, RefreshSchedule } from './refresh.js';
import type { ReportRun, Subscription } from './reports.js';
import { validateAlert, type AlertRule, type AlertRun, type AlertState, type AlertWebhook } from './alerts.js';
import { recipients } from './mail.js';
import { enabled, id, record, validateSchedule } from './schedule.js';

export interface AutomationState {
  version: 1;
  schedules: RefreshSchedule[];
  datasets: DatasetStatus[];
  refreshRuns: RefreshRun[];
  subscriptions: Subscription[];
  reportRuns: ReportRun[];
  alertRules: AlertRule[];
  alertStates: AlertState[];
  alertRuns: AlertRun[];
  alertTransitions: AlertWebhook[];
}
export const emptyAutomationState = (): AutomationState => ({ version: 1, schedules: [], datasets: [], refreshRuns: [], subscriptions: [], reportRuns: [], alertRules: [], alertStates: [], alertRuns: [], alertTransitions: [] });
function fail(): never { throw new Error('Invalid persisted automation state'); }
function timestamp(value: unknown, nullable = true): void {
  if (value === null && nullable) return;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail();
}
function text(value: unknown): void { if (typeof value !== 'string' || !value || value.includes('\0')) fail(); }
function number(value: unknown, nullable = true): void { if (!(nullable && value === null) && !(typeof value === 'number' && Number.isFinite(value))) fail(); }
function oneOf(value: unknown, choices: string[]): void { if (typeof value !== 'string' || !choices.includes(value)) fail(); }
function error(value: unknown, refresh = false): void {
  if (value === null) return;
  const e = record(value, refresh ? ['code', 'message', 'lastGood'] : ['code', 'message']);
  text(e.code); text(e.message); if (refresh) timestamp(e.lastGood);
}
function scheduled(r: Record<string, unknown>): void {
  enabled(r.enabled); validateSchedule(r.schedule); timestamp(r.nextRun);
  if ((r.enabled === false) !== (r.nextRun === null)) fail();
}
function run(r: Record<string, unknown>, states: string[]): void {
  id(r.id, 'id'); timestamp(r.startedAt, false); timestamp(r.finishedAt); oneOf(r.state, states);
  if ((r.state === 'running') !== (r.finishedAt === null)) fail();
}
/** Reject corrupt resources/history before any background work can resume. */
export function validateAutomationState(value: unknown): AutomationState {
  const s = record(value, Object.keys(emptyAutomationState()));
  if (s.version !== 1) fail();
  // Upgrade files written by the refresh-only checkpoint without losing history.
  for (const key of ['subscriptions', 'reportRuns', 'alertRules', 'alertStates', 'alertRuns', 'alertTransitions']) if (s[key] === undefined) s[key] = [];
  const rows = (key: string, fields: string[], unique: string[], check: (r: Record<string, unknown>) => void) => {
    const list = s[key]; if (!Array.isArray(list)) fail();
    const seen = new Set<string>();
    for (const item of list) {
      const r = record(item, fields); const k = JSON.stringify(unique.map(field => r[field]));
      if (seen.has(k)) fail(); seen.add(k); check(r);
    }
  };
  rows('schedules', ['datasetId', 'enabled', 'schedule', 'nextRun'], ['datasetId'], r => { id(r.datasetId, 'datasetId'); scheduled(r); });
  rows('datasets', ['datasetId', 'lastGood', 'nextRun', 'consecutiveFailures', 'state', 'error'], ['datasetId'], r => {
    id(r.datasetId, 'datasetId'); timestamp(r.lastGood); timestamp(r.nextRun); error(r.error, true);
    if (!Number.isSafeInteger(r.consecutiveFailures) || Number(r.consecutiveFailures) < 0) fail();
    oneOf(r.state, ['never', 'running', 'ready', 'error']);
  });
  rows('refreshRuns', ['id', 'datasetId', 'startedAt', 'finishedAt', 'state', 'rows', 'error'], ['id'], r => {
    id(r.datasetId, 'datasetId'); run(r, ['running', 'succeeded', 'failed']); error(r.error, true); number(r.rows);
    if (r.rows !== null && (!Number.isSafeInteger(r.rows) || Number(r.rows) < 0)) fail();
  });
  rows('subscriptions', ['id', 'userId', 'dashboardId', 'recipients', 'enabled', 'schedule', 'nextRun'], ['userId', 'id'], r => {
    id(r.id, 'id'); id(r.userId, 'userId'); id(r.dashboardId, 'dashboardId'); recipients(r.recipients); scheduled(r);
  });
  rows('reportRuns', ['id', 'subscriptionId', 'userId', 'startedAt', 'finishedAt', 'state', 'error'], ['id'], r => {
    id(r.subscriptionId, 'subscriptionId'); id(r.userId, 'userId'); run(r, ['running', 'sent', 'failed']); error(r.error);
  });
  rows('alertRules', ['id', 'datasetId', 'dashboardId', 'visualId', 'fieldId', 'dimensions', 'enabled', 'recipients', 'condition'], ['id'], r => {
    const { id: ruleId, ...body } = r; validateAlert(id(ruleId, 'id'), body);
  });
  rows('alertStates', ['ruleId', 'state', 'evaluatedAt', 'error'], ['ruleId'], r => {
    id(r.ruleId, 'ruleId'); oneOf(r.state, ['ok', 'triggered']); timestamp(r.evaluatedAt); error(r.error);
  });
  rows('alertRuns', ['id', 'ruleId', 'refreshRunId', 'startedAt', 'finishedAt', 'state', 'value', 'previousValue', 'percentChange', 'error', 'notification', 'notificationError'], ['id'], r => {
    id(r.ruleId, 'ruleId'); id(r.refreshRunId, 'refreshRunId'); run(r, ['running', 'evaluated', 'failed']);
    number(r.value); number(r.previousValue); number(r.percentChange); error(r.error); error(r.notificationError);
    oneOf(r.notification, ['not-needed', 'pending', 'sent', 'failed']);
  });
  rows('alertTransitions', ['version', 'type', 'eventId', 'occurredAt', 'ruleId', 'datasetId', 'dashboardId', 'visualId', 'fieldId', 'refreshRunId', 'from', 'to', 'value', 'previousValue', 'percentChange', 'condition'], ['eventId'], r => {
    if (r.version !== 1 || r.type !== 'opensight.alert.state_changed' || r.from === r.to) fail();
    for (const key of ['eventId', 'ruleId', 'datasetId', 'dashboardId', 'visualId', 'refreshRunId']) id(r[key], key);
    timestamp(r.occurredAt, false); oneOf(r.from, ['ok', 'triggered']); oneOf(r.to, ['ok', 'triggered']); number(r.value, false); number(r.previousValue); number(r.percentChange);
    validateAlert(String(r.ruleId), { datasetId: r.datasetId, dashboardId: r.dashboardId, visualId: r.visualId, fieldId: r.fieldId, enabled: true, recipients: ['validation@example.com'], condition: r.condition });
  });
  const state = s as unknown as AutomationState;
  if (state.alertRules.some(r => !state.alertStates.some(a => a.ruleId === r.id)) || state.alertStates.some(a => !state.alertRules.some(r => r.id === a.ruleId))) fail();
  for (const schedule of state.schedules) if (!state.datasets.some(d => d.datasetId === schedule.datasetId && d.nextRun === schedule.nextRun)) fail();
  return state;
}
