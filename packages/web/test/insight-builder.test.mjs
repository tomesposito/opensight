import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthorCanvas } from '../build/test/Author.js';
import { activeSheet, authorReducer, emptyDraft, serializeDraft, serializeVisual, validateDraft, capabilityNote, authorVisualProblem } from '../build/test/authoring.js';
import { importBundle, exportBundle } from '../build/test/bundle-authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { compileVisual } from '../build/test/compiler.js';
import { convertDefinition } from '../build/test/definition-converter.js';
import { normalizeInsight, rebindInsight } from '../build/test/insight-configuration.js';
import { DEFAULT_FORECAST_CONFIG } from '../build/test/forecast.js';
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
    [c => { c.Computations = [{ Forecast: { ComputationId: 'forecast', Time: c.Computations[0].TopBottomRanked.Category, Value: c.Computations[0].TopBottomRanked.Value } }]; }, 'INSIGHT_TIME_REQUIRED'],
    // Preserve the native parameter rejection alongside the subset acceptance below.
    [c => { c.CustomNarrative = { Narrative: '${forecast.result}' }; }, 'INSIGHT_CUSTOM_NARRATIVE_UNSUPPORTED'],
    [c => { c.Computations = [{ GrowthRate: { ComputationId: 'growth', Time: c.Computations[0].TopBottomRanked.Category, Value: c.Computations[0].TopBottomRanked.Value } }]; }, 'INSIGHT_TIME_REQUIRED'],
    [c => { c.NativeFutureOption = true; }, 'INSIGHT_CONFIGURATION_UNSUPPORTED'],
    [c => { c.Computations[0].TopBottomRanked.Value.NumericalMeasureField.Column = {}; }, 'INSIGHT_FIELD_UNBOUND'],
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
  assert.throws(() => compile(draft), /INSIGHT_TIME_REQUIRED/);
});

test('rebinding and author serialization preserve malformed bindings for compiler rejection (issue #297)', () => {
  const dim = name => ({ categoricalDimensionField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'sales_data' } } });
  const value = name => ({ numericalMeasureField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'sales_data' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
  for (const [kind, slot] of [['uniqueValues', 'category'], ['forecast', 'time'], ['totalAggregation', 'value'], ['metricComparison', 'fromValue'], ['metricComparison', 'targetValue']]) {
    for (const malformed of [{ unsupportedDimensionField: {} }, { ...value('revenue'), extra: {} }, { numericalMeasureField: { ...value('revenue').numericalMeasureField, aggregationFunction: { simpleNumericalAggregation: 'AVERAGE' } } }]) {
      const configuration = { computations: [{ [kind]: { computationId: 'c', [slot]: malformed } }] };
      const before = structuredClone(configuration);
      assert.strictEqual(rebindInsight(configuration, [dim('category')], [value('profit')]), configuration, `${kind}.${slot}`);
      assert.deepEqual(configuration, before);
      const d = add(); visual(d).insightConfiguration = configuration;
      assert.throws(() => validateDraft(d), /Invalid or unsupported author draft/);
      const definition = serializeVisual(visual(d));
      assert.deepEqual(definition.insightVisual.insightConfiguration, before);
      assert.throws(() => compileVisual({ source: 'bundle', definition, rows: null, path: '$', bindings: {} }), /INSIGHT_(FIELD_UNBOUND|CONFIGURATION_UNSUPPORTED)/);
    }
  }
});

test('well-independent insight bindings remain saveable in unfinished drafts (issue #297)', () => {
  const category = { categoricalDimensionField: { fieldId: 'old-category', column: { columnName: 'missing-category', dataSetIdentifier: 'old-data' } } };
  const value = { numericalMeasureField: { fieldId: 'old-value', column: { columnName: 'missing-value', dataSetIdentifier: 'old-data' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } };
  const configuration = { computations: [{ topBottomRanked: { computationId: 'c', type: 'TOP', category, value } }] };
  const d = add(); Object.assign(visual(d), { dimension: null, measures: [], insightConfiguration: configuration });
  assert.doesNotThrow(() => validateDraft(d));
  assert.deepEqual(serializeVisual(visual(d)).insightVisual.insightConfiguration, configuration);
  assert.throws(() => normalizeInsight(configuration, [{ id: 'region', column: 'region', dataSet: 'sales_data' }], [{ id: 'revenue', column: 'revenue', dataSet: 'sales_data' }]), /INSIGHT_FIELD_UNBOUND/);
  assert.equal(buildAuthorQuery(visual(d)), null);
});

test('forecast authoring option dispatches the preset and round-trips through normalization and bundles', async t => {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, action;
  let draft = authorReducer(add(), { type: 'assign', field: 'order_date', well: 'dimension' });
  t.after(async () => { if (renderer) await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  await act(() => { renderer = create(createElement(AuthorCanvas, { draft, dispatch: a => { action = a; } })); });
  const select = renderer.root.findByProps({ 'aria-label': 'Narrative computation' });
  assert.equal(select.findAllByType('option').find(n => n.props.value === 'forecast').props.children, 'Forecast (date required)');
  await act(() => select.props.onChange({ target: { value: 'forecast' } }));
  const configuration = { computations: [{ forecast: { computationId: 'forecast' } }] };
  assert.deepEqual(action, { type: 'insight', configuration });
  draft = authorReducer(draft, action); validateDraft(draft);
  const model = compile(draft).model;
  assert.deepEqual(normalizeInsight(model.insightConfiguration, model.dimensions, model.measures), [{ kind: 'forecast', id: 'forecast', measure: 0, forecast: DEFAULT_FORECAST_CONFIG }]);
  const bundle = bundleOf(serializeDraft(draft)), imported = importBundle(bundle);
  assert.deepEqual(visual(imported).imported.issues, []);
  assert.deepEqual(visual(imported).insightConfiguration, configuration);
  assert.deepEqual(exportBundle(imported), bundle);
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft: imported, dispatch() {} }));
  assert.match(html, /value="forecast" selected=""/);
});

