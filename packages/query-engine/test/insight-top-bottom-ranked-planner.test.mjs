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

const rankedComputation = (patch = {}) => ({ TopBottomRanked: { ComputationId: 'ranked', Type: 'TOP', Category: insightCatField(), Value: insightValueField(), ...patch } });
const mmComputation = (patch = {}) => ({ MaximumMinimum: { ComputationId: 'mm', Type: 'MAXIMUM', Time: insightCatField(), Value: insightValueField(), ...patch } });
const anomalyComputation = (patch = {}) => ({ Anomaly: { ComputationId: 'anomaly', Time: insightDateField(), Value: insightValueField(), ...patch } });

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
  assert.deepEqual(stripPaths(actual), stripPaths(baseline), 'the plan must match the equivalent admitted computation apart from binding paths');
  assert.equal(actual.sql, baseline.sql, 'SQL must be unchanged');
  assert.deepEqual(evaluatePlan(actual, rows), evaluatePlan(baseline, rows));
  return actual;
}

for (const dialect of dialects) {
  for (const Type of ['TOP', 'BOTTOM']) {
    test(`TopBottomRanked ${Type} over a category dimension plans like the admitted maximum-minimum series: ${dialect}`, () => {
      // Clear the fixture's East filter so evaluation sees every region.
      const unfiltered = (computations) => { const q = insightRequest(computations); q.analysis.Definition.FilterGroups = []; return q; };
      const baseline = planVisual(unfiltered([mmComputation()]), { dialect });
      const r = unfiltered([rankedComputation({ Type, Name: 'Revenue ranking', ResultSize: 3 })]);
      const actual = assertInvariant(r, dialect, baseline);
      assert.deepEqual(actual.dimensions.map(d => [d.fieldId, d.columnName, d.outputName, d.granularity]), [['region', 'region', 'region', undefined]]);
      assert.deepEqual(actual.measures.map(m => [m.fieldId, m.columnName, m.outputName, m.aggregation]), [['revenue', 'revenue', 'revenue', 'SUM']]);
      assert.deepEqual(evaluatePlan(actual, rows), [
        { region: 'East', revenue: 50 },
        { region: 'North', revenue: null },
        { region: 'West', revenue: 10 },
      ], 'native results keep dimension order and null aggregates; the consumer ranks the groups');
    });

    test(`TopBottomRanked ${Type} over a date dimension plans like the admitted anomaly series: ${dialect}`, () => {
      const baseline = planVisual(insightRequest([anomalyComputation()]), { dialect });
      const r = insightRequest([rankedComputation({ Type, Category: insightDateField() })]);
      const actual = assertInvariant(r, dialect, baseline);
      assert.deepEqual(actual.dimensions.map(d => [d.columnName, d.outputName, d.granularity]), [['order_date', 'month', 'MONTH']]);
      assert.deepEqual(actual.measures.map(m => [m.columnName, m.outputName, m.aggregation]), [['revenue', 'revenue', 'SUM']]);
    });
  }

  test(`TopBottomRanked ResultSize is planning-invariant at its bounds and when absent: ${dialect}`, () => {
    const baseline = planVisual(insightRequest([mmComputation()]), { dialect });
    for (const ResultSize of [undefined, 1, 20]) {
      const patch = ResultSize === undefined ? {} : { ResultSize };
      const computation = rankedComputation(patch);
      if (ResultSize === undefined) delete computation.TopBottomRanked.ResultSize;
      assertInvariant(insightRequest([computation]), dialect, baseline);
    }
  });

  test(`TopBottomRanked may omit Category or Value when a companion computation derives the same binding: ${dialect}`, () => {
    const baseline = planVisual(insightRequest([mmComputation()]), { dialect });
    const valueOnly = insightRequest([
      { TopBottomRanked: { ComputationId: 'ranked', Type: 'BOTTOM', Value: insightValueField() } },
      { MaximumMinimum: { ComputationId: 'mm', Type: 'MAXIMUM', Time: insightCatField() } },
    ]);
    assertInvariant(valueOnly, dialect, baseline);
    const categoryOnly = insightRequest([
      { TopBottomRanked: { ComputationId: 'ranked', Type: 'TOP', Category: insightCatField() } },
      { MaximumMinimum: { ComputationId: 'mm', Type: 'MINIMUM', Value: insightValueField() } },
    ]);
    assertInvariant(categoryOnly, dialect, baseline);
  });
}

test('TopBottomRanked plans on the prepared-visual path', () => {
  const r = insightRequest([rankedComputation({ Type: 'BOTTOM', ResultSize: 20 })]);
  const analysis = structuredClone(r.analysis); analysis.Definition.FilterGroups = [];
  const prepared = planPreparedVisual([{ name: 'region', type: 'STRING' }, { name: 'revenue', type: 'DECIMAL' }], analysis, 'insight-1', r.localData.dataSetArn);
  assert.deepEqual(prepared.dimensions.map(d => d.outputName), ['region']);
  assert.deepEqual(prepared.measures.map(m => m.aggregation), ['SUM']);
});

