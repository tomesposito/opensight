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
import { measure } from './helpers.mjs';
test('native KPI target is a second SUM at the same grain in DuckDB, Postgres and fixture evaluation', () => {
  for (const trend of [false, true]) for (const wrapped of [false, true]) {
    const r = request(); wells(r).TargetValues = [measure('profit', 'SUM', 'target-id')];
    if (trend) wells(r).TrendGroups = [dimension('region')];
    if (wrapped) body(r).ChartConfiguration.FieldWells = { KPIFieldWells: wells(r) };
    for (const dialect of ['duckdb', 'postgres']) {
      const plan = planVisual(r, { dialect });
      assert.deepEqual(plan.dimensions.map(d => d.columnName), trend ? ['region'] : []);
      assert.deepEqual(plan.measures.map(m => [m.fieldId, m.columnName, m.aggregation]), [['revenue', 'revenue', 'SUM'], ['target-id', 'profit', 'SUM']]);
      assert.equal(/GROUP BY 1/.test(plan.sql), trend);
      assert.deepEqual(evaluatePlan(plan, [{ region: 'East', revenue: 3, profit: 2 }, { region: 'East', revenue: 4, profit: null }, { region: 'West', revenue: 8, profit: 5 }]), [{ ...(trend ? { region: 'East' } : {}), revenue: 7, 'target-id': 2 }]);
      assert.equal(evaluatePlan(plan, [{ region: 'East', revenue: 3, profit: null }])[0]['target-id'], null);
    }
  }
});
test('native KPI targets fail closed for malformed, multiple, unbound, duplicate and non-SUM targets', () => {
  for (const targets of [null, {}, [null], [dimension('region')], [measure('profit'), measure('revenue')], [measure('missing')], [measure('profit', 'SUM', 'revenue')], [measure('profit', 'AVG')]]) {
    const r = request(); wells(r).TargetValues = targets;
    assert.throws(() => planVisual(r));
  }
  const r = request(); wells(r).TrendGroups = [dimension('region')]; wells(r).TargetValues = [measure('profit', 'AVG')];
  assert.throws(() => planVisual(r), /SUM/);
});
