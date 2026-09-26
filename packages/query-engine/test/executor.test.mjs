import assert from 'node:assert/strict';
import test from 'node:test';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { executeLocal } from '@opensight/query-engine';
import { calculation, deferredExpressions, dimension, expected, fixtureRoot, measure, read, request, semantics, temporaryCsv, wells } from './helpers.mjs';

for (const oracle of expected) {
  test(`DuckDB generated-query results: ${oracle.visualId}`, async () => {
    const result = await executeLocal(request(oracle.visualId), { dataRoot: fixtureRoot });
    assert.deepEqual(result.rows, oracle.rows);
    assert.doesNotThrow(() => JSON.stringify(result));
  });
}

for (const scenario of semantics) {
  test(`semantic execution contract: ${scenario.id}`, async (t) => {
    if (scenario.status.startsWith('deferred-')) {
      for (const expression of deferredExpressions[scenario.id]) {
        const r = request();
        calculation(r, expression);
        await assert.rejects(executeLocal(r, { dataRoot: '/does-not-exist' }), { code: 'UNSUPPORTED_FEATURE' });
      }
    } else {
      // Select the same row as the oracle's WHERE order_id = 6 without enabling numeric filters.
      const lines = read('sales.csv').trimEnd().split('\n');
      const options = temporaryCsv(t, `${lines[0]}\n${lines.find(line => line.startsWith('6,'))}\n`);
      const r = request();
      assert.deepEqual((await executeLocal(r, options)).rows, scenario.rows);
      wells(r).Values = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'].map(a => measure('revenue', a, a.toLowerCase()));
      assert.deepEqual((await executeLocal(r, options)).rows, [{ sum: null, avg: null, count: 0, min: null, max: null }]);
    }
  });
}

test('multiple grouping keys and all enabled aggregations execute with non-null COUNT semantics', async () => {
  const r = request('sales-table');
  r.analysis.Definition.FilterGroups = [];
  wells(r).GroupBy = [dimension('region'), dimension('category')];
  wells(r).Values = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'].map(a => measure('revenue', a, a.toLowerCase()));
  assert.deepEqual((await executeLocal(r, { dataRoot: fixtureRoot })).rows, [
    { region: 'East', category: 'Hardware', sum: 200, avg: 200 / 3, count: 3, min: 0, max: 100 },
    { region: 'East', category: 'Software', sum: 300, avg: 300, count: 1, min: 300, max: 300 },
    { region: 'West', category: 'Hardware', sum: 350, avg: 175, count: 2, min: 150, max: 200 },
    { region: 'West', category: 'Software', sum: 50, avg: 50, count: 1, min: 50, max: 50 },
  ]);
});

test('row arithmetic occurs before SUM, propagates nulls and uses operator precedence', async () => {
  const r = request();
  calculation(r, '({revenue} - {profit}) * 2 + 1');
  assert.deepEqual((await executeLocal(r, { dataRoot: fixtureRoot })).rows, [{ calculated: 683 }]);
  calculation(r, '1 + 2 * 3 - 4', 'literal_math');
  assert.deepEqual((await executeLocal(r, { dataRoot: fixtureRoot })).rows, [{ literal_math: 15 }]);
});

test('chained calculations evaluate in dependency order, including a forward reference', async () => {
  const r = request();
  calculation(r, '{later} - 5', 'first');
  r.analysis.Definition.CalculatedFields.push({ Name: 'later', DataSetIdentifier: 'sales_data', Expression: '{revenue} * 0.9' });
  assert.deepEqual((await executeLocal(r, { dataRoot: fixtureRoot })).rows, [{ first: 430 }]);
});

test('empty filtered input preserves scalar null aggregates and returns no grouped rows', async () => {
  const r = request();
  r.analysis.Definition.FilterGroups[0].Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = ['Nowhere'];
  assert.deepEqual((await executeLocal(r, { dataRoot: fixtureRoot })).rows, [{ revenue: null }]);
  r.visualId = 'revenue-by-region';
  assert.deepEqual((await executeLocal(r, { dataRoot: fixtureRoot })).rows, []);
});

test('SQL injection strings stay bound and quoted', async () => {
  const r = request();
  const alias = 'revenue"; DROP TABLE sales; --';
  wells(r).Values = [measure('revenue', 'SUM', alias)];
  r.analysis.Definition.FilterGroups[0].Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = ["East' OR TRUE --"];
  assert.deepEqual((await executeLocal(r, { dataRoot: fixtureRoot })).rows, [{ [alias]: null }]);
});