test('TopBottomRanked rejects a missing or invalid Type with the type path', () => {
  for (const Type of [undefined, 'MAXIMUM', 'MINIMUM', 'top', null, 1]) {
    const patch = Type === undefined ? {} : { Type };
    const computation = rankedComputation(patch);
    if (Type === undefined) delete computation.TopBottomRanked.Type;
    let error;
    try { planVisual(insightRequest([computation])); } catch (e) { error = e; }
    assert.ok(error, `expected a throw for Type=${String(Type)}`);
    assert.equal(error.code, 'INVALID_INPUT');
    assert.ok(error.path.endsWith('.Computations[0].TopBottomRanked.Type'), `unexpected path ${error.path}`);
  }
});

test('TopBottomRanked rejects an invalid ResultSize with the result-size path', () => {
  for (const ResultSize of [0, 21, 2.5, '3', null, Number.NaN]) {
    let error;
    try { planVisual(insightRequest([rankedComputation({ ResultSize })])); } catch (e) { error = e; }
    assert.ok(error, `expected a throw for ResultSize=${String(ResultSize)}`);
    assert.equal(error.code, 'INVALID_INPUT');
    assert.ok(error.path.endsWith('.Computations[0].TopBottomRanked.ResultSize'), `unexpected path ${error.path}`);
  }
});

test('TopBottomRanked fails closed on malformed configuration and bindings', () => {
  for (const [computations, code] of [
    [[rankedComputation({ Future: true })], 'UNSUPPORTED_FEATURE'],
    [[rankedComputation({ Name: 1 })], 'INVALID_INPUT'],
    [[rankedComputation({ ComputationId: 'bad id' })], 'INVALID_INPUT'],
    [[rankedComputation(), rankedComputation()], 'INVALID_INPUT'],
    // Category must be a category or date dimension field, bound to a matching column type.
    [[rankedComputation({ Category: insightValueField() })], 'UNSUPPORTED_FEATURE'],
    [[rankedComputation({ Category: insightDateField('region', 'region') })], 'TYPE_MISMATCH'],
    [[rankedComputation({ Category: insightCatField('order_date', 'order_date') })], 'TYPE_MISMATCH'],
    [[rankedComputation({ Category: insightDateField('order_date', 'order_date', 'WEEK') })], 'UNSUPPORTED_FEATURE'],
    [[rankedComputation({ Category: insightCatField('missing', 'missing') })], 'UNRESOLVED_BINDING'],
    // Value keeps the shared insight measure rules.
    [[rankedComputation({ Value: insightValueField('revenue', 'revenue', 'AVG') })], 'UNSUPPORTED_FEATURE'],
    [[rankedComputation({ Value: insightValueField('missing', 'missing') })], 'UNRESOLVED_BINDING'],
    // The same field ID must bind consistently across computations.
    [[rankedComputation(), rankedComputation({ ComputationId: 'other', Category: insightCatField('region', 'category') })], 'UNRESOLVED_BINDING'],
    // Collection rules are unchanged: exactly one derived dimension, at least one measure.
    [[rankedComputation(), { UniqueValues: { ComputationId: 'u', Category: insightCatField('category', 'category') } }], 'INVALID_INPUT'],
    [[{ TopBottomRanked: { ComputationId: 'ranked', Type: 'TOP', Category: insightCatField() } }], 'INVALID_INPUT'],
    [[{ TopBottomRanked: { ComputationId: 'ranked', Type: 'TOP', Value: insightValueField() } }], 'INVALID_INPUT'],
    // Movers still cannot combine with any other computation.
    [[rankedComputation(), { TopBottomMovers: { ComputationId: 'm', Type: 'TOP', Category: insightCatField(), Time: insightDateField(), Value: insightValueField() } }], 'UNSUPPORTED_FEATURE'],
    // The remaining unadmitted kinds stay rejected.
    [[{ TotalAggregation: { ComputationId: 'a', Value: insightValueField() } }], 'UNSUPPORTED_FEATURE'],
    [[{ GrowthRate: { ComputationId: 'a', Time: insightDateField(), Value: insightValueField() } }], 'UNSUPPORTED_FEATURE'],
    [[{ PeriodOverPeriod: { ComputationId: 'a', Time: insightDateField(), Value: insightValueField() } }], 'UNSUPPORTED_FEATURE'],
    [[{ MetricComparison: { ComputationId: 'a', Time: insightDateField(), FromValue: insightValueField(), TargetValue: insightValueField('profit', 'profit') } }], 'UNSUPPORTED_FEATURE'],
  ]) assert.throws(() => planVisual(insightRequest(computations)), { code }, JSON.stringify(computations).slice(0, 120));
});
