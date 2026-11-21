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

const mmComputation = (patch = {}) => ({ MaximumMinimum: { ComputationId: 'mm', Type: 'MAXIMUM', Time: insightDateField(), Value: insightValueField(), ...patch } });
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
  for (const Type of ['MAXIMUM', 'MINIMUM']) {
    test(`MaximumMinimum ${Type} over a date dimension plans like the admitted anomaly series: ${dialect}`, () => {
      const baseline = planVisual(insightRequest([anomalyComputation()]), { dialect });
      const r = insightRequest([mmComputation({ Type, Name: 'Revenue extremes' })]);
      const actual = assertInvariant(r, dialect, baseline);
      assert.deepEqual(actual.dimensions.map(d => [d.columnName, d.outputName, d.granularity]), [['order_date', 'month', 'MONTH']]);
      assert.deepEqual(actual.measures.map(m => [m.columnName, m.outputName, m.aggregation]), [['revenue', 'revenue', 'SUM']]);
    });

    test(`MaximumMinimum ${Type} over a category dimension derives that category and the SUM measure: ${dialect}`, () => {
      // Clear the fixture's East filter so evaluation sees every region.
      const unfiltered = (computations) => { const q = insightRequest(computations); q.analysis.Definition.FilterGroups = []; return q; };
      const byMax = planVisual(unfiltered([mmComputation({ Type: 'MAXIMUM', Time: insightCatField() })]), { dialect });
      const r = unfiltered([mmComputation({ Type, Time: insightCatField() })]);
      const actual = assertInvariant(r, dialect, byMax);
      assert.deepEqual(actual.dimensions.map(d => [d.fieldId, d.columnName, d.outputName, d.granularity]), [['region', 'region', 'region', undefined]]);
      assert.deepEqual(actual.measures.map(m => [m.fieldId, m.columnName, m.aggregation]), [['revenue', 'revenue', 'SUM']]);
      assert.deepEqual(evaluatePlan(actual, rows), [
        { region: 'East', revenue: 50 },
        { region: 'North', revenue: null },
        { region: 'West', revenue: 10 },
      ], 'native results keep dimension order and null aggregates; the consumer picks the extreme group');
    });
  }

  test(`MaximumMinimum may omit Time or Value when a companion computation derives the same binding: ${dialect}`, () => {
    const baseline = planVisual(insightRequest([anomalyComputation()]), { dialect });
    const valueOnly = insightRequest([
      { MaximumMinimum: { ComputationId: 'mm', Type: 'MINIMUM', Value: insightValueField() } },
      { Forecast: { ComputationId: 'fc', Time: insightDateField(), Value: insightValueField() } },
    ]);
    assertInvariant(valueOnly, dialect, baseline);
    const timeOnly = insightRequest([
      { MaximumMinimum: { ComputationId: 'mm', Type: 'MAXIMUM', Time: insightDateField() } },
      { Forecast: { ComputationId: 'fc', Value: insightValueField() } },
    ]);
    assertInvariant(timeOnly, dialect, baseline);
  });
}

test('MaximumMinimum plans on the prepared-visual path', () => {
  const r = insightRequest([mmComputation({ Type: 'MINIMUM' })]);
  const analysis = structuredClone(r.analysis); analysis.Definition.FilterGroups = [];
  const prepared = planPreparedVisual([{ name: 'order_date', type: 'DATETIME' }, { name: 'revenue', type: 'DECIMAL' }], analysis, 'insight-1', r.localData.dataSetArn);
  assert.deepEqual(prepared.dimensions.map(d => d.outputName), ['month']);
  assert.deepEqual(prepared.measures.map(m => m.aggregation), ['SUM']);
});

test('MaximumMinimum rejects a missing or invalid Type with the type path', () => {
  for (const Type of [undefined, 'TOP', 'BOTTOM', 'maximum', null, 1]) {
    const patch = Type === undefined ? {} : { Type };
    const computation = mmComputation(patch);
    if (Type === undefined) delete computation.MaximumMinimum.Type;
    let error;
    try { planVisual(insightRequest([computation])); } catch (e) { error = e; }
    assert.ok(error, `expected a throw for Type=${String(Type)}`);
    assert.equal(error.code, 'INVALID_INPUT');
    assert.ok(error.path.endsWith('.Computations[0].MaximumMinimum.Type'), `unexpected path ${error.path}`);
  }
});

test('MaximumMinimum fails closed on malformed configuration and bindings', () => {
  for (const [computations, code] of [
    [[mmComputation({ Future: true })], 'UNSUPPORTED_FEATURE'],
    [[mmComputation({ Name: 1 })], 'INVALID_INPUT'],
    [[mmComputation({ ComputationId: 'bad id' })], 'INVALID_INPUT'],
    [[mmComputation(), mmComputation()], 'INVALID_INPUT'],
    // Time must be a date or category dimension field, bound to a matching column type.
    [[mmComputation({ Time: insightValueField() })], 'UNSUPPORTED_FEATURE'],
    [[mmComputation({ Time: insightDateField('region', 'region') })], 'TYPE_MISMATCH'],
    [[mmComputation({ Time: insightCatField('order_date', 'order_date') })], 'TYPE_MISMATCH'],
    [[mmComputation({ Time: insightDateField('order_date', 'order_date', 'WEEK') })], 'UNSUPPORTED_FEATURE'],
    [[mmComputation({ Time: insightDateField('missing', 'missing') })], 'UNRESOLVED_BINDING'],
    // Value keeps the shared insight measure rules.
    [[mmComputation({ Value: insightValueField('revenue', 'revenue', 'AVG') })], 'UNSUPPORTED_FEATURE'],
    [[mmComputation({ Value: insightValueField('missing', 'missing') })], 'UNRESOLVED_BINDING'],
    // The same field ID must bind consistently across computations.
    [[mmComputation(), mmComputation({ ComputationId: 'other', Time: insightDateField('order_date', 'order_date', 'DAY') })], 'UNRESOLVED_BINDING'],
    // Collection rules are unchanged: exactly one derived dimension, at least one measure.
    [[mmComputation(), { UniqueValues: { ComputationId: 'u', Category: insightCatField() } }], 'INVALID_INPUT'],
    [[{ MaximumMinimum: { ComputationId: 'mm', Type: 'MAXIMUM', Time: insightDateField() } }], 'INVALID_INPUT'],
    [[{ MaximumMinimum: { ComputationId: 'mm', Type: 'MAXIMUM', Value: insightValueField() } }], 'INVALID_INPUT'],
    // Movers still cannot combine with any other computation.
    [[mmComputation(), { TopBottomMovers: { ComputationId: 'm', Type: 'TOP', Category: insightCatField(), Time: insightDateField(), Value: insightValueField() } }], 'UNSUPPORTED_FEATURE'],
    // The remaining unadmitted kinds stay rejected.
    [[{ TotalAggregation: { ComputationId: 'a', Value: insightValueField() } }], 'UNSUPPORTED_FEATURE'],
  ]) assert.throws(() => planVisual(insightRequest(computations)), { code }, JSON.stringify(computations).slice(0, 120));
});
