import test from 'node:test';
import assert from 'node:assert/strict';
import { planPreparedVisual, planVisual } from '@opensight/query-engine';
import { evaluatePlan } from '@opensight/query-engine/browser';
import { request } from './helpers.mjs';

const dialects = ['duckdb', 'postgres', 'mysql', 'redshift', 'athena'];

const insightDateField = (fieldId = 'order_date', columnName = 'order_date', grain = 'MONTH') => ({ DateDimensionField: { FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: columnName }, ...(grain ? { DateGranularity: grain } : {}) } });
const insightCatField = (fieldId = 'region', columnName = 'region') => ({ CategoricalDimensionField: { FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: columnName } } });
const insightValueField = (fieldId = 'revenue', columnName = 'revenue', aggregation = 'SUM') => ({ NumericalMeasureField: { FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: columnName }, AggregationFunction: { SimpleNumericalAggregation: aggregation } } });

function insightRequest(computations, visualId = 'insight-1') {
  const r = request('revenue-trend');
  r.analysis.Definition.Sheets[0].Visuals = [{ InsightVisual: { VisualId: visualId, InsightConfiguration: { Computations: computations } } }];
  r.visualId = visualId;
  return r;
}

const growthComputation = (patch = {}) => ({ GrowthRate: { ComputationId: 'growth', Time: insightDateField(), Value: insightValueField(), PeriodSize: 2, ...patch } });
const ptdComputation = (patch = {}) => ({ PeriodToDate: { ComputationId: 'ptd', Time: insightDateField(), Value: insightValueField(), ...patch } });

const rows = [
  { region: 'West', category: 'Hardware', order_date: '2025-03-01', revenue: 10 },
  { region: 'East', category: 'Software', order_date: '2025-01-01', revenue: 20 },
  { region: 'North', category: 'Hardware', order_date: '2025-02-01', revenue: null },
  { region: 'East', category: 'Software', order_date: '2025-01-02', revenue: 30 },
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
  assert.deepEqual(stripPaths(actual), stripPaths(baseline), 'the plan must match PeriodToDate apart from binding paths');
  assert.equal(actual.sql, baseline.sql, 'SQL must be unchanged');
  assert.deepEqual(evaluatePlan(actual, rows), evaluatePlan(baseline, rows));
  return actual;
}

const configPath = '$.analysis.Definition.Sheets[0].Visuals[0].InsightVisual.InsightConfiguration';
const computationPath = (kind = 'GrowthRate', index = 0) => `${configPath}.Computations[${index}].${kind}`;

for (const dialect of dialects) {
  for (const grain of ['MONTH', 'YEAR', 'QUARTER', 'DAY', null]) {
    test(`GrowthRate over ${grain ?? 'default DAY'} plans like PeriodToDate: ${dialect}`, () => {
      const Time = insightDateField('order_date', 'order_date', grain);
      const baseline = planVisual(insightRequest([ptdComputation({ Time })]), { dialect });
      const r = insightRequest([growthComputation({ Time, Name: 'Revenue growth rate' })]);
      const actual = assertInvariant(r, dialect, baseline);
      const expectedGrain = grain ?? 'DAY';
      assert.deepEqual(actual.dimensions.map(d => [d.fieldId, d.columnName, d.outputName, d.granularity]), [['order_date', 'order_date', expectedGrain.toLowerCase(), expectedGrain]]);
      assert.deepEqual(actual.measures.map(m => [m.fieldId, m.columnName, m.outputName, m.aggregation]), [['revenue', 'revenue', 'revenue', 'SUM']]);
      assert.equal(actual.dimensions[0].path, `${computationPath()}.Time.DateDimensionField`);
      assert.equal(actual.measures[0].path, `${computationPath()}.Value.NumericalMeasureField`);
      // Also evaluate the complete dated series, including a null aggregate.
      r.analysis.Definition.FilterGroups = [];
      const unfilteredBaseline = insightRequest([ptdComputation({ Time })]);
      unfilteredBaseline.analysis.Definition.FilterGroups = [];
      const unfiltered = assertInvariant(r, dialect, planVisual(unfilteredBaseline, { dialect }));
      if (grain === 'MONTH') assert.deepEqual(evaluatePlan(unfiltered, rows), [
        { month: '2025-01', revenue: 50 },
        { month: '2025-02', revenue: null },
        { month: '2025-03', revenue: 10 },
      ], 'native results keep the dated SUM series; the consumer computes the growth rate');
    });
  }

  test(`GrowthRate may omit Time or Value when companions derive the same binding: ${dialect}`, () => {
    const baseline = planVisual(insightRequest([ptdComputation()]), { dialect });
    const valueOnly = insightRequest([
      { GrowthRate: { ComputationId: 'growth', Value: insightValueField(), PeriodSize: 2 } },
      { MaximumMinimum: { ComputationId: 'mm', Type: 'MAXIMUM', Time: insightDateField() } },
    ]);
    assertInvariant(valueOnly, dialect, baseline);
    const timeOnly = insightRequest([
      { GrowthRate: { ComputationId: 'growth', Time: insightDateField() } },
      { PeriodToDate: { ComputationId: 'ptd', Value: insightValueField() } },
    ]);
    assertInvariant(timeOnly, dialect, baseline);
    const bothOmitted = insightRequest([
      { GrowthRate: { ComputationId: 'growth', PeriodSize: 2 } },
      ptdComputation(),
    ]);
    assertInvariant(bothOmitted, dialect, baseline);
  });

  test(`GrowthRate shares consistent field IDs across computations in either order: ${dialect}`, () => {
    const baseline = planVisual(insightRequest([ptdComputation()]), { dialect });
    for (const computations of [[growthComputation(), ptdComputation()], [ptdComputation(), growthComputation()]]) {
      assertInvariant(insightRequest(computations), dialect, baseline);
    }
  });
}

