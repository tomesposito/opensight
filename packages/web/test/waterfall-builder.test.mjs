import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthorCanvas } from '../build/test/Author.js';
import { activeSheet, authorReducer, emptyDraft, serializeDraft, serializeVisual, validateDraft, capabilityNote, authorVisualProblem } from '../build/test/authoring.js';
import { importBundle, exportBundle } from '../build/test/bundle-authoring.js';
import { buildAuthorQuery, loadAuthorRows } from '../build/test/author-query.js';
import { executeFixtureQuery } from '../build/test/fixture-query.js';
import { compileVisual } from '../build/test/compiler.js';
import { convertDefinition } from '../build/test/definition-converter.js';

const add = () => authorReducer(emptyDraft(), { type: 'add', kind: 'waterfall' });
const visual = d => activeSheet(d).visuals[0];
const bundleOf = resource => ({ members: [{ path: 'analysis/authored-analysis.json', resource }] });
const compile = (draft, rows = null) => compileVisual({ source: 'bundle', definition: serializeVisual(visual(draft)), rows, bindings: {}, path: '$' });
const nativeApi = definition => {
  const apiKeys = v => Array.isArray(v) ? v.map(apiKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), apiKeys(v)])) : v;
  const api = apiKeys(definition); delete api.Sheets[0].Layouts;
  const visuals = api.Sheets[0].Visuals[0]; visuals.WaterfallVisual = visuals.WaterfallChartVisual; delete visuals.WaterfallChartVisual;
  const wells = visuals.WaterfallVisual.ChartConfiguration.FieldWells.WaterfallChartAggregatedFieldWells;
  wells.Categories = wells.Category; delete wells.Category;
  return api;
};

test('waterfall gallery exposes Categories, Values and Breakdown, capability notes, and pinned preview totals', async () => {
  let draft = add();
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft, dispatch() {} }));
  for (const label of ['Categories', 'Values', 'Breakdown']) assert.ok(html.includes(`aria-label="Assign ${label}"`));
  assert.ok(html.includes(capabilityNote('waterfall'))); assert.match(html, /Show legend/);
  assert.equal(visual(draft).dimension, 'region'); assert.deepEqual(visual(draft).measures, ['revenue']);
  draft = authorReducer(draft, { type: 'assign', field: 'profit', well: 'values' }); validateDraft(draft);
  const query = buildAuthorQuery(visual(draft));
  assert.deepEqual(query.dimensions.map(d => d.columnName), ['region']); assert.deepEqual(query.measures.map(m => m.columnName), ['profit']);
  const result = executeFixtureQuery(query); assert.ok(result.rows, result.message);
  const c = compile(draft, result.rows), visible = c.option.series[1];
  assert.equal(visible.data.at(-1).delta, result.rows.reduce((sum, r) => sum + r.profit, 0));
  // The API and static paths pass the same query and rows to the shared compiler.
  const requests = [];
  const loaded = await loadAuthorRows({ queryDataset: async (id, request) => { assert.equal(id, 'sales'); requests.push(request); return { rows: result.rows }; } }, query, new AbortController().signal);
  assert.deepEqual(requests, [query]); assert.deepEqual(compile(draft, loaded.rows).table, c.table);
  const bundle = bundleOf(serializeDraft(draft)), imported = importBundle(bundle);
  assert.deepEqual(visual(imported).imported.issues, []); assert.deepEqual(exportBundle(imported), bundle);
});

test('waterfall replacement, removal and type changes keep one dimension and measure', () => {
  let draft = add();
  for (const field of ['category', 'order_date']) draft = authorReducer(draft, { type: 'assign', field, well: 'dimension' });
  assert.equal(visual(draft).dimension, 'order_date');
  draft = authorReducer(draft, { type: 'kind', kind: 'pivot' });
  draft = authorReducer(draft, { type: 'assign', field: 'region', well: 'rows' });
  draft = authorReducer(draft, { type: 'assign', field: 'profit', well: 'values' });
  assert.equal(visual(draft).rows.length, 2); assert.equal(visual(draft).measures.length, 2);
  draft = authorReducer(draft, { type: 'kind', kind: 'waterfall' }); validateDraft(draft);
  assert.equal(visual(draft).dimension, 'order_date'); assert.deepEqual(visual(draft).measures, ['revenue']);
  assert.deepEqual(visual(draft).rows, []); assert.deepEqual(visual(draft).columns, []);
  for (const [field, well, error] of [['order_date', 'dimension', 'CATEGORY'], ['revenue', 'values', 'VALUES']]) {
    const removed = authorReducer(draft, { type: 'unassign', field, well }); validateDraft(removed);
    assert.throws(() => compile(removed), new RegExp(`WATERFALL_${error}_REQUIRED`));
  }
});

