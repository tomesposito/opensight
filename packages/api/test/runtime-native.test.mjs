import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { InvocationScope } from '../dist/runtime-scope.js';
import { containedWork } from '../dist/contained-work.js';
import { TenantBudgets, WorkScope } from '../dist/budgets.js';
import { blazeLimits } from '../dist/blaze.js';
import { budgetConfig } from './budget-helpers.mjs';

test('SR1 Linux native DuckDB workers and watchdogs are gone before successful, failed and cancelled invocation return', async t => {
  assert.equal(process.platform, 'linux', 'native containment acceptance requires Linux');
  const pids = [], track = InvocationScope.prototype.worker, started = WorkScope.prototype.workerStarted;
  let cancel;
  t.mock.method(InvocationScope.prototype, 'worker', function (child) { pids.push(child.pid); track.call(this, child); });
  t.mock.method(WorkScope.prototype, 'workerStarted', function () { started.call(this); cancel?.(); });
  const source = { id: 'native', connectorId: 'file', table: 'native_rows', columns: [{ name: 'amount', type: 'INTEGER' }], security: 'unrestricted' };
  const task = { kind: 'prep', pipeline: { version: 1, input: 'native', steps: [] }, sources: [source], datasets: [], id: 'prepared', tables: [{ source, rows: [[1], [2]] }] };
  for (const outcome of ['success', 'failure', 'cancel']) {
    const scope = new InvocationScope(Date.now() + 10000), budgets = new TenantBudgets(budgetConfig, () => {}), context = { tenantId: 'synthetic' };
    cancel = outcome === 'cancel' ? () => scope.controller.abort() : undefined;
    const run = scope.run(async s => {
      s.own({ close: () => budgets.shutdown(), force: () => budgets.close() });
      const result = await budgets.run(context, false, async () => {}, () => containedWork(budgets.current(context), task, blazeLimits()), s.signal);
      assert.deepEqual(result.rows, [[1], [2]]);
      if (outcome === 'failure') throw Error('after native compute');
    });
    if (outcome === 'success') await run; else await assert.rejects(run);
    assert.deepEqual(budgets.node(), { running: 0, queued: 0 });
    for (const pid of pids) await assert.rejects(access(`/proc/${pid}`), { code: 'ENOENT' });
  }
  assert.equal(pids.length, 3);
});

test('SR1 failed or never-settling cleanup quarantines the process and clears its deadline timers', async () => {
  for (const fault of ['end', 'never']) {
    const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./support/runtime-cleanup-worker.mjs', import.meta.url)), fault], { timeout: 5000 });
    assert.match(stdout, /cleanup quarantined/);
  }
});
