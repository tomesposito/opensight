import test from 'node:test';
import assert from 'node:assert/strict';
import { BlazeStore, blazeLimits, executionSettings } from '../dist/blaze.js';
import { Scheduler } from '../dist/schedule.js';
const limits = { maxBytes: 2400, datasetBytes: 800, maxRows: 5, cellChars: 50 };
const settings = { mode: 'BLAZE', intervalMinutes: null };
const load = values => async table => { table.start([{ name: 'n', type: 'INTEGER' }]); for (const n of values) table.row([n]); };
const code = expected => e => e.code === expected;
test('Blaze atomically publishes complete columnar output, bounds rows/bytes/text and refuses stale fallback', async () => {
  const store = new BlazeStore(limits); store.configure('a', settings);
  assert.throws(() => store.read('a'), code('BLAZE_NOT_READY'));
  await store.refresh('a', load([1,2]));
  assert.deepEqual(store.read('a').table.rows(), [{ n: 1 }, { n: 2 }]);
  assert.equal(store.status('a').rowCount, 2);
  const last = store.status('a').lastRefreshedAt;
  for (const values of [[1,2,3,4,5,6], ['x'.repeat(51)], ...[1,2].map(() => Array(5).fill('x'.repeat(40)))]) {
    await assert.rejects(store.refresh('a', load(values)), code('BLAZE_DATASET_TOO_LARGE'));
    assert.throws(() => store.read('a'), code('BLAZE_DATASET_TOO_LARGE'));
    assert.equal(store.status('a').lastRefreshedAt, last); assert.equal(store.status('a').bytes, 0);
  }
  await assert.rejects(store.refresh('a', async () => { throw Object.assign(new Error('private details'), { code: 'PREP_EXECUTION_FAILED' }); }), code('BLAZE_REFRESH_FAILED'));
  assert.doesNotMatch(JSON.stringify(store.status('a')), /private details/);
  await assert.rejects(store.refresh('a', async () => { throw Object.assign(new Error('invalid'), { code: 'PREP_SCHEMA_MISMATCH' }); }), code('BLAZE_PIPELINE_INVALID'));
  await store.refresh('a', load([])); assert.equal(store.status('a').rowCount, 0);
});
test('capacity reserves intake and evicts the least recently read snapshot', async () => {
  const store = new BlazeStore({ ...limits, maxBytes: 1450 });
  for (const id of ['a','b','c']) store.configure(id, settings);
  await store.refresh('a', load([1,2,3,4,5])); await store.refresh('b', load([2]));
  store.read('a');
  await store.refresh('c', load([3]));
  assert.throws(() => store.read('b'), code('BLAZE_EVICTED'));
  assert.equal(store.read('a').table.rowCount, 5); assert.equal(store.read('c').table.rowCount, 1);
});
test('refresh serializes intake, blocks running reads and cannot publish after invalidation or replacement', async () => {
  const store = new BlazeStore(limits); store.configure('a', settings); store.configure('b', settings);
  for (const mutation of [() => store.invalidate('a'), () => store.configure('a', { mode: 'DIRECT_QUERY', intervalMinutes: null }), () => { store.remove('a'); store.configure('a', settings); }]) {
    store.configure('a', settings);
    let finish; const pending = store.refresh('a', async table => { await load([1])(table); await new Promise(resolve => finish = resolve); });
    assert.throws(() => store.read('a'), code('BLAZE_REFRESH_IN_PROGRESS'));
    await assert.rejects(store.refresh('b', load([2])), code('BLAZE_BUSY'));
    await new Promise(resolve => setImmediate(resolve)); mutation(); finish();
    await assert.rejects(pending, code('BLAZE_INVALIDATED'));
  }
});
test('interval scheduling uses fake time, coalesces missed intervals and reschedules failures', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 0 });
  const store = new BlazeStore(limits); store.configure('a', { ...settings, intervalMinutes: 1 });
  let calls = 0, pending;
  const scheduler = new Scheduler(() => store.tick(key => store.refresh(key, async table => { calls++; await load([calls])(table); if (pending) await pending; if (calls === 2) throw new Error('failed'); })));
  scheduler.start(); await scheduler.idle(); assert.equal(calls, 0);
  t.mock.timers.tick(60000); await scheduler.idle(); assert.equal(calls, 1);
  t.mock.timers.tick(600000); await scheduler.idle(); assert.equal(calls, 2); assert.equal(store.status('a').state, 'error');
  let finish; pending = new Promise(resolve => finish = resolve);
  t.mock.timers.tick(60000); await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(600000); assert.equal(calls, 3); finish(); await scheduler.idle();
  assert.equal(store.status('a').nextRefreshAt, new Date(Date.now() + 60000).toISOString());
  scheduler.stop(); t.mock.timers.tick(600000); assert.equal(calls, 3);
});
test('limits and schedules reject untrusted, unsafe and inconsistent configuration', () => {
  for (const value of ['0','-1','1.5','garbage','9007199254740992','']) assert.throws(() => blazeLimits({ OPENSIGHT_BLAZE_MAX_ROWS: value }), code('BLAZE_CONFIG_INVALID'));
  assert.throws(() => blazeLimits({ OPENSIGHT_BLAZE_MAX_BYTES: '1' }), code('BLAZE_CONFIG_INVALID'));
  for (const value of [{}, { mode: 'BLAZE', intervalMinutes: 0 }, { mode: 'DIRECT_QUERY', intervalMinutes: 1 }, { ...settings, table: 'forged' }]) assert.throws(() => executionSettings(value), code('BLAZE_CONFIG_INVALID'));
});
