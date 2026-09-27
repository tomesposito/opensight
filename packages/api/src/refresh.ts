import { validateAlert, type AlertRule, type AlertState, type AlertRun, type AlertWebhook } from './alerts.js';
import type { Subscription, ReportRun } from './reports.js';
import { randomUUID } from 'node:crypto';
import { QueryEngineError } from '@opensight/query-engine';
import { AutomationStore } from './automation-store.js';
import { enabled, id, nextRun, record, validateSchedule, type Schedule } from './schedule.js';
import { RequestError } from './query.js';

export interface RefreshSchedule { datasetId: string; enabled: boolean; schedule: Schedule; nextRun: string | null }
export interface RunError { code: string; message: string; lastGood: string | null }
export interface RefreshRun { id: string; datasetId: string; startedAt: string; finishedAt: string | null; state: 'running' | 'succeeded' | 'failed'; rows: number | null; error: RunError | null }
export interface DatasetStatus { datasetId: string; lastGood: string | null; nextRun: string | null; consecutiveFailures: number; state: 'never' | 'running' | 'ready' | 'error'; error: RunError | null }
export interface RefreshState { version: 1; alertRules: AlertRule[]; alertStates: AlertState[]; alertRuns: AlertRun[]; alertTransitions: AlertWebhook[]; subscriptions: Subscription[]; reportRuns: ReportRun[]; schedules: RefreshSchedule[]; refreshRuns: RefreshRun[]; datasets: DatasetStatus[] }
export const emptyRefreshState = (): RefreshState => ({ version: 1, alertRules: [], alertStates: [], alertRuns: [], alertTransitions: [], subscriptions: [], reportRuns: [], schedules: [], refreshRuns: [], datasets: [] });
export function validateRefreshState(value: unknown): RefreshState {
  const s = record(value, ['version', 'schedules', 'refreshRuns', 'datasets', 'subscriptions', 'reportRuns', 'alertRules', 'alertStates', 'alertRuns', 'alertTransitions']);
  if (s.version !== 1 || !Array.isArray(s.schedules) || !Array.isArray(s.refreshRuns) || !Array.isArray(s.datasets)) throw new Error('Invalid automation state');
  for (const item of s.schedules) { const r = record(item, ['datasetId', 'enabled', 'schedule', 'nextRun']); id(r.datasetId, 'datasetId'); enabled(r.enabled); validateSchedule(r.schedule); }
  s.subscriptions ??= []; s.reportRuns ??= [];
  if (!Array.isArray(s.subscriptions) || !Array.isArray(s.reportRuns)) throw new Error('Invalid report state');
  for (const item of s.subscriptions) { const r = record(item, ['id', 'userId', 'dashboardId', 'recipients', 'enabled', 'schedule', 'nextRun']); id(r.id, 'id'); id(r.userId, 'userId'); id(r.dashboardId, 'dashboardId'); enabled(r.enabled); validateSchedule(r.schedule); }
  s.alertRules ??= []; s.alertStates ??= []; s.alertRuns ??= []; s.alertTransitions ??= [];
  if (![s.alertRules, s.alertStates, s.alertRuns, s.alertTransitions].every(Array.isArray)) throw new Error('Invalid alert state');
  for (const item of s.alertRules as unknown[]) { const r = item as AlertRule; const { id: ruleId, ...body } = r; validateAlert(id(ruleId, 'id'), body); }
  return s as unknown as RefreshState;
}
function status(state: RefreshState, datasetId: string): DatasetStatus {
  let value = state.datasets.find(s => s.datasetId === datasetId);
  if (!value) { value = { datasetId, lastGood: null, nextRun: null, consecutiveFailures: 0, state: 'never', error: null }; state.datasets.push(value); }
  return value;
}
export interface RefreshSource { refresh(): Promise<number> }
export class RefreshService {
  private readonly running = new Map<string, Promise<RefreshRun>>();
  onSuccess?: (datasetId: string, run: RefreshRun) => Promise<void>;
  constructor(readonly store: AutomationStore<RefreshState>, private readonly sources: ReadonlyMap<string, RefreshSource>, private readonly now = () => new Date()) {}
  private requireDataset(datasetId: string): void {
    if (!this.sources.has(datasetId) && !this.store.read().datasets.some(s => s.datasetId === datasetId)) throw new RequestError(404, 'Dataset has no configured local refresh binding');
  }
  list(): RefreshSchedule[] { return this.store.read().schedules; }
  getStatus(datasetId: string): DatasetStatus { this.requireDataset(datasetId); return status(this.store.read(), datasetId); }
  history(datasetId: string): RefreshRun[] { this.requireDataset(datasetId); return this.store.read().refreshRuns.filter(r => r.datasetId === datasetId); }
  async put(datasetId: string, raw: unknown): Promise<RefreshSchedule> {
    this.requireDataset(datasetId);
    const body = record(raw, ['enabled', 'schedule']);
    const active = enabled(body.enabled), schedule = validateSchedule(body.schedule);
    const resource = { datasetId, enabled: active, schedule, nextRun: active ? nextRun(schedule, this.now()) : null };
    return this.store.change(state => {
      state.schedules = state.schedules.filter(s => s.datasetId !== datasetId); state.schedules.push(resource);
      status(state, datasetId).nextRun = resource.nextRun;
      return resource;
    });
  }
  async remove(datasetId: string): Promise<void> {
    await this.store.change(state => {
      if (!state.schedules.some(s => s.datasetId === datasetId)) throw new RequestError(404, 'Refresh schedule not found');
      state.schedules = state.schedules.filter(s => s.datasetId !== datasetId); status(state, datasetId).nextRun = null;
    });
  }
  async recover(): Promise<void> {
    await this.store.change(state => {
      for (const run of state.refreshRuns.filter(r => r.state === 'running')) {
        const s = status(state, run.datasetId);
        const error = { code: 'REFRESH_INTERRUPTED', message: `Refresh interrupted for dataset ${run.datasetId}`, lastGood: s.lastGood };
        Object.assign(run, { state: 'failed', finishedAt: this.now().toISOString(), error });
        Object.assign(s, { state: 'error', error, consecutiveFailures: s.consecutiveFailures + 1 });
      }
    });
  }
  async tick(): Promise<void> {
    for (const s of this.list()) {
      if (!s.enabled || !s.nextRun || s.nextRun > this.now().toISOString() || this.running.has(s.datasetId)) continue;
      const claimed = await this.store.change(state => {
        const current = state.schedules.find(r => r.datasetId === s.datasetId);
        if (current?.enabled && current.nextRun === s.nextRun) {
          current.nextRun = nextRun(current.schedule, this.now()); status(state, s.datasetId).nextRun = current.nextRun;
          return true;
        }
        return false;
      });
      if (claimed) await this.run(s.datasetId);
    }
  }
  run(datasetId: string): Promise<RefreshRun> {
    this.requireDataset(datasetId);
    const previous = this.running.get(datasetId);
    if (previous) return previous;
    const promise = this.execute(datasetId).finally(() => this.running.delete(datasetId));
    this.running.set(datasetId, promise);
    return promise;
  }
  private async execute(datasetId: string): Promise<RefreshRun> {
    const run: RefreshRun = { id: randomUUID(), datasetId, startedAt: this.now().toISOString(), finishedAt: null, state: 'running', rows: null, error: null };
    await this.store.change(state => { state.refreshRuns.push(run); status(state, datasetId).state = 'running'; });
    try {
      const source = this.sources.get(datasetId);
      if (!source) throw new QueryEngineError('LOCAL_DATA_ERROR', '$.source', 'Source unavailable');
      run.rows = await source.refresh();
      if (!Number.isSafeInteger(run.rows) || run.rows < 0) throw new Error('Invalid refresh row count');
      run.state = 'succeeded';
    } catch (error) {
      run.state = 'failed';
      const code = error instanceof QueryEngineError ? error.code === 'LOCAL_DATA_ERROR' ? 'SOURCE_UNREACHABLE' : error.code : 'REFRESH_FAILED';
      run.error = { code, message: `${code === 'SOURCE_UNREACHABLE' ? 'Source unreachable' : 'Refresh failed'} for dataset ${datasetId}`, lastGood: this.getStatus(datasetId).lastGood };
    }
    run.finishedAt = this.now().toISOString();
    await this.store.change(state => {
      state.refreshRuns[state.refreshRuns.findIndex(r => r.id === run.id)] = run;
      const s = status(state, datasetId);
      s.state = run.state === 'succeeded' ? 'ready' : 'error'; s.error = run.error;
      if (run.state === 'succeeded') { s.lastGood = run.finishedAt; s.consecutiveFailures = 0; }
      else s.consecutiveFailures++;
    });
    if (run.state === 'succeeded') await this.onSuccess?.(datasetId, run);
    return run;
  }
}
