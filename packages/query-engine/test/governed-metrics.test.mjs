import { evaluatePlan, metricCombination as browserMetricCombination } from '@opensight/query-engine/browser';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { resolveMetricQuery, resolveMetricDefinition, parseMetricReference, metricId, queryUsesMetrics, metricColumn, metricCombination, interactiveRequest, executeLocal, planVisual } from '@opensight/query-engine';
import { request, fixtureRoot, read } from './helpers.mjs';
const metric = { id: 'net', version: 2, name: 'Net revenue', expression: '{revenue} - {profit}', defaultAggregation: 'AVG', format: { style: 'number', decimalPlaces: 2 }, description: '', synonyms: [] };
const query = { dimensions: [{ fieldId: 'region', columnName: 'region' }], measures: [{ fieldId: 'net', columnName: metricColumn('net'), aggregation: 'SUM' }], filters: [] };

test('metric combination proves only supported coarser-grain operations (#313)', () => {
  assert.equal(browserMetricCombination, metricCombination);
  for (const [defaultAggregation, expected] of [['SUM', 'SUM'], ['COUNT', 'SUM'], ['AVG', 'NONE'], ['MIN', 'MIN'], ['MAX', 'MAX'], ['DISTINCT_COUNT', 'NONE']]) {
    for (const expression of ['{revenue}', 'sumOver({revenue}, [], PRE_AGG)', 'sumOver({revenue}, [], PRE_FILTER)']) {
      assert.equal(metricCombination({ ...metric, expression, defaultAggregation }), expected, `${expression}, ${defaultAggregation}`);
    }
  }
  for (const [expression, expected] of [
    ['sum({revenue})', 'SUM'], ['count({revenue})', 'SUM'],
    ['min({revenue})', 'MIN'], ['max({revenue})', 'MAX'],
    ['sum({profit})/sum({revenue})', 'NONE'],
    ['sum({profit} * {revenue}) / sum({revenue})', 'NONE'],
    ['avg({revenue})', 'NONE'], ['distinct_count({category})', 'NONE'],
    ['-sum({revenue})', 'NONE'], ['coalesce(sum({revenue}), 0)', 'NONE'],
    ['sum(sum({revenue}))', 'NONE'], ['sum(sumOver({revenue}, [], PRE_AGG))', 'NONE'],
    ['sumOver(sum({revenue}), [], POST_AGG_FILTER)', 'NONE'], ['sum(', 'NONE'],
  ]) {
    assert.equal(metricCombination({ ...metric, expression, defaultAggregation: 'SUM' }), expected, expression);
  }
  assert.equal(metricCombination({ ...metric, expression: 'sum({revenue})', defaultAggregation: 'AVG' }), 'SUM');
});
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


test('metric references parse optional published-version pins without changing unpinned IDs (#327)', () => {
  assert.equal(parseMetricReference('revenue'), undefined);
  assert.equal(metricId('revenue'), undefined);
  assert.deepEqual(parseMetricReference('__metric_weekly-sales'), { id: 'weekly-sales' });
  assert.deepEqual(parseMetricReference('__metric_weekly-sales@v2'), { id: 'weekly-sales', version: 2 });
  assert.equal(metricId('__metric_weekly-sales'), 'weekly-sales');
  assert.equal(metricId('__metric_weekly-sales@v2'), 'weekly-sales');
});

const latest = { ...metric, version: 4, expression: 'sum({revenue}) * 2', defaultAggregation: 'SUM' };
const history = { metrics: [latest, { ...metric, id: 'unrelated' }], versions: [metric, latest] };
const pinnedQuery = version => ({ ...query, measures: [{ fieldId: 'net', columnName: `__metric_net@v${version}`, aggregation: 'SUM' }] });

test('pins select historical math and aggregation, keep exact names and report only selections (#327)', () => {
  const before = structuredClone(history);
  let selected;
  const result = resolveMetricQuery(pinnedQuery(2), history, metrics => { selected = metrics; });
  assert.deepEqual(result.calculatedFields, [{ name: '__metric_net@v2', expression: 'avg({revenue} - {profit})' }]);
  assert.equal(result.measures[0].aggregation, 'AVG');
  assert.deepEqual(selected, [metric]);
  const unpinned = resolveMetricQuery(query, history, metrics => { selected = metrics; });
  assert.deepEqual(unpinned.calculatedFields, [{ name: '__metric_net', expression: latest.expression }]);
  assert.equal(unpinned.measures[0].aggregation, 'SUM');
  assert.deepEqual(selected, [latest]);
  assert.deepEqual(history, before);
  assert.equal(resolveMetricQuery(pinnedQuery(4), { metrics: [latest] }).calculatedFields[0].expression, latest.expression);
});

