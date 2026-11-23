import test from 'node:test';
import assert from 'node:assert/strict';
import { planVisual, evaluatePlan } from '@opensight/query-engine/browser';
import { request, wells, body, dimension, measure } from './helpers.mjs';

const dialects = ['duckdb', 'postgres', 'mysql', 'redshift', 'athena'];

function tableRequest() {
  const r = request('sales-table');
  r.analysis.Definition.FilterGroups = [];
  wells(r).GroupBy = [dimension('region', 'group-id')];
  wells(r).Values = [measure('revenue', 'SUM', 'primary-id'), measure('discounted_revenue', 'SUM', 'calculated-id')];
  return r;
}

function dateDimension() {
  return { DateDimensionField: {
    FieldId: 'date-id', Column: { DataSetIdentifier: 'sales_data', ColumnName: 'order_date' }, DateGranularity: 'MONTH',
  } };
}

function setSort(r, fieldId = 'group-id', direction = 'ASC') {
  const sort = { FieldId: fieldId };
  if (direction !== 'omitted') sort.Direction = direction;
  body(r).ChartConfiguration.SortConfiguration = { RowSort: [{ FieldSort: sort }] };
  return sort;
}

function sortPath(r) {
  const index = r.analysis.Definition.Sheets[0].Visuals.findIndex(v => Object.values(v)[0].VisualId === r.visualId);
  const kind = Object.keys(r.analysis.Definition.Sheets[0].Visuals[index])[0];
  return `$.analysis.Definition.Sheets[0].Visuals[${index}].${kind}.ChartConfiguration.SortConfiguration`;
}

const rows = [
  { region: 'West', category: 'Hardware', order_date: '2025-03-01', revenue: 10 },
  { region: 'East', category: 'Software', order_date: '2025-01-01', revenue: 20 },
  { region: 'North', category: 'Hardware', order_date: '2025-02-01', revenue: null },
  { region: 'East', category: 'Software', order_date: '2025-01-02', revenue: 30 },
];

function assertInvariant(r, dialect, baseline) {
  const before = structuredClone(r);
  const actual = planVisual(r, { dialect });
  assert.deepEqual(r, before, 'planning must not mutate the definition');
  assert.deepEqual(actual, baseline, 'the entire plan must be unchanged');
  assert.equal(actual.sql, baseline.sql, 'SQL including ORDER BY must be unchanged');
  assert.deepEqual(evaluatePlan(actual, rows), evaluatePlan(baseline, rows));
  return actual;
}

const bindings = [
  { name: 'first categorical dimension', fieldId: 'group-id', groupBy: [dimension('region', 'group-id')] },
  { name: 'first date dimension', fieldId: 'date-id', groupBy: [dateDimension()] },
  { name: 'later categorical dimension', fieldId: 'later-id', groupBy: [dimension('region', 'group-id'), dimension('category', 'later-id')] },
  { name: 'later date dimension', fieldId: 'date-id', groupBy: [dimension('region', 'group-id'), dateDimension()] },
  { name: 'primary measure', fieldId: 'primary-id', groupBy: [dimension('region', 'group-id')] },
  { name: 'calculated measure', fieldId: 'calculated-id', groupBy: [dimension('region', 'group-id')] },
  { name: 'measure without dimensions', fieldId: 'primary-id', groupBy: [] },
];

for (const dialect of dialects) {
  for (const binding of bindings) for (const direction of ['ASC', 'DESC', 'omitted']) {
    test(`RowSort preserves plan/SQL/results: ${dialect}, ${binding.name}, ${direction}`, () => {
      const r = tableRequest();
      wells(r).GroupBy = structuredClone(binding.groupBy);
      const baseline = planVisual(r, { dialect });
      setSort(r, binding.fieldId, direction);
      const actual = assertInvariant(r, dialect, baseline);
      assert.deepEqual(actual.measures.map(m => [m.fieldId, m.columnName, m.aggregation]), [
        ['primary-id', 'revenue', 'SUM'], ['calculated-id', 'discounted_revenue', 'SUM'],
      ]);
      if (binding.name === 'primary measure') assert.deepEqual(evaluatePlan(actual, rows), [
        { 'group-id': 'East', 'primary-id': 50, 'calculated-id': 45 },
        { 'group-id': 'North', 'primary-id': null, 'calculated-id': null },
        { 'group-id': 'West', 'primary-id': 10, 'calculated-id': 9 },
      ], 'native results keep dimension order and null aggregates regardless of display sort');
    });
  }

  for (const config of [{}, { RowSort: [] }]) {
    test(`empty table sort is a no-op: ${dialect}, ${JSON.stringify(config)}`, () => {
      const r = tableRequest();
      const baseline = planVisual(r, { dialect });
      body(r).ChartConfiguration.SortConfiguration = structuredClone(config);
      assertInvariant(r, dialect, baseline);
    });
  }

  test(`RowSort preserves calculations and filter parameters: ${dialect}`, () => {
    const r = tableRequest();
    r.analysis.Definition.FilterGroups = request().analysis.Definition.FilterGroups;
    const baseline = planVisual(r, { dialect });
    assert.deepEqual(baseline.parameters, ['East']);
    assert.equal(baseline.calculations.length, 1);
    for (const fieldId of ['group-id', 'primary-id', 'calculated-id']) {
      setSort(r, fieldId, 'DESC');
      const actual = assertInvariant(r, dialect, baseline);
      assert.deepEqual(actual.measures.map(m => m.aggregation), ['SUM', 'SUM']);
    }
  });
}