test('multiple filter groups intersect before aggregation', async () => {
  const r = request();
  const second = structuredClone(r.analysis.Definition.FilterGroups[0]);
  second.FilterGroupId = 'software';
  second.Filters[0].CategoryFilter.Column.ColumnName = 'category';
  second.Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = ['Software'];
  r.analysis.Definition.FilterGroups.push(second);
  assert.deepEqual((await executeLocal(r, { dataRoot: fixtureRoot })).rows, [{ revenue: 300 }]);
});

test('calculated string filters bind before filtering', async () => {
  const r = request();
  r.analysis.Definition.CalculatedFields.push({ Name: 'region_alias', DataSetIdentifier: 'sales_data', Expression: '{region}' });
  r.analysis.Definition.FilterGroups[0].Filters[0].CategoryFilter.Column.ColumnName = 'region_alias';
  assert.deepEqual((await executeLocal(r, { dataRoot: fixtureRoot })).rows, [{ revenue: 500 }]);
});

test('null dimensions group deterministically and the non-null equality policy excludes them', async t => {
  const options = temporaryCsv(t, read('sales.csv') + '9,2025-04-02,,Hardware,10,2\n');
  const r = request('revenue-by-region');
  assert.deepEqual((await executeLocal(r, options)).rows, [{ region: 'East', revenue: 500 }]);
  r.analysis.Definition.FilterGroups = [];
  assert.deepEqual((await executeLocal(r, options)).rows, [
    { region: null, revenue: 10 }, { region: 'East', revenue: 500 }, { region: 'West', revenue: 400 },
  ]);
});

test('calendar months span years and do not manufacture missing periods', async t => {
  const options = temporaryCsv(t, read('sales.csv') + '9,2026-01-31,East,Hardware,10,2\n');
  assert.deepEqual((await executeLocal(request('revenue-trend'), options)).rows, [
    ...expected.find(q => q.visualId === 'revenue-trend').rows, { month: '2026-01', revenue: 10 },
  ]);
});

test('CSV quoting and apostrophes in local filenames are supported', async t => {
  const r = request('share-by-category');
  r.localData.csv = "sales'quoted.csv";
  const options = temporaryCsv(t, read('sales.csv').replaceAll('Hardware', '"Hard,ware"'), r.localData.csv);
  assert.deepEqual((await executeLocal(r, options)).rows, [{ category: 'Hard,ware', revenue: 200 }, { category: 'Software', revenue: 300 }]);
});

test('large integer aggregates serialize losslessly as decimal strings', async t => {
  const r = request();
  wells(r).Values = [measure('order_id')];
  const options = temporaryCsv(t, read('sales.csv').split('\n')[0] + '\n9007199254740993,2025-01-01,East,Hardware,1,1\n');
  assert.deepEqual((await executeLocal(r, options)).rows, [{ order_id: '9007199254740993' }]);
});

for (const [name, transform, code] of [
  ['wrong header', text => text.replace('order_id,order_date', 'wrong,order_date'), 'LOCAL_DATA_ERROR'],
  ['reordered header', text => text.replace('revenue,profit', 'profit,revenue'), 'LOCAL_DATA_ERROR'],
  ['bad numeric cell', text => text.replace(',100,20', ',bad,20'), 'EXECUTION_ERROR'],
  ['bad date', text => text.replace('2025-01-01', '2025-99-99'), 'EXECUTION_ERROR'],
  ['offset timestamps outside initial subset', text => text.replace('2025-01-01', '2025-01-01T01:00:00+02:00'), 'EXECUTION_ERROR'],
  ['nonfinite cell', text => text.replace(',100,20', ',NaN,20'), 'LOCAL_DATA_ERROR'],
]) {
  test(`executor rejects ${name}`, async t => {
    await assert.rejects(executeLocal(request(), temporaryCsv(t, transform(read('sales.csv')))), { code });
  });
}

test('executor rejects missing CSV and symlink escapes from the selected root', async t => {
  const r = request();
  r.localData.csv = 'missing.csv';
  await assert.rejects(executeLocal(r, { dataRoot: fixtureRoot }), { code: 'LOCAL_DATA_ERROR' });
  const options = temporaryCsv(t, read('sales.csv'));
  symlinkSync(join(fixtureRoot, 'sales.csv'), join(options.dataRoot, 'outside.csv'));
  r.localData.csv = 'outside.csv';
  await assert.rejects(executeLocal(r, options), { code: 'LOCAL_DATA_ERROR' });
});

test('simultaneous calls have isolated databases', async () => {
  const rows = await Promise.all(expected.map(async oracle => (await executeLocal(request(oracle.visualId), { dataRoot: fixtureRoot })).rows));
  assert.deepEqual(rows, expected.map(q => q.rows));
});
