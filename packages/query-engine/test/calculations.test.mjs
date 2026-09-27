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
  const normalized = results.rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, numeric.has(k) && v !== null ? Number(v) : v])));
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
