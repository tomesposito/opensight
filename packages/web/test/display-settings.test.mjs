import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseQsBundle } from '@opensight/bundle-parser';
import { activeSheet, authorReducer, emptyDraft, validateDraft, serializeDraft, serializeVisual } from '../build/test/authoring.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { compileVisual } from '../build/test/compiler.js';
import { importBundle, exportBundle, downloadBundleBytes } from '../build/test/bundle-authoring.js';
import { VisualCard } from '../build/test/VisualCard.js';
import { LEGEND_POSITIONS, hasLegend, hasDataLabels } from '../build/test/formatting.js';
import { init } from '../build/test/echarts.js';
import { convertDefinition } from '../build/test/definition-converter.js';
const add = kind => authorReducer(emptyDraft(), { type: 'add', kind });
const selected = d => activeSheet(d).visuals[0];
const input = (v, rows = [{ region: 'East', category: 'A', month: '2025-01', revenue: 12.345, profit: 5.5 }]) => ({ ...buildAuthorVisual(v), rows });

test('subtitle, title size, legend position, spacing and decimals survive reducer, storage and .qs edits', async () => {
  let d = add('bar');
  d = authorReducer(d, { type: 'subtitle', subtitle: '  Revenue by region <script>  ', visible: false });
  d = authorReducer(d, { type: 'formatting', formatting: { titleFontSize: 24, barCategoryGap: 35, decimalPlaces: 3, names: { revenue: 'Sales' } } });
  d = authorReducer(d, { type: 'legend-position', position: 'LEFT' });
  validateDraft(JSON.parse(JSON.stringify(d)));
  const bundle = await parseQsBundle(await downloadBundleBytes(d));
  const restored = importBundle(bundle);
  assert.equal(selected(restored).subtitle, selected(d).subtitle);
  assert.equal(selected(restored).subtitleVisible, false);
  assert.deepEqual(selected(restored).formatting, selected(d).formatting);
  assert.deepEqual(selected(restored).imported.issues, []);
  assert.deepEqual(exportBundle(restored), bundle);
  const body = bundle.members[0].resource.definition.sheets[0].visuals[0].barChartVisual;
  assert.deepEqual(body.subtitle, { visibility: 'HIDDEN', formatText: { plainText: selected(d).subtitle } });
  assert.equal(body.chartConfiguration.legend.position, 'LEFT');
  const edited = authorReducer(restored, { type: 'subtitle', subtitle: '', visible: true });
  assert.equal(selected(importBundle(exportBundle(edited))).subtitle, '');
  // A temporary kind change must retain options for a later return to the chart.
  const table = authorReducer(d, { type: 'kind', kind: 'table' });
  assert.deepEqual(selected(importBundle(exportBundle(table))).formatting, selected(d).formatting);
});

test('display settings validate at reducer, draft and compiler boundaries', () => {
  for (const f of [{ titleFontSize: 7 }, { titleFontSize: 49 }, { titleFontSize: 14.5 }, { barCategoryGap: -1 }, { barCategoryGap: 81 }, { barCategoryGap: NaN }, { decimalPlaces: -1 }, { legendPosition: 'center' }]) {
    const d = add('bar');
    assert.equal(selected(authorReducer(d, { type: 'formatting', formatting: f })), selected(d));
    selected(d).formatting = f; assert.throws(() => validateDraft(d));
    assert.throws(() => compileVisual(input(selected(d))), /invalid visual formatting/);
  }
  const d = add('bar');
  assert.equal(selected(authorReducer(d, { type: 'legend-position', position: 'MIDDLE' })), selected(d));
  assert.equal(selected(authorReducer(d, { type: 'subtitle', subtitle: 2, visible: true })), selected(d));
  for (const bad of [{ subtitle: [] }, { subtitle: 'Text', subtitleVisible: 'false' }, { subtitleVisible: true }]) {
    const d = add('bar'); Object.assign(selected(d), bad); assert.throws(() => validateDraft(d));
  }
  const definition = serializeVisual(selected(d));
  definition.barChartVisual.chartConfiguration.legend.position = 'MIDDLE';
  assert.throws(() => compileVisual({ ...input(selected(d)), definition }), /legend.position/);
});

