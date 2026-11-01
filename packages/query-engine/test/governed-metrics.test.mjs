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

async function makePg(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  const csv = read('sales.csv').trim().split('\n'), columns = csv.shift().split(',');
  const rows = csv.map(line => Object.fromEntries(line.split(',').map((v, i) => [columns[i], v === '' ? null : [0, 4, 5].includes(i) ? Number(v) : v])));
  await pg.exec('CREATE TABLE sales (order_id BIGINT, order_date TIMESTAMP, region TEXT, category TEXT, revenue DOUBLE PRECISION, profit DOUBLE PRECISION)');
  for (const row of rows) await pg.query('INSERT INTO sales VALUES ($1,$2,$3,$4,$5,$6)', columns.map(c => row[c]));
  return { pg, rows };
}
async function runAllEngines(t, req) {
  const { pg, rows } = await makePg(t);
  const duck = await executeLocal(req, { dataRoot: fixtureRoot });
  const plan = planVisual(req, { dialect: 'postgres' });
  let actual = (await pg.query(plan.sql, [...plan.parameters])).rows;
  if (plan.postProcess) actual = evaluatePlan(plan, actual);
  const norm = rs => rs.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
  actual = norm(actual);
  assert.deepEqual(actual, norm(duck.rows));
  assert.deepEqual(norm(evaluatePlan(duck.plan, rows)), norm(duck.rows));
  return { duck, plan };
}
const measureValue = (rows, region) => {
  const row = rows.find(r => Object.values(r).includes(region));
  assert.ok(row, `row for ${region}`);
  return Number(Object.entries(row).find(([k]) => k !== 'region')?.[1]);
};

test('every accepted metric aggregation consumes through interactive queries (#168)', async t => {
  for (const aggregation of ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'DISTINCT_COUNT']) {
    const m = { ...metric, expression: '{revenue}', defaultAggregation: aggregation };
    const resolved = resolveMetricQuery(query, { metrics: [m] });
    assert.equal(resolved.measures[0].aggregation, aggregation);
    await runAllEngines(t, interactiveRequest(resolved, request()));
  }
});

test('DISTINCT_COUNT metrics count distinct non-null values, not rows (#168)', async t => {
  const byRevenue = { ...metric, expression: '{revenue}', defaultAggregation: 'DISTINCT_COUNT' };
  const { duck } = await runAllEngines(t, interactiveRequest(resolveMetricQuery(query, { metrics: [byRevenue] }), request()));
  // East revenues: 100, 300, 0, null, 100 -> 3 distinct; West: 200, 50, 150 -> 3.
  assert.equal(measureValue(duck.rows, 'East'), 3);
  assert.equal(measureValue(duck.rows, 'West'), 3);
  const byCategory = { ...metric, expression: '{category}', defaultAggregation: 'DISTINCT_COUNT' };
  const cat = await runAllEngines(t, interactiveRequest(resolveMetricQuery(query, { metrics: [byCategory] }), request()));
  // Categories repeat within each region: 2 distinct, while COUNT would be 5 (East) / 3 (West).
  assert.equal(measureValue(cat.duck.rows, 'East'), 2);
  assert.equal(measureValue(cat.duck.rows, 'West'), 2);
});

test('DISTINCT_COUNT metric whose expression is already distinct_count(...) consumes (#168)', async t => {
  const m = { ...metric, expression: 'distinct_count({category})', defaultAggregation: 'DISTINCT_COUNT' };
  const { duck } = await runAllEngines(t, interactiveRequest(resolveMetricQuery(query, { metrics: [m] }), request()));
  assert.equal(measureValue(duck.rows, 'East'), 2);
  assert.equal(measureValue(duck.rows, 'West'), 2);
});

test('DISTINCT_COUNT metric consumes through a saved definition (#168)', async t => {
  const m = { ...metric, id: 'buyers', expression: '{category}', defaultAggregation: 'DISTINCT_COUNT' };
  const savedQuery = { dimensions: [{ fieldId: 'region', columnName: 'region' }], measures: [{ fieldId: 'buyers', columnName: metricColumn('buyers'), aggregation: 'DISTINCT_COUNT' }], filters: [] };
  const base = interactiveRequest(savedQuery, request());
  const definition = resolveMetricDefinition(base.analysis.Definition, new Map([['sales_data', { metrics: [m] }]]));
  assert.equal(definition.CalculatedFields[0].Expression, 'distinct_count({category})');
  const req = { ...base, analysis: { ...base.analysis, Definition: definition } };
  const { duck } = await runAllEngines(t, req);
  assert.equal(measureValue(duck.rows, 'East'), 2);
  assert.equal(measureValue(duck.rows, 'West'), 2);
});

test('plain-column DISTINCT_COUNT plans as COUNT(DISTINCT ...) on every engine (#168)', async t => {
  const q = { dimensions: [{ fieldId: 'region', columnName: 'region' }], measures: [{ fieldId: 'rev', columnName: 'revenue', aggregation: 'DISTINCT_COUNT' }], filters: [] };
  const { duck, plan } = await runAllEngines(t, interactiveRequest(q, request()));
  assert.match(plan.sql, /COUNT\(DISTINCT "revenue"\)/);
  assert.equal(measureValue(duck.rows, 'East'), 3);
  const qs = { ...q, measures: [{ fieldId: 'cat', columnName: 'category', aggregation: 'DISTINCT_COUNT' }] };
  const s = await runAllEngines(t, interactiveRequest(qs, request()));
  assert.equal(measureValue(s.duck.rows, 'East'), 2);
  assert.equal(measureValue(s.duck.rows, 'West'), 2);
});
