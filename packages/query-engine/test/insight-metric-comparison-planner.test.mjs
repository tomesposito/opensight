import test from 'node:test';
import assert from 'node:assert/strict';
import { planPreparedVisual, planVisual } from '@opensight/query-engine';
import { evaluatePlan } from '@opensight/query-engine/browser';
import { request } from './helpers.mjs';

const dialects = ['duckdb', 'postgres', 'mysql', 'redshift', 'athena'];

const insightDateField = (fieldId = 'order_date', columnName = 'order_date', grain = 'MONTH') => ({ DateDimensionField: { FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: columnName }, ...(grain ? { DateGranularity: grain } : {}) } });
const insightCatField = (fieldId = 'region', columnName = 'region') => ({ CategoricalDimensionField: { FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: columnName } } });
const insightNumField = (fieldId = 'order_id', columnName = 'order_id') => ({ NumericalDimensionField: { FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: columnName } } });
const insightValueField = (fieldId = 'revenue', columnName = 'revenue', aggregation = 'SUM') => ({ NumericalMeasureField: { FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: columnName }, AggregationFunction: { SimpleNumericalAggregation: aggregation } } });

function insightRequest(computations, visualId = 'insight-1') {
  const r = request('revenue-trend');
  r.analysis.Definition.Sheets[0].Visuals = [{ InsightVisual: { VisualId: visualId, InsightConfiguration: { Computations: computations } } }];
  r.visualId = visualId;
  return r;
}

const mcComputation = (patch = {}) => ({ MetricComparison: { ComputationId: 'comparison', Time: insightDateField(), FromValue: insightValueField(), TargetValue: insightValueField('profit', 'profit'), ...patch } });
const ptdComputation = (patch = {}) => ({ PeriodToDate: { ComputationId: 'ptd', Time: insightDateField(), Value: insightValueField(), ...patch } });
// The already-admitted baselines over the same fields: two PeriodToDate
// computations for a date Time, two MaximumMinimum computations for a
// category Time. Both derive the same single dimension and two measures.
const ptdPair = (Time = insightDateField()) => [
  ptdComputation({ Time }),
  ptdComputation({ Time, ComputationId: 'ptd-target', Value: insightValueField('profit', 'profit') }),
];
const mmComputation = (patch = {}) => ({ MaximumMinimum: { ComputationId: 'mm', Type: 'MAXIMUM', Time: insightCatField(), Value: insightValueField(), ...patch } });
const mmPair = () => [
  mmComputation(),
  mmComputation({ ComputationId: 'mm-target', Type: 'MINIMUM', Value: insightValueField('profit', 'profit') }),
];

const rows = [
  { region: 'West', category: 'Hardware', order_date: '2025-03-01', revenue: 10, profit: 3 },
  { region: 'East', category: 'Software', order_date: '2025-01-01', revenue: 20, profit: 5 },
  { region: 'North', category: 'Hardware', order_date: '2025-02-01', revenue: null, profit: null },
  { region: 'East', category: 'Software', order_date: '2025-01-02', revenue: 30, profit: 7 },
];

// Binding paths name the computation that owns each field, so they are the
// one legitimate difference between plans of different computation kinds;
// everything else — dimensions, measures, calculations, filters, SQL,
// parameters — must be identical.
const stripPaths = (p) => ({
  ...p,
  dimensions: p.dimensions.map(({ path, ...rest }) => rest),
  measures: p.measures.map(({ path, ...rest }) => rest),
});

function assertInvariant(r, dialect, baseline) {
  const before = structuredClone(r);
  const actual = planVisual(r, { dialect });
  assert.deepEqual(r, before, 'planning must not mutate the definition');
  assert.deepEqual(stripPaths(actual), stripPaths(baseline), 'the plan must match the admitted baseline pair apart from binding paths');
  assert.equal(actual.sql, baseline.sql, 'SQL must be unchanged');
  assert.deepEqual(evaluatePlan(actual, rows), evaluatePlan(baseline, rows));
  return actual;
}

const configPath = '$.analysis.Definition.Sheets[0].Visuals[0].InsightVisual.InsightConfiguration';
const computationPath = (kind = 'MetricComparison', index = 0) => `${configPath}.Computations[${index}].${kind}`;