test('RowSort admission rejects renderer-incompatible field wells (issue #319)', () => {
  // An ordinary AVG calculated measure cannot render: the compiler accepts
  // only SUM bindings or governed metric bindings. Without a RowSort
  // admission the planner's wider native allowance still plans it.
  const r = tableRequest();
  wells(r).Values[1] = measure('discounted_revenue', 'AVG', 'calculated-id');
  assert.doesNotThrow(() => planVisual(r));
  setSort(r);
  assert.throws(() => planVisual(r), (error) => {
    assert.equal(error.name, 'QueryEngineError');
    assert.equal(error.code, 'UNSUPPORTED_FEATURE');
    assert.ok(error.path.endsWith('.Values[1].NumericalMeasureField.AggregationFunction'), error.path);
    return true;
  });
  // Governed metric bindings keep their non-SUM aggregations under admission.
  const governed = tableRequest();
  governed.analysis.Definition.CalculatedFields.push({ Name: '__metric_margin', DataSetIdentifier: 'sales_data', Expression: '{revenue} * 0.9' });
  wells(governed).Values.push(measure('__metric_margin', 'AVG', 'metric-id'));
  const baseline = planVisual(governed);
  setSort(governed);
  assert.deepEqual(planVisual(governed), baseline);
});

const fp = '.RowSort[0].FieldSort';
const invalidCases = [
  ...[null, [], 'sort', 1, false].map(value => [`non-object configuration ${JSON.stringify(value)}`, r => { body(r).ChartConfiguration.SortConfiguration = value; }, 'INVALID_INPUT', '']),
  ['multiple entries', (r, s, c) => { c.RowSort.push(structuredClone(c.RowSort[0])); }, 'INVALID_INPUT', ''],
  ...[null, {}, 'sort', 1, false].map(value => [`non-array RowSort ${JSON.stringify(value)}`, (r, s, c) => { c.RowSort = value; }, 'INVALID_INPUT', '.RowSort']),
  ...[null, [], 'sort', 1, false].map(value => [`non-object wrapper ${JSON.stringify(value)}`, (r, s, c) => { c.RowSort = [value]; }, 'INVALID_INPUT', '']),
  ['empty wrapper', (r, s, c) => { c.RowSort = [{}]; }, 'INVALID_INPUT', ''],
  ['mixed variants', (r, s, c) => { c.RowSort[0].AggregationSort = {}; }, 'INVALID_INPUT', ''],
  ['unknown wrapper key alongside FieldSort', (r, s, c) => { c.RowSort[0].Unexpected = true; }, 'INVALID_INPUT', ''],
  ['unknown wrapper variant', (r, s, c) => { c.RowSort = [{ Unexpected: s }]; }, 'INVALID_INPUT', ''],
  ['unknown wrapper key alongside AggregationSort', (r, s, c) => { c.RowSort = [{ AggregationSort: {}, Unexpected: true }]; }, 'INVALID_INPUT', ''],
  ['AggregationSort alone', (r, s, c) => { c.RowSort = [{ AggregationSort: {
    FieldId: 'group-id', Direction: 'DESC', Column: { DataSetIdentifier: 'sales_data', ColumnName: 'revenue' },
    AggregationFunction: { NumericalAggregationFunction: { SimpleNumericalAggregation: 'SUM' } },
  } }]; }, 'UNSUPPORTED_FEATURE', '.RowSort[0].AggregationSort'],
  ...[undefined, null, [], 'sort', 1, false].map(value => [`non-object FieldSort ${JSON.stringify(value)}`, (r, s, c) => { c.RowSort[0].FieldSort = value; }, 'INVALID_INPUT', fp]),
  ['unknown FieldSort key', (r, s) => { s.Unexpected = true; }, 'UNSUPPORTED_FEATURE', `${fp}.Unexpected`],
  ['aggregation column in FieldSort', (r, s) => { s.Column = { DataSetIdentifier: 'sales_data', ColumnName: 'revenue' }; }, 'UNSUPPORTED_FEATURE', `${fp}.Column`],
  ['aggregation function in FieldSort', (r, s) => { s.AggregationFunction = {}; }, 'UNSUPPORTED_FEATURE', `${fp}.AggregationFunction`],
  ['missing field ID', (r, s) => { delete s.FieldId; }, 'INVALID_INPUT', `${fp}.FieldId`],
  ...['', null, 42, false, {}, [], '\0'].map(value => [`malformed field ID ${JSON.stringify(value)}`, (r, s) => { s.FieldId = value; }, 'INVALID_INPUT', `${fp}.FieldId`]),
  ...['missing', 'profit', 'region', 'revenue', 'discounted_revenue', 'GROUP-ID'].map(value => [`unbound field ID ${value}`, (r, s) => { s.FieldId = value; }, 'INVALID_INPUT', '']),
  ['date column instead of field ID', (r, s) => { wells(r).GroupBy = [dateDimension()]; s.FieldId = 'order_date'; }, 'INVALID_INPUT', ''],
  ['date output alias instead of field ID', (r, s) => { wells(r).GroupBy = [dateDimension()]; s.FieldId = 'month'; }, 'INVALID_INPUT', ''],
  ['removed dimension', r => { wells(r).GroupBy = []; }, 'INVALID_INPUT', ''],
  ['removed measure', (r, s) => { wells(r).Values.pop(); s.FieldId = 'calculated-id'; }, 'INVALID_INPUT', ''],
  ...['DOWN', 'asc', '', null, 1, false, {}, []].map(value => [`invalid direction ${JSON.stringify(value)}`, (r, s) => { s.Direction = value; }, 'INVALID_INPUT', '']),
];

