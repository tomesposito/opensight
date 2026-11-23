import test from 'node:test';
import assert from 'node:assert/strict';
import { planVisual, evaluatePlan } from '@opensight/query-engine/browser';
import { request, wells, body, dimension, measure } from './helpers.mjs';

const dialects = ['duckdb', 'postgres', 'mysql', 'redshift', 'athena'];
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

function setLimit(r, limit) {
  const config = body(r).ChartConfiguration;
  config.SortConfiguration = { ...(config.SortConfiguration ?? {}), CategoryItemsLimit: limit };
  return limit;
}

function setSort(r) {
  const config = body(r).ChartConfiguration;
  config.SortConfiguration = {
    ...(config.SortConfiguration ?? {}),
    CategorySort: [{ AggregationSort: {
      FieldId: 'category-id', Direction: 'DESC',
      Column: { DataSetIdentifier: 'sales_data', ColumnName: 'revenue' },
      AggregationFunction: { NumericalAggregationFunction: { SimpleNumericalAggregation: 'SUM' } },
    } }],
  };
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

function sortPath(r) {
  const index = r.analysis.Definition.Sheets[0].Visuals.findIndex(v => Object.values(v)[0].VisualId === r.visualId);
  const kind = Object.keys(r.analysis.Definition.Sheets[0].Visuals[index])[0];
  return `$.analysis.Definition.Sheets[0].Visuals[${index}].${kind}.ChartConfiguration.SortConfiguration`;
}

const limitVariants = [
  ['count 1', { ItemsLimit: 1 }],
  ['count 100', { ItemsLimit: 100 }],
  ['count with INCLUDE', { ItemsLimit: 5, OtherCategories: 'INCLUDE' }],
  ['count with EXCLUDE', { ItemsLimit: 5, OtherCategories: 'EXCLUDE' }],
  ['OtherCategories only', { OtherCategories: 'EXCLUDE' }],
  ['empty object', {}],
];

for (const chart of charts) for (const dialect of dialects) {
  for (const [name, limit] of limitVariants) {
    test(`CategoryItemsLimit preserves plan/SQL/results: ${chart.name}, ${dialect}, ${name}`, () => {
      for (const dated of [false, true]) {
        const r = categoryRequest(chart, dated);
        const baseline = planVisual(r, { dialect });
        setLimit(r, structuredClone(limit));
        const actual = assertInvariant(r, dialect, baseline);
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

  test(`CategoryItemsLimit coexists with CategorySort and parameters: ${chart.name}, ${dialect}`, () => {
    const r = categoryRequest(chart);
    r.analysis.Definition.FilterGroups = request().analysis.Definition.FilterGroups;
    // Pie renders exactly one measure (issue #319), so the second binding
    // applies to the other category charts only.
    if (chart.name !== 'pie') wells(r).Values.push(measure('discounted_revenue', 'SUM', 'secondary-id'));
    const baseline = planVisual(r, { dialect });
    assert.deepEqual(baseline.parameters, ['East']);
    assert.equal(baseline.calculations.length, chart.name !== 'pie' ? 1 : 0);
    setSort(r);
    setLimit(r, { ItemsLimit: 2, OtherCategories: 'INCLUDE' });
    assertInvariant(r, dialect, baseline);
  });
}

test('CategoryItemsLimit admission rejects renderer-incompatible field wells (issue #319)', () => {
  for (const chart of charts) {
    const r = categoryRequest(chart);
    wells(r).Values.push(measure('discounted_revenue', 'AVG', 'secondary-id'));
    assert.doesNotThrow(() => planVisual(r));
    setLimit(r, { ItemsLimit: 2, OtherCategories: 'INCLUDE' });
    assert.throws(() => planVisual(r), (error) => {
      assert.equal(error.name, 'QueryEngineError');
      assert.equal(error.code, 'UNSUPPORTED_FEATURE');
      assert.ok(error.path.endsWith('.Values[1].NumericalMeasureField.AggregationFunction'), error.path);
      return true;
    });
  }
  // Pie cannot render a second measure, even when both bindings are SUM.
  const pie = categoryRequest(charts[3]);
  wells(pie).Values.push(measure('profit', 'SUM', 'secondary-id'));
  setLimit(pie, { ItemsLimit: 2 });
  assert.throws(() => planVisual(pie), { name: 'QueryEngineError', code: 'UNSUPPORTED_FEATURE' });
});

const lp = '.CategoryItemsLimit';
const invalidCases = [
  ['null limit', null, 'INVALID_INPUT', lp],
  ['array limit', [], 'INVALID_INPUT', lp],
  ['string limit', 'limit', 'INVALID_INPUT', lp],
  ['number limit', 5, 'INVALID_INPUT', lp],
  ['unknown key', { Unexpected: true }, 'UNSUPPORTED_FEATURE', `${lp}.Unexpected`],
  ...[0, 101, -1, 1.5, '5', null, true, NaN].map(value => [
    `malformed ItemsLimit ${String(value)}`, { ItemsLimit: value }, 'INVALID_INPUT', `${lp}.ItemsLimit`,
  ]),
  ...['include', 'MAYBE', '', null, 1, true].map(value => [
    `malformed OtherCategories ${JSON.stringify(value)}`, { ItemsLimit: 5, OtherCategories: value }, 'INVALID_INPUT', `${lp}.OtherCategories`,
  ]),
];

for (const chart of charts) for (const [name, limit, code, suffix] of invalidCases) {
  test(`CategoryItemsLimit fails closed: ${chart.name}, ${name}`, () => {
    for (const dialect of dialects) {
      const r = categoryRequest(chart);
      setLimit(r, structuredClone(limit));
      assert.throws(() => planVisual(r, { dialect }), { name: 'QueryEngineError', code, path: `${sortPath(r)}${suffix}` });
    }
  });
}

for (const chart of charts) for (const key of [
  'SmallMultiplesSort', 'SmallMultiplesLimitConfiguration',
  'TrendGroupSort', 'RowSort', 'ColumnSort', 'FieldSortOptions', 'BreakdownItemsLimit', 'Unexpected',
]) {
  test(`category chart keeps ${key} rejected alongside a valid limit: ${chart.name}`, () => {
    for (const dialect of dialects) {
      const r = categoryRequest(chart);
      setLimit(r, { ItemsLimit: 3 });
      body(r).ChartConfiguration.SortConfiguration[key] = [];
      const path = sortPath(r);
      assert.throws(() => planVisual(r, { dialect }), {
        name: 'QueryEngineError', code: 'UNSUPPORTED_FEATURE', path, message: `${path}: unrecognized execution property`,
      });
    }
  });
}

for (const visualId of ['sales-table', 'total-revenue']) {
  test(`CategoryItemsLimit stays rejected: ${visualId}`, () => {
    for (const dialect of dialects) {
      const r = request(visualId);
      setLimit(r, { ItemsLimit: 3, OtherCategories: 'INCLUDE' });
      assert.throws(() => planVisual(r, { dialect }), {
        name: 'QueryEngineError', code: 'UNSUPPORTED_FEATURE', path: `${sortPath(r)}${visualId === 'total-revenue' ? '.CategoryItemsLimit' : ''}`,
      });
    }
  });
}

for (const kind of ['ComboChartVisual', 'PivotTableVisual', 'ScatterPlotVisual', 'HeatMapVisual', 'RadarChartVisual', 'UnknownVisual']) {
  test(`SortConfiguration limit does not admit unsupported visual kind ${kind}`, () => {
    for (const dialect of dialects) {
      const r = categoryRequest();
      setLimit(r, { ItemsLimit: 3 });
      const visualBody = body(r);
      r.analysis.Definition.Sheets[0].Visuals[0] = { [kind]: visualBody };
      const path = `$.analysis.Definition.Sheets[0].Visuals[0].${kind}`;
      assert.throws(() => planVisual(r, { dialect }), {
        name: 'QueryEngineError', code: 'UNSUPPORTED_FEATURE', path, message: `${path}: unsupported visual kind`,
      });
    }
  });
}
