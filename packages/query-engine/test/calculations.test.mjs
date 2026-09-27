import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { executeLocal, planVisual } from '@opensight/query-engine';
import { evaluatePlan } from '@opensight/query-engine/browser';
import { calculation, dimension, fixtureRoot, measure, read, request, wells } from './helpers.mjs';
const source = read('sales.csv').trim().split('\n');
const columns = source.shift().split(',');
export const rows = source.map(line => Object.fromEntries(line.split(',').map((v, i) => [columns[i], v === '' ? null : [0, 4, 5].includes(i) ? Number(v) : v])));
export async function postgresFixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec('CREATE SCHEMA IF NOT EXISTS public; CREATE TABLE public.sales (order_id BIGINT, order_date TIMESTAMP, region TEXT, category TEXT, revenue DOUBLE PRECISION, profit DOUBLE PRECISION)');
  for (const row of rows) await pg.query('INSERT INTO sales VALUES ($1,$2,$3,$4,$5,$6)', columns.map(c => row[c]));
  return pg;
}
export async function differential(r, pg) {
  const duck = await executeLocal(r, { dataRoot: fixtureRoot }), plan = planVisual(r, { dialect: 'postgres' });
  const results = await pg.query(plan.sql, [...plan.parameters]);
  const numeric = new Set(plan.measures.map(m => m.outputName));
  let normalized = results.rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, numeric.has(k) && v !== null ? Number(v) : v])));
  if (plan.postProcess) { normalized = normalized.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v !== null && plan.sourceColumns.find(c => c.name === k)?.scalarType === 'number' ? Number(v) : v]))); normalized = evaluatePlan(plan, normalized); }
  const equivalent = (actual, expected, engine) => {
    assert.equal(actual.length, expected.length, engine);
    actual.forEach((row, i) => { assert.deepEqual(Object.keys(row), Object.keys(expected[i])); for (const [key, value] of Object.entries(row)) {
      const other = expected[i][key]; if (typeof value === 'number' && typeof other === 'number') assert.ok(Math.abs(value - other) <= 1e-12 * Math.max(1, Math.abs(other)), `${engine}: ${value} vs ${other}`);
      else assert.deepEqual(value, other, engine);
    } });
  };
  equivalent(normalized, duck.rows, 'PostgreSQL equals DuckDB');
  equivalent(evaluatePlan(duck.plan, rows), duck.rows, 'client equals DuckDB');
  return duck.rows;
}
test('aggregate function fixture differential and null semantics', async t => {
  const pg = await postgresFixture(t);
  const cases = [['sum', 900], ['avg', 900 / 7], ['count', 7], ['distinct_count', 6], ['min', 0], ['max', 300], ['median', 100], ['percentile', 200]];
  for (const [name, expected] of cases) await t.test(name, async () => {
    const r = request(); r.analysis.Definition.FilterGroups = []; calculation(r, `${name}({revenue}${name === 'percentile' ? ', 75' : ''})`);
    assert.deepEqual(await differential(r, pg), [{ calculated: expected }]);
  });
  for (const name of ['stdev', 'stdevp', 'var', 'varp']) await t.test(name, async () => {
    const r = request(); r.analysis.Definition.FilterGroups = []; calculation(r, `${name}({revenue})`);
    const result = await differential(r, pg); const values = rows.map(r => r.revenue).filter(v => v !== null), mean = values.reduce((a, b) => a + b) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - (name.endsWith('p') ? 0 : 1));
    assert.ok(Math.abs(result[0].calculated - (name.startsWith('stdev') ? Math.sqrt(variance) : variance)) < 1e-9);
  });
  await t.test('string count and distinct count', async () => { const r = request(); r.analysis.Definition.FilterGroups = []; calculation(r, 'distinct_count({region})'); assert.deepEqual(await differential(r, pg), [{ calculated: 2 }]); });
  await t.test('aggregate ratio at visual grain and calculation dependencies', async () => {
    const r = request('sales-table'); r.analysis.Definition.FilterGroups = []; wells(r).GroupBy = [dimension('region')];
    calculation(r, 'sum({profit}) / {Total}'); r.analysis.Definition.CalculatedFields.push({ Name: 'Total', DataSetIdentifier: 'sales_data', Expression: 'sum({revenue})' });
    assert.deepEqual(await differential(r, pg), [{ region: 'East', calculated: 65 / 500 }, { region: 'West', calculated: 70 / 400 }]);
  });
  await t.test('empty groups', async () => { const r = request(); r.analysis.Definition.FilterGroups[0].Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = ['missing']; calculation(r, 'coalesce(sum({revenue}), 0) + count({revenue})'); assert.deepEqual(await differential(r, pg), [{ calculated: 0 }]); });
});