for (const dialect of dialects) {
  for (const grain of ['MONTH', 'YEAR', 'QUARTER', 'DAY', null]) {
    test(`MetricComparison over ${grain ?? 'default DAY'} plans like the PeriodToDate pair: ${dialect}`, () => {
      const Time = insightDateField('order_date', 'order_date', grain);
      const baseline = planVisual(insightRequest(ptdPair(Time)), { dialect });
      const r = insightRequest([mcComputation({ Time, Name: 'Revenue vs profit' })]);
      const actual = assertInvariant(r, dialect, baseline);
      const expectedGrain = grain ?? 'DAY';
      assert.deepEqual(actual.dimensions.map(d => [d.fieldId, d.columnName, d.outputName, d.granularity]), [['order_date', 'order_date', expectedGrain.toLowerCase(), expectedGrain]]);
      assert.deepEqual(actual.measures.map(m => [m.fieldId, m.columnName, m.outputName, m.aggregation]), [['revenue', 'revenue', 'revenue', 'SUM'], ['profit', 'profit', 'profit', 'SUM']]);
      assert.equal(actual.dimensions[0].path, `${computationPath()}.Time.DateDimensionField`);
      assert.equal(actual.measures[0].path, `${computationPath()}.FromValue.NumericalMeasureField`);
      assert.equal(actual.measures[1].path, `${computationPath()}.TargetValue.NumericalMeasureField`);
      // Also evaluate the complete dated series, including null aggregates.
      r.analysis.Definition.FilterGroups = [];
      const unfilteredBaseline = insightRequest(ptdPair(Time));
      unfilteredBaseline.analysis.Definition.FilterGroups = [];
      const unfiltered = assertInvariant(r, dialect, planVisual(unfilteredBaseline, { dialect }));
      if (grain === 'MONTH') assert.deepEqual(evaluatePlan(unfiltered, rows), [
        { month: '2025-01', revenue: 50, profit: 12 },
        { month: '2025-02', revenue: null, profit: null },
        { month: '2025-03', revenue: 10, profit: 3 },
      ], 'native results keep both SUM series; the consumer computes the comparison');
    });
  }

  test(`MetricComparison with a category Time plans like the MaximumMinimum pair: ${dialect}`, () => {
    const baseline = planVisual(insightRequest(mmPair()), { dialect });
    const r = insightRequest([mcComputation({ Time: insightCatField() })]);
    const actual = assertInvariant(r, dialect, baseline);
    assert.deepEqual(actual.dimensions.map(d => [d.fieldId, d.columnName, d.outputName, d.granularity]), [['region', 'region', 'region', undefined]]);
    assert.equal(actual.dimensions[0].path, `${computationPath()}.Time.CategoricalDimensionField`);
  });

  test(`MetricComparison may omit Time when a companion derives the same dimension: ${dialect}`, () => {
    const dateBaseline = planVisual(insightRequest(ptdPair()), { dialect });
    const dateCompanion = insightRequest([
      { MetricComparison: { ComputationId: 'comparison', FromValue: insightValueField(), TargetValue: insightValueField('profit', 'profit') } },
      ptdComputation(),
    ]);
    assertInvariant(dateCompanion, dialect, dateBaseline);
    const categoryBaseline = planVisual(insightRequest(mmPair()), { dialect });
    const categoryCompanion = insightRequest([
      { MetricComparison: { ComputationId: 'comparison', FromValue: insightValueField(), TargetValue: insightValueField('profit', 'profit') } },
      mmComputation(),
    ]);
    assertInvariant(categoryCompanion, dialect, categoryBaseline);
  });

  test(`MetricComparison shares consistent field IDs across computations in either order: ${dialect}`, () => {
    const baseline = planVisual(insightRequest(ptdPair()), { dialect });
    for (const computations of [[mcComputation(), ptdComputation()], [ptdComputation(), mcComputation()]]) {
      assertInvariant(insightRequest(computations), dialect, baseline);
    }
  });
}

test('MetricComparison plans like the PeriodToDate pair on the prepared-visual path without mutation', () => {
  const r = insightRequest([mcComputation()]);
  const baselineRequest = insightRequest(ptdPair());
  r.analysis.Definition.FilterGroups = [];
  baselineRequest.analysis.Definition.FilterGroups = [];
  const schema = [{ name: 'order_date', type: 'DATETIME' }, { name: 'revenue', type: 'DECIMAL' }, { name: 'profit', type: 'DECIMAL' }];
  const before = structuredClone(r);
  const baseline = planPreparedVisual(schema, baselineRequest.analysis, 'insight-1', r.localData.dataSetArn);
  const prepared = planPreparedVisual(schema, r.analysis, 'insight-1', r.localData.dataSetArn);
  assert.deepEqual(r, before, 'prepared planning must not mutate the definition');
  assert.deepEqual(stripPaths(prepared), stripPaths(baseline));
  assert.deepEqual(evaluatePlan(prepared, rows), evaluatePlan(baseline, rows));
  assert.deepEqual(prepared.dimensions.map(d => d.outputName), ['month']);
  assert.deepEqual(prepared.measures.map(m => m.aggregation), ['SUM', 'SUM']);
});

