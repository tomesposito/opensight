import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthorCanvas } from '../build/test/Author.js';
import { activeSheet, authorReducer, emptyDraft, serializeDraft, serializeVisual, validateDraft, capabilityNote, authorVisualProblem } from '../build/test/authoring.js';
import { importBundle, exportBundle } from '../build/test/bundle-authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { compileVisual } from '../build/test/compiler.js';
import { convertDefinition } from '../build/test/definition-converter.js';
const add = () => authorReducer(emptyDraft(), { type: 'add', kind: 'insight' });
const visual = d => activeSheet(d).visuals[0];
const bundleOf = resource => ({ members: [{ path: 'analysis/authored-analysis.json', resource }] });
const compile = d => compileVisual({ source: 'bundle', rows: null, definition: serializeVisual(visual(d)), path: '$', bindings: {} });
const nativeApi = () => ({ DataSetIdentifierDeclarations: [{ Identifier: 'opensight_local_sales', DataSetArn: 'arn:aws:quicksight:us-east-1:123456789012:dataset/renderable-sales' }], Sheets: [{ SheetId: 's', Visuals: [{ InsightVisual: {
  VisualId: 'i', DataSetIdentifier: 'opensight_local_sales', InsightConfiguration: { Computations: [{ TopBottomRanked: { ComputationId: 'rank', Type: 'TOP', ResultSize: 2,
    Category: { CategoricalDimensionField: { FieldId: 'region-id', Column: { ColumnName: 'region', DataSetIdentifier: 'opensight_local_sales' } } },
    Value: { NumericalMeasureField: { FieldId: 'revenue-id', Column: { ColumnName: 'revenue', DataSetIdentifier: 'opensight_local_sales' }, AggregationFunction: { SimpleNumericalAggregation: 'SUM' } } },
  } }] },
} }] }] });
test('insight gallery, well labels, capability note and computation controls', () => {
  let draft = add();
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft, dispatch() {} }));
  for (const label of ['Category', 'Values']) assert.ok(html.includes(`aria-label="Assign ${label}"`));
  assert.ok(html.includes(capabilityNote('insight'))); assert.match(html, /optional second measure/); assert.match(html, /Narrative computation/);
  assert.doesNotMatch(html, /Show legend|Show data labels/);
  draft = authorReducer(draft, { type: 'assign', field: 'profit', well: 'values' }); validateDraft(draft);
  assert.deepEqual(visual(draft).measures, ['revenue', 'profit']); assert.deepEqual(buildAuthorQuery(visual(draft)).measures.map(m => m.columnName), ['revenue', 'profit']);
  const bundle = bundleOf(serializeDraft(draft)), imported = importBundle(bundle);
  assert.deepEqual(visual(imported).imported.issues, []); assert.deepEqual(exportBundle(imported), bundle);
});
test('insight wells replace categories, cap measures at two and fail on missing required wells', () => {
  let draft = add(); draft = authorReducer(draft, { type: 'assign', field: 'order_date', well: 'dimension' });
  draft = authorReducer(draft, { type: 'assign', field: 'profit', well: 'values' });
  assert.equal(visual(draft).dimension, 'order_date'); assert.equal(compile(draft).model.dimensions[0].dateGranularity, 'MONTH');
  draft = authorReducer(draft, { type: 'unassign', field: 'revenue', well: 'values' });
  draft = authorReducer(draft, { type: 'unassign', field: 'profit', well: 'values' }); validateDraft(draft);
  assert.throws(() => compile(draft), /INSIGHT_VALUES_REQUIRED/);
  draft = add(); draft = authorReducer(draft, { type: 'unassign', field: 'region', well: 'dimension' });
  assert.throws(() => compile(draft), /INSIGHT_CATEGORY_REQUIRED/);
});
test('native InsightVisual computations hydrate wells, render equally in both dialects, and round-trip', () => {
  const api = nativeApi(), resource = serializeDraft(add()); resource.definition = convertDefinition(api);
  const bundle = bundleOf(resource), imported = importBundle(bundle);
  assert.equal(visual(imported).kind, 'insight'); assert.deepEqual(visual(imported).imported.issues, []);
  assert.equal(visual(imported).dimension, 'region'); assert.deepEqual(visual(imported).measures, ['revenue']);
  assert.ok(buildAuthorQuery(visual(imported))); assert.deepEqual(exportBundle(imported), bundle);
  const rows = [{ region: 'East', revenue: 4 }, { region: 'West', revenue: 7 }];
  const direct = compileVisual({ source: 'api', definition: api.Sheets[0].Visuals[0], rows, bindings: {}, path: '$' });
  const projected = compileVisual({ source: 'bundle', definition: serializeVisual(visual(imported)), rows, bindings: {}, path: '$' });
  assert.equal(direct.narrative.text, projected.narrative.text);
  const changed = authorReducer(imported, { type: 'assign', field: 'category', well: 'dimension' });
  assert.equal(compile(changed).model.dimensions[0].column, 'category');
});
test('unsupported native computations and properties appear in import reports, block queries, and retain originals', () => {
  for (const [change, code] of [
    [c => { c.Computations = [{ Forecast: { ComputationId: 'forecast' } }]; }, 'INSIGHT_FORECAST_UNSUPPORTED'],
    [c => { c.CustomNarrative = { Narrative: '${forecast.result}' }; }, 'INSIGHT_CUSTOM_NARRATIVE_UNSUPPORTED'],
    [c => { c.Computations = [{ GrowthRate: { ComputationId: 'growth', Time: c.Computations[0].TopBottomRanked.Category, Value: c.Computations[0].TopBottomRanked.Value } }]; }, 'INSIGHT_TIME_REQUIRED'],
    [c => { c.NativeFutureOption = true; }, 'INSIGHT_CONFIGURATION_UNSUPPORTED'],
    [c => { c.Computations[0].TopBottomRanked.Value.NumericalMeasureField.Column = {}; }, 'expected a nonempty string'],
  ]) {
    const api = nativeApi(); change(api.Sheets[0].Visuals[0].InsightVisual.InsightConfiguration);
    const resource = serializeDraft(add()); resource.definition = convertDefinition(api);
    const bundle = bundleOf(resource), imported = importBundle(bundle);
    assert.ok(JSON.stringify(imported.bundle.report).includes(code), JSON.stringify(imported.bundle.report));
    assert.match(authorVisualProblem(visual(imported)), /Unsupported features/);
    assert.equal(buildAuthorQuery(visual(imported)), null); assert.deepEqual(exportBundle(imported), bundle);
  }
});
test('native time and metric computations retain field identities and cannot reference unbound fields', () => {
  const api = nativeApi(), b = api.Sheets[0].Visuals[0].InsightVisual;
  const first = b.InsightConfiguration.Computations[0].TopBottomRanked;
  const Time = { DateDimensionField: { FieldId: 'month', DateGranularity: 'MONTH', Column: { ColumnName: 'order_date', DataSetIdentifier: 'opensight_local_sales' } } };
  const Value = first.Value, TargetValue = structuredClone(Value);
  TargetValue.NumericalMeasureField.FieldId = 'profit'; TargetValue.NumericalMeasureField.Column.ColumnName = 'profit';
  b.InsightConfiguration.Computations = [
    { TotalAggregation: { ComputationId: 'total', Value } },
    { MaximumMinimum: { ComputationId: 'max', Type: 'MAXIMUM', Time, Value } },
    { GrowthRate: { ComputationId: 'growth', PeriodSize: 2, Time, Value } },
    { PeriodOverPeriod: { ComputationId: 'period', Time, Value } },
    { MetricComparison: { ComputationId: 'comparison', Time, FromValue: Value, TargetValue } },
  ];
  const rows = [{ month: '2024-01-01', revenue: 100, profit: 20 }, { month: '2024-02-01', revenue: 150, profit: 30 }];
  const input = { source: 'api', definition: api.Sheets[0].Visuals[0], rows, path: '$', bindings: { month: 'month' } };
  const c = compileVisual(input); assert.match(c.narrative.text, /change 50 \(50.00%\)/); assert.match(c.narrative.text, /difference 200 \(400.00%\)/);
  const resource = serializeDraft(add()); resource.definition = convertDefinition(api);
  const bundle = bundleOf(resource), imported = importBundle(bundle);
  assert.deepEqual(visual(imported).imported.issues, []); assert.equal(visual(imported).dateGrain ?? 'MONTH', 'MONTH');
  assert.deepEqual(exportBundle(imported), bundle);
  const projection = JSON.parse(JSON.stringify(serializeVisual(visual(imported))));
  projection.insightVisual.insightConfiguration.computations[0].totalAggregation.value.numericalMeasureField.column.columnName = 'missing';
  assert.throws(() => compileVisual({ source: 'bundle', definition: projection, rows: null, path: '$', bindings: {} }), /INSIGHT_FIELD_UNBOUND/);
});
test('builder insight presets persist ranked N and block unsupported definitions during compilation', () => {
  let draft = add();
  draft = authorReducer(draft, { type: 'insight', configuration: { computations: [{ topBottomRanked: { computationId: 'top', type: 'TOP', resultSize: 7 } }] } });
  validateDraft(draft);
  const bundle = bundleOf(serializeDraft(draft)); const imported = importBundle(bundle);
  assert.deepEqual(visual(imported).imported.issues, []); assert.deepEqual(exportBundle(imported), bundle);
  assert.equal(visual(imported).insightConfiguration.computations[0].topBottomRanked.resultSize, 7);
  draft = authorReducer(draft, { type: 'insight', configuration: { computations: [{ forecast: { computationId: 'f' } }] } });
  assert.doesNotThrow(() => serializeVisual(visual(draft)));
  assert.throws(() => compile(draft), /INSIGHT_FORECAST_UNSUPPORTED/);
});
