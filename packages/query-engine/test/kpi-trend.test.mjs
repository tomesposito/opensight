import test from 'node:test';
import assert from 'node:assert/strict';
import { planVisual, evaluatePlan } from '@opensight/query-engine/browser';
import { request, wells, body, dimension } from './helpers.mjs';
test('native KPI trend wells produce grouped SUM rows across query dialects', () => {
  const r = request(); wells(r).TrendGroups = [dimension('region')];
  body(r).ChartConfiguration.SortConfiguration = { TrendGroupSort: [{ FieldSort: { FieldId: 'region', Direction: 'DESC' } }] };
  for (const dialect of ['duckdb', 'postgres']) {
    const plan = planVisual(r, { dialect });
    assert.equal(plan.dimensions[0].columnName, 'region');
    assert.match(plan.sql, /GROUP BY 1/);
    assert.deepEqual(evaluatePlan(plan, [{ region: 'East', revenue: 3 }, { region: 'East', revenue: 4 }, { region: 'West', revenue: 8 }]), [{ region: 'East', revenue: 7 }]);
  }
  wells(r).Values[0].NumericalMeasureField.AggregationFunction.SimpleNumericalAggregation = 'AVG';
  assert.throws(() => planVisual(r), /one SUM measure/);
});
