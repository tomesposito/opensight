import test from 'node:test';
import assert from 'node:assert/strict';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { TenantBudgets } from '../dist/budgets.js';
import { HostedData } from '../dist/hosted-data.js';
import { HostedPrep } from '../dist/hosted-prep.js';
import { sourceFixture, upload, registration } from './source-helpers.mjs';
import { budgetConfig } from './budget-helpers.mjs';
const query = { dimensions: [], measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] };
const pipe = input => ({ version: 1, input, steps: [] });
const waitFor = async check => { const deadline = performance.now() + 10000; while (!check()) { if (performance.now() > deadline) assert.fail('work did not reach checkpoint'); await delay(2); } };
function dataFor(f, config = budgetConfig, postgres) {
  const budgets = new TenantBudgets(config, c => f.metadata.assertContext(c));
  return new HostedData(f.sources, postgres, budgets);
}

test('H4 source SQL cancellation: query, preview, output and refresh never publish a partially filled sink', async t => {
  const f = await sourceFixture(t), a = await f.login(); await f.sources.create(a, 'source', registration());
  let opened = 0;
  const data = dataFor(f, budgetConfig, async (_r, _c, _l, sink, control) => {
    sink.start(registration().columns); sink.row(['east', 999, 'partial']); opened++;
    await new Promise(resolve => control.signal.addEventListener('abort', resolve, { once: true }));
    sink.row(['west', 999, 'must refuse']);
  });
  for (const path of ['query', 'preview', 'output', 'refresh']) {
    const controller = new AbortController(); data.begin(a, controller.signal); const before = opened;
    const work = path === 'refresh' ? data.refresh(a, 'source') : data.execute(a, 'source', path, path === 'query' ? { query } : {});
    const rejected = assert.rejects(work, { code: 'EXECUTION_CANCELLED' });
    await waitFor(() => opened > before); controller.abort(); await rejected;
    assert.deepEqual(data.budgets.node(), { running: 0, queued: 0 });
  }
  data.begin(a, new AbortController().signal);
  await assert.rejects(data.execute(a, 'source', 'output', { mode: 'BLAZE' }), { code: 'EXECUTION_CANCELLED' });
});
test('H4 real worker cancellation covers cached/direct source reads, prepared output/query/preview/refresh, and upload', async t => {
  const f = await sourceFixture(t), a = await f.login(), data = dataFor(f), prep = new HostedPrep(data), u = await f.sources.upload(a, upload());
  await data.refresh(a, u.id);
  await prep.save(a, 'prepared', { name: 'Prepared', pipeline: pipe(u.id), expectedVersion: 0 });
  await prep.configure(a, 'prepared', { expectedVersion: 1, mode: 'BLAZE', intervalMinutes: null });
  await prep.execute(a, 'prepared', 'refresh');
  await data.refresh(a, u.id);
  const actions = [
    ...['DIRECT_QUERY', 'BLAZE'].flatMap(mode => ['query', 'preview', 'output'].map(path => () => data.execute(a, u.id, path, { mode, ...(path === 'query' ? { query } : {}) }))),
    () => prep.preview(a, 'prepared', {}), () => prep.execute(a, 'prepared', 'query', query),
    () => prep.execute(a, 'prepared', 'refresh'), () => data.upload(a, upload()),
  ];
  let maxCancellationMs = 0;
  for (const action of actions) {
    const before = data.budgets.snapshot(a.tenantId).workerExecutions;
    const controller = new AbortController(); data.begin(a, controller.signal);
    const result = action(), rejected = assert.rejects(result, { code: 'EXECUTION_CANCELLED' });
    await waitFor(() => data.budgets.snapshot(a.tenantId).workerExecutions > before);
    const started = performance.now(); controller.abort(); await rejected; maxCancellationMs = Math.max(maxCancellationMs, performance.now() - started);
    assert.deepEqual(data.budgets.node(), { running: 0, queued: 0 });
  }
  data.begin(a, new AbortController().signal);
  await assert.rejects(prep.execute(a, 'prepared', 'rows'), { code: 'EXECUTION_CANCELLED' });
  assert.equal((await f.metadata.list(a, 'source')).length, 1, 'cancelled upload persisted nothing');
  assert.ok(maxCancellationMs < 750, `cancellation ${maxCancellationMs}ms`);
  t.diagnostic(JSON.stringify({ maxCancellationMs, ...data.budgets.snapshot(a.tenantId) }));
});
test('H4 queued revision/session changes deny before I/O; rejection cannot mutate a current cache', async t => {
  const f = await sourceFixture(t), a = await f.login(), data = dataFor(f), u = await f.sources.upload(a, upload());
  await data.refresh(a, u.id);
  let release; const hold = new Promise(r => { release = r; });
  const running = data.budgets.run(a, false, async () => {}, () => hold);
  const queued = data.refresh(a, u.id); const refused = assert.rejects(queued, { code: 'METADATA_REVISED' });
  await waitFor(() => data.budgets.node().queued === 1);
  await f.sources.bind(a, u.id, { expectedVersion: 1, policy: { rowLevel: false, rowRules: [] } });
  release(); await running; await refused;
  assert.equal(data.budgets.snapshot(a.tenantId).sourceRows, 3);
  // Revocation of the verified session (independent of metadata revisions) also gates dequeue.
  let revoked = false; data.begin(a, undefined, async () => { if (revoked) throw Object.assign(new Error(), { code: 'AUTHENTICATION_FAILED' }); });
  let release2; const running2 = data.budgets.run(a, false, async () => {}, () => new Promise(r => { release2 = r; }));
  await delay(0);
  const next = data.execute(a, u.id, 'output', {}); const denied = assert.rejects(next, { code: 'AUTHENTICATION_FAILED' });
  await waitFor(() => data.budgets.node().queued === 1); revoked = true; release2(); await running2; await denied;
  assert.equal(data.budgets.snapshot(a.tenantId).sourceRows, 3);
});
test('H4 measured two-tenant flood: bounded queues, fair completion, H3 denials, source pressure, RSS and event-loop stalls', async t => {
  const f = await sourceFixture(t), a = await f.login(), b = await f.login('two');
  const config = structuredClone(budgetConfig); config.node.running = 2;
  const data = dataFor(f, config);
  const synthetic = upload(); synthetic.base64 = Buffer.from('region,amount,private\n' + Array.from({ length: 4096 }, (_, i) => `east,${i},synthetic\n`).join('')).toString('base64');
  const one = await f.sources.upload(a, synthetic), two = await f.sources.upload(b, synthetic);
  await f.sources.create(a, 'denied', { ...registration(), policy: { rowLevel: true, rowRules: [] } });
  const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
  const baseRss = process.memoryUsage().rss; let peakRss = baseRss;
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
  let start = performance.now();
  const first = data.execute(a, one.id, 'query', { query });
  await waitFor(() => data.budgets.node().running === 1);
  const flood = Array.from({ length: 16 }, () => data.execute(a, one.id, 'query', { query }).then(() => 'completed', e => e.code));
  await waitFor(() => data.budgets.node().queued === 4);
  const before = data.budgets.snapshot(a.tenantId).sourceRows;
  for (const [id, code] of [[two.id, 'RESOURCE_NOT_FOUND'], ['denied', 'ROW_ACCESS_DENIED']]) {
    for (const path of ['query', 'preview', 'output']) await assert.rejects(data.execute(a, id, path, path === 'query' ? { query } : {}), { code });
  }
  await assert.rejects(data.execute({ ...b }, one.id, 'output', {}), { code: 'TENANT_CONTEXT_REQUIRED' });
  assert.equal(data.budgets.snapshot(a.tenantId).sourceRows, before);
  start = performance.now(); const result = await data.execute(b, two.id, 'query', { query }); const otherLatencyMs = performance.now() - start;
  assert.deepEqual(result.rows, [{ total: 8386560 }]);
  await first; const results = await Promise.all(flood);
  clearInterval(sampler); loop.disable();
  const usage = data.budgets.snapshot(a.tenantId), other = data.budgets.snapshot(b.tenantId);
  const measurement = { otherLatencyMs, maxEventLoopMs: loop.max / 1e6, parentRssDeltaBytes: Math.max(0, peakRss - baseRss), usage, other };
  t.diagnostic(JSON.stringify(measurement));
  assert.equal(results.filter(x => x === 'TENANT_BUDGET_EXCEEDED').length, 12);
  assert.equal(usage.sourceRows, 4096 * 5); assert.equal(other.sourceRows, 4096);
  assert.equal(usage.peakQueued, 4); assert.equal(usage.peakRunning, 1);
  assert.ok(usage.maxExecutionMs < 3000, `execution ${usage.maxExecutionMs}ms`);
  assert.ok(otherLatencyMs < 6000, `competitor latency ${otherLatencyMs}ms`);
  assert.ok(measurement.maxEventLoopMs < 250, `event-loop stall ${measurement.maxEventLoopMs}ms`);
  assert.ok(measurement.parentRssDeltaBytes < 128 * 1048576);
  assert.ok(usage.peakWorkerRssBytes > 0 && usage.peakWorkerRssBytes < 384 * 1048576); assert.ok(usage.peakWorkingBytes < 16 * 1048576);
  assert.deepEqual(data.budgets.node(), { running: 0, queued: 0 });
});

