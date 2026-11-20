import test from 'node:test';
import assert from 'node:assert/strict';
import { planVisual, evaluatePlan } from '@opensight/query-engine/browser';
import { request, wells, body, dimension, measure } from './helpers.mjs';

const dialects = ['duckdb', 'postgres', 'mysql', 'redshift', 'athena'];
const aggregations = ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'DISTINCT_COUNT'];
const charts = [
  { name: 'bar', visualId: 'revenue-by-region' },
  { name: 'line', visualId: 'revenue-trend', type: 'LINE' },
  { name: 'area', visualId: 'revenue-trend', type: 'AREA' },
  { name: 'pie', visualId: 'share-by-category' },
];

function categoryRequest(chart = charts[0], dated = false) {
  const r = request(chart.visualId);
  r.analysis.Definition.FilterGroups = [];
  wells(r).Category = dated ? [{ DateDimensionField: {
    FieldId: 'category-id', Column: { DataSetIdentifier: 'sales_data', ColumnName: 'order_date' }, DateGranularity: 'MONTH',
  } }] : [dimension('region', 'category-id')];
  wells(r).Values = [measure('revenue', 'SUM', 'primary-id')];
  if (chart.type) body(r).ChartConfiguration.Type = chart.type;
  return r;
}

function setSort(r, variant = 'AggregationSort', aggregation = 'SUM', direction = 'ASC', column = 'revenue') {
  const sort = { FieldId: 'category-id' };
  if (direction !== 'omitted') sort.Direction = direction;
  if (variant === 'AggregationSort') {
    sort.Column = { DataSetIdentifier: 'sales_data', ColumnName: column };
    sort.AggregationFunction = { NumericalAggregationFunction: { SimpleNumericalAggregation: aggregation } };
  }
  body(r).ChartConfiguration.SortConfiguration = { CategorySort: [{ [variant]: sort }] };
  return sort;
}

const rows = [
  { region: 'West', order_date: '2025-03-01', revenue: 8, profit: 5 },
  { region: 'East', order_date: '2025-01-01', revenue: 3, profit: 2 },
  { region: 'North', order_date: '2025-02-01', revenue: null, profit: null },
  { region: 'East', order_date: '2025-01-02', revenue: 4, profit: null },
];

function assertInvariant(r, dialect, baseline) {
  const before = structuredClone(r);
  const actual = planVisual(r, { dialect });
  assert.deepEqual(r, before, 'planning must not mutate the definition');
  assert.deepEqual(actual, baseline, 'the entire plan must be unchanged');
  assert.equal(actual.sql, baseline.sql);
  assert.deepEqual(evaluatePlan(actual, rows), evaluatePlan(baseline, rows));
  return actual;
}

for (const chart of charts) for (const dialect of dialects) {
  for (const variant of ['FieldSort', 'AggregationSort']) {
    for (const aggregation of variant === 'FieldSort' ? [undefined] : aggregations) {
      for (const direction of ['ASC', 'DESC', 'omitted']) {
        test(`CategorySort preserves plan/SQL/results: ${chart.name}, ${dialect}, ${variant}, ${aggregation ?? 'field'}, ${direction}`, () => {
          for (const dated of [false, true]) {
            const r = categoryRequest(chart, dated);
            const baseline = planVisual(r, { dialect });
            setSort(r, variant, aggregation, direction);
            const actual = assertInvariant(r, dialect, baseline);
            assert.deepEqual(actual.measures.map(m => [m.fieldId, m.columnName, m.aggregation]), [['primary-id', 'revenue', 'SUM']]);
            assert.deepEqual(evaluatePlan(actual, rows), dated ? [
              { month: '2025-01', 'primary-id': 7 },
              { month: '2025-02', 'primary-id': null },
              { month: '2025-03', 'primary-id': 8 },
            ] : [
              { 'category-id': 'East', 'primary-id': 7 },
              { 'category-id': 'North', 'primary-id': null },
              { 'category-id': 'West', 'primary-id': 8 },
            ]);
          }
        });
      }
    }
  }

  test(`CategorySort preserves calculations, multiple Values, measure aggregations and parameters: ${chart.name}, ${dialect}`, () => {
    const r = categoryRequest(chart);
    r.analysis.Definition.FilterGroups = request().analysis.Definition.FilterGroups;
    wells(r).Values.push(measure('discounted_revenue', 'AVG', 'secondary-id'));
    const baseline = planVisual(r, { dialect });
    assert.deepEqual(baseline.parameters, ['East']);
    assert.equal(baseline.calculations.length, 1);
    for (const aggregation of aggregations) {
      setSort(r, 'AggregationSort', aggregation, 'DESC', 'discounted_revenue');
      const actual = assertInvariant(r, dialect, baseline);
      assert.deepEqual(actual.measures.map(m => m.aggregation), ['SUM', 'AVG']);
    }
  });

  test(`empty SortConfiguration is a no-op: ${chart.name}, ${dialect}`, () => {
    const r = categoryRequest(chart);
    const baseline = planVisual(r, { dialect });
    body(r).ChartConfiguration.SortConfiguration = {};
    assertInvariant(r, dialect, baseline);
  });
}
