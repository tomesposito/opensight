import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMetricDefinition } from '@opensight/query-engine';
import { AssetCatalog, assetKey } from '../dist/asset-model.js';
import { lookupMetrics, metricDefinition, metricQuery } from '../dist/metric-consumption.js';
import { DashboardSnapshots } from '../dist/reports.js';
import { dashboardExport } from '../dist/dashboard-export.js';

const scope = { tenantId: 'tenant', namespaceId: 'workspace', userId: 'author' };
const dataset = { kind: 'dataset', id: 'sales' };
const metric = { id: 'total', version: 2, name: 'Total', expression: '{amount}', defaultAggregation: 'SUM', format: { style: 'number', decimalPlaces: 2 }, description: '', synonyms: [] };
const wire = (...ids) => ({ Sheets: ids.map(DataSetIdentifier => ({ Column: { DataSetIdentifier, ColumnName: '__metric_total' } })) });

test('reports and dashboard exports forward resolved metrics for grouped totals (#313)', async () => {
  const definition = { Sheets: [{ SheetId: 'sheet', Visuals: [{ KPIVisual: { VisualId: 'total', ChartConfiguration: { FieldWells: {
    Values: [{ NumericalMeasureField: { FieldId: 'value', Column: { DataSetIdentifier: 'sales', ColumnName: '__metric_total' }, AggregationFunction: { SimpleNumericalAggregation: 'SUM' } } }],
    TrendGroups: [{ CategoricalDimensionField: { FieldId: 'period', Column: { DataSetIdentifier: 'sales', ColumnName: 'period' } } }],
  } } } }] }] };
  const result = { rows: [{ period: 'A', value: 10 }, { period: 'B', value: 30 }], bindings: { period: 'period', value: 'value' },
    metrics: [{ ...metric, expression: 'sum({amount})' }], plan: { dimensions: [{ fieldId: 'period', outputName: 'period' }], measures: [{ fieldId: 'value', outputName: 'value' }] } };
  const snapshots = new DashboardSnapshots({ get: () => ({ Definition: definition }) }, { executeVisual: async () => result });
  assert.equal((await snapshots.capture('dashboard')).visuals[0].option.graphic[0].style.text, '40');
  const backend = { query: async () => result }, record = { id: 'dashboard', versions: [{ version: 1, name: 'Test', wireDefinition: definition }] };
  assert.match((await dashboardExport(backend, record, 1, 'csv', {})).bytes.toString(), /sheet,total/);
  result.metrics = [{ ...metric, expression: 'sum({profit}) / sum({amount})' }];
  await assert.rejects(snapshots.capture('dashboard'), /NONADDITIVE_MEASURE_COMBINATION/);
  await assert.rejects(dashboardExport(backend, record, 1, 'csv', {}), /NONADDITIVE_MEASURE_COMBINATION/);
});

test('metric definition dedupes targeted lookups per full dataset key and preserves each binding result', async () => {
  const calls = [], resolution = { metrics: [metric], unsafeJoin: false };
  const backend = { scope, transaction: () => assert.fail('targeted lookup must not scan the catalog'), async metricExecution(ref) {
    assert.equal(this.scope, scope); calls.push(assetKey(ref)); await Promise.resolve(); return resolution;
  } };
  const bindings = { first: dataset, second: { ...dataset }, owned: { kind: 'prepared-dataset', id: 'sales', ownerId: 'author' }, repeated: { ownerId: 'author', id: 'sales', kind: 'prepared-dataset' }, peer: { kind: 'prepared-dataset', id: 'sales', ownerId: 'peer' } };
  const definition = wire(...Object.keys(bindings)), before = structuredClone(definition);
  let resolved;
  const result = await metricDefinition(definition, bindings, lookupMetrics(backend), metrics => { resolved = metrics; });
  assert.deepEqual(calls, [assetKey(dataset), assetKey(bindings.owned), assetKey(bindings.peer)]);
  assert.deepEqual(result, resolveMetricDefinition(definition, new Map(Object.keys(bindings).map(id => [id, resolution]))));
  assert.deepEqual(resolved, Object.keys(bindings).map(() => metric));
  assert.deepEqual(definition, before);
  resolution.metrics = [{ ...metric, version: 4, expression: '{amount} * 2' }];
  const next = await metricDefinition(definition, bindings, lookupMetrics(backend));
  assert.equal(calls.length, 6, 'dedupe must not cache across definition calls or publications');
  assert.ok(next.CalculatedFields.every(c => c.Expression === 'sum({amount} * 2)'));
});

test('metric definition skips ordinary definitions and propagates one shared lookup failure', async () => {
  const plain = { Sheets: [] };
  assert.equal(await metricDefinition(plain, { data: dataset }, () => assert.fail('ordinary visual needs no metric lookup')), plain);
  let calls = 0;
  const failure = Object.assign(new Error('missing dataset'), { code: 'METRIC_DATASET_NOT_FOUND' });
  const lookup = async () => { calls++; throw failure; };
  await assert.rejects(metricDefinition(wire('a', 'b'), { a: dataset, b: { ...dataset } }, lookup), e => e === failure);
  assert.equal(calls, 1);
});

test('metric lookup keeps the generic catalog fallback and never retries targeted errors with a scan', async () => {
  const catalog = new AssetCatalog(scope, [{ kind: 'user', id: 'author', version: 1, body: { role: 'author' } }, { ...dataset, version: 1, body: { definition: {} } }]);
  let calls = 0;
  const backend = { scope, async transaction(write, work) { assert.equal(write, false); calls++; return work(catalog); } };
  assert.deepEqual(await lookupMetrics(backend)(dataset), { metrics: [], versions: [], unsafeJoin: false });
  assert.equal(calls, 1);
  await assert.rejects(lookupMetrics(backend)({ ...dataset, id: 'unknown' }), { code: 'METRIC_DATASET_NOT_FOUND' });
  backend.metricExecution = async () => { throw Object.assign(new Error('revised'), { code: 'AUTHORIZATION_REVISED' }); };
  await assert.rejects(lookupMetrics(backend)(dataset), { code: 'AUTHORIZATION_REVISED' });
  assert.equal(calls, 2);
});


test('metric consumers report selected publications only, including pins and repeated dataset bindings (#327)', async () => {
  const current = { ...metric, version: 4, expression: '{amount} * 2' };
  const resolution = { metrics: [current, { ...metric, id: 'unused' }], versions: [metric, current] };
  let reported;
  const capture = metrics => { reported = metrics; };
  const query = { dimensions: [], measures: [{ fieldId: 'sales', columnName: '__metric_total@v2', aggregation: 'SUM' }], filters: [] };
  await metricQuery(query, dataset, async () => resolution, capture);
  assert.deepEqual(reported, [metric]);
  await metricQuery({ ...query, measures: [{ ...query.measures[0], columnName: '__metric_total' }] }, dataset, async () => resolution, capture);
  assert.deepEqual(reported, [current]);
  const definition = wire('first', 'second');
  definition.Sheets[0].Column.ColumnName = '__metric_total@v2';
  await metricDefinition(definition, { first: dataset, second: dataset, unused: dataset }, async () => resolution, capture);
  assert.deepEqual(reported, [metric, current]);
});
