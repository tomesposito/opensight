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

for (const dialect of dialects) for (const aggregation of aggregations) for (const direction of ['ASC', 'DESC', 'omitted']) {
  test(`KPI aggregation sort admits ${aggregation} ${direction} in ${dialect}`, () => {
    for (const dated of [false, true]) for (const wrapped of [false, true]) {
      const r = trendRequest();
      if (dated) wells(r).TrendGroups = [{ DateDimensionField: {
        FieldId: 'trend-id', Column: { DataSetIdentifier: 'sales_data', ColumnName: 'order_date' }, DateGranularity: 'MONTH',
      } }];
      if (wrapped) body(r).ChartConfiguration.FieldWells = { KPIFieldWells: wells(r) };
      const baseline = planVisual(r, { dialect });
      setSort(r, aggregation, direction);
      assert.deepEqual(planVisual(r, { dialect }), baseline);
    }
  });
}

test('KPI aggregation sort admits a primary column also used by the target', () => {
  const r = trendRequest();
  wells(r).TargetValues = [measure('revenue', 'SUM', 'target-id')];
  setSort(r);
  for (const dialect of dialects) assert.equal(planVisual(r, { dialect }).measures.length, 2);
});

const sp = '$.analysis.Definition.Sheets[0].Visuals[3].KPIVisual.ChartConfiguration.SortConfiguration';
const ap = `${sp}.TrendGroupSort[0].AggregationSort`;
const fp = `${ap}.AggregationFunction`;
const np = `${fp}.NumericalAggregationFunction`;
const invalidCases = [
  ['both sort variants', (r, s, c) => { c.TrendGroupSort[0].FieldSort = { FieldId: 'trend-id', Direction: 'DESC' }; }, 'INVALID_INPUT', sp],
  ['empty wrapper', (r, s, c) => { c.TrendGroupSort = [{}]; }, 'INVALID_INPUT', sp],
  ['null wrapper', (r, s, c) => { c.TrendGroupSort = [null]; }, 'INVALID_INPUT', sp],
  ['unknown wrapper key', (r, s, c) => { c.TrendGroupSort[0].Unexpected = true; }, 'UNSUPPORTED_FEATURE', `${sp}.Unexpected`],
  ['CategorySort wrapper', (r, s, c) => { c.TrendGroupSort = [{ CategorySort: s }]; }, 'UNSUPPORTED_FEATURE', `${sp}.CategorySort`],
  ['CategorySort beside TrendGroupSort', (r, s, c) => { c.CategorySort = []; }, 'UNSUPPORTED_FEATURE', `${sp}.CategorySort`],
  ['multiple entries', (r, s, c) => { c.TrendGroupSort.push(structuredClone(c.TrendGroupSort[0])); }, 'INVALID_INPUT', sp],
  ['empty list', (r, s, c) => { c.TrendGroupSort = []; }, 'INVALID_INPUT', sp],
  ['non-array list', (r, s, c) => { c.TrendGroupSort = {}; }, 'INVALID_INPUT', `${sp}.TrendGroupSort`],
  ['null aggregation sort', (r, s, c) => { c.TrendGroupSort[0].AggregationSort = null; }, 'INVALID_INPUT', ap],
  ['unknown aggregation sort key', (r, s) => { s.Unexpected = true; }, 'UNSUPPORTED_FEATURE', `${ap}.Unexpected`],
  ['measure field ID', (r, s) => { s.FieldId = 'primary-id'; }, 'INVALID_INPUT', sp],
  ['unbound field ID', (r, s) => { s.FieldId = 'missing'; }, 'INVALID_INPUT', sp],
  ['trend column instead of field ID', (r, s) => { s.FieldId = 'region'; }, 'INVALID_INPUT', sp],
  ['missing field ID', (r, s) => { delete s.FieldId; }, 'INVALID_INPUT', `${ap}.FieldId`],
  ['non-string field ID', (r, s) => { s.FieldId = 42; }, 'INVALID_INPUT', `${ap}.FieldId`],
  ['no trend dimension', r => { delete wells(r).TrendGroups; }, 'INVALID_INPUT', sp],
  ['target-only column', (r, s) => { wells(r).TargetValues = [measure('profit', 'SUM', 'target-id')]; s.Column.ColumnName = 'profit'; }, 'INVALID_INPUT', `${ap}.Column`],
  ['dimension column', (r, s) => { s.Column.ColumnName = 'region'; }, 'INVALID_INPUT', `${ap}.Column`],
  ['other bound dataset column', (r, s) => { s.Column.ColumnName = 'profit'; }, 'INVALID_INPUT', `${ap}.Column`],
  ['wrong dataset identifier', (r, s) => { s.Column.DataSetIdentifier = 'other_data'; }, 'UNRESOLVED_BINDING', `${ap}.Column.DataSetIdentifier`],
  ['missing dataset identifier', (r, s) => { delete s.Column.DataSetIdentifier; }, 'UNRESOLVED_BINDING', `${ap}.Column.DataSetIdentifier`],
  ['nonexistent column', (r, s) => { s.Column.ColumnName = 'missing'; }, 'UNRESOLVED_BINDING', `${ap}.Column.ColumnName`],
  ['missing column name', (r, s) => { delete s.Column.ColumnName; }, 'INVALID_INPUT', `${ap}.Column.ColumnName`],
  ['missing column', (r, s) => { delete s.Column; }, 'INVALID_INPUT', `${ap}.Column`],
  ['unknown column key', (r, s) => { s.Column.Unexpected = true; }, 'UNSUPPORTED_FEATURE', `${ap}.Column.Unexpected`],
  ['bad direction', (r, s) => { s.Direction = 'DOWN'; }, 'INVALID_INPUT', sp],
  ['null direction', (r, s) => { s.Direction = null; }, 'INVALID_INPUT', sp],
  ['non-string direction', (r, s) => { s.Direction = 1; }, 'INVALID_INPUT', sp],
  ['unknown aggregation function key', (r, s) => { s.AggregationFunction.Unexpected = true; }, 'UNSUPPORTED_FEATURE', `${fp}.Unexpected`],
  ['unknown numerical aggregation key', (r, s) => { s.AggregationFunction.NumericalAggregationFunction.Unexpected = true; }, 'UNSUPPORTED_FEATURE', `${np}.Unexpected`],
  ['missing aggregation function', (r, s) => { delete s.AggregationFunction; }, 'INVALID_INPUT', fp],
  ['null aggregation function', (r, s) => { s.AggregationFunction = null; }, 'INVALID_INPUT', fp],
  ['missing numerical wrapper', (r, s) => { s.AggregationFunction = {}; }, 'INVALID_INPUT', np],
  ['unwrapped simple aggregation', (r, s) => { s.AggregationFunction = { SimpleNumericalAggregation: 'SUM' }; }, 'UNSUPPORTED_FEATURE', `${fp}.SimpleNumericalAggregation`],
  ['null numerical wrapper', (r, s) => { s.AggregationFunction.NumericalAggregationFunction = null; }, 'INVALID_INPUT', np],
  ['missing simple aggregation', (r, s) => { s.AggregationFunction.NumericalAggregationFunction = {}; }, 'INVALID_INPUT', `${np}.SimpleNumericalAggregation`],
  ['non-string aggregation', (r, s) => { s.AggregationFunction.NumericalAggregationFunction.SimpleNumericalAggregation = 1; }, 'INVALID_INPUT', `${np}.SimpleNumericalAggregation`],
  ...['MEDIAN', 'PERCENTILE', 'AVG'].map(value => [
    `unsupported ${value} aggregation`, (r, s) => { s.AggregationFunction.NumericalAggregationFunction.SimpleNumericalAggregation = value; },
    'UNSUPPORTED_FEATURE', `${np}.SimpleNumericalAggregation`,
  ]),
];