test('GrowthRate plans like PeriodToDate on the prepared-visual path without mutation', () => {
  const r = insightRequest([growthComputation()]);
  const baselineRequest = insightRequest([ptdComputation()]);
  r.analysis.Definition.FilterGroups = [];
  baselineRequest.analysis.Definition.FilterGroups = [];
  const schema = [{ name: 'order_date', type: 'DATETIME' }, { name: 'revenue', type: 'DECIMAL' }];
  const before = structuredClone(r);
  const baseline = planPreparedVisual(schema, baselineRequest.analysis, 'insight-1', r.localData.dataSetArn);
  const prepared = planPreparedVisual(schema, r.analysis, 'insight-1', r.localData.dataSetArn);
  assert.deepEqual(r, before, 'prepared planning must not mutate the definition');
  assert.deepEqual(stripPaths(prepared), stripPaths(baseline));
  assert.deepEqual(evaluatePlan(prepared, rows), evaluatePlan(baseline, rows));
  assert.deepEqual(prepared.dimensions.map(d => d.outputName), ['month']);
  assert.deepEqual(prepared.measures.map(m => m.aggregation), ['SUM']);
});

test('GrowthRate admits the shared computation ID bounds and string names', () => {
  const baseline = planVisual(insightRequest([ptdComputation()]));
  for (const ComputationId of ['a', 'growth_1-A', 'a'.repeat(512)]) {
    for (const Name of ['', 'Revenue growth rate']) {
      assertInvariant(insightRequest([growthComputation({ ComputationId, Name })]), 'duckdb', baseline);
    }
  }
});

test('GrowthRate admits PeriodSize 2 and an omitted PeriodSize with the same plan', () => {
  const baseline = planVisual(insightRequest([ptdComputation()]));
  assertInvariant(insightRequest([growthComputation({ PeriodSize: 2 })]), 'duckdb', baseline);
  const omitted = growthComputation();
  delete omitted.GrowthRate.PeriodSize;
  assertInvariant(insightRequest([omitted]), 'duckdb', baseline);
});

test('GrowthRate rejects PeriodSize values other than 2 at the exact property path', () => {
  for (const PeriodSize of [0, 1, 3, -2, 2.5, '2', null, true, {}, []]) {
    assert.throws(() => planVisual(insightRequest([growthComputation({ PeriodSize })])), {
      code: 'UNSUPPORTED_FEATURE', path: `${computationPath()}.PeriodSize`,
    }, JSON.stringify(PeriodSize));
  }
});

test('GrowthRate rejects unknown properties at the exact property path', () => {
  for (const [key, value] of [
    ['Future', true], ['PeriodTimeGranularity', 'MONTH'], ['ForecastProperties', {}],
    ['AnomalyDetection', {}], ['Category', insightCatField()], ['Type', 'TOP'],
    ['ResultSize', 3], ['MoverSize', 3], ['SortOrder', 'PERCENT_DIFFERENCE'],
  ]) {
    assert.throws(() => planVisual(insightRequest([growthComputation({ [key]: value })])), {
      code: 'UNSUPPORTED_FEATURE', path: `${computationPath()}.${key}`,
    });
  }
});

test('GrowthRate rejects malformed computation IDs and names at their exact paths', () => {
  for (const ComputationId of [undefined, null, 1, '', 'bad id', 'bad.id', 'a'.repeat(513)]) {
    const computation = growthComputation({ ComputationId });
    if (ComputationId === undefined) delete computation.GrowthRate.ComputationId;
    assert.throws(() => planVisual(insightRequest([computation])), {
      code: 'INVALID_INPUT', path: `${computationPath()}.ComputationId`,
    });
  }
  for (const Name of [null, 1, {}, []]) {
    assert.throws(() => planVisual(insightRequest([growthComputation({ Name })])), {
      code: 'INVALID_INPUT', path: `${computationPath()}.Name`,
    });
  }
});

