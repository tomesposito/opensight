import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { AutomationStore } from '../dist/automation-store.js';
import { emptyAutomationState, validateAutomationState } from '../dist/automation-state.js';
import { ReportService } from '../dist/reports.js';
import { RefreshService } from '../dist/refresh.js';
import { StubMailTransport } from '../dist/mail.js';
import { startApi, interval } from './automation-helpers.mjs';
async function temporary(t) { const root = await mkdtemp(join(tmpdir(), 'opensight-state-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }

test('atomic state serializes concurrent writes and retains the last persisted state on failure', async t => {
  const root = await temporary(t), path = join(root, 'state.json');
  const store = await AutomationStore.load({ count: 0 }, path, value => value);
  await Promise.all(Array.from({ length: 20 }, () => store.change(s => { s.count++; })));
  assert.equal(store.read().count, 20); assert.equal(JSON.parse(await readFile(path, 'utf8')).count, 20);
  await rm(path); await mkdir(path);
  await assert.rejects(store.change(s => { s.count++; })); assert.equal(store.read().count, 20);
  await rm(path, { recursive: true }); await store.change(s => { s.count++; }); assert.equal(store.read().count, 21);
});
test('restart rejects malformed resources, duplicate IDs, bad history and missing alert state', () => {
  for (const mutate of [
    s => { s.version = 2; }, s => { s.datasets = [null]; }, s => { s.refreshRuns = [{}]; },
    s => { s.subscriptions = [{ id: 'x', userId: 'u', dashboardId: 'd', recipients: ['bad'], enabled: false, schedule: interval, nextRun: null }]; },
    s => { s.schedules = [{ datasetId: 'sales', enabled: true, schedule: interval, nextRun: 'tomorrow' }]; },
    s => { s.reportRuns = [{ id: 'x', userId: 'u', subscriptionId: 's', startedAt: 'bad', finishedAt: null, state: 'running', error: null }]; },
    s => { s.alertRules = [{ id: 'r', datasetId: 'sales', dashboardId: 'd', visualId: 'v', fieldId: 'f', dimensions: {}, enabled: true, recipients: ['r@example.com'], condition: { kind: 'above', threshold: 1 } }]; },
    s => { s.alertTransitions = [{}]; },
  ]) { const state = emptyAutomationState(); mutate(state); assert.throws(() => validateAutomationState(state)); }
  const old = { version: 1, schedules: [], refreshRuns: [], datasets: [] }; assert.deepEqual(validateAutomationState(old), emptyAutomationState());
});
test('subscription persistence retains owner and next-run; restart marks interrupted delivery without resend', async t => {
  const path = join(await temporary(t), 'state.json');
  const store = await AutomationStore.load(emptyAutomationState(), path, validateAutomationState), mail = new StubMailTransport();
  const provider = { has: () => true, capture: async () => ({ dashboardId: 'd', title: 'Dashboard', capturedAt: new Date().toISOString(), visuals: [] }) };
  const reports = new ReportService(store, provider, mail);
  await reports.put('user', 'weekly', { dashboardId: 'd', recipients: ['r@example.com'], enabled: true, schedule: { kind: 'weekly', weekday: 1, at: '09:00', timeZone: 'UTC' } });
  await store.change(s => { s.reportRuns.push({ id: 'interrupted', subscriptionId: 'weekly', userId: 'user', startedAt: new Date().toISOString(), finishedAt: null, state: 'running', error: null }); });
  const reloaded = await AutomationStore.load(emptyAutomationState(), path, validateAutomationState), restarted = new ReportService(reloaded, provider, mail);
  await restarted.recover(); assert.deepEqual(restarted.list('user'), reports.list('user'));
  assert.equal(restarted.history('user', 'weekly')[0].error.code, 'REPORT_INTERRUPTED'); assert.equal(mail.messages.length, 0);
});
test('persisted refresh binding loss remains visible after restart with last-good timestamp', async t => {
  const path = join(await temporary(t), 'state.json');
  const store = await AutomationStore.load(emptyAutomationState(), path, validateAutomationState);
  const refresh = new RefreshService(store, new Map([['sales', { refresh: async () => 3 }]]));
  await refresh.put('sales', { enabled: false, schedule: interval }); const good = await refresh.run('sales');
  const restored = await AutomationStore.load(emptyAutomationState(), path, validateAutomationState), missing = new RefreshService(restored, new Map());
  const run = await missing.run('sales'); assert.equal(run.error.code, 'SOURCE_UNREACHABLE'); assert.equal(run.error.lastGood, good.finishedAt);
});
test('run routes reject unsupported payloads and automation status follows HTTP method rules', async t => {
  const { request } = await startApi(t);
  assert.equal((await request('/api/datasets/sales/refresh-runs', 'POST', { csv: '/elsewhere' })).status, 400);
  assert.equal((await (await request('/api/datasets/sales/refresh-runs')).json()).length, 0);
  const response = await request('/api/automation-status', 'POST'); assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET');
  assert.equal((await (await request('/api/automation-status')).json()).smtp, 'configured');
});
