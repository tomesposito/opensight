import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVisual, CompileError } from '../build/test/compiler.js';
import { init } from '../build/test/echarts.js';
import { convertDefinition } from '../build/test/definition-converter.js';

const dim = name => ({ categoricalDimensionField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' } } });
const measure = name => ({ numericalMeasureField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
const input = (rows, color = true) => ({ source: 'bundle', path: '$.radar', bindings: {}, rows, definition: {
  radarChartVisual: { visualId: 'radar', chartConfiguration: { fieldWells: { radarChartAggregatedFieldWells: {
    category: [dim('category')], color: color ? [dim('color')] : [], values: [measure('a'), measure('b')],
  } } } },
} });
const config = source => source.definition.radarChartVisual.chartConfiguration;
const wells = source => config(source).fieldWells.radarChartAggregatedFieldWells;
const rows = [
  { category: 'Speed', color: 'Blue', a: 10, b: 3 },
  { category: 'Cost', color: 'Red', a: -2, b: 6 },
  { category: 'Cost', color: 'Blue', a: 4, b: null },
  { category: 'Quality', color: 'Blue', a: 0, b: 0 },
  { category: 'Speed', color: 'Red', a: 8, b: 2 },
];

test('radar aligns color × measure series in row order and uses per-indicator extents', () => {
  const source = input(rows), before = structuredClone(source), c = compileVisual(source);
  assert.deepEqual(c.option.radar.indicator, [
    { name: 'Speed', min: 0, max: 10 }, { name: 'Cost', min: -6, max: 6 }, { name: 'Quality', min: 0, max: 1 },
  ]);
  assert.deepEqual(c.option.series.map(s => [s.type, s.name, s.data[0].value]), [
    ['radar', 'Blue · a', [10, 4, 0]], ['radar', 'Blue · b', [3, null, 0]],
    ['radar', 'Red · a', [8, -2, null]], ['radar', 'Red · b', [2, 6, null]],
  ]);
  assert.deepEqual(c.table.rows, rows.map(r => [r.category, r.color, r.a, r.b]));
  assert.deepEqual(source, before);
});

test('radar without Color keeps measures separate, typed categories, nulls and zeroes', () => {
  const c = compileVisual(input([
    { category: null, a: null, b: null }, { category: '(null)', a: -0.25, b: -0.1 }, { category: 'Zero', a: 0, b: 0 },
  ], false));
  assert.deepEqual(c.option.series.map(s => [s.name, s.data[0].value]), [['a', [null, -0.25, 0]], ['b', [null, -0.1, 0]]]);
  assert.deepEqual(c.option.radar.indicator.map(i => [i.min, i.max]), [[0, 1], [-0.25, 0.25], [0, 1]]);
  for (const [data, state] of [[[], 'empty'], [null, 'unavailable']]) {
    const c = compileVisual(input(data));
    assert.equal(c.state, state); assert.deepEqual(c.option.radar.indicator, []); assert.deepEqual(c.option.series, []);
  }
});

test('radar validates required wells, cardinality, unsupported options and duplicate groups', () => {
  const bad = (mutate, error) => {
    const source = input(rows); mutate(source);
    assert.throws(() => compileVisual(source), e => e instanceof CompileError && error.test(e.message));
  };
  bad(s => { wells(s).category = []; }, /RADAR_CATEGORY_REQUIRED/);
  bad(s => { wells(s).category.push(dim('extra')); }, /RADAR_CATEGORY_REQUIRED/);
  bad(s => { wells(s).color.push(dim('extra')); }, /RADAR_COLOR_LIMIT/);
  bad(s => { wells(s).values = []; }, /RADAR_VALUES_REQUIRED/);
  bad(s => { config(s).shape = 'CIRCLE'; }, /shape: unsupported property/);
  bad(s => { config(s).axesRangeScale = 'SHARED'; }, /axesRangeScale: unsupported property/);
  bad(s => { config(s).tooltip = { selectedTooltipType: 'DETAILED' }; }, /selectedTooltipType: unsupported property/);
  bad(s => { config(s).sortConfiguration = { categoryItemsLimit: {} }; }, /categoryItemsLimit: unsupported property/);
  bad(s => { s.rows = [...rows, rows[0]]; }, /duplicate categories/);
  bad(s => { s.rows = [{ ...rows[0], a: '10' }]; }, /finite number or null/);
});

test('radar display settings, explicit sorting and API conversion preserve semantics', () => {
  const source = input(rows);
  Object.assign(config(source), { legend: { visibility: 'HIDDEN' }, dataLabels: { visibility: 'VISIBLE' }, tooltip: { tooltipVisibility: 'HIDDEN' }, sortConfiguration: { categorySort: [{ fieldSort: { fieldId: 'category', direction: 'ASC' } }] } });
  const c = compileVisual(source);
  assert.deepEqual(c.option.radar.indicator.map(i => i.name), ['Cost', 'Quality', 'Speed']);
  assert.equal(c.option.legend.show, false); assert.equal(c.option.tooltip.show, false);
  assert.ok(c.option.series.every(s => s.label.show));
  const apiKeys = v => Array.isArray(v) ? v.map(apiKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), apiKeys(v)])) : v;
  const api = apiKeys(source.definition);
  const converted = convertDefinition({ DataSetIdentifierDeclarations: [], Sheets: [{ SheetId: 'sheet', Visuals: [api] }] });
  assert.deepEqual(compileVisual({ ...source, definition: api, source: 'api' }).option, c.option);
  assert.deepEqual(compileVisual({ ...source, definition: converted.sheets[0].visuals[0] }).option, c.option);
});

test('radar SVG keeps real gaps, omits incomplete fills and restores vertices on update', () => {
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 600, height: 360 });
  const source = input(['A', 'B', 'C', 'D'].map((category, i) => ({ category, a: i === 1 ? null : i + 1, b: null })), false);
  try {
    chart.setOption(compileVisual(source).option);
    const series = chart.getModel().getSeriesByIndex(0), item = series.getData().getItemGraphicEl(0);
    const line = item.childAt(0), fill = item.childAt(1), symbols = item.childAt(2);
    assert.deepEqual(symbols.children().map(s => s.ignore), [false, true, false, false]);
    assert.equal(fill.invisible, true);
    const edges = [];
    line.buildPath({ moveTo: (x, y) => edges.push(['M', x, y]), lineTo: (x, y) => edges.push(['L', x, y]) }, line.shape);
    assert.deepEqual(edges, [
      ['M', ...line.shape.points[2]], ['L', ...line.shape.points[3]],
      ['M', ...line.shape.points[3]], ['L', ...line.shape.points[0]],
    ]);
    const allNull = chart.getModel().getSeriesByIndex(1).getData().getItemGraphicEl(0);
    assert.ok(allNull.childAt(2).children().every(s => s.ignore));
    assert.equal(allNull.childAt(1).invisible, true);
    assert.doesNotMatch(chart.renderToSVGString(), /NaN|Infinity/);
    chart.dispatchAction({ type: 'highlight', seriesIndex: 0 });
    assert.equal(fill.invisible, true);
    source.rows[1].a = 2;
    chart.setOption(compileVisual(source).option);
    const updated = chart.getModel().getSeriesByIndex(0).getData().getItemGraphicEl(0);
    assert.equal(updated.childAt(1).invisible, false);
    assert.ok(updated.childAt(2).children().every(s => !s.ignore));
    assert.doesNotMatch(chart.renderToSVGString(), /NaN|Infinity/);
  } finally { chart.dispose(); }
});
