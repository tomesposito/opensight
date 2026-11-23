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

function sortPath(r) {
  const index = r.analysis.Definition.Sheets[0].Visuals.findIndex(v => Object.values(v)[0].VisualId === r.visualId);
  const kind = Object.keys(r.analysis.Definition.Sheets[0].Visuals[index])[0];
  return `$.analysis.Definition.Sheets[0].Visuals[${index}].${kind}.ChartConfiguration.SortConfiguration`;
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

  test(`CategorySort preserves calculations, multiple Values and parameters: ${chart.name}, ${dialect}`, () => {
    const r = categoryRequest(chart);
    r.analysis.Definition.FilterGroups = request().analysis.Definition.FilterGroups;
    // Pie renders exactly one measure (issue #319), so the multiple-Values
    // shape applies to the other category charts only.
    const multi = chart.name !== 'pie';
    if (multi) wells(r).Values.push(measure('discounted_revenue', 'SUM', 'secondary-id'));
    const baseline = planVisual(r, { dialect });
    assert.deepEqual(baseline.parameters, ['East']);
    assert.equal(baseline.calculations.length, multi ? 1 : 0);
    for (const aggregation of aggregations) {
      setSort(r, 'AggregationSort', aggregation, 'DESC', multi ? 'discounted_revenue' : 'revenue');
      const actual = assertInvariant(r, dialect, baseline);
      assert.deepEqual(actual.measures.map(m => m.aggregation), multi ? ['SUM', 'SUM'] : ['SUM']);
    }
  });

  test(`empty SortConfiguration is a no-op: ${chart.name}, ${dialect}`, () => {
    const r = categoryRequest(chart);
    const baseline = planVisual(r, { dialect });
    body(r).ChartConfiguration.SortConfiguration = {};
    assertInvariant(r, dialect, baseline);
  });
}

