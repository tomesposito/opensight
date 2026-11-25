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

const taComputation = (patch = {}) => ({ TotalAggregation: { ComputationId: 'total', Value: insightValueField(), ...patch } });
const mmComputation = (patch = {}) => ({ MaximumMinimum: { ComputationId: 'mm', Type: 'MAXIMUM', Time: insightCatField(), Value: insightValueField(), ...patch } });
const ptdComputation = (patch = {}) => ({ PeriodToDate: { ComputationId: 'ptd', Time: insightDateField(), Value: insightValueField(), ...patch } });
// The already-admitted baselines over the same fields: TotalAggregation
// derives no dimension and (when it shares or omits Value) no new
// measure, so a collection containing it must plan exactly like the
// same collection without it.
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
  assert.deepEqual(stripPaths(actual), stripPaths(baseline), 'the plan must match the admitted baseline apart from binding paths');
  assert.equal(actual.sql, baseline.sql, 'SQL must be unchanged');
  assert.deepEqual(evaluatePlan(actual, rows), evaluatePlan(baseline, rows));
  return actual;
}

const configPath = '$.analysis.Definition.Sheets[0].Visuals[0].InsightVisual.InsightConfiguration';
const computationPath = (kind = 'TotalAggregation', index = 0) => `${configPath}.Computations[${index}].${kind}`;

for (const dialect of dialects) {
  test(`TotalAggregation sharing a MaximumMinimum measure plans like MaximumMinimum alone: ${dialect}`, () => {
    const baseline = planVisual(insightRequest([mmComputation()]), { dialect });
    for (const computations of [[taComputation(), mmComputation()], [mmComputation(), taComputation()]]) {
      const actual = assertInvariant(insightRequest(computations), dialect, baseline);
      assert.deepEqual(actual.dimensions.map(d => [d.fieldId, d.columnName, d.outputName, d.granularity]), [['region', 'region', 'region', undefined]]);
      assert.deepEqual(actual.measures.map(m => [m.fieldId, m.columnName, m.outputName, m.aggregation]), [['revenue', 'revenue', 'revenue', 'SUM']]);
    }
    const first = planVisual(insightRequest([taComputation(), mmComputation()]), { dialect });
    assert.equal(first.measures[0].path, `${computationPath()}.Value.NumericalMeasureField`);
    assert.equal(first.dimensions[0].path, `${computationPath('MaximumMinimum', 1)}.Time.CategoricalDimensionField`);
  });

  test(`TotalAggregation sharing a PeriodToDate measure plans like PeriodToDate alone: ${dialect}`, () => {
    const baseline = planVisual(insightRequest([ptdComputation()]), { dialect });
    const actual = assertInvariant(insightRequest([taComputation({ Name: 'Total revenue' }), ptdComputation()]), dialect, baseline);
    assert.deepEqual(actual.dimensions.map(d => [d.fieldId, d.columnName, d.outputName, d.granularity]), [['order_date', 'order_date', 'month', 'MONTH']]);
    assert.equal(actual.measures[0].path, `${computationPath()}.Value.NumericalMeasureField`);
    // Also evaluate the complete dated series, including null aggregates.
    const unfiltered = insightRequest([taComputation(), ptdComputation()]);
    unfiltered.analysis.Definition.FilterGroups = [];
    const unfilteredBaseline = insightRequest([ptdComputation()]);
    unfilteredBaseline.analysis.Definition.FilterGroups = [];
    const evaluated = assertInvariant(unfiltered, dialect, planVisual(unfilteredBaseline, { dialect }));
    assert.deepEqual(evaluatePlan(evaluated, rows), [
      { month: '2025-01', revenue: 50 },
      { month: '2025-02', revenue: null },
      { month: '2025-03', revenue: 10 },
    ], 'native results keep the grouped SUM series; the consumer computes the total');
  });

  test(`TotalAggregation binding a second measure plans like the two-measure MaximumMinimum pair: ${dialect}`, () => {
    const baseline = planVisual(insightRequest(mmPair()), { dialect });
    const computations = [
      mmComputation(),
      taComputation({ Value: insightValueField('profit', 'profit') }),
      mmComputation({ ComputationId: 'mm-target', Type: 'MINIMUM', Value: insightValueField('profit', 'profit') }),
    ];
    const actual = assertInvariant(insightRequest(computations), dialect, baseline);
    assert.deepEqual(actual.measures.map(m => [m.fieldId, m.columnName, m.aggregation]), [['revenue', 'revenue', 'SUM'], ['profit', 'profit', 'SUM']]);
    assert.equal(actual.measures[1].path, `${computationPath('TotalAggregation', 1)}.Value.NumericalMeasureField`);
  });

  test(`TotalAggregation may omit Value when a companion derives the measure: ${dialect}`, () => {
    const baseline = planVisual(insightRequest([mmComputation()]), { dialect });
    const companion = insightRequest([{ TotalAggregation: { ComputationId: 'total' } }, mmComputation()]);
    assertInvariant(companion, dialect, baseline);
  });
}