test('waterfall breakdown well assigns, validates, queries, previews, and round-trips', () => {
  let draft = add();
  draft = authorReducer(draft, { type: 'assign', field: 'category', well: 'breakdown' });
  assert.deepEqual(visual(draft).breakdowns, ['category']);
  // Measures are refused on the breakdown well; the previous value stands.
  draft = authorReducer(draft, { type: 'assign', field: 'profit', well: 'breakdown' });
  assert.deepEqual(visual(draft).breakdowns, ['category']);
  draft = authorReducer(draft, { type: 'assign', field: 'order_date', well: 'breakdown' });
  assert.deepEqual(visual(draft).breakdowns, ['order_date']);
  draft = authorReducer(draft, { type: 'unassign', field: 'order_date', well: 'breakdown' });
  assert.deepEqual(visual(draft).breakdowns, []);
  // Other kinds refuse the well; a smuggled value fails closed with a named error.
  let bar = authorReducer(emptyDraft(), { type: 'add', kind: 'bar' });
  bar = authorReducer(bar, { type: 'assign', field: 'category', well: 'breakdown' });
  assert.equal(visual(bar).breakdowns, undefined);
  assert.match(authorVisualProblem({ ...visual(bar), breakdowns: ['category'] }), /BREAKDOWNS_UNSUPPORTED/);
  assert.match(authorVisualProblem({ ...visual(bar), breakdowns: ['a', 'b'] }), /BREAKDOWNS_UNSUPPORTED/);
  // The query groups by (dimension, breakdown); preview shows real values.
  draft = authorReducer(draft, { type: 'assign', field: 'category', well: 'breakdown' });
  assert.equal(authorVisualProblem(visual(draft)), undefined);
  const query = buildAuthorQuery(visual(draft));
  assert.deepEqual(query.dimensions.map(d => d.columnName), ['region', 'category']);
  const result = executeFixtureQuery(query); assert.ok(result.rows, result.message);
  const regions = [...new Set(result.rows.map(r => r.region))], categories = [...new Set(result.rows.map(r => r.category))];
  const sum = (region, category) => result.rows.filter(r => r.region === region && r.category === category).reduce((s, r) => s + (r.revenue ?? 0), 0);
  const c = compile(draft, result.rows), [assist, visible] = c.option.series;
  assert.equal(visible.data.length, 1 + (regions.length - 1) * (1 + categories.length));
  assert.ok(!c.option.xAxis.data.includes('Total'));
  // First bar is the first region's subtotal; last bar is the grand total.
  assert.equal(visible.data[0].delta, regions.reduce((s, r) => s + categories.reduce((t, cat) => t + sum(r, cat), 0), 0) - regions.slice(1).reduce((s, r) => s + categories.reduce((t, cat) => t + sum(r, cat), 0), 0));
  assert.equal(visible.data.at(-1).delta, result.rows.reduce((s, r) => s + (r.revenue ?? 0), 0));
  assert.equal(assist.data[0], 0); assert.equal(assist.data.at(-1), 0);
  assert.equal(visible.data[0].itemStyle.color, '#2673c9'); assert.equal(visible.data.at(-1).itemStyle.color, '#2673c9');
  // Subtotals draw from zero; delta bars float from the running total.
  const subtotalAt = i => assist.data[i] === 0;
  assert.ok(subtotalAt(0) && subtotalAt(visible.data.length - 1));
  // Serialization writes the Breakdowns well; the draft round-trips cleanly.
  const serialized = serializeVisual(visual(draft));
  assert.deepEqual(Object.keys(serialized.waterfallChartVisual.chartConfiguration.fieldWells.waterfallChartAggregatedFieldWells).sort(), ['breakdowns', 'category', 'values']);
  const bundle = bundleOf(serializeDraft(draft)), roundTripped = importBundle(bundle);
  assert.deepEqual(visual(roundTripped).breakdowns, ['category']);
  assert.deepEqual(visual(roundTripped).imported.issues, []);
  assert.deepEqual(exportBundle(roundTripped), bundle);
});

