import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planVisual, evaluatePlan } from '@opensight/query-engine/browser';
import { normalizeInsight } from '../build/test/insight-configuration.js';

// Issue #321: an Insight collection the renderer rejects for deriving more
// than two distinct measures must fail in the native planner before
// querying, and every collection the planner admits on measure cardinality
// must pass the renderer's normalizeInsight check.

const fixtureRoot = fileURLToPath(new URL('../../../fixtures/renderable-sales/', import.meta.url));
const json = (name) => JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8'));

// Native (API) field shapes, as the planner consumes them.
const nativeCat = (fieldId = 'region', columnName = 'region') => ({ CategoricalDimensionField: { FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: columnName } } });
const nativeValue = (fieldId = 'revenue', columnName = 'revenue') => ({ NumericalMeasureField: { FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: columnName }, AggregationFunction: { SimpleNumericalAggregation: 'SUM' } } });
const nativeMc = () => ({ MetricComparison: { ComputationId: 'comparison', Time: nativeCat(), FromValue: nativeValue(), TargetValue: nativeValue('profit', 'profit') } });
const nativeMm = (id, value) => ({ MaximumMinimum: { ComputationId: id, Type: 'MAXIMUM', Time: nativeCat(), Value: value } });

function nativeRequest(computations) {
  const analysis = json('analysis.json');
  analysis.Definition.FilterGroups = [];
  analysis.Definition.Sheets[0].Visuals = [{ InsightVisual: { VisualId: 'insight-1', InsightConfiguration: { Computations: computations } } }];
  return { analysis, dataSet: json('describe-data-set.response.json'),
    dataSource: json('describe-data-source.response.json'), localData: json('local-data.json'), visualId: 'insight-1' };
}

// Web field shapes, as the renderer consumes them.
const webCat = (fieldId = 'region', columnName = 'region') => ({ categoricalDimensionField: { fieldId, column: { columnName, dataSetIdentifier: 'sales_data' } } });
const webValue = (fieldId = 'revenue', columnName = 'revenue') => ({ numericalMeasureField: { fieldId, column: { columnName, dataSetIdentifier: 'sales_data' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
const webMc = () => ({ metricComparison: { computationId: 'comparison', time: webCat(), fromValue: webValue(), targetValue: webValue('profit', 'profit') } });
const webMm = (id, value) => ({ maximumMinimum: { computationId: id, type: 'MAXIMUM', time: webCat(), value } });

const dimensionFields = [{ id: 'region', column: 'region', dataSet: 'sales_data' }];
const measureFields = (...names) => names.map(name => ({ id: name, column: name, dataSet: 'sales_data' }));

const rows = [
  { region: 'West', order_id: 1, revenue: 10, profit: 3 },
  { region: 'East', order_id: 2, revenue: 20, profit: 5 },
  { region: 'East', order_id: 3, revenue: 30, profit: 7 },
];

test('planner-admitted two-measure mixed collection passes the renderer', () => {
  const plan = planVisual(nativeRequest([nativeMc(), nativeMm('mm-revenue', nativeValue())]));
  assert.deepEqual(plan.measures.map(m => m.fieldId), ['revenue', 'profit']);
  assert.ok(evaluatePlan(plan, rows).length, 'native execution must produce rows');
  const requests = normalizeInsight(
    { computations: [webMc(), webMm('mm-revenue', webValue())] },
    dimensionFields, measureFields('revenue', 'profit'));
  assert.deepEqual(requests.map(r => [r.kind, r.measure, r.target]), [
    ['metricComparison', 0, 1], ['maximumMinimum', 0, undefined],
  ]);
});

test('renderer-rejected three-measure collections fail at planning time (issue #321)', () => {
  const cases = [
    {
      native: [nativeMc(), nativeMm('mm-third', nativeValue('order_id', 'order_id'))],
      web: [webMc(), webMm('mm-third', webValue('order_id', 'order_id'))],
      measures: ['revenue', 'profit', 'order_id'],
    },
    {
      native: [nativeMm('mm-revenue', nativeValue()), nativeMm('mm-profit', nativeValue('profit', 'profit')), nativeMm('mm-orders', nativeValue('order_id', 'order_id'))],
      web: [webMm('mm-revenue', webValue()), webMm('mm-profit', webValue('profit', 'profit')), webMm('mm-orders', webValue('order_id', 'order_id'))],
      measures: ['revenue', 'profit', 'order_id'],
    },
  ];
  for (const { native, web, measures } of cases) {
    // The renderer rejects the collection outright…
    assert.throws(() => normalizeInsight({ computations: web }, dimensionFields, measureFields(...measures)),
      (error) => error.code === 'INSIGHT_VALUES_REQUIRED');
    // …and the planner now rejects it first, before any query executes.
    assert.throws(() => planVisual(nativeRequest(native)),
      { code: 'INVALID_INPUT', path: '$.analysis.Definition.Sheets[0].Visuals[0].InsightVisual.InsightConfiguration' });
  }
});