test('GrowthRate fails closed on malformed field bindings with exact diagnostics', () => {
  const withoutAggregation = insightValueField();
  delete withoutAggregation.NumericalMeasureField.AggregationFunction;
  for (const [patch, code, suffix] of [
    // Time accepts only a date dimension bound to a datetime column.
    [{ Time: insightCatField() }, 'UNSUPPORTED_FEATURE', '.Time.CategoricalDimensionField'],
    [{ Time: insightValueField() }, 'UNSUPPORTED_FEATURE', '.Time.NumericalMeasureField'],
    [{ Time: insightDateField('region', 'region') }, 'TYPE_MISMATCH', '.Time.DateDimensionField'],
    [{ Time: insightDateField('order_date', 'order_date', 'WEEK') }, 'UNSUPPORTED_FEATURE', '.Time.DateDimensionField.DateGranularity'],
    [{ Time: insightDateField('missing', 'missing') }, 'UNRESOLVED_BINDING', '.Time.DateDimensionField.Column.ColumnName'],
    // Value requires a numerical measure with explicit SUM and a numeric column.
    [{ Value: insightDateField() }, 'UNSUPPORTED_FEATURE', '.Value.DateDimensionField'],
    [{ Value: insightValueField('revenue', 'revenue', 'AVG') }, 'UNSUPPORTED_FEATURE', '.Value.NumericalMeasureField.AggregationFunction'],
    [{ Value: withoutAggregation }, 'INVALID_INPUT', '.Value.NumericalMeasureField.AggregationFunction'],
    [{ Value: insightValueField('region', 'region') }, 'TYPE_MISMATCH', '.Value.NumericalMeasureField'],
    [{ Value: insightValueField('missing', 'missing') }, 'UNRESOLVED_BINDING', '.Value.NumericalMeasureField.Column.ColumnName'],
  ]) assert.throws(() => planVisual(insightRequest([growthComputation(patch)])), { code, path: `${computationPath()}${suffix}` }, JSON.stringify(patch));
});

test('GrowthRate preserves collection rules with exact diagnostics', () => {
  for (const [computations, code, path] of [
    [[growthComputation(), growthComputation()], 'INVALID_INPUT', `${computationPath('GrowthRate', 1)}.ComputationId`],
    [[growthComputation(), ptdComputation({ ComputationId: 'GROWTH' })], 'INVALID_INPUT', `${computationPath('PeriodToDate', 1)}.ComputationId`],
    // Field IDs must keep their date grain and measure column across computations.
    [[growthComputation(), ptdComputation({ Time: insightDateField('order_date', 'order_date', 'DAY') })], 'UNRESOLVED_BINDING', `${computationPath('PeriodToDate', 1)}.Time.DateDimensionField`],
    [[ptdComputation(), growthComputation({ Value: insightValueField('revenue', 'profit') })], 'UNRESOLVED_BINDING', `${computationPath('GrowthRate', 1)}.Value.NumericalMeasureField`],
    // Two derived dimensions remain invalid, even when both bind the same date column.
    [[growthComputation(), ptdComputation({ Time: insightDateField('other', 'order_date', 'DAY') })], 'INVALID_INPUT', configPath],
    [[growthComputation(), { UniqueValues: { ComputationId: 'u', Category: insightCatField() } }], 'INVALID_INPUT', configPath],
    [[{ GrowthRate: { ComputationId: 'growth', Time: insightDateField(), PeriodSize: 2 } }], 'INVALID_INPUT', configPath],
    [[{ GrowthRate: { ComputationId: 'growth', Value: insightValueField() } }], 'INVALID_INPUT', configPath],
    [[{ GrowthRate: { ComputationId: 'growth', PeriodSize: 2 } }], 'INVALID_INPUT', configPath],
    // A UniqueValues companion cannot supply the COUNT carrier for a growth computation.
    [[{ GrowthRate: { ComputationId: 'growth', Time: insightDateField() } }, { UniqueValues: { ComputationId: 'u' } }], 'INVALID_INPUT', configPath],
    // A category supplied by a companion must still fail the date-required rule.
    [[{ GrowthRate: { ComputationId: 'growth', Value: insightValueField(), PeriodSize: 2 } }, { UniqueValues: { ComputationId: 'u', Category: insightCatField() } }], 'UNSUPPORTED_FEATURE', configPath],
    [[{ MaximumMinimum: { ComputationId: 'mm', Type: 'MAXIMUM', Time: insightCatField() } }, { GrowthRate: { ComputationId: 'growth', Value: insightValueField() } }], 'UNSUPPORTED_FEATURE', configPath],
    [[{ TopBottomRanked: { ComputationId: 'ranked', Type: 'TOP', Category: insightCatField(), Value: insightValueField() } }, { GrowthRate: { ComputationId: 'growth' } }], 'UNSUPPORTED_FEATURE', configPath],
    // Movers still cannot combine with any other computation.
    [[growthComputation(), { TopBottomMovers: { ComputationId: 'm', Type: 'TOP', Category: insightCatField(), Time: insightDateField(), Value: insightValueField() } }], 'UNSUPPORTED_FEATURE', configPath],
  ]) assert.throws(() => planVisual(insightRequest(computations)), { code, path }, JSON.stringify(computations).slice(0, 120));
});

test('TotalAggregation remains unsupported with exact kind path', () => {
  for (const computation of [
    { TotalAggregation: { ComputationId: 'a', Value: insightValueField() } },
  ]) {
    const kind = Object.keys(computation)[0];
    assert.throws(() => planVisual(insightRequest([computation])), { code: 'UNSUPPORTED_FEATURE', path: computationPath(kind) });
  }
});