for (const [name, mutate, code, suffix] of invalidCases) {
  test(`RowSort fails closed: ${name}`, () => {
    for (const dialect of dialects) {
      const r = tableRequest();
      const s = setSort(r);
      mutate(r, s, body(r).ChartConfiguration.SortConfiguration);
      const before = structuredClone(r);
      assert.throws(() => planVisual(r, { dialect }), { name: 'QueryEngineError', code, path: `${sortPath(r)}${suffix}` });
      assert.deepEqual(r, before, 'rejected planning must not mutate the definition');
    }
  });
}

for (const key of ['CategorySort', 'CategoryItemsLimit', 'TrendGroupSort', 'ColumnSort', 'FieldSortOptions', 'BreakdownItemsLimit', 'SmallMultiplesSort', 'SmallMultiplesLimitConfiguration', 'Unexpected']) {
  test(`table rejects other SortConfiguration key at the whole block: ${key}`, () => {
    for (const dialect of dialects) for (const withRowSort of [false, true]) {
      const r = tableRequest();
      if (withRowSort) setSort(r);
      else body(r).ChartConfiguration.SortConfiguration = {};
      body(r).ChartConfiguration.SortConfiguration[key] = [];
      const path = sortPath(r);
      assert.throws(() => planVisual(r, { dialect }), {
        name: 'QueryEngineError', code: 'UNSUPPORTED_FEATURE', path, message: `${path}: unrecognized execution property`,
      });
    }
  });
}

for (const visualId of ['revenue-by-region', 'revenue-trend', 'share-by-category', 'total-revenue']) {
  test(`RowSort stays rejected on other supported visuals: ${visualId}`, () => {
    for (const dialect of dialects) {
      const r = request(visualId);
      setSort(r);
      const path = `${sortPath(r)}${visualId === 'total-revenue' ? '.RowSort' : ''}`;
      assert.throws(() => planVisual(r, { dialect }), {
        name: 'QueryEngineError', code: 'UNSUPPORTED_FEATURE', path, message: `${path}: unrecognized execution property`,
      });
    }
  });
}

for (const kind of ['ComboChartVisual', 'PivotTableVisual', 'ScatterPlotVisual', 'HeatMapVisual', 'RadarChartVisual', 'UnknownVisual']) {
  test(`RowSort does not admit unsupported visual kind ${kind}`, () => {
    for (const dialect of dialects) {
      const r = tableRequest();
      setSort(r);
      const index = r.analysis.Definition.Sheets[0].Visuals.findIndex(v => Object.values(v)[0].VisualId === r.visualId);
      r.analysis.Definition.Sheets[0].Visuals[index] = { [kind]: body(r) };
      const path = `$.analysis.Definition.Sheets[0].Visuals[${index}].${kind}`;
      assert.throws(() => planVisual(r, { dialect }), {
        name: 'QueryEngineError', code: 'UNSUPPORTED_FEATURE', path, message: `${path}: unsupported visual kind`,
      });
    }
  });
}