test('MetricComparison admits the shared computation ID bounds and string names', () => {
  const baseline = planVisual(insightRequest(ptdPair()));
  for (const ComputationId of ['a', 'comparison_1-A', 'a'.repeat(512)]) {
    for (const Name of ['', 'Revenue vs profit']) {
      assertInvariant(insightRequest([mcComputation({ ComputationId, Name })]), 'duckdb', baseline);
    }
  }
});

test('MetricComparison requires both FromValue and TargetValue at their exact paths', () => {
  const noFrom = mcComputation();
  delete noFrom.MetricComparison.FromValue;
  assert.throws(() => planVisual(insightRequest([noFrom])), {
    code: 'INVALID_INPUT', path: `${computationPath()}.FromValue`,
  });
  const noTarget = mcComputation();
  delete noTarget.MetricComparison.TargetValue;
  assert.throws(() => planVisual(insightRequest([noTarget])), {
    code: 'INVALID_INPUT', path: `${computationPath()}.TargetValue`,
  });
  const neither = { MetricComparison: { ComputationId: 'comparison', Time: insightDateField() } };
  assert.throws(() => planVisual(insightRequest([neither])), {
    code: 'INVALID_INPUT', path: `${computationPath()}.FromValue`,
  });
});

test('MetricComparison rejects a FromValue and TargetValue that bind the same measure', () => {
  assert.throws(() => planVisual(insightRequest([mcComputation({ TargetValue: insightValueField('revenue', 'revenue') })])), {
    code: 'INVALID_INPUT', path: `${computationPath()}.TargetValue`,
  });
  // The same field ID over a different column fails earlier, inside the
  // shared measure derivation.
  assert.throws(() => planVisual(insightRequest([mcComputation({ TargetValue: insightValueField('revenue', 'profit') })])), {
    code: 'UNRESOLVED_BINDING', path: `${computationPath()}.TargetValue.NumericalMeasureField`,
  });
  // Two distinct field IDs over the same column are two distinct measures.
  const baseline = planVisual(insightRequest(ptdPair()));
  const sameColumn = insightRequest([mcComputation({ TargetValue: insightValueField('profit', 'revenue') })]);
  const before = structuredClone(sameColumn);
  const actual = planVisual(sameColumn);
  assert.deepEqual(sameColumn, before, 'planning must not mutate the definition');
  assert.deepEqual(actual.measures.map(m => [m.fieldId, m.columnName]), [['revenue', 'revenue'], ['profit', 'revenue']]);
  assert.notDeepEqual(stripPaths(actual).measures, stripPaths(baseline).measures);
});

test('MetricComparison rejects unknown properties at the exact property path', () => {
  for (const [key, value] of [
    ['Value', insightValueField()], ['Category', insightCatField()], ['Type', 'TOP'],
    ['ResultSize', 3], ['PeriodSize', 2], ['PeriodTimeGranularity', 'MONTH'],
    ['ForecastProperties', {}], ['AnomalyDetection', {}], ['MoverSize', 3],
    ['SortOrder', 'PERCENT_DIFFERENCE'], ['Future', true],
  ]) {
    assert.throws(() => planVisual(insightRequest([mcComputation({ [key]: value })])), {
      code: 'UNSUPPORTED_FEATURE', path: `${computationPath()}.${key}`,
    });
  }
});

test('MetricComparison rejects malformed computation IDs and names at their exact paths', () => {
  for (const ComputationId of [undefined, null, 1, '', 'bad id', 'bad.id', 'a'.repeat(513)]) {
    const computation = mcComputation({ ComputationId });
    if (ComputationId === undefined) delete computation.MetricComparison.ComputationId;
    assert.throws(() => planVisual(insightRequest([computation])), {
      code: 'INVALID_INPUT', path: `${computationPath()}.ComputationId`,
    });
  }
  for (const Name of [null, 1, {}, []]) {
    assert.throws(() => planVisual(insightRequest([mcComputation({ Name })])), {
      code: 'INVALID_INPUT', path: `${computationPath()}.Name`,
    });
  }
});