test('draft and missing pins fail closed; unpublished metrics and security checks retain named errors (#327)', () => {
  for (const version of [1, 3, 5, 99, 0, '9007199254740993']) {
    assert.throws(() => resolveMetricQuery(pinnedQuery(version), history), { code: 'METRIC_VERSION_NOT_PUBLISHED', path: '$.metrics' });
    const wire = interactiveRequest(pinnedQuery(version), request()).analysis.Definition;
    assert.throws(() => resolveMetricDefinition(wire, new Map([['sales_data', history]])), { code: 'METRIC_VERSION_NOT_PUBLISHED', path: '$.metrics' });
  }
  assert.throws(() => resolveMetricQuery(pinnedQuery(2), { metrics: [], versions: [metric] }), { code: 'METRIC_NOT_PUBLISHED', path: '$.metrics' });
  assert.throws(() => resolveMetricQuery(pinnedQuery(2), { ...history, unsafeJoin: true }), { code: 'METRIC_UNSAFE_FANOUT' });
  assert.throws(() => resolveMetricQuery({ ...query, dimensions: [{ fieldId: 'x', columnName: '__metric_net@v2' }] }, history), { code: 'METRIC_ROLE_INVALID' });
  assert.throws(() => resolveMetricQuery({ ...query, calculatedFields: [{ name: '__metric_net@v2', expression: '1' }] }, history), { code: 'METRIC_OVERRIDE_FORBIDDEN' });
});

test('filter and calculated-field references select pins and dedupe exact references (#327)', () => {
  const q = { dimensions: [], measures: [], filters: [{ columnName: '__metric_net@v2', value: '10' }],
    calculatedFields: [{ name: 'delta', expression: '{__metric_net@v4} - {__metric_net@v2}' }] };
  assert.equal(queryUsesMetrics(q), true);
  assert.equal(queryUsesMetrics({ ...q, filters: [] }), true);
  assert.equal(queryUsesMetrics({ ...q, calculatedFields: [] }), true);
  let selected;
  const result = resolveMetricQuery(q, history, metrics => { selected = metrics; });
  assert.deepEqual(result.calculatedFields.map(c => c.name), ['delta', '__metric_net@v2', '__metric_net@v4']);
  assert.deepEqual(selected, [metric, latest]);
  const wire = { CalculatedFields: [{ Name: 'delta', Expression: q.calculatedFields[0].expression, DataSetIdentifier: 'data' }],
    FilterGroups: [{ Column: { DataSetIdentifier: 'data', ColumnName: '__metric_net@v2' } }] };
  const resolved = resolveMetricDefinition(wire, new Map([['data', history]]), metrics => { selected = metrics; });
  assert.deepEqual(resolved.CalculatedFields.map(c => c.Name), ['delta', '__metric_net@v2', '__metric_net@v4']);
  assert.deepEqual(selected, [metric, latest]);
  assert.throws(() => resolveMetricDefinition({ CalculatedFields: [{ Name: '__metric_net@v2', Expression: '1', DataSetIdentifier: 'data' }] }, new Map([['data', history]])), { code: 'METRIC_OVERRIDE_FORBIDDEN' });
});

test('two publications and the current reference coexist on DuckDB, PostgreSQL and client paths (#327)', async t => {
  const q = { ...query, measures: [
    ...pinnedQuery(2).measures.map(m => ({ ...m, fieldId: 'old' })),
    ...pinnedQuery(4).measures.map(m => ({ ...m, fieldId: 'new' })),
    { fieldId: 'current', columnName: '__metric_net', aggregation: 'SUM' },
  ] };
  const resolved = resolveMetricQuery(q, history);
  assert.deepEqual(resolved.calculatedFields.map(c => c.name), ['__metric_net@v2', '__metric_net@v4', '__metric_net']);
  const { duck } = await runAllEngines(t, interactiveRequest(resolved, request()));
  assert.equal(duck.rows.length, 2);
  for (const row of duck.rows) { assert.equal(row.new, row.current); assert.notEqual(row.old, row.new); }
  const base = interactiveRequest(q, request());
  const definition = resolveMetricDefinition(base.analysis.Definition, new Map([['sales_data', history]]));
  const saved = await runAllEngines(t, { ...base, analysis: { ...base.analysis, Definition: definition } });
  assert.deepEqual(saved.duck.rows, duck.rows);
});
