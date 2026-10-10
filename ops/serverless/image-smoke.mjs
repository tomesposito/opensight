// Run via stdin in the exact runtime image: no credentials, networking or mounted source.
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import { statfsSync } from 'node:fs';
import { InvocationScope } from './packages/api/dist/runtime-scope.js';
import { containedWork } from './packages/api/dist/contained-work.js';
import { TenantBudgets, WorkScope } from './packages/api/dist/budgets.js';
import { blazeLimits } from './packages/api/dist/blaze.js';
assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'arm64');
assert.match(process.version, /^v24\./);
await assert.rejects(writeFile('/var/task/forbidden', 'synthetic'), { code: 'EROFS' });
const fs = statfsSync('/tmp'); assert.ok(fs.blocks * fs.bsize <= 512 * 1024 * 1024);
for (const file of ['aws-lambda', 'platform-probe', 'lambda', 'scheduler-lambda', 'migration-lambda']) await import(`./packages/api/dist/${file}.js`);
for (const file of ['opensight-embed.html', 'opensight-embed-session.html', 'opensight-embed-preview.html']) await access(`./packages/web/dist/${file}`);
for (const path of ['./.git', './fixtures', './packages/api/test', './packages/api/src', './node_modules/typescript']) await assert.rejects(access(path), { code: 'ENOENT' });
assert.match(await readFile('./ops/serverless/rds-ca.pem', 'utf8'), /BEGIN CERTIFICATE/);
const tenant = { running: 1, queued: 4, executionMs: 10000, queueMs: 30000, sourceRows: 100000, resultBytes: 1048576, workingBytes: 16777216, cacheBytes: 16777216, workerRssBytes: 536870912, workerHeapMb: 128, duckdbMemoryMb: 64, cellChars: 16384 };
const config = { node: { ...tenant, running: 3, queued: 12, refreshSlots: 1, workingBytes: 67108864, cacheBytes: 67108864, workerRssBytes: 1610612736 }, defaults: tenant, tenants: {} };
const pids = [], track = InvocationScope.prototype.worker, started = WorkScope.prototype.workerStarted;
let cancel;
InvocationScope.prototype.worker = function(child) { pids.push(child.pid); track.call(this, child); };
WorkScope.prototype.workerStarted = function() { started.call(this); cancel?.(); };
const source = { id: 'native', connectorId: 'file', table: 'native_rows', columns: [{ name: 'amount', type: 'INTEGER' }], security: 'unrestricted' };
const task = { kind: 'prep', pipeline: { version: 1, input: 'native', steps: [] }, sources: [source], datasets: [], id: 'prepared', tables: [{ source, rows: [[1], [2]] }] };
for (const outcome of ['success', 'failure', 'cancel']) {
  const scope = new InvocationScope(Date.now() + 10000), budgets = new TenantBudgets(config, () => {}), context = { tenantId: 'synthetic' };
  let directory;
  cancel = outcome === 'cancel' ? () => scope.controller.abort() : undefined;
  const work = scope.run(async current => {
    directory = await current.temporaryDirectory();
    await writeFile(`${directory}/synthetic`, 'cleanup');
    current.own({ close: () => budgets.shutdown(), force: () => budgets.close() });
    const result = await budgets.run(context, false, async () => {}, () => containedWork(budgets.current(context), task, blazeLimits()), current.signal);
    assert.deepEqual(result.rows, [[1], [2]]);
    if (outcome === 'failure') throw Error('synthetic post-compute fault');
  });
  if (outcome === 'success') await work; else await assert.rejects(work);
  assert.deepEqual(budgets.node(), { running: 0, queued: 0 });
  await assert.rejects(access(directory), { code: 'ENOENT' });
  for (const pid of pids) await assert.rejects(access(`/proc/${pid}`), { code: 'ENOENT' });
}
assert.equal(pids.length, 3);
console.log(JSON.stringify({ passed: true, cases: ['read-only-root', 'bounded-tmp', 'production-modules', 'embed-assets', 'native-success', 'native-failure', 'native-cancel', 'worker-reaping', 'temporary-cleanup'] }));
