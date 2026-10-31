import { evaluatePlan } from '@opensight/query-engine/browser';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { resolveMetricQuery, resolveMetricDefinition, metricColumn, interactiveRequest, executeLocal, planVisual } from '@opensight/query-engine';
import { request, fixtureRoot, read } from './helpers.mjs';
const metric = { id: 'net', version: 2, name: 'Net revenue', expression: '{revenue} - {profit}', defaultAggregation: 'AVG', format: { style: 'number', decimalPlaces: 2 }, description: '', synonyms: [] };
const query = { dimensions: [{ fieldId: 'region', columnName: 'region' }], measures: [{ fieldId: 'net', columnName: metricColumn('net'), aggregation: 'SUM' }], filters: [] };
test('governed measures use the same DuckDB, PostgreSQL and client calculation path', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  const csv = read('sales.csv').trim().split('\n'), columns = csv.shift().split(',');
  const rows = csv.map(line => Object.fromEntries(line.split(',').map((v,i) => [columns[i], v === '' ? null : [0,4,5].includes(i) ? Number(v) : v])));
  await pg.exec('CREATE TABLE sales (order_id BIGINT, order_date TIMESTAMP, region TEXT, category TEXT, revenue DOUBLE PRECISION, profit DOUBLE PRECISION)');
  for (const row of rows) await pg.query('INSERT INTO sales VALUES ($1,$2,$3,$4,$5,$6)', columns.map(c => row[c]));
  for (const expression of ['{revenue} - {profit}', 'sum({profit}) / nullIf(sum({revenue}), 0)', 'sumOver({revenue}, [], PRE_AGG)']) {
    const resolved = resolveMetricQuery(query, { metrics: [{ ...metric, expression }] });
    assert.equal(resolved.measures[0].aggregation, 'AVG');
    const metadata = request(), r = interactiveRequest(resolved, metadata);
    const duck = await executeLocal(r, { dataRoot: fixtureRoot });
    const plan = planVisual(r, { dialect: 'postgres' });
    let actual = (await pg.query(plan.sql, [...plan.parameters])).rows;
    if (plan.postProcess) actual = evaluatePlan(plan, actual);
    assert.deepEqual(actual, duck.rows); assert.deepEqual(evaluatePlan(duck.plan, rows), duck.rows);
  }
});
test('metric references reject missing publication, cross-dataset lookup, shadows, dimensions and unsafe fanout', () => {
  assert.throws(() => resolveMetricQuery(query, { metrics: [] }), { code: 'METRIC_NOT_PUBLISHED' });
  assert.throws(() => resolveMetricQuery(query, { metrics: [metric], unsafeJoin: true }), { code: 'METRIC_UNSAFE_FANOUT' });
  assert.throws(() => resolveMetricQuery({ ...query, calculatedFields: [{ name: metricColumn('net'), expression: '1' }] }, { metrics: [metric] }), { code: 'METRIC_OVERRIDE_FORBIDDEN' });
  assert.throws(() => resolveMetricQuery({ ...query, dimensions: [{ fieldId: 'net', columnName: metricColumn('net') }] }, { metrics: [metric] }), { code: 'METRIC_ROLE_INVALID' });
  const wire = interactiveRequest(query, request()).analysis.Definition;
  assert.throws(() => resolveMetricDefinition(wire, new Map([['other', { metrics: [metric] }]])), { code: 'METRIC_NOT_PUBLISHED' });
  const next = resolveMetricDefinition(wire, new Map([['sales_data', { metrics: [metric] }]]));
  assert.equal(next.CalculatedFields[0].Expression, 'avg({revenue} - {profit})');
  assert.deepEqual(wire.CalculatedFields, []);
});
