import assert from 'node:assert/strict';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createApiServer } from '@opensight/api';
import { QueryEngineError } from '@opensight/query-engine';
import { AutomationStore } from '../dist/automation-store.js';
import { RefreshService, emptyRefreshState, validateRefreshState } from '../dist/refresh.js';
import { SalesQuery } from '../dist/query.js';
import { nextRun, Scheduler, validateSchedule } from '../dist/schedule.js';

const interval = { kind: 'interval', minutes: 1, timeZone: 'UTC' };
const fixtures = new URL('../../../fixtures/renderable-sales/', import.meta.url);
async function temporary(t) { const root = await mkdtemp(join(tmpdir(), 'opensight-refresh-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }
async function service(source, path) {
  const store = await AutomationStore.load(emptyRefreshState(), path, validateRefreshState);
  const refresh = new RefreshService(store, new Map([['sales', source]])); await refresh.recover(); return refresh;
}
export async function api(t, options = {}) {
  const server = await createApiServer({ dataRoot: new URL('../../../fixtures/', import.meta.url).pathname, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  return async (path, method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
}

test('schedule validation is strict, including IANA zone, HH:MM, weekday and interval bounds', () => {
  for (const raw of [null, {}, { ...interval, minutes: 0 }, { ...interval, minutes: 1.1 }, { ...interval, minutes: 525601 }, { ...interval, timeZone: '+02:00' }, { ...interval, timeZone: 'Atlantis/Lost' }, { ...interval, at: '12:00' }, { kind: 'daily', at: '24:00', timeZone: 'UTC' }, { kind: 'daily', at: '9:00', timeZone: 'UTC' }, { kind: 'weekly', at: '09:00', weekday: 7, timeZone: 'UTC' }, { kind: 'daily', at: '12:00', timeZone: 'UTC', weekday: 1 }]) assert.throws(() => validateSchedule(raw));
  assert.deepEqual(validateSchedule(interval), interval);
});
test('timezone daily and weekly scheduling skips DST gaps and duplicate fold times', () => {
  const daily = { kind: 'daily', at: '02:30', timeZone: 'America/New_York' };
  assert.equal(nextRun(daily, new Date('2026-03-08T05:00:00Z')), '2026-03-09T06:30:00.000Z');
  assert.equal(nextRun({ ...daily, kind: 'weekly', weekday: 0 }, new Date('2026-03-02T12:00:00Z')), '2026-03-15T06:30:00.000Z');
  const fold = { ...daily, at: '01:30' };
  assert.equal(nextRun(fold, new Date('2026-11-01T04:00:00Z')), '2026-11-01T05:30:00.000Z');
  assert.equal(nextRun(fold, new Date('2026-11-01T05:30:00Z')), '2026-11-02T06:30:00.000Z');
  assert.equal(nextRun({ kind: 'weekly', at: '09:00', weekday: 1, timeZone: 'Asia/Kolkata' }, new Date('2026-09-27T00:00:00Z')), '2026-09-28T03:30:00.000Z');
});
test('fake timers run due schedules, coalesce missed intervals, stop and prevent overlap', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: new Date('2026-09-27T00:00:00Z') });
  let calls = 0, release;
  const refresh = await service({ refresh: async () => { calls++; await new Promise(r => { release = r; }); return 8; } });
  await refresh.put('sales', { enabled: true, schedule: interval });
  const scheduler = new Scheduler(() => refresh.tick()); scheduler.start(); await scheduler.idle();
  t.after(() => scheduler.stop());
  t.mock.timers.tick(59000); await scheduler.idle(); assert.equal(calls, 0);
  t.mock.timers.tick(1000); await new Promise(setImmediate); assert.equal(calls, 1);
  assert.equal(refresh.history('sales')[0].finishedAt, null);
  t.mock.timers.tick(300000); await new Promise(setImmediate); assert.equal(calls, 1);
  release(); await scheduler.idle();
  t.mock.timers.tick(1000); await new Promise(setImmediate); assert.equal(calls, 2);
  release(); await scheduler.idle();
  assert.equal(refresh.getStatus('sales').nextRun, '2026-09-27T00:07:01.000Z');
  scheduler.stop(); t.mock.timers.tick(60000); assert.equal(calls, 2);
});
test('success, failure, last-good, recovery and schedule deletion are durable', async t => {
  const path = join(await temporary(t), 'state.json'); let fail = false;
  const source = { refresh: async () => { if (fail) throw new QueryEngineError('LOCAL_DATA_ERROR', '$', '/private/source'); return 12; } };
  const refresh = await service(source, path);
  await refresh.put('sales', { enabled: true, schedule: interval });
  const good = await refresh.run('sales'); assert.equal(good.rows, 12);
  fail = true; await refresh.run('sales'); await refresh.run('sales');
  assert.equal(refresh.getStatus('sales').consecutiveFailures, 2);
  assert.equal(refresh.getStatus('sales').lastGood, good.finishedAt);
  assert.deepEqual(refresh.history('sales')[1].error, { code: 'SOURCE_UNREACHABLE', message: 'Source unreachable for dataset sales', lastGood: good.finishedAt });
  const restarted = await service(source, path);
  assert.deepEqual(restarted.history('sales'), refresh.history('sales'));
  fail = false; await restarted.run('sales'); assert.equal(restarted.getStatus('sales').consecutiveFailures, 0);
  await restarted.remove('sales'); assert.equal(restarted.getStatus('sales').nextRun, null); assert.equal(restarted.history('sales').length, 4);
});
test('restart records interrupted refreshes and preserves last-good', async t => {
  const path = join(await temporary(t), 'state.json');
  const state = emptyRefreshState(); state.refreshRuns.push({ id: 'run', datasetId: 'sales', startedAt: '2026-01-01T00:00:00Z', finishedAt: null, rows: null, error: null, state: 'running' });
  await writeFile(path, JSON.stringify(state)); const refresh = await service({ refresh: async () => 1 }, path);
  assert.equal(refresh.history('sales')[0].error.code, 'REFRESH_INTERRUPTED'); assert.equal(refresh.getStatus('sales').state, 'error');
});
test('DuckDB refresh counts every source row including nulls and reports loss and restoration', async t => {
  const root = await temporary(t); await cp(fixtures, root, { recursive: true });
  const sales = await SalesQuery.load(root), refresh = await service(sales);
  const csv = await readFile(join(root, 'sales.csv'), 'utf8');
  assert.equal((await refresh.run('sales')).rows, csv.trim().split('\n').length - 1);
  await unlink(join(root, 'sales.csv')); assert.equal((await refresh.run('sales')).error.code, 'SOURCE_UNREACHABLE');
  assert.ok(refresh.getStatus('sales').lastGood);
  await writeFile(join(root, 'sales.csv'), csv); assert.equal((await refresh.run('sales')).state, 'succeeded');
  await writeFile(join(root, 'sales.csv'), 'wrong,header\n1,2\n'); assert.equal((await refresh.run('sales')).state, 'failed');
});
test('refresh API CRUD, status and history preserve validation boundaries', async t => {
  const request = await api(t), base = '/api/datasets/sales';
  assert.equal((await request(`${base}/refresh-status`)).status, 200);
  assert.equal((await request(`${base}/refresh-schedule`)).status, 404);
  for (const body of [{ enabled: true, schedule: { ...interval, minutes: -1 } }, { enabled: 'true', schedule: interval }, { enabled: true, schedule: interval, smtp: {} }]) assert.equal((await request(`${base}/refresh-schedule`, 'PUT', body)).status, 400);
  assert.equal((await request(`${base}/refresh-schedule`, 'PUT', { enabled: true, schedule: interval })).status, 200);
  assert.equal((await (await request('/api/refresh-schedules')).json()).length, 1);
  const run = await (await request(`${base}/refresh-runs`, 'POST')).json(); assert.equal(run.state, 'succeeded');
  assert.deepEqual(await (await request(`${base}/refresh-runs/${run.id}`)).json(), run);
  assert.equal((await (await request(`${base}/refresh-runs`)).json()).length, 1);
  assert.equal((await request(`${base}/refresh-status?bad=1`)).status, 400);
  assert.equal((await request('/api/datasets/%ZZ/refresh-status')).status, 400);
  assert.equal((await request('/api/datasets/missing/refresh-status')).status, 404);
  assert.equal((await request(`${base}/refresh-status`, 'PUT', {})).status, 405);
  assert.equal((await request(`${base}/refresh-schedule`, 'DELETE')).status, 200);
  assert.equal((await (await request(`${base}/refresh-status`)).json()).nextRun, null);
});