test('MetricComparison fails closed on malformed field bindings with exact diagnostics', () => {
  const withoutAggregation = insightValueField();
  delete withoutAggregation.NumericalMeasureField.AggregationFunction;
  for (const [patch, code, suffix] of [
    // Time accepts only a date or category dimension field variant.
    [{ Time: insightValueField() }, 'UNSUPPORTED_FEATURE', '.Time.NumericalMeasureField'],
    [{ Time: insightNumField() }, 'UNSUPPORTED_FEATURE', '.Time.NumericalDimensionField'],
    [{ Time: insightDateField('region', 'region') }, 'TYPE_MISMATCH', '.Time.DateDimensionField'],
    [{ Time: insightDateField('order_date', 'order_date', 'WEEK') }, 'UNSUPPORTED_FEATURE', '.Time.DateDimensionField.DateGranularity'],
    [{ Time: insightDateField('missing', 'missing') }, 'UNRESOLVED_BINDING', '.Time.DateDimensionField.Column.ColumnName'],
    [{ Time: insightCatField('order_id', 'order_id') }, 'TYPE_MISMATCH', '.Time.CategoricalDimensionField'],
    [{ Time: insightCatField('missing', 'missing') }, 'UNRESOLVED_BINDING', '.Time.CategoricalDimensionField.Column.ColumnName'],
    // FromValue and TargetValue each require a numerical measure with
    // explicit SUM and a numeric column.
    [{ FromValue: insightDateField() }, 'UNSUPPORTED_FEATURE', '.FromValue.DateDimensionField'],
    [{ FromValue: insightValueField('revenue', 'revenue', 'AVG') }, 'UNSUPPORTED_FEATURE', '.FromValue.NumericalMeasureField.AggregationFunction'],
    [{ FromValue: withoutAggregation }, 'INVALID_INPUT', '.FromValue.NumericalMeasureField.AggregationFunction'],
    [{ FromValue: insightValueField('region', 'region') }, 'TYPE_MISMATCH', '.FromValue.NumericalMeasureField'],
    [{ FromValue: insightValueField('missing', 'missing') }, 'UNRESOLVED_BINDING', '.FromValue.NumericalMeasureField.Column.ColumnName'],
    [{ TargetValue: insightCatField() }, 'UNSUPPORTED_FEATURE', '.TargetValue.CategoricalDimensionField'],
    [{ TargetValue: insightValueField('profit', 'profit', 'AVG') }, 'UNSUPPORTED_FEATURE', '.TargetValue.NumericalMeasureField.AggregationFunction'],
    [{ TargetValue: insightValueField('profit', 'region') }, 'TYPE_MISMATCH', '.TargetValue.NumericalMeasureField'],
    [{ TargetValue: insightValueField('missing', 'missing') }, 'UNRESOLVED_BINDING', '.TargetValue.NumericalMeasureField.Column.ColumnName'],
  ]) assert.throws(() => planVisual(insightRequest([mcComputation(patch)])), { code, path: `${computationPath()}${suffix}` }, JSON.stringify(patch));
});

test('MetricComparison preserves collection rules with exact diagnostics', () => {
  for (const [computations, code, path] of [
    [[mcComputation(), mcComputation()], 'INVALID_INPUT', `${computationPath('MetricComparison', 1)}.ComputationId`],
    [[mcComputation(), ptdComputation({ ComputationId: 'COMPARISON' })], 'INVALID_INPUT', `${computationPath('PeriodToDate', 1)}.ComputationId`],
    // Field IDs must keep their date grain and measure column across computations.
    [[mcComputation(), ptdComputation({ Time: insightDateField('order_date', 'order_date', 'DAY') })], 'UNRESOLVED_BINDING', `${computationPath('PeriodToDate', 1)}.Time.DateDimensionField`],
    [[ptdComputation(), mcComputation({ FromValue: insightValueField('revenue', 'profit') })], 'UNRESOLVED_BINDING', `${computationPath('MetricComparison', 1)}.FromValue.NumericalMeasureField`],
    // Two derived dimensions remain invalid, even when both bind the same date column.
    [[mcComputation(), ptdComputation({ Time: insightDateField('other', 'order_date', 'DAY') })], 'INVALID_INPUT', configPath],
    [[mcComputation(), { UniqueValues: { ComputationId: 'u', Category: insightCatField() } }], 'INVALID_INPUT', configPath],
    // A standalone MetricComparison without Time derives no dimension.
    [[{ MetricComparison: { ComputationId: 'comparison', FromValue: insightValueField(), TargetValue: insightValueField('profit', 'profit') } }], 'INVALID_INPUT', configPath],
    // Movers still cannot combine with any other computation.
    [[mcComputation(), { TopBottomMovers: { ComputationId: 'm', Type: 'TOP', Category: insightCatField(), Time: insightDateField(), Value: insightValueField() } }], 'UNSUPPORTED_FEATURE', configPath],
  ]) assert.throws(() => planVisual(insightRequest(computations)), { code, path }, JSON.stringify(computations).slice(0, 120));
});

test('TotalAggregation remains unsupported with exact kind path', () => {
  assert.throws(() => planVisual(insightRequest([
    { TotalAggregation: { ComputationId: 'a', Value: insightValueField() } },
  ])), { code: 'UNSUPPORTED_FEATURE', path: computationPath('TotalAggregation') });
});