for (const [name, mutate, code, path] of invalidCases) {
  test(`KPI aggregation sort fails closed for ${name}`, () => {
    for (const dialect of dialects) {
      const r = trendRequest();
      const sort = setSort(r);
      mutate(r, sort, body(r).ChartConfiguration.SortConfiguration);
      assert.throws(() => planVisual(r, { dialect }), { name: 'QueryEngineError', code, path });
    }
  });
}

for (const visualId of ['revenue-by-region', 'revenue-trend', 'sales-table', 'share-by-category']) {
  test(`KPI aggregation sort remains rejected on non-KPI visual ${visualId}`, () => {
    const r = request(visualId);
    setSort(r);
    for (const dialect of dialects) assert.throws(() => planVisual(r, { dialect }), error => {
      assert.equal(error.name, 'QueryEngineError');
      assert.equal(error.code, 'UNSUPPORTED_FEATURE');
      assert.ok(error.path.endsWith('.ChartConfiguration.SortConfiguration'));
      return true;
    });
  });
}

test('KPI FieldSort still validates ASC, DESC and omitted direction without changing the plan', () => {
  for (const dialect of dialects) for (const direction of ['ASC', 'DESC', undefined]) {
    const r = trendRequest();
    const baseline = planVisual(r, { dialect });
    body(r).ChartConfiguration.SortConfiguration = { TrendGroupSort: [{ FieldSort: {
      FieldId: 'trend-id', ...(direction === undefined ? {} : { Direction: direction }),
    } }] };
    assert.deepEqual(planVisual(r, { dialect }), baseline);
  }
});

test('KPI FieldSort retains its existing error codes, paths and messages', () => {
  const cases = [
    [null, 'INVALID_INPUT', sp, 'expected an object'],
    [{ FieldId: 'primary-id' }, 'INVALID_INPUT', sp, 'trend group sort must reference the bound trend dimension'],
    [{ FieldId: 'trend-id', Direction: 'DOWN' }, 'INVALID_INPUT', sp, 'invalid trend sort direction'],
    [{ FieldId: 'trend-id', Unexpected: true }, 'UNSUPPORTED_FEATURE', `${sp}.Unexpected`, 'unrecognized execution property'],
  ];
  for (const dialect of dialects) for (const [fieldSort, code, path, message] of cases) {
    const r = trendRequest();
    body(r).ChartConfiguration.SortConfiguration = { TrendGroupSort: [{ FieldSort: fieldSort }] };
    assert.throws(() => planVisual(r, { dialect }), { name: 'QueryEngineError', code, path, message: `${path}: ${message}` });
  }
});
