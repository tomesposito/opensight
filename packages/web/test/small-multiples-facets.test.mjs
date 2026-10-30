import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileVisual, normalizeVisual } from '../build/test/compiler.js';
import { init } from '../build/test/echarts.js';
import { activeSheet, authorReducer, authorVisualProblem, emptyDraft, serializeVisual } from '../build/test/authoring.js';
import { exportBundle } from '../build/test/bundle-authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { buildAuthorPreview } from '../build/test/author-preview.js';
import { EXTRA_VISUALS } from '../build/test/visual-catalog.js';

const fixtures = JSON.parse(await readFile(new URL('../src/fixtures.generated.json', import.meta.url), 'utf8'));
const barFixture = () => structuredClone(fixtures[1].sheets[0].visuals.find(v => Object.hasOwn(v.definition, 'BarChartVisual')));
const lineFixture = () => structuredClone(fixtures[1].sheets[0].visuals.find(v => Object.hasOwn(v.definition, 'LineChartVisual')));
const facetWell = (fieldId = 'region') => ({ CategoricalDimensionField: { FieldId: fieldId, Column: { DataSetIdentifier: 'sales_data', ColumnName: fieldId } } });
// The bar/line fixtures use 'region' as the category dimension, so their facet field is 'category'.
const facetedBar = (rows) => {
  const input = barFixture();
  input.definition.BarChartVisual.ChartConfiguration.FieldWells.BarChartAggregatedFieldWells.SmallMultiples = [facetWell('category')];
  input.rows = rows;
  return input;
};
const lineRows = [
  { month: '2025-01', category: 'Hardware', revenue: 400 },
  { month: '2025-02', category: 'Hardware', revenue: 500 },
  { month: '2025-01', category: 'Software', revenue: 300 },
  { month: '2025-02', category: 'Software', revenue: 600 },
];
const facetedLine = (rows) => {
  const input = lineFixture();
  input.definition.LineChartVisual.ChartConfiguration.FieldWells.LineChartAggregatedFieldWells.SmallMultiples = [facetWell('category')];
  input.rows = rows;
  return input;
};
// Extra kinds (combo/area/bar100) are built from the test helper's definition
// shape rather than the pinned fixtures.
const dim = name => ({ categoricalDimensionField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' } } });
const measure = name => ({ numericalMeasureField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
const extraInput = (kind, rows) => {
  const spec = EXTRA_VISUALS[kind];
  const wells = { [spec.dimensions[0]]: [dim('group')], smallMultiples: [dim('region')] };
  // Mirror the repo's extra-compiler test helper: a single measure well takes both measures.
  spec.measures.forEach((key, i) => { wells[key] = (spec.measures.length === 1 ? ['a', 'b'] : ['a', 'b'].slice(i, i + 1)).map(measure); });
  return { source: 'bundle', path: '$.test', bindings: {}, rows,
    definition: { [spec.variant]: { visualId: kind, chartConfiguration: { fieldWells: { [spec.wells]: wells }, ...(kind === 'bar100' ? { barsArrangement: 'STACKED_PERCENT' } : {}), ...(kind === 'area' ? { type: 'AREA' } : {}) } } } };
};
const rows = [
  { category: 'Hardware', region: 'East', revenue: 200 },
  { category: 'Software', region: 'East', revenue: 100 },
  { category: 'Hardware', region: 'West', revenue: 50 },
  { category: 'Software', region: 'West', revenue: 300 },
];
const extraRows = [
  { group: 'A', region: 'East', a: 10, b: 30 },
  { group: 'B', region: 'East', a: 20, b: 40 },
  { group: 'A', region: 'West', a: 50, b: 10 },
  { group: 'B', region: 'West', a: 60, b: 20 },
];

test('bar and line parse SmallMultiples into model.facet, keeping one category dimension', () => {
  const bar = normalizeVisual('api', facetedBar(rows).definition);
  assert.equal(bar.kind, 'bar');
  assert.deepEqual(bar.dimensions.map(f => f.id), ['region']);
  assert.equal(bar.facet.id, 'category');
  const line = normalizeVisual('api', facetedLine(rows).definition);
  assert.equal(line.kind, 'line');
  assert.equal(line.facet.id, 'category');
});

test('more than one small multiples field fails closed for bar', () => {
  const input = facetedBar(rows);
  input.definition.BarChartVisual.ChartConfiguration.FieldWells.BarChartAggregatedFieldWells.SmallMultiples.push(facetWell('order_date'));
  assert.throws(() => normalizeVisual('api', input.definition), /at most one Small multiples field/);
});

test('non-faceted kinds still reject a nonempty small multiples well', () => {
  const input = structuredClone(fixtures[1].sheets[0].visuals.find(v => Object.hasOwn(v.definition, 'KPIVisual')));
  input.definition.KPIVisual.ChartConfiguration.FieldWells.SmallMultiples = [facetWell()];
  assert.throws(() => normalizeVisual('api', input.definition), /field well not supported/);
});

test('faceted bar renders one panel per facet with titles and a single shared legend', () => {
  const c = compileVisual(facetedBar(rows));
  assert.equal(c.state, 'ready');
  assert.equal(c.model.facet.id, 'category');
  assert.equal(c.option.grid.length, 2);
  assert.equal(c.option.xAxis.length, 2);
  assert.equal(c.option.yAxis.length, 2);
  assert.deepEqual(c.option.xAxis.map(a => a.gridIndex), [0, 1]);
  assert.deepEqual(c.option.title.map(t => t.text), ['Hardware', 'Software']);
  assert.equal(c.option.series.length, 2);
  assert.deepEqual(c.option.series.map(s => [s.type, s.xAxisIndex, s.yAxisIndex]), [['bar', 0, 0], ['bar', 1, 1]]);
  assert.deepEqual(c.option.series[0].data, [200, 50]);
  assert.deepEqual(c.option.series[1].data, [100, 300]);
  assert.deepEqual(c.option.xAxis[0].data, ['East', 'West']);
});

for (const orientation of ['VERTICAL', 'HORIZONTAL']) {
  test(`${orientation.toLowerCase()} faceted bar preserves each panel's axes and category order`, () => {
    const input = facetedBar([
      { category: 'Hardware', region: 'West', revenue: 200 },
      { category: 'Software', region: 'North', revenue: 100 },
      { category: 'Hardware', region: 'East', revenue: 50 },
      { category: 'Software', region: 'South', revenue: 300 },
      { category: 'Software', region: 'Central', revenue: 150 },
    ]);
    input.definition.BarChartVisual.ChartConfiguration.Orientation = orientation;
    const { model, option } = compileVisual(input);
    const horizontal = orientation === 'HORIZONTAL';
    assert.equal(model.horizontal, horizontal);
    assert.equal(option.grid.length, 2);
    assert.equal(option.xAxis.length, 2);
    assert.equal(option.yAxis.length, 2);
    assert.deepEqual(option.title.map(t => t.text), ['Hardware', 'Software']);
    const categories = [['West', 'East'], ['North', 'South', 'Central']];
    for (let i = 0; i < categories.length; i++) {
      assert.equal(option.xAxis[i].type, horizontal ? 'value' : 'category');
      assert.equal(option.yAxis[i].type, horizontal ? 'category' : 'value');
      assert.equal(option.xAxis[i].gridIndex, i);
      assert.equal(option.yAxis[i].gridIndex, i);
      const categoryAxis = horizontal ? option.yAxis[i] : option.xAxis[i];
      assert.deepEqual(categoryAxis.data, categories[i]);
      assert.equal(categoryAxis.inverse, horizontal ? true : undefined);
    }
    assert.deepEqual(option.series.map(s => [s.xAxisIndex, s.yAxisIndex]), [[0, 0], [1, 1]]);
    assert.deepEqual(option.series.map(s => s.data), [[200, 50], [100, 300, 150]]);
  });
}

test('horizontal faceted bar reference lines use each panel\'s value xAxis', () => {
  const input = facetedBar(rows);
  input.definition.BarChartVisual.ChartConfiguration.Orientation = 'HORIZONTAL';
  input.definition.BarChartVisual.OpenSightReferenceLines = [
    { value: 75, label: 'Minimum', color: '#c0392b' },
    { value: 150, label: 'Goal', color: '#3b82f6' },
  ];
  const { option } = compileVisual(input);
  assert.equal(option.xAxis.length, 2);
  assert.ok(option.xAxis.every(axis => axis.type === 'value'));
  assert.deepEqual(option.series.map(s => [s.xAxisIndex, s.yAxisIndex]), [[0, 0], [1, 1]]);
  for (const series of option.series) {
    assert.equal(option.xAxis[series.xAxisIndex].type, 'value');
    assert.deepEqual(series.markLine.data, [
      { name: 'Minimum', xAxis: 75, label: { color: '#c0392b' }, lineStyle: { color: '#c0392b' } },
      { name: 'Goal', xAxis: 150, label: { color: '#3b82f6' }, lineStyle: { color: '#3b82f6' } },
    ]);
  }
});

test('faceted line renders one line series per facet', () => {
  const c = compileVisual(facetedLine(lineRows));
  assert.equal(c.state, 'ready');
  assert.equal(c.option.grid.length, 2);
  assert.deepEqual(c.option.series.map(s => s.type), ['line', 'line']);
  assert.deepEqual(c.option.series[0].data, [400, 500]);
  assert.deepEqual(c.option.series[1].data, [300, 600]);
  assert.deepEqual(c.option.title.map(t => t.text), ['Hardware', 'Software']);
  assert.deepEqual(c.option.xAxis[0].data, ['2025-01', '2025-02']);
});

test('faceted combo renders bar-first plus lines per facet', () => {
  const c = compileVisual(extraInput('combo', extraRows));
  assert.equal(c.state, 'ready');
  assert.equal(c.option.grid.length, 2);
  // Two measures (bar + line) x two facets, each bound to its own axes.
  assert.deepEqual(c.option.series.map(s => [s.type, s.xAxisIndex]), [['bar', 0], ['line', 0], ['bar', 1], ['line', 1]]);
  assert.deepEqual(c.option.series[0].data, [10, 20]);
  assert.deepEqual(c.option.series[2].data, [50, 60]);
  assert.deepEqual(c.option.title.map(t => t.text), ['East', 'West']);
});

test('faceted area renders per-facet line series with area fill', () => {
  const c = compileVisual(extraInput('area', extraRows));
  assert.equal(c.state, 'ready');
  assert.equal(c.option.grid.length, 2);
  // Two measures x two facets, each bound to its own axes.
  assert.deepEqual(c.option.series.map(s => [s.type, s.xAxisIndex]), [['line', 0], ['line', 0], ['line', 1], ['line', 1]]);
  assert.ok(c.option.series.every(s => s.areaStyle));
  assert.deepEqual(c.option.series[0].data, [10, 20]);
  assert.deepEqual(c.option.series[2].data, [50, 60]);
  assert.deepEqual(c.option.title.map(t => t.text), ['East', 'West']);
});

test('faceted bar100 normalizes to percent per facet', () => {
  const c = compileVisual(extraInput('bar100', extraRows));
  assert.equal(c.state, 'ready');
  assert.equal(c.option.grid.length, 2);
  assert.ok(c.option.series.every(s => s.type === 'bar'));
  // East facet: A totals 40, B totals 60. West facet: A totals 60, B totals 80.
  assert.deepEqual(c.option.series[0].data.map(n => Math.round(n)), [25, 33]);
  assert.deepEqual(c.option.series[1].data.map(n => Math.round(n)), [75, 67]);
  assert.deepEqual(c.option.series[2].data.map(n => Math.round(n)), [83, 75]);
  assert.deepEqual(c.option.series[3].data.map(n => Math.round(n)), [17, 25]);
});

test('horizontal faceted bar100 keeps percent xAxes and category yAxes', () => {
  const input = extraInput('bar100', extraRows);
  input.definition.barChartVisual.chartConfiguration.orientation = 'HORIZONTAL';
  const { option } = compileVisual(input);
  assert.equal(option.xAxis.length, 2);
  assert.equal(option.yAxis.length, 2);
  for (let i = 0; i < 2; i++) {
    assert.equal(option.xAxis[i].type, 'value');
    assert.equal(option.xAxis[i].min, 0);
    assert.equal(option.xAxis[i].max, 100);
    assert.equal(option.xAxis[i].gridIndex, i);
    assert.equal(option.yAxis[i].type, 'category');
    assert.deepEqual(option.yAxis[i].data, ['A', 'B']);
    assert.equal(option.yAxis[i].inverse, true);
    assert.equal(option.yAxis[i].gridIndex, i);
  }
  assert.deepEqual(option.series.map(s => [s.xAxisIndex, s.yAxisIndex]), [[0, 0], [0, 0], [1, 1], [1, 1]]);
});

test('faceted bar renders to SVG without NaN/overflow', () => {
  const c = compileVisual(facetedBar(rows));
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 900, height: 500 });
  try {
    chart.setOption(c.option);
    const svg = chart.renderToSVGString();
    assert.match(svg, /<svg/);
    assert.doesNotMatch(svg, /NaN|Infinity/);
    assert.match(svg, /Hardware/);
    assert.match(svg, /Software/);
  } finally { chart.dispose(); }
});

test('panel-count cap truncates facets with a warning', () => {
  const input = facetedBar(rows);
  input.definition.BarChartVisual.ChartConfiguration.OpenSightMultiplesOptions = {
    visibleRows: 'auto', visibleColumns: 'auto', panelCount: 1,
    title: { size: 'medium', bold: false, italic: false, underline: false, align: 'center' },
    border: { enabled: false, widthPx: 1, style: 'solid', color: '#000000' }, gutter: false, background: false,
  };
  const c = compileVisual(input);
  assert.equal(c.option.grid.length, 1);
  assert.deepEqual(c.option.title.map(t => t.text), ['Hardware']);
  assert.match(c.model.warnings.join('\n'), /2 small-multiple panels exceed the 1-panel limit/);
});

test('visible rows/columns pin the facet grid', () => {
  const input = facetedBar(rows);
  input.definition.BarChartVisual.ChartConfiguration.OpenSightMultiplesOptions = {
    visibleRows: 1, visibleColumns: 2, panelCount: 20,
    title: { size: 'medium', bold: false, italic: false, underline: false, align: 'center' },
    border: { enabled: false, widthPx: 1, style: 'solid', color: '#000000' }, gutter: false, background: false,
  };
  const c = compileVisual(input);
  assert.equal(c.option.grid.length, 2);
  // Two panels side by side: second panel starts at 50% left.
  assert.equal(c.option.grid[1].left, '50.00%');
});

test('author query groups a faceted bar by (dimension, facet)', () => {
  const draft = authorReducer(emptyDraft(), { type: 'add', kind: 'bar' });
  const visual = { ...activeSheet(draft).visuals[0], smallMultiples: ['region'] };
  const request = buildAuthorQuery(visual);
  assert.deepEqual(request.dimensions.map(d => d.fieldId), [visual.dimension, 'region']);
});

test('faceted bar previews with real facet-grouped rows', () => {
  const draft = authorReducer(emptyDraft(), { type: 'add', kind: 'bar' });
  const visual = { ...activeSheet(draft).visuals[0], smallMultiples: ['category'] };
  assert.equal(authorVisualProblem(visual), undefined);
  const preview = buildAuthorPreview(visual);
  assert.ok(preview.rows.length > 0);
  assert.ok(preview.rows.every(r => 'category' in r));
});

test('kpi with small multiples still fails closed in the author problem check', () => {
  const draft = authorReducer(emptyDraft(), { type: 'add', kind: 'kpi' });
  const visual = { ...activeSheet(draft).visuals[0], smallMultiples: ['region'] };
  assert.match(authorVisualProblem(visual), /SMALL_MULTIPLES_UNSUPPORTED/);
});

test('faceted bar serializes and exports its SmallMultiples well', () => {
  const draft = authorReducer(emptyDraft(), { type: 'add', kind: 'bar' });
  const visual = { ...activeSheet(draft).visuals[0], smallMultiples: ['category'] };
  const definition = serializeVisual(visual, true);
  assert.equal(definition.barChartVisual.chartConfiguration.fieldWells.barChartAggregatedFieldWells.smallMultiples[0].categoricalDimensionField.column.columnName, 'category');
  // Export no longer rejects small multiples on the faceted kinds.
  assert.doesNotThrow(() => exportBundle({ ...draft, sheets: [{ ...activeSheet(draft), visuals: [visual] }] }));
});

test('faceted bar with explicit multiples options round-trips through the bundle', () => {
  const input = facetedBar(rows);
  input.definition.BarChartVisual.ChartConfiguration.OpenSightMultiplesOptions = {
    visibleRows: 'auto', visibleColumns: 2, panelCount: 20,
    title: { size: 'large', bold: true, italic: false, underline: false, align: 'left' },
    border: { enabled: true, widthPx: 2, style: 'solid', color: '#112233' }, gutter: true, background: true,
  };
  const c = compileVisual(input);
  assert.equal(c.option.grid.length, 2);
  assert.equal(c.option.grid[0].borderWidth, 2);
  assert.equal(c.option.grid[0].backgroundColor, '#f4f6f8');
  assert.equal(c.option.title[0].textStyle.fontSize, 15);
});
