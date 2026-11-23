import test from 'node:test';
import assert from 'node:assert/strict';
import { planPreparedVisual, planVisual } from '@opensight/query-engine';
import { evaluatePlan } from '@opensight/query-engine/browser';
import { request } from './helpers.mjs';

// Issue #321: the renderer (normalizeInsight) accepts at most two distinct
// measures per Insight collection. The native planner must enforce the same
// collection cardinality before querying — per-computation validation cannot
// see it, because the third measure arrives through a different computation.

const dialects = ['duckdb', 'postgres', 'mysql', 'redshift', 'athena'];

const insightCatField = (fieldId = 'region', columnName = 'region') => ({ CategoricalDimensionField: { FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: columnName } } });
const insightValueField = (fieldId = 'revenue', columnName = 'revenue') => ({ NumericalMeasureField: { FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: columnName }, AggregationFunction: { SimpleNumericalAggregation: 'SUM' } } });

function insightRequest(computations, visualId = 'insight-1') {
  const r = request('revenue-trend');
  r.analysis.Definition.Sheets[0].Visuals = [{ InsightVisual: { VisualId: visualId, InsightConfiguration: { Computations: computations } } }];
  r.visualId = visualId;
  return r;
}

const mcComputation = (patch = {}) => ({ MetricComparison: { ComputationId: 'comparison', Time: insightCatField(), FromValue: insightValueField(), TargetValue: insightValueField('profit', 'profit'), ...patch } });
const mmComputation = (patch = {}) => ({ MaximumMinimum: { ComputationId: 'mm', Type: 'MAXIMUM', Time: insightCatField(), Value: insightValueField(), ...patch } });

const configPath = '$.analysis.Definition.Sheets[0].Visuals[0].InsightVisual.InsightConfiguration';

const rows = [
  { region: 'West', order_id: 1, revenue: 10, profit: 3 },
  { region: 'East', order_id: 2, revenue: 20, profit: 5 },
  { region: 'East', order_id: 3, revenue: 30, profit: 7 },
];

for (const dialect of dialects) {
  test(`MetricComparison plus a MaximumMinimum over a third measure fails at planning: ${dialect}`, () => {
    const r = insightRequest([
      mcComputation(),
      mmComputation({ ComputationId: 'mm-third', Value: insightValueField('order_id', 'order_id') }),
    ]);
    assert.throws(() => planVisual(r, { dialect }), { code: 'INVALID_INPUT', path: configPath });
  });

  test(`three MaximumMinimum computations over distinct measures fail at planning: ${dialect}`, () => {
    const r = insightRequest([
      mmComputation(),
      mmComputation({ ComputationId: 'mm-profit', Type: 'MINIMUM', Value: insightValueField('profit', 'profit') }),
      mmComputation({ ComputationId: 'mm-orders', Value: insightValueField('order_id', 'order_id') }),
    ]);
    assert.throws(() => planVisual(r, { dialect }), { code: 'INVALID_INPUT', path: configPath });
  });

  test(`exactly two distinct measures across mixed computations still plan and evaluate: ${dialect}`, () => {
    const r = insightRequest([
      mcComputation(),
      mmComputation({ ComputationId: 'mm-revenue', Value: insightValueField() }),
    ]);
    r.analysis.Definition.FilterGroups = [];
    const before = structuredClone(r);
    const plan = planVisual(r, { dialect });
    assert.deepEqual(r, before, 'planning must not mutate the definition');
    assert.deepEqual(plan.measures.map(m => m.fieldId), ['revenue', 'profit']);
    assert.deepEqual(evaluatePlan(plan, rows), [
      { region: 'East', revenue: 50, profit: 12 },
      { region: 'West', revenue: 10, profit: 3 },
    ]);
  });
}

test('the two-measure limit also binds on the prepared-visual path', () => {
  const r = insightRequest([
    mcComputation(),
    mmComputation({ ComputationId: 'mm-third', Value: insightValueField('order_id', 'order_id') }),
  ]);
  const schema = [
    { name: 'region', type: 'STRING' }, { name: 'revenue', type: 'DECIMAL' },
    { name: 'profit', type: 'DECIMAL' }, { name: 'order_id', type: 'INTEGER' },
  ];
  assert.throws(() => planPreparedVisual(schema, r.analysis, 'insight-1', r.localData.dataSetArn), { code: 'INVALID_INPUT', path: configPath });
});

test('a single-measure collection and a uniqueValues-only collection stay admitted', () => {
  const single = planVisual(insightRequest([mmComputation()]));
  assert.deepEqual(single.measures.map(m => m.fieldId), ['revenue']);
  const uniqueOnly = planVisual(insightRequest([
    { UniqueValues: { ComputationId: 'u', Category: insightCatField() } },
  ]));
  assert.deepEqual(uniqueOnly.measures.map(m => m.aggregation), ['COUNT'], 'uniqueValues-only keeps its plan-only COUNT carrier');
});