test('period-to-date authoring preset dispatches, serializes and round-trips with the bound-grain default', async t => {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, action;
  let draft = authorReducer(add(), { type: 'assign', field: 'order_date', well: 'dimension' });
  t.after(async () => { if (renderer) await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  await act(() => { renderer = create(createElement(AuthorCanvas, { draft, dispatch: a => { action = a; } })); });
  const select = renderer.root.findByProps({ 'aria-label': 'Narrative computation' });
  assert.equal(select.findAllByType('option').find(n => n.props.value === 'periodToDate').props.children, 'Period to date (date required)');
  await act(() => select.props.onChange({ target: { value: 'periodToDate' } }));
  const configuration = { computations: [{ periodToDate: { computationId: 'periodToDate' } }] };
  assert.deepEqual(action, { type: 'insight', configuration });
  draft = authorReducer(draft, action); validateDraft(draft);
  assert.deepEqual(serializeVisual(visual(draft)).insightVisual.insightConfiguration, configuration);
  const model = compile(draft).model;
  assert.deepEqual(normalizeInsight(model.insightConfiguration, model.dimensions, model.measures), [{ kind: 'periodToDate', id: 'periodToDate', measure: 0, periodTimeGranularity: 'MONTH' }]);
  const bundle = bundleOf(serializeDraft(draft)), imported = importBundle(bundle);
  assert.deepEqual(visual(imported).imported.issues, []);
  assert.deepEqual(visual(imported).insightConfiguration, configuration);
  assert.deepEqual(exportBundle(imported), bundle);
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft: imported, dispatch() {} }));
  assert.match(html, /value="periodToDate" selected=""/);

  // Selecting the same preset on a categorical insight keeps the existing honest error state.
  const categorical = authorReducer(add(), action); validateDraft(categorical);
  assert.doesNotThrow(() => serializeVisual(visual(categorical)));
  assert.throws(() => compile(categorical), /INSIGHT_TIME_REQUIRED/);
  await act(() => renderer.update(createElement(AuthorCanvas, { draft: categorical, dispatch() {} })));
  assert.match(JSON.stringify(renderer.toJSON()), /INSIGHT_TIME_REQUIRED/);
});

test('unique-values authoring preset dispatches, serializes and round-trips', async t => {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, action;
  let draft = add();
  t.after(async () => { if (renderer) await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  await act(() => { renderer = create(createElement(AuthorCanvas, { draft, dispatch: a => { action = a; } })); });
  const select = renderer.root.findByProps({ 'aria-label': 'Narrative computation' });
  assert.equal(select.findAllByType('option').find(n => n.props.value === 'uniqueValues').props.children, 'Unique values');
  await act(() => select.props.onChange({ target: { value: 'uniqueValues' } }));
  const configuration = { computations: [{ uniqueValues: { computationId: 'uniqueValues' } }] };
  assert.deepEqual(action, { type: 'insight', configuration });
  draft = authorReducer(draft, action); validateDraft(draft);
  assert.deepEqual(serializeVisual(visual(draft)).insightVisual.insightConfiguration, configuration);
  const model = compile(draft).model;
  assert.deepEqual(normalizeInsight(model.insightConfiguration, model.dimensions, model.measures), [{ kind: 'uniqueValues', id: 'uniqueValues', measure: 0 }]);
  const bundle = bundleOf(serializeDraft(draft)), imported = importBundle(bundle);
  assert.deepEqual(visual(imported).imported.issues, []);
  assert.deepEqual(visual(imported).insightConfiguration, configuration);
  assert.deepEqual(exportBundle(imported), bundle);
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft: imported, dispatch() {} }));
  assert.match(html, /value="uniqueValues" selected=""/);
});