test('waterfall imports report unsupported native options and bad wells, block queries, retain originals', () => {
  for (const [change, error] of [
    [c => { c.fieldWells.waterfallChartAggregatedFieldWells.category = []; }, /WATERFALL_CATEGORY_REQUIRED/],
    [c => { c.fieldWells.waterfallChartAggregatedFieldWells.values = []; }, /WATERFALL_VALUES_REQUIRED/],
    [c => { c.colorConfiguration = { positiveBarColor: '#ffffff' }; }, /colorConfiguration.*unsupported property/],
    [c => { c.waterfallChartOptions = { totalBarLabel: 'Net', totalBarVisibility: 'HIDDEN' }; }, /waterfallChartOptions.*unsupported property/],
    [c => { c.sortConfiguration = { breakdownItemsLimit: { itemsLimit: 5 } }; }, /breakdownItemsLimit.*unsupported property/],
    [c => { c.sortConfiguration = { categoryItemsLimit: {} }; }, /categoryItemsLimit.*unsupported property/],
    [c => { c.tooltip = { selectedTooltipType: 'DETAILED' }; }, /selectedTooltipType.*unsupported property/],
    [c => { c.primaryYAxisDisplayOptions = {}; }, /primaryYAxisDisplayOptions.*unsupported property/],
  ]) {
    const resource = serializeDraft(add()); change(resource.definition.sheets[0].visuals[0].waterfallChartVisual.chartConfiguration);
    const bundle = bundleOf(resource), imported = importBundle(bundle), report = JSON.stringify(imported.bundle.report);
    assert.match(report, /CompileError/); assert.match(report, error);
    assert.match(authorVisualProblem(visual(imported)), /Unsupported features/);
    assert.equal(buildAuthorQuery(visual(imported)), null); assert.deepEqual(exportBundle(imported), bundle);
  }
});

test('native WaterfallVisual Categories imports hydrate correctly; future options still fail closed', () => {
  const original = serializeDraft(add()), api = nativeApi(original.definition);
  const resource = { ...original, definition: convertDefinition(api) }, imported = importBundle(bundleOf(resource));
  assert.equal(visual(imported).kind, 'waterfall'); assert.equal(visual(imported).dimension, 'region');
  assert.deepEqual(visual(imported).measures, ['revenue']); assert.deepEqual(visual(imported).imported.issues, []);
  assert.ok(buildAuthorQuery(visual(imported)));
  const native = api.Sheets[0].Visuals[0];
  const data = [{ region: 'North', revenue: 7 }, { region: 'South', revenue: -9 }];
  const direct = compileVisual({ source: 'api', definition: native, rows: data, path: '$', bindings: {} });
  assert.deepEqual(direct.option, compile(imported, data).option);
  {
    // A native Breakdowns well now imports into draft state and renders the
    // interleaved layout instead of failing.
    const changed = structuredClone(api);
    const bdWell = changed.Sheets[0].Visuals[0].WaterfallVisual.ChartConfiguration.FieldWells.WaterfallChartAggregatedFieldWells;
    bdWell.Breakdowns = [{ CategoricalDimensionField: { FieldId: 'category', Column: { ColumnName: 'category', DataSetIdentifier: 'sales_data' } } }];
    const bundle = bundleOf({ ...original, definition: convertDefinition(changed) }), withBreakdown = importBundle(bundle);
    assert.deepEqual(visual(withBreakdown).breakdowns, ['category']);
    assert.deepEqual(visual(withBreakdown).imported.issues, []);
    assert.ok(buildAuthorQuery(visual(withBreakdown)));
    const serialized = serializeVisual(visual(withBreakdown));
    assert.deepEqual(Object.keys(serialized.waterfallChartVisual.chartConfiguration.fieldWells.waterfallChartAggregatedFieldWells).sort(), ['breakdowns', 'category', 'values']);
    assert.deepEqual(exportBundle(withBreakdown), bundle);
  }
  for (const change of [c => { c.NativeFutureOption = { KeepCase: true }; }]) {
    const changed = structuredClone(api); change(changed.Sheets[0].Visuals[0].WaterfallVisual.ChartConfiguration);
    const bundle = bundleOf({ ...original, definition: convertDefinition(changed) }), blocked = importBundle(bundle);
    assert.match(JSON.stringify(blocked.bundle.report), /CompileError.*NativeFutureOption.*unsupported property/);
    assert.equal(buildAuthorQuery(visual(blocked)), null); assert.deepEqual(exportBundle(blocked), bundle);
    assert.throws(() => compileVisual({ source: 'api', definition: changed.Sheets[0].Visuals[0], rows: null, path: '$', bindings: {} }), /NativeFutureOption.*unsupported property/);
  }
});