test('table calculation fixture differential uses calendar offsets, partitions, ties and visual grain', async t => {
  const pg = await postgresFixture(t);
  const query = expression => { const r = request('revenue-trend'); r.analysis.Definition.FilterGroups = []; calculation(r, expression); return r; };
  const cases = [
    ['runningSum(sum({revenue}), [{order_date} ASC])', [600, 650, 900]],
    ['percentOfTotal(sum({revenue}))', [600/900, 50/900, 250/900]],
    ['difference(sum({revenue}), [{order_date} ASC], -1)', [null, -550, 200]],
    ['percentDifference(sum({revenue}), [{order_date} ASC], -1)', [null, -550/600, 4]],
    ['periodOverPeriodDifference(sum({revenue}), {order_date}, MONTH, 1)', [null, null, 200]],
    ['periodOverPeriodPercentDifference(sum({revenue}), {order_date}, MONTH, 1)', [null, null, 4]],
    ['rank([sum({revenue}) DESC])', [1, 3, 2]],
    ['denseRank([sum({revenue}) ASC])', [3, 1, 2]],
  ];
  for (const [expression, expected] of cases) await t.test(expression, async () => {
    const result = await differential(query(expression), pg);
    assert.deepEqual(result.map(r => r.calculated), expected);
  });
  await t.test('partitions and ties', async () => {
    const r = request('sales-table'); r.analysis.Definition.FilterGroups = []; wells(r).GroupBy = [dimension('region'), dimension('category')];
    calculation(r, 'percentOfTotal(sum({revenue}), [{region}])');
    assert.deepEqual((await differential(r, pg)).map(r => r.calculated), [0.4, 0.6, 0.875, 0.125]);
    calculation(r, 'rank([count({region}) ASC])', 'ranks');
    assert.deepEqual((await differential(r, pg)).map(r => r.ranks), [4, 2, 2, 1]);
    calculation(r, 'denseRank([count({region}) ASC])', 'dense');
    assert.deepEqual((await differential(r, pg)).map(r => r.dense), [3, 2, 2, 1]);
  });
  await t.test('post processing retains pushed scalar expressions', async () => {
    const r = query('runningSum(sum({Rounded}), [{order_date} ASC])'); r.analysis.Definition.CalculatedFields.push({ Name: 'Rounded', DataSetIdentifier: 'sales_data', Expression: 'round({revenue} * 0.9, 2)' });
    assert.match(planVisual(r).sql, /ROUND/);
    assert.deepEqual((await differential(r, pg)).map(r => r.calculated), [540, 585, 810]);
  });
});


test('level-aware stages agree across engines and preserve filter ordering', async t => {
  const pg = await postgresFixture(t);
  const expected = { sum: [900, 500], avg: [900/7, 125], count: [7, 4], min: [0, 0], max: [300, 300] };
  for (const [name, values] of Object.entries(expected)) for (const [i, level] of ['PRE_FILTER', 'PRE_AGG'].entries()) await t.test(`${name}Over ${level}`, async () => {
    const r = request(); calculation(r, `${name}Over({revenue}, [], ${level})`); wells(r).Values = [measure('calculated', 'MIN')];
    assert.deepEqual(await differential(r, pg), [{ calculated: values[i] }]);
  });
  for (const name of Object.keys(expected)) await t.test(`${name}Over POST_AGG_FILTER`, async () => {
    const r = request('sales-table'); r.analysis.Definition.FilterGroups = []; wells(r).GroupBy = [dimension('region')];
    calculation(r, `${name}Over(sum({revenue}), [], POST_AGG_FILTER)`);
    const value = { sum: 900, avg: 450, count: 2, min: 400, max: 500 }[name];
    assert.deepEqual(await differential(r, pg), [{ region: 'East', calculated: value }, { region: 'West', calculated: value }]);
  });
  await t.test('PRE_FILTER nested in an aggregate survives the analysis filter', async () => {
    const r = request(); calculation(r, 'sum({revenue}) / min(sumOver({revenue}, [], PRE_FILTER))');
    assert.deepEqual(await differential(r, pg), [{ calculated: 500/900 }]);
  });
  await t.test('PRE_AGG partitions can use fields absent from the visual', async () => {
    const r = request(); calculation(r, 'max(sumOver({revenue}, [{category}], PRE_AGG))');
    assert.deepEqual(await differential(r, pg), [{ calculated: 300 }]);
  });
  await t.test('POST_AGG_FILTER sees aggregate-filtered groups', async () => {
    const r = request('sales-table'); r.analysis.Definition.FilterGroups = []; wells(r).GroupBy = [dimension('region')];
    calculation(r, 'percentOfTotal(sum({revenue}))'); r.analysis.Definition.CalculatedFields.push({ Name: 'Total', DataSetIdentifier: 'sales_data', Expression: 'sum({revenue})' });
    r.parameterDeclarations = [{ name: 'Threshold', type: 'number', multiple: false }]; r.parameterBindings = { Threshold: [450] }; r.parameterFilters = [{ columnName: 'Total', parameterName: 'Threshold', operator: 'GREATER_THAN_OR_EQUAL_TO' }];
    assert.deepEqual(await differential(r, pg), [{ region: 'East', calculated: 1 }]);
  });
});
