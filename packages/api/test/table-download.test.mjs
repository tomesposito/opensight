import test from 'node:test';
import assert from 'node:assert/strict';
import { TenantBudgets } from '../dist/budgets.js';
import { BlazeTable } from '../dist/blaze.js';
import { tableDownload } from '../dist/table-download.js';
import { budgetConfig } from './budget-helpers.mjs';
import { rowsToCsv } from '@opensight/web/exports';

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
test('#308 CSV streams bounded chunks with existing quoting, formula safety, Unicode and empty headers', async t => {
  const budgets = new TenantBudgets(budgetConfig, () => {});
  for (const rows of [[], [['=SUM(A1)', 3], ['a,"b"\r\n雪😀', -2], ['@formula', null], ['\ttext', true]], Array.from({ length: 5000 }, () => ['é😀'.repeat(20), 17])]) {
    const input = table(rows), expected = rows.length ? rowsToCsv(input.rows()) : 'text,value\r\n';
    t.mock.method(input, 'rows', () => assert.fail('CSV must not materialize row objects'));
    await budgets.run(context, false, async () => {}, async () => {
      const download = await tableDownload(budgets.current(context), 'table', input, 'csv'), chunks = [];
      for await (const chunk of download.body) { assert.ok(chunk.length <= 65536); chunks.push(chunk); }
      assert.equal(Buffer.concat(chunks).toString(), expected);
      assert.equal(download.byteLength, Buffer.byteLength(expected));
      if (download.byteLength > 65536) assert.ok(chunks.length > 1);
    });
  }
  const input = table([['first', 'second']]); input.columns[0].name = '10'; input.columns[1].name = '2';
  await budgets.run(context, false, async () => {}, async () => {
    const download = await tableDownload(budgets.current(context), 'table', input, 'csv'), chunks = [];
    for await (const chunk of download.body) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), '2,10\r\nsecond,first\r\n');
  });
});
for (const stage of ['sizing', 'streaming']) test(`#308 CSV cancellation interrupts ${stage} and drains admission`, async t => {
  const budgets = new TenantBudgets(budgetConfig, () => {}), input = table(Array.from({ length: 5000 }, () => ['text', 1]));
  let reads = 0;
  await assert.rejects(budgets.run(context, false, async () => {}, async () => {
    const scope = budgets.current(context), value = input.value;
    const cancel = () => t.mock.method(input, 'value', (...args) => {
      if (++reads === 100) setImmediate(() => scope.cancel());
      return value(...args);
    });
    if (stage === 'sizing') cancel();
    const result = await tableDownload(scope, 'table', input, 'csv');
    if (stage === 'streaming') cancel();
    for await (const _chunk of result.body) { /* consume until cancelled */ }
  }), { code: 'EXECUTION_CANCELLED' });
  assert.ok(reads >= 100 && reads < 1000, `only bounded work after cancellation: ${reads}`);
  assert.deepEqual(budgets.node(), { running: 0, queued: 0 });
});