test('H4 resource ceilings fail closed and tenant-local cache eviction leaves the other tenant readable', async t => {
  const f = await sourceFixture(t), a = await f.login(), b = await f.login('two');
  const one = await f.sources.upload(a, upload()), two = await f.sources.upload(b, upload());
  for (const [field, limit, code] of [['sourceRows', 2, 'TENANT_BUDGET_EXCEEDED'], ['resultBytes', 8, 'TENANT_BUDGET_EXCEEDED'], ['cacheBytes', 600, 'TENANT_BUDGET_EXCEEDED']]) {
    const config = structuredClone(budgetConfig); config.defaults[field] = limit;
    const data = dataFor(f, config);
    await assert.rejects(field === 'cacheBytes' ? data.refresh(a, one.id) : data.execute(a, one.id, 'output', {}), { code });
    assert.deepEqual(data.budgets.node(), { running: 0, queued: 0 });
    assert.ok(data.cache.bytes() <= config.node.cacheBytes);
  }
  const config = structuredClone(budgetConfig); config.defaults.cacheBytes = 2100;
  const data = dataFor(f, config), three = await f.sources.upload(a, upload());
  await data.refresh(b, two.id); await data.refresh(a, one.id); await data.refresh(a, three.id);
  assert.ok(data.cache.bytes(a.tenantId) <= 2100); assert.ok(data.cache.bytes() <= config.node.cacheBytes);
  assert.equal((await data.execute(b, two.id, 'output', { mode: 'BLAZE' })).rowCount, 3);
  await assert.rejects(data.execute(a, one.id, 'output', { mode: 'BLAZE' }), { code: 'BLAZE_NOT_READY' });
  const memory = structuredClone(budgetConfig); memory.defaults.workerRssBytes = 96 * 1048576; memory.defaults.workerHeapMb = 64; memory.defaults.duckdbMemoryMb = 32;
  const contained = dataFor(f, memory);
  await assert.rejects(contained.execute(a, one.id, 'output', {}), { code: 'EXECUTION_CANCELLED' });
  assert.deepEqual(contained.budgets.node(), { running: 0, queued: 0 });
});

test('H4 an independent watchdog kills blocked evaluators on deadline and parent death', async () => {
  const { fork } = await import('node:child_process'), { readFile } = await import('node:fs/promises');
  const fixture = new URL('./worker-parent-fixture.mjs', import.meta.url);
  const blocked = fork(fixture, ['worker', '200'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exit = new Promise(resolve => blocked.once('exit', (code, signal) => resolve({ code, signal })));
  assert.deepEqual(await exit, { code: null, signal: 'SIGKILL' });
  const parent = fork(fixture, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const { pid } = await new Promise((resolve, reject) => { parent.once('message', resolve); parent.once('error', reject); });
  const gone = new Promise(resolve => parent.once('exit', resolve)); parent.kill('SIGKILL'); await gone;
  const start = performance.now();
  for (;;) {
    try {
      const status = await readFile(`/proc/${pid}/status`, 'utf8');
      if (/^State:\s+Z/m.test(status)) break;
    } catch (e) { if (e.code === 'ENOENT') break; throw e; }
    if (performance.now() - start > 1000) { process.kill(pid, 'SIGKILL'); assert.fail('orphan survived'); }
    await delay(5);
  }
  assert.ok(performance.now() - start < 1000);
});
