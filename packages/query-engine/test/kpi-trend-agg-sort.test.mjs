import test from 'node:test';
import assert from 'node:assert/strict';
import { planVisual, evaluatePlan } from '@opensight/query-engine/browser';
import { request, wells, body, dimension, measure } from './helpers.mjs';

const dialects = ['duckdb', 'postgres', 'mysql', 'redshift', 'athena'];
const aggregations = ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'DISTINCT_COUNT'];

function trendRequest() {
  const r = request();
  r.analysis.Definition.FilterGroups = [];
  wells(r).TrendGroups = [dimension('region', 'trend-id')];
  wells(r).Values = [measure('revenue', 'SUM', 'primary-id')];
  return r;
}

function setSort(r, aggregation = 'SUM', direction = 'ASC') {
  const sort = {
    FieldId: 'trend-id',
    Column: { DataSetIdentifier: 'sales_data', ColumnName: 'revenue' },
    AggregationFunction: { NumericalAggregationFunction: { SimpleNumericalAggregation: aggregation } },
  };
  if (direction !== 'omitted') sort.Direction = direction;
  body(r).ChartConfiguration.SortConfiguration = { TrendGroupSort: [{ AggregationSort: sort }] };
  return sort;
}

for (const dialect of dialects) for (const target of [false, true]) for (const wrapped of [false, true]) {
  test(`KPI aggregation sort preserves the entire plan and grouped SUM rows: ${dialect}, target=${target}, wrapped=${wrapped}`, () => {
    const r = trendRequest();
    if (target) wells(r).TargetValues = [measure('profit', 'SUM', 'target-id')];
    if (wrapped) body(r).ChartConfiguration.FieldWells = { KPIFieldWells: wells(r) };
    const baseline = planVisual(r, { dialect });
    // Sorting by average descending must neither recompute SUM as AVG nor reorder groups.
    setSort(r, 'AVERAGE', 'DESC');
    const actual = planVisual(r, { dialect });
    assert.deepEqual(actual, baseline);
    assert.deepEqual(actual.dimensions, baseline.dimensions);
    assert.deepEqual(actual.measures, baseline.measures);
    assert.equal(actual.sql, baseline.sql);
    assert.deepEqual(actual.measures.map(m => [m.fieldId, m.columnName, m.aggregation]), [
      ['primary-id', 'revenue', 'SUM'], ...(target ? [['target-id', 'profit', 'SUM']] : []),
    ]);
    const rows = [
      { region: 'West', revenue: 8, profit: 5 },
      { region: 'East', revenue: 3, profit: 2 },
      { region: 'North', revenue: null, profit: null },
      { region: 'East', revenue: 4, profit: null },
    ];
    const expected = [
      { 'trend-id': 'East', 'primary-id': 7, ...(target ? { 'target-id': 2 } : {}) },
      { 'trend-id': 'North', 'primary-id': null, ...(target ? { 'target-id': null } : {}) },
      { 'trend-id': 'West', 'primary-id': 8, ...(target ? { 'target-id': 5 } : {}) },
    ];
    assert.deepEqual(evaluatePlan(actual, rows), evaluatePlan(baseline, rows));
    assert.deepEqual(evaluatePlan(actual, rows), expected);
  });
}
