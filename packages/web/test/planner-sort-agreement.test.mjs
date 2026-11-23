import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planVisual, evaluatePlan } from '@opensight/query-engine/browser';
import { compileVisual, CompileError } from '../build/test/compiler.js';
import sales from '../src/sales.generated.json' with { type: 'json' };

// Issue #319: definitions the native planner admits under a CategorySort,
// CategoryItemsLimit or RowSort admission must compile in the web renderer,
// and definitions the renderer rejects must fail at planning time instead
// of executing first and failing at compile or export.

const fixtureRoot = fileURLToPath(new URL('../../../fixtures/renderable-sales/', import.meta.url));
const json = (name) => JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8'));

function request(visualId) {
  return { analysis: json('analysis.json'), dataSet: json('describe-data-set.response.json'),
    dataSource: json('describe-data-source.response.json'), localData: json('local-data.json'), visualId };
}
function body(r) {
  return Object.values(r.analysis.Definition.Sheets[0].Visuals.find((v) => Object.values(v)[0].VisualId === r.visualId))[0];
}
function wells(r) {
  const w = body(r).ChartConfiguration.FieldWells;
  return Object.values(w)[0];
}
function visual(r) {
  return r.analysis.Definition.Sheets[0].Visuals.find((v) => Object.values(v)[0].VisualId === r.visualId);
}
const dimension = (name, fieldId = name) => ({ CategoricalDimensionField: {
  FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: name } } });
const measure = (name, aggregation = 'SUM', fieldId = name) => ({ NumericalMeasureField: {
  FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: name },
  AggregationFunction: { SimpleNumericalAggregation: aggregation } } });

function barRequest() {
  const r = request('revenue-by-region');
  r.analysis.Definition.FilterGroups = [];
  wells(r).Category = [dimension('region', 'category-id')];
  wells(r).Values = [measure('revenue', 'SUM', 'primary-id')];
  body(r).ChartConfiguration.SortConfiguration = { CategorySort: [{ AggregationSort: {
    FieldId: 'category-id', Direction: 'DESC',
    Column: { DataSetIdentifier: 'sales_data', ColumnName: 'revenue' },
    AggregationFunction: { NumericalAggregationFunction: { SimpleNumericalAggregation: 'SUM' } },
  } }] };
  return r;
}

function pieRequest() {
  const r = request('share-by-category');
  r.analysis.Definition.FilterGroups = [];
  wells(r).Category = [dimension('category', 'category-id')];
  wells(r).Values = [measure('revenue', 'SUM', 'primary-id')];
  body(r).ChartConfiguration.SortConfiguration = { CategoryItemsLimit: { ItemsLimit: 2, OtherCategories: 'INCLUDE' } };
  return r;
}

function tableRequest() {
  const r = request('sales-table');
  r.analysis.Definition.FilterGroups = [];
  wells(r).GroupBy = [dimension('region', 'group-id')];
  wells(r).Values = [measure('revenue', 'SUM', 'primary-id'), measure('discounted_revenue', 'SUM', 'calculated-id')];
  body(r).ChartConfiguration.SortConfiguration = { RowSort: [{ FieldSort: { FieldId: 'group-id', Direction: 'ASC' } }] };
  return r;
}

const bindingsFor = (r) => Object.fromEntries(
  [...wells(r).Category ?? [], ...wells(r).GroupBy ?? [], ...wells(r).Values]
    .map((f) => { const inner = Object.values(f)[0]; return [inner.FieldId, inner.FieldId]; }));

for (const [name, make] of [['bar with CategorySort', barRequest], ['pie with CategoryItemsLimit', pieRequest], ['table with RowSort', tableRequest]]) {
  test(`planner-admitted definition compiles in the renderer: ${name}`, () => {
    const r = make();
    const plan = planVisual(r);
    const rows = evaluatePlan(plan, sales.rows);
    assert.ok(rows.length, 'native execution must produce rows');
    const compiled = compileVisual({ source: 'api', definition: visual(r), rows, path: '$', bindings: bindingsFor(r) });
    assert.equal(compiled.state, 'ready');
  });
}

test('renderer-rejected definition fails at planning time, not after execution (issue #319)', () => {
  const r = barRequest();
  wells(r).Values.push(measure('discounted_revenue', 'AVG', 'secondary-id'));
  assert.throws(() => planVisual(r), { name: 'QueryEngineError', code: 'UNSUPPORTED_FEATURE' });
  assert.throws(
    () => compileVisual({ source: 'api', definition: visual(r), rows: [], path: '$', bindings: bindingsFor(r) }),
    (error) => error instanceof CompileError && /only explicit SUM result bindings are supported/.test(error.message),
  );
});