test('card renders escaped subtitle and title size; title and subtitle visibility are independent', () => {
  const v = { ...selected(add('bar')), title: 'Revenue', subtitle: '<img src=x>\nSecond line', subtitleVisible: true, titleVisible: false, formatting: { titleFontSize: 26 } };
  const html = renderToStaticMarkup(createElement(VisualCard, { visual: input(v) }));
  assert.match(html, /style="font-size:26px" class="sr-only">Revenue/);
  assert.match(html, /class="card-subtitle">&lt;img src=x&gt;\nSecond line/);
  assert.doesNotMatch(html, /<img/);
  const hidden = renderToStaticMarkup(createElement(VisualCard, { visual: input({ ...v, subtitleVisible: false }) }));
  assert.doesNotMatch(hidden, /class="card-subtitle"/);
});

test('native subtitle and legend position import and API conversion work; rich text stays reported and preserved', () => {
  const resource = serializeDraft(add('bar'));
  const body = resource.definition.sheets[0].visuals[0].barChartVisual;
  body.subtitle = { visibility: 'VISIBLE', formatText: { plainText: 'Native subtitle' } };
  body.chartConfiguration.legend.position = 'RIGHT';
  const bundle = { members: [{ path: 'analysis/authored-analysis.json', resource }] };
  let imported = importBundle(bundle);
  assert.equal(selected(imported).subtitle, 'Native subtitle');
  assert.equal(selected(imported).formatting.legendPosition, 'RIGHT');
  assert.deepEqual(selected(imported).imported.issues, []);
  assert.deepEqual(exportBundle(imported), bundle);
  body.subtitle.formatText = { richText: '<text>Retained rich text</text>' };
  imported = importBundle(bundle);
  assert.match(JSON.stringify(imported.bundle.report), /subtitle.formatText.richText/);
  assert.deepEqual(exportBundle(imported), bundle);
  const edited = authorReducer(imported, { type: 'subtitle', subtitle: 'Plain replacement', visible: false });
  assert.deepEqual(exportBundle(edited).members[0].resource.definition.sheets[0].visuals[0].barChartVisual.subtitle, { visibility: 'HIDDEN', formatText: { plainText: 'Plain replacement' } });
  const apiBody = { VisualId: 'v', Subtitle: { Visibility: 'VISIBLE', FormatText: { PlainText: 'API subtitle' } }, ChartConfiguration: { FieldWells: { BarChartAggregatedFieldWells: { Category: [{ CategoricalDimensionField: { FieldId: 'region', Column: { DataSetIdentifier: 'sales_data', ColumnName: 'region' } } }], Values: [{ NumericalMeasureField: { FieldId: 'revenue', Column: { DataSetIdentifier: 'sales_data', ColumnName: 'revenue' }, AggregationFunction: { SimpleNumericalAggregation: 'SUM' } } }] } }, Legend: { Position: 'TOP' } } };
  const api = { source: 'api', definition: { BarChartVisual: apiBody }, rows: [{ region: 'East', revenue: 1 }], bindings: {}, path: 'test' };
  const converted = convertDefinition({ DataSetIdentifierDeclarations: [], Sheets: [{ SheetId: 's', Visuals: [api.definition] }] });
  assert.deepEqual(compileVisual(api).model, compileVisual({ ...api, source: 'bundle', definition: converted.sheets[0].visuals[0] }).model);
});