for (const variant of ['FieldSort', 'AggregationSort']) {
  const vp = `.CategorySort[0].${variant}`;
  const invalidCases = [
    ['null configuration', (r) => { body(r).ChartConfiguration.SortConfiguration = null; }, 'INVALID_INPUT', ''],
    ['array configuration', (r) => { body(r).ChartConfiguration.SortConfiguration = []; }, 'INVALID_INPUT', ''],
    ['string configuration', (r) => { body(r).ChartConfiguration.SortConfiguration = 'sort'; }, 'INVALID_INPUT', ''],
    ['empty list', (r, s, c) => { c.CategorySort = []; }, 'INVALID_INPUT', ''],
    ['multiple entries', (r, s, c) => { c.CategorySort.push(structuredClone(c.CategorySort[0])); }, 'INVALID_INPUT', ''],
    ['null list', (r, s, c) => { c.CategorySort = null; }, 'INVALID_INPUT', '.CategorySort'],
    ['object list', (r, s, c) => { c.CategorySort = {}; }, 'INVALID_INPUT', '.CategorySort'],
    ['null wrapper', (r, s, c) => { c.CategorySort = [null]; }, 'INVALID_INPUT', ''],
    ['array wrapper', (r, s, c) => { c.CategorySort = [[]]; }, 'INVALID_INPUT', ''],
    ['neither variant', (r, s, c) => { c.CategorySort = [{}]; }, 'INVALID_INPUT', ''],
    ['both variants', (r, s, c) => { c.CategorySort[0][variant === 'FieldSort' ? 'AggregationSort' : 'FieldSort'] = {}; }, 'INVALID_INPUT', ''],
    ['unknown wrapper key', (r, s, c) => { c.CategorySort[0].Unexpected = true; }, 'UNSUPPORTED_FEATURE', '.Unexpected'],
    ['unknown variant', (r, s, c) => { c.CategorySort = [{ Unexpected: s }]; }, 'UNSUPPORTED_FEATURE', '.Unexpected'],
    ['null variant', (r, s, c) => { c.CategorySort[0][variant] = null; }, 'INVALID_INPUT', vp],
    ['array variant', (r, s, c) => { c.CategorySort[0][variant] = []; }, 'INVALID_INPUT', vp],
    ['unknown variant key', (r, s) => { s.Unexpected = true; }, 'UNSUPPORTED_FEATURE', `${vp}.Unexpected`],
    ['missing field ID', (r, s) => { delete s.FieldId; }, 'INVALID_INPUT', `${vp}.FieldId`],
    ...[null, 42, '', '\0'].map(value => [`malformed field ID ${JSON.stringify(value)}`, (r, s) => { s.FieldId = value; }, 'INVALID_INPUT', `${vp}.FieldId`]),
    ...['primary-id', 'region', 'missing'].map(value => [`unbound category ID ${value}`, (r, s) => { s.FieldId = value; }, 'INVALID_INPUT', '']),
    ['no category dimension', r => { wells(r).Category = []; }, 'INVALID_INPUT', ''],
    ['second category dimension ID', (r, s) => { wells(r).Category.push(dimension('category', 'second-id')); s.FieldId = 'second-id'; }, 'INVALID_INPUT', ''],
    ...['DOWN', 'asc', null, 1, false, {}].map(value => [`invalid direction ${JSON.stringify(value)}`, (r, s) => { s.Direction = value; }, 'INVALID_INPUT', '']),
  ];
  if (variant === 'FieldSort') invalidCases.push(
    ['aggregation column in FieldSort', (r, s) => { s.Column = { DataSetIdentifier: 'sales_data', ColumnName: 'revenue' }; }, 'UNSUPPORTED_FEATURE', `${vp}.Column`],
    ['aggregation function in FieldSort', (r, s) => { s.AggregationFunction = {}; }, 'UNSUPPORTED_FEATURE', `${vp}.AggregationFunction`],
  );
  else {
    const cp = `${vp}.Column`, fp = `${vp}.AggregationFunction`, np = `${fp}.NumericalAggregationFunction`;
    invalidCases.push(
      ['dimension column', (r, s) => { s.Column.ColumnName = 'region'; }, 'INVALID_INPUT', cp],
      ['unbound Values column', (r, s) => { s.Column.ColumnName = 'profit'; }, 'INVALID_INPUT', cp],
      ['unbound calculated column', (r, s) => { s.Column.ColumnName = 'discounted_revenue'; }, 'INVALID_INPUT', cp],
      ['nonexistent column', (r, s) => { s.Column.ColumnName = 'missing'; }, 'UNRESOLVED_BINDING', `${cp}.ColumnName`],
      ['measure ID instead of column', (r, s) => { s.Column.ColumnName = 'primary-id'; }, 'UNRESOLVED_BINDING', `${cp}.ColumnName`],
      ['wrong dataset', (r, s) => { s.Column.DataSetIdentifier = 'other_data'; }, 'UNRESOLVED_BINDING', `${cp}.DataSetIdentifier`],
      ['missing dataset', (r, s) => { delete s.Column.DataSetIdentifier; }, 'UNRESOLVED_BINDING', `${cp}.DataSetIdentifier`],
      ['null dataset', (r, s) => { s.Column.DataSetIdentifier = null; }, 'UNRESOLVED_BINDING', `${cp}.DataSetIdentifier`],
      ['missing column name', (r, s) => { delete s.Column.ColumnName; }, 'INVALID_INPUT', `${cp}.ColumnName`],
      ['empty column name', (r, s) => { s.Column.ColumnName = ''; }, 'INVALID_INPUT', `${cp}.ColumnName`],
      ['missing column', (r, s) => { delete s.Column; }, 'INVALID_INPUT', cp],
      ['null column', (r, s) => { s.Column = null; }, 'INVALID_INPUT', cp],
      ['array column', (r, s) => { s.Column = []; }, 'INVALID_INPUT', cp],
      ['unknown column key', (r, s) => { s.Column.Unexpected = true; }, 'UNSUPPORTED_FEATURE', `${cp}.Unexpected`],
      ['missing aggregation function', (r, s) => { delete s.AggregationFunction; }, 'INVALID_INPUT', fp],
      ['null aggregation function', (r, s) => { s.AggregationFunction = null; }, 'INVALID_INPUT', fp],
      ['array aggregation function', (r, s) => { s.AggregationFunction = []; }, 'INVALID_INPUT', fp],
      ['unknown aggregation function key', (r, s) => { s.AggregationFunction.Unexpected = true; }, 'UNSUPPORTED_FEATURE', `${fp}.Unexpected`],
      ['unwrapped aggregation', (r, s) => { s.AggregationFunction = { SimpleNumericalAggregation: 'SUM' }; }, 'UNSUPPORTED_FEATURE', `${fp}.SimpleNumericalAggregation`],
      ['categorical aggregation', (r, s) => { s.AggregationFunction = { CategoricalAggregationFunction: 'COUNT' }; }, 'UNSUPPORTED_FEATURE', `${fp}.CategoricalAggregationFunction`],
      ['date aggregation', (r, s) => { s.AggregationFunction = { DateAggregationFunction: 'MAX' }; }, 'UNSUPPORTED_FEATURE', `${fp}.DateAggregationFunction`],
      ['missing numerical wrapper', (r, s) => { s.AggregationFunction = {}; }, 'INVALID_INPUT', np],
      ['null numerical wrapper', (r, s) => { s.AggregationFunction.NumericalAggregationFunction = null; }, 'INVALID_INPUT', np],
      ['array numerical wrapper', (r, s) => { s.AggregationFunction.NumericalAggregationFunction = []; }, 'INVALID_INPUT', np],
      ['unknown numerical key', (r, s) => { s.AggregationFunction.NumericalAggregationFunction.Unexpected = true; }, 'UNSUPPORTED_FEATURE', `${np}.Unexpected`],
      ['missing simple aggregation', (r, s) => { s.AggregationFunction.NumericalAggregationFunction = {}; }, 'INVALID_INPUT', `${np}.SimpleNumericalAggregation`],
      ...[null, 1, '', {}].map(value => [`malformed aggregation ${JSON.stringify(value)}`, (r, s) => { s.AggregationFunction.NumericalAggregationFunction.SimpleNumericalAggregation = value; }, 'INVALID_INPUT', `${np}.SimpleNumericalAggregation`]),
      ...['AVG', 'MEDIAN', 'PERCENTILE', 'sum', 'UNKNOWN'].map(value => [`unsupported aggregation ${value}`, (r, s) => { s.AggregationFunction.NumericalAggregationFunction.SimpleNumericalAggregation = value; }, 'UNSUPPORTED_FEATURE', `${np}.SimpleNumericalAggregation`]),
    );
  }

  for (const chart of charts) for (const [name, mutate, code, suffix] of invalidCases) {
    test(`CategorySort fails closed: ${chart.name}, ${variant}, ${name}`, () => {
      for (const dialect of dialects) {
        const r = categoryRequest(chart);
        const sort = setSort(r, variant);
        mutate(r, sort, body(r).ChartConfiguration.SortConfiguration);
        assert.throws(() => planVisual(r, { dialect }), { name: 'QueryEngineError', code, path: `${sortPath(r)}${suffix}` });
      }
    });
  }
}