test('TotalAggregation plans like MaximumMinimum alone on the prepared-visual path without mutation', () => {
  const r = insightRequest([taComputation(), mmComputation()]);
  const baselineRequest = insightRequest([mmComputation()]);
  r.analysis.Definition.FilterGroups = [];
  baselineRequest.analysis.Definition.FilterGroups = [];
  const schema = [{ name: 'region', type: 'STRING' }, { name: 'revenue', type: 'DECIMAL' }];
  const before = structuredClone(r);
  const baseline = planPreparedVisual(schema, baselineRequest.analysis, 'insight-1', r.localData.dataSetArn);
  const prepared = planPreparedVisual(schema, r.analysis, 'insight-1', r.localData.dataSetArn);
  assert.deepEqual(r, before, 'prepared planning must not mutate the definition');
  assert.deepEqual(stripPaths(prepared), stripPaths(baseline));
  assert.deepEqual(evaluatePlan(prepared, rows), evaluatePlan(baseline, rows));
  assert.deepEqual(prepared.dimensions.map(d => d.outputName), ['region']);
  assert.deepEqual(prepared.measures.map(m => m.aggregation), ['SUM']);
});

test('TotalAggregation admits the shared computation ID bounds and string names', () => {
  const baseline = planVisual(insightRequest([mmComputation()]));
  for (const ComputationId of ['a', 'total_1-A', 'a'.repeat(512)]) {
    for (const Name of ['', 'Total revenue']) {
      assertInvariant(insightRequest([taComputation({ ComputationId, Name }), mmComputation()]), 'duckdb', baseline);
    }
  }
});

test('TotalAggregation alone derives no dimension and fails the collection rule', () => {
  for (const computations of [
    [taComputation()],
    [{ TotalAggregation: { ComputationId: 'total' } }],
    [taComputation(), taComputation({ ComputationId: 'total-2', Value: insightValueField('profit', 'profit') })],
  ]) assert.throws(() => planVisual(insightRequest(computations)), { code: 'INVALID_INPUT', path: configPath }, JSON.stringify(computations).slice(0, 120));
});

test('TotalAggregation rejects unknown properties at the exact property path', () => {
  for (const [key, value] of [
    ['Time', insightDateField()], ['Category', insightCatField()], ['Type', 'SUM'],
    ['FromValue', insightValueField()], ['TargetValue', insightValueField('profit', 'profit')],
    ['ResultSize', 3], ['PeriodSize', 2], ['Future', true],
  ]) {
    assert.throws(() => planVisual(insightRequest([taComputation({ [key]: value }), mmComputation()])), {
      code: 'UNSUPPORTED_FEATURE', path: `${computationPath()}.${key}`,
    });
  }
});

test('TotalAggregation rejects malformed computation IDs and names at their exact paths', () => {
  for (const ComputationId of [undefined, null, 1, '', 'bad id', 'bad.id', 'a'.repeat(513)]) {
    const computation = taComputation({ ComputationId });
    if (ComputationId === undefined) delete computation.TotalAggregation.ComputationId;
    assert.throws(() => planVisual(insightRequest([computation, mmComputation()])), {
      code: 'INVALID_INPUT', path: `${computationPath()}.ComputationId`,
    });
  }
  for (const Name of [null, 1, {}, []]) {
    assert.throws(() => planVisual(insightRequest([taComputation({ Name }), mmComputation()])), {
      code: 'INVALID_INPUT', path: `${computationPath()}.Name`,
    });
  }
});

test('TotalAggregation fails closed on malformed Value bindings with exact diagnostics', () => {
  const withoutAggregation = insightValueField();
  delete withoutAggregation.NumericalMeasureField.AggregationFunction;
  for (const [Value, code, suffix] of [
    [insightDateField(), 'UNSUPPORTED_FEATURE', '.Value.DateDimensionField'],
    [insightCatField(), 'UNSUPPORTED_FEATURE', '.Value.CategoricalDimensionField'],
    [insightValueField('revenue', 'revenue', 'AVG'), 'UNSUPPORTED_FEATURE', '.Value.NumericalMeasureField.AggregationFunction'],
    [withoutAggregation, 'INVALID_INPUT', '.Value.NumericalMeasureField.AggregationFunction'],
    [insightValueField('region', 'region'), 'TYPE_MISMATCH', '.Value.NumericalMeasureField'],
    [insightValueField('missing', 'missing'), 'UNRESOLVED_BINDING', '.Value.NumericalMeasureField.Column.ColumnName'],
  ]) assert.throws(() => planVisual(insightRequest([taComputation({ Value }), mmComputation()])), { code, path: `${computationPath()}${suffix}` }, JSON.stringify(Value));
});

test('TotalAggregation preserves collection rules with exact diagnostics', () => {
  for (const [computations, code, path] of [
    // Duplicate computation IDs, including a case-only difference.
    [[taComputation(), mmComputation({ ComputationId: 'TOTAL' })], 'INVALID_INPUT', `${computationPath('MaximumMinimum', 1)}.ComputationId`],
    // Field IDs must keep their measure column across computations.
    [[mmComputation(), taComputation({ Value: insightValueField('revenue', 'profit') })], 'UNRESOLVED_BINDING', `${computationPath('TotalAggregation', 1)}.Value.NumericalMeasureField`],
    // A second derived dimension remains invalid.
    [[taComputation(), mmComputation(), ptdComputation()], 'INVALID_INPUT', configPath],
    // Three distinct measures across the collection exceed the cap (#321).
    [[mmComputation(), taComputation({ Value: insightValueField('profit', 'profit') }), taComputation({ ComputationId: 'total-2', Value: insightValueField('order_id', 'order_id') })], 'INVALID_INPUT', configPath],
    // Movers still cannot combine with any other computation.
    [[taComputation(), { TopBottomMovers: { ComputationId: 'm', Type: 'TOP', Category: insightCatField(), Time: insightDateField(), Value: insightValueField() } }], 'UNSUPPORTED_FEATURE', configPath],
  ]) assert.throws(() => planVisual(insightRequest(computations)), { code, path }, JSON.stringify(computations).slice(0, 120));
});