test('anomaly authoring preset dispatches, serializes and round-trips with the default detection options', async t => {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, action;
  let draft = authorReducer(add(), { type: 'assign', field: 'order_date', well: 'dimension' });
  t.after(async () => { if (renderer) await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  await act(() => { renderer = create(createElement(AuthorCanvas, { draft, dispatch: a => { action = a; } })); });
  const select = renderer.root.findByProps({ 'aria-label': 'Narrative computation' });
  assert.equal(select.findAllByType('option').find(n => n.props.value === 'anomaly').props.children, 'Anomaly (date required)');
  await act(() => select.props.onChange({ target: { value: 'anomaly' } }));
  const configuration = { computations: [{ anomaly: { computationId: 'anomaly' } }] };
  assert.deepEqual(action, { type: 'insight', configuration });
  draft = authorReducer(draft, action); validateDraft(draft);
  assert.deepEqual(serializeVisual(visual(draft)).insightVisual.insightConfiguration, configuration);
  const model = compile(draft).model;
  assert.deepEqual(normalizeInsight(model.insightConfiguration, model.dimensions, model.measures), [{ kind: 'anomaly', id: 'anomaly', measure: 0, anomalyDetection: { direction: 'BOTH' } }]);
  const bundle = bundleOf(serializeDraft(draft)), imported = importBundle(bundle);
  assert.deepEqual(visual(imported).imported.issues, []);
  assert.deepEqual(visual(imported).insightConfiguration, configuration);
  assert.deepEqual(exportBundle(imported), bundle);
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft: imported, dispatch() {} }));
  assert.match(html, /value="anomaly" selected=""/);

  // Selecting the same preset on a categorical insight keeps the existing honest error state.
  const categorical = authorReducer(add(), action); validateDraft(categorical);
  assert.doesNotThrow(() => serializeVisual(visual(categorical)));
  assert.throws(() => compile(categorical), /INSIGHT_TIME_REQUIRED/);
  await act(() => renderer.update(createElement(AuthorCanvas, { draft: categorical, dispatch() {} })));
  assert.match(JSON.stringify(renderer.toJSON()), /INSIGHT_TIME_REQUIRED/);
});

test('custom narrative editor inserts catalog/field placeholders and formats, round-trips, and clears only the template', async t => {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, lastAction;
  const computations = [{ totalAggregation: { computationId: 'sum', name: 'Total' } }, { topBottomRanked: { computationId: 'top', type: 'TOP', resultSize: 2 } }];
  let draft = authorReducer(add(), { type: 'insight', configuration: { computations } });
  const dispatch = action => { lastAction = action; draft = authorReducer(draft, action); };
  const update = () => renderer.update(createElement(AuthorCanvas, { draft, dispatch }));
  const control = label => renderer.root.findByProps({ 'aria-label': label });
  const change = async (label, value) => { await act(() => control(label).props.onChange({ target: { value } })); await act(update); };
  t.after(async () => { if (renderer) await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  await act(() => { renderer = create(createElement(AuthorCanvas, { draft, dispatch })); });
  const options = control('Insert placeholder').findAllByType('option').map(option => option.props.value);
  for (const option of ['Total.value', 'Total.formattedValue', 'top.itemsCount', 'top.items[0].category', 'top.items[0].value', 'field.revenue']) assert.ok(options.includes(option));
  assert.ok(!options.includes('sum.value')); assert.ok(!options.includes('field.region'));
  assert.deepEqual(control('Placeholder format').findAllByType('option').map(option => option.props.value), ['', 'decimals:0', 'decimals:2', 'percent:true', 'grouping:false']);
  await change('Custom narrative template', 'Revenue ');
  await change('Placeholder format', 'decimals:2');
  await change('Insert placeholder', 'Total.value');
  assert.deepEqual(lastAction, { type: 'insight', configuration: { computations, customNarrative: { narrative: 'Revenue {Total.value|decimals:2}' } } });
  await change('Custom narrative template', `${control('Custom narrative template').props.value}\n\nSum `);
  await change('Placeholder format', 'grouping:false');
  await change('Insert placeholder', 'field.revenue');
  validateDraft(draft);
  const template = 'Revenue {Total.value|decimals:2}\n\nSum {field.revenue|grouping:false}';
  assert.equal(visual(draft).insightConfiguration.customNarrative.narrative, template);
  const bundle = bundleOf(serializeDraft(draft)), imported = importBundle(bundle);
  assert.deepEqual(visual(imported).imported.issues, []); assert.deepEqual(exportBundle(imported), bundle);
  const rows = [{ region: 'East', revenue: 1234.5 }];
  const compileRows = d => compileVisual({ source: 'bundle', rows, definition: serializeVisual(visual(d)), path: '$', bindings: {} });
  assert.equal(compileRows(draft).narrative.text, 'Revenue 1,234.50\n\nSum 1234.5');
  assert.deepEqual(compileRows(imported).narrative, compileRows(draft).narrative);
  await change('Custom narrative template', '');
  assert.deepEqual(lastAction, { type: 'insight', configuration: { computations } });
  assert.match(compileRows(draft).narrative.text, /Total revenue/);
});