for (const chart of charts) for (const key of [
  // CategoryItemsLimit left this list in the category-limit planner slice: it is now admitted (see category-limit-planner.test.mjs).
  'SmallMultiplesSort', 'SmallMultiplesLimitConfiguration',
  'TrendGroupSort', 'RowSort', 'ColumnSort', 'FieldSortOptions', 'BreakdownItemsLimit', 'Unexpected',
]) {
  test(`category chart keeps ${key} rejected: ${chart.name}`, () => {
    for (const dialect of dialects) for (const withCategorySort of [false, true]) {
      const r = categoryRequest(chart);
      if (withCategorySort) setSort(r);
      else body(r).ChartConfiguration.SortConfiguration = {};
      body(r).ChartConfiguration.SortConfiguration[key] = [];
      const path = sortPath(r);
      assert.throws(() => planVisual(r, { dialect }), {
        name: 'QueryEngineError', code: 'UNSUPPORTED_FEATURE', path, message: `${path}: unrecognized execution property`,
      });
    }
  });
}

for (const visualId of ['sales-table', 'total-revenue']) for (const variant of ['FieldSort', 'AggregationSort']) {
  test(`CategorySort stays rejected: ${visualId}, ${variant}`, () => {
    for (const dialect of dialects) {
      const r = request(visualId);
      setSort(r, variant);
      assert.throws(() => planVisual(r, { dialect }), {
        name: 'QueryEngineError', code: 'UNSUPPORTED_FEATURE', path: `${sortPath(r)}${visualId === 'total-revenue' ? '.CategorySort' : ''}`,
      });
    }
  });
}

test('KPI TrendGroupSort still admits both variants with unchanged plans', () => {
  for (const dialect of dialects) for (const variant of ['FieldSort', 'AggregationSort']) {
    const r = request();
    wells(r).TrendGroups = [dimension('region', 'category-id')];
    const baseline = planVisual(r, { dialect });
    setSort(r, variant, 'AVERAGE', 'DESC');
    const config = body(r).ChartConfiguration.SortConfiguration;
    config.TrendGroupSort = config.CategorySort;
    delete config.CategorySort;
    assertInvariant(r, dialect, baseline);
  }
});