test('all legend chart kinds reserve space at each position; visibility and horizontal bars remain effective', () => {
  for (const kind of ['bar', 'line', 'pie', 'combo', 'area', 'bar100']) for (const position of LEGEND_POSITIONS) {
    const v = { ...selected(add(kind)), formatting: { legendPosition: position }, horizontal: true };
    const { option } = compileVisual(input(v));
    const side = position === 'LEFT' || position === 'RIGHT';
    assert.equal(option.legend.orient, side ? 'vertical' : 'horizontal');
    assert.equal(option.legend.show, true);
    if (side) assert.equal(option.legend[position.toLowerCase()], 0);
    else assert.equal(option.legend[position === 'TOP' ? 'top' : 'bottom'], 0);
    if (kind === 'pie') assert.equal(option.series[0][side ? position.toLowerCase() : position === 'TOP' ? 'top' : 'bottom'], side ? 120 : 36);
    else assert.equal(option.grid[side ? position.toLowerCase() : position === 'TOP' ? 'top' : 'bottom'], side ? 130 : 48);
    assert.equal(compileVisual(input({ ...v, legend: false })).option.legend.show, false);
  }
});

test('bar category spacing applies with clustered, stacked, percent and combo arrangements', () => {
  for (const kind of ['bar', 'bar100', 'combo']) for (const stacked of [false, true]) {
    const v = { ...selected(add(kind)), stacked, formatting: { barCategoryGap: 40 } };
    const { option } = compileVisual(input(v));
    assert.equal(option.series[0].barCategoryGap, '40%');
    assert.equal(option.series[0].barMaxWidth, undefined);
    if (kind === 'bar') assert.equal(option.series[0].stack, stacked ? 'values' : undefined);
  }
});

test('a side legend leaves pie percentages readable in a narrow card', () => {
  const v = { ...selected(add('pie')), dimension: 'region', labels: true, formatting: { legendPosition: 'RIGHT', decimalPlaces: 2 } };
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 344, height: 240 });
  try {
    chart.setOption(compileVisual(input(v)).option);
    assert.match(chart.renderToSVGString(), /100.00%/);
  } finally { chart.dispose(); }
});

test('decimal formatting preserves each label meaning and leaves input values untouched', () => {
  for (const [kind, params, expected] of [
    ['bar', { value: 1234.567 }, '1,234.57'], ['line', { value: 0 }, '0.00'], ['area', { value: 3.2 }, '3.20'], ['combo', { value: -3.2 }, '-3.20'],
    ['bar100', { value: 66.666 }, '66.67%'], ['pie', { name: 'East', value: 12.345, percent: 33.333 }, 'East: 33.33%'],
    ['scatter', { name: 'East', value: [12.345, 5.5] }, 'East: 12.35, 5.50'], ['heatmap', { value: [0, 1, 12.345] }, '12.35'],
    ['funnel', { name: 'East', value: 12.345 }, 'East: 12.35'], ['treemap', { name: 'East', value: 12.345 }, 'East: 12.35'],
    ['histogram', { value: 2 }, '2.00'], ['filledMap', { name: 'United States', value: 12.345 }, 'United States: 12.35'],
  ]) {
    const v = { ...selected(add(kind)), labels: true, formatting: { decimalPlaces: 2 } };
    const rows = [{ region: kind === 'filledMap' ? 'United States' : 'East', category: 'A', month: '2025-01', revenue: 12.345, profit: 5.5 }];
    const before = structuredClone(rows);
    const c = compileVisual(input(v, rows));
    assert.equal(c.option.series[0].label.formatter(params), expected, kind);
    assert.deepEqual(rows, before);
  }
  const v = { ...selected(add('bar')), labels: true, formatting: { decimalPlaces: 2 } };
  const c = compileVisual(input(v));
  assert.equal(c.option.series[0].label.formatter({ value: null }), '');
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 600, height: 400 });
  try { chart.setOption(c.option); assert.match(chart.renderToSVGString(), /12.35/); } finally { chart.dispose(); }
  assert.equal(hasLegend('table'), false); assert.equal(hasDataLabels('gauge'), false);
});
