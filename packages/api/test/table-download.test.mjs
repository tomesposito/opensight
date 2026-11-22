import test from 'node:test';
import assert from 'node:assert/strict';
import { TenantBudgets } from '../dist/budgets.js';
import { BlazeTable } from '../dist/blaze.js';
import { tableDownload } from '../dist/table-download.js';
import { budgetConfig } from './budget-helpers.mjs';

const context = { tenantId: 'test', namespaceId: 'test', userId: 'author', authorizationRevision: 1 };
function table(rows = [['=SUM(A1)', 3]]) {
  const result = new BlazeTable({ maxBytes: 16777216, datasetBytes: 16777216, maxRows: 100000, cellChars: 16384 });
  result.start([{ name: 'text', type: 'string' }, { name: 'value', type: 'number' }]);
  for (const row of rows) result.row(row);
  return result;
}
for (const format of ['csv', 'xlsx']) test(`#308 ${format} refuses encoding memory before reading cells or allocating row copies`, async t => {
  const config = structuredClone(budgetConfig); config.defaults.workingBytes = config.defaults.resultBytes = 1024;
  const budgets = new TenantBudgets(config, () => {}), input = table();
  t.mock.method(input, 'rows', () => assert.fail('row objects allocated before admission'));
  t.mock.method(input, 'value', () => assert.fail('cell read before admission'));
  await assert.rejects(budgets.run(context, false, async () => {}, () => tableDownload(budgets.current(context), 'table', input, format)), { code: 'TENANT_BUDGET_EXCEEDED' });
  assert.equal(budgets.snapshot(context.tenantId).workerExecutions, 0);
  assert.deepEqual(budgets.node(), { running: 0, queued: 0 });
});
