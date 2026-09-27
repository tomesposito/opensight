import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVisual } from '../build/test/compiler.js';
import { EXTRA_VISUALS } from '../build/test/visual-catalog.js';
import { init } from '../build/test/echarts.js';

const dim = name => ({ categoricalDimensionField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' } } });
const measure = name => ({ numericalMeasureField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
export function input(kind, rows) {
  const spec = EXTRA_VISUALS[kind];
  const dims = kind === 'heatmap' ? ['group', 'column'] : kind === 'pointMap' ? ['lat', 'lon'] : kind === 'gauge' ? [] : ['group'];
  const measures = ['scatter', 'combo', 'bar100'].includes(kind) ? ['a', 'b'] : ['a'];
  const wells = {};
  spec.dimensions.forEach((key, i) => { wells[key] = (spec.dimensions.length === 1 ? dims : dims.slice(i, i + 1)).map(dim); });
  spec.measures.forEach((key, i) => { wells[key] = (spec.measures.length === 1 ? measures : measures.slice(i, i + 1)).map(measure); });
  return { source: 'bundle', path: '$.test', bindings: {}, rows: rows ?? (kind === 'gauge' ? [{ a: 42 }] : [{ group: kind === 'filledMap' ? 'France' : 'A', column: 'X', lat: 48, lon: 2, a: 10, b: 30 }, { group: kind === 'filledMap' ? 'Germany' : 'B', column: 'Y', lat: 52, lon: 13, a: 20, b: 20 }]), definition: { [spec.variant]: { visualId: kind, chartConfiguration: { fieldWells: spec.wells ? { [spec.wells]: wells } : wells, ...(kind === 'bar100' ? { barsArrangement: 'STACKED_PERCENT' } : {}), ...(kind === 'area' ? { type: 'AREA' } : {}) } } } };
}
const seriesTypes = { scatter: 'scatter', combo: 'bar', bar100: 'bar', area: 'line', funnel: 'funnel', gauge: 'gauge', treemap: 'treemap', heatmap: 'heatmap', box: 'boxplot', wordCloud: 'scatter', histogram: 'bar', filledMap: 'map', pointMap: 'scatter' };
for (const kind of Object.keys(EXTRA_VISUALS)) test(`${kind}: pinned rows compile, render to SVG, and retain accessible data`, () => {
  const source = input(kind), before = structuredClone(source), c = compileVisual(source);
  assert.equal(c.model.kind, kind); assert.equal(c.state, 'ready'); assert.equal(c.option.series[0].type, seriesTypes[kind]);
  assert.equal(c.table.rows.length, source.rows.length); assert.deepEqual(source, before);
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 600, height: 360 });
  try { chart.setOption(c.option); const svg = chart.renderToSVGString(); assert.match(svg, /<svg/); assert.match(svg, /<path|<text|<polygon/); assert.doesNotMatch(svg, /NaN|Infinity/); }
  finally { chart.dispose(); }
  assert.equal(compileVisual({ ...source, rows: null }).state, 'unavailable');
  assert.equal(compileVisual({ ...source, rows: [] }).state, 'empty');
});
test('scatter, combo, area and 100% bars preserve independent values', () => {
  assert.deepEqual(compileVisual(input('scatter')).option.series[0].data[0].value, [10, 30]);
  assert.deepEqual(compileVisual(input('combo')).option.series.map(s => [s.type, s.data]), [['bar', [10, 20]], ['line', [30, 20]]]);
  assert.ok(compileVisual(input('area')).option.series[0].areaStyle);
  assert.deepEqual(compileVisual(input('bar100')).option.series.map(s => s.data), [[25, 50], [75, 50]]);
  assert.deepEqual(compileVisual(input('bar100', [{ group: 'zero', a: 0, b: 0 }])).option.series.map(s => s.data), [[0], [0]]);
  assert.throws(() => compileVisual(input('bar100', [{ group: 'bad', a: -1, b: 3 }])), /nonnegative/);
});
test('box quartiles and histogram bin frequencies come from all supplied samples', () => {
  const rows = [1, 2, 3, 4, 10, null].map(a => ({ group: 'A', a }));
  assert.deepEqual(compileVisual(input('box', rows)).option.series[0].data, [[1, 2, 3, 4, 10]]);
  const h = input('histogram', rows); Object.values(h.definition)[0].chartConfiguration.opensightBins = 3;
  assert.deepEqual(compileVisual(h).option.series[0].data, [3, 1, 1]);
});
test('heatmap coordinates, treemap weights, funnel ordering and gauge bounds', () => {
  assert.deepEqual(compileVisual(input('heatmap')).option.series[0].data, [[0, 0, 10], [1, 1, 20]]);
  assert.deepEqual(compileVisual(input('treemap')).option.series[0].data, [{ name: 'A', value: 10 }, { name: 'B', value: 20 }]);
  assert.deepEqual(compileVisual(input('funnel')).option.series[0].data.map(d => d.value), [10, 20]);
  const g = input('gauge'); g.definition.gaugeChartVisual.chartConfiguration.opensightGauge = { min: 0, max: 1000 };
  assert.equal(compileVisual(g).option.series[0].max, 1000); assert.equal(compileVisual(g).option.series[0].data[0].value, 42);
  assert.throws(() => compileVisual(input('gauge', [{ a: 1 }, { a: 2 }])), /one aggregate/);
});
test('maps bind geographic values without inventing coordinates', () => {
  assert.deepEqual(compileVisual(input('pointMap')).option.series[0].data[0].value, [2, 48, 10]);
  assert.equal(compileVisual(input('filledMap')).option.series[0].data[0].name, 'France');
  assert.throws(() => compileVisual(input('pointMap', [{ lat: 91, lon: 2, a: 1 }])), /latitude/);
  assert.throws(() => compileVisual(input('filledMap', [{ group: 'East', a: 1 }])), /matching country/);
});
test('word cloud orders weights deterministically and limits visible words without losing data', () => {
  const c = compileVisual(input('wordCloud', Array.from({ length: 100 }, (_, i) => ({ group: `word${i}`, a: i }))));
  assert.equal(c.option.series[0].data.length, 80); assert.equal(c.option.series[0].data[0].name, 'word99'); assert.equal(c.table.rows.length, 100);
});