for (const kind of ['ComboChartVisual', 'PivotTableVisual', 'ScatterPlotVisual', 'HeatMapVisual', 'RadarChartVisual', 'UnknownVisual']) {
  test(`SortConfiguration does not admit unsupported visual kind ${kind}`, () => {
    for (const dialect of dialects) for (const sorted of [false, true]) {
      const r = categoryRequest();
      if (sorted) setSort(r);
      const visualBody = body(r);
      r.analysis.Definition.Sheets[0].Visuals[0] = { [kind]: visualBody };
      const path = `$.analysis.Definition.Sheets[0].Visuals[0].${kind}`;
      assert.throws(() => planVisual(r, { dialect }), {
        name: 'QueryEngineError', code: 'UNSUPPORTED_FEATURE', path, message: `${path}: unsupported visual kind`,
      });
    }
  });
}

test('CategorySort admission rejects renderer-incompatible field wells (issue #319)', () => {
  for (const chart of charts) {
    // An ordinary AVG measure cannot render: the compiler accepts only SUM
    // bindings or governed metric bindings. Without a sort admission the
    // planner's wider native allowance still plans the same definition.
    const r = categoryRequest(chart);
    wells(r).Values.push(measure('discounted_revenue', 'AVG', 'secondary-id'));
    assert.doesNotThrow(() => planVisual(r));
    setSort(r);
    assert.throws(() => planVisual(r), (error) => {
      assert.equal(error.name, 'QueryEngineError');
      assert.equal(error.code, 'UNSUPPORTED_FEATURE');
      assert.ok(error.path.endsWith('.Values[1].NumericalMeasureField.AggregationFunction'), error.path);
      return true;
    });
  }
  // A second category dimension cannot render on a category chart.
  const twoDims = categoryRequest(charts[0]);
  wells(twoDims).Category.push(dimension('category', 'second-id'));
  setSort(twoDims);
  assert.throws(() => planVisual(twoDims), { name: 'QueryEngineError', code: 'UNSUPPORTED_FEATURE' });
  // Pie cannot render a second measure, even when both bindings are SUM.
  const pie = categoryRequest(charts[3]);
  wells(pie).Values.push(measure('profit', 'SUM', 'secondary-id'));
  setSort(pie);
  assert.throws(() => planVisual(pie), (error) => {
    assert.equal(error.name, 'QueryEngineError');
    assert.equal(error.code, 'UNSUPPORTED_FEATURE');
    assert.ok(error.path.endsWith('.Values'), error.path);
    return true;
  });
  // Governed metric bindings keep their non-SUM aggregations under admission.
  const governed = categoryRequest(charts[0]);
  governed.analysis.Definition.CalculatedFields.push({ Name: '__metric_margin', DataSetIdentifier: 'sales_data', Expression: '{revenue} * 0.9' });
  wells(governed).Values.push(measure('__metric_margin', 'AVG', 'metric-id'));
  const baseline = planVisual(governed);
  setSort(governed);
  assert.deepEqual(planVisual(governed), baseline);
});

for (const chart of charts) test(`aggregation sort cannot bypass column security: ${chart.name}`, () => {
  for (const dialect of dialects) for (const indirect of [false, true]) {
    const r = categoryRequest(chart);
    r.localData.security.dataset = 'protected';
    r.security = {
      namespaceId: 'default', userId: 'alice', users: [{ id: 'alice', namespaceId: 'default' }], groups: [],
      policy: { namespaceId: 'default', dataSetArn: r.localData.dataSetArn, rowLevel: false, rowRules: [], protectedColumns: ['profit'] },
    };
    // The visual itself is allowed; only the sort attempts to reach the denied column.
    assert.doesNotThrow(() => planVisual(r, { dialect }));
    if (indirect) r.analysis.Definition.CalculatedFields.push({
      Name: 'hidden_profit', DataSetIdentifier: 'sales_data', Expression: '{profit} + 1',
    });
    setSort(r, 'AggregationSort', 'SUM', 'ASC', indirect ? 'hidden_profit' : 'profit');
    assert.throws(() => planVisual(r, { dialect }), error => {
      assert.equal(error.name, 'QueryEngineError');
      assert.equal(error.code, 'UNRESOLVED_BINDING');
      assert.equal(error.path, indirect ? '$.analysis.Definition.CalculatedFields[1].Expression' : `${sortPath(r)}.CategorySort[0].AggregationSort.Column.ColumnName`);
      assert.equal(error.message, `${error.path}: unknown column: profit`);
      return true;
    });
  }
});
