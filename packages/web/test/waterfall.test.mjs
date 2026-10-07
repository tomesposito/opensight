import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVisual, CompileError } from '../build/test/compiler.js';
import { init } from '../build/test/echarts.js';
import { rowSelection } from '../build/test/visual-selection.js';

const dim = name => ({ categoricalDimensionField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' } } });
const measure = name => ({ numericalMeasureField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
const input = deltas => ({ source: 'bundle', path: '$.waterfall', bindings: {}, rows: deltas?.map((delta, i) => ({ category: `C${i}`, delta })) ?? null, definition: {
  waterfallChartVisual: { visualId: 'waterfall', chartConfiguration: { fieldWells: { waterfallChartAggregatedFieldWells: { category: [dim('category')], values: [measure('delta')] } } } },
} });
const config = source => source.definition.waterfallChartVisual.chartConfiguration;
const wells = source => config(source).fieldWells.waterfallChartAggregatedFieldWells;

test('waterfall spans sequential totals, uses signed labels/colors, and leaves View data unchanged', () => {
  const source = input([10, -4, -12, 3, 8, 0]), before = structuredClone(source), c = compileVisual(source);
  const [assist, visible] = c.option.series;
  assert.deepEqual(c.option.xAxis.data, ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'Total']);
  assert.deepEqual(assist.data, [0, 6, -6, -6, -3, 5, 0]);
  assert.deepEqual(visible.data.map(d => d.value), [10, 4, 12, 3, 8, 0, 5]);
  assert.deepEqual(visible.data.map(d => d.delta), [10, -4, -12, 3, 8, 0, 5]);
  assert.deepEqual(visible.data.map(d => d.itemStyle.color), ['#2e8b57', '#d64545', '#d64545', '#2e8b57', '#2e8b57', '#2e8b57', '#2673c9']);
  assert.equal(assist.itemStyle.color, 'transparent'); assert.equal(assist.silent, true); assert.equal(assist.tooltip.show, false);
  assert.equal(assist.stack, visible.stack); assert.equal(visible.stackStrategy, 'all');
  assert.equal(visible.label.formatter({ data: visible.data[1] }), '-4');
  assert.equal(visible.tooltip.formatter({ name: 'C1', data: visible.data[1] }), 'C1: -4');
  assert.deepEqual(c.table.rows, source.rows.map(r => [r.category, r.delta]));
  assert.deepEqual(rowSelection(c, 2), { values: { category: 'C2' } }); assert.equal(rowSelection(c, 6), undefined);
  assert.deepEqual(source, before);
});

test('waterfall rendered bar geometry covers negative starts, crossings, and negative/zero totals', () => {
  for (const deltas of [[-10, 3, 12, -9], [10, -4, -12, 3, 8], [0, 0], [4, -4]]) {
    const source = input(deltas); config(source).dataLabels = { visibility: 'VISIBLE' };
    const c = compileVisual(source), chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 600, height: 360 });
    try {
      chart.setOption(c.option);
      const svg = chart.renderToSVGString(); assert.match(svg, />Total</); assert.doesNotMatch(svg, /NaN|Infinity/);
      const series = chart.getModel().getSeriesByIndex(1), data = series.getData();
      let running = 0;
      for (let i = 0; i <= deltas.length; i++) {
        const previous = i === deltas.length ? 0 : running;
        if (i < deltas.length) running += deltas[i];
        const low = Math.min(previous, running), high = Math.max(previous, running);
        const layout = data.getItemLayout(i), axis = series.coordinateSystem.getAxis('y');
        const expected = [axis.toGlobalCoord(axis.dataToCoord(low)), axis.toGlobalCoord(axis.dataToCoord(high))].sort((a, b) => a - b);
        const actual = [layout.y, layout.y + layout.height].sort((a, b) => a - b);
        assert.ok(actual.every((v, j) => Math.abs(v - expected[j]) < 1e-7), `${deltas} bar ${i}: ${actual} vs ${expected}`);
      }
    } finally { chart.dispose(); }
  }
});

test('waterfall rejects missing/multiple wells and any supplied breakdowns with named errors', () => {
  for (const [slot, error, field] of [['category', 'CATEGORY', dim], ['values', 'VALUES', measure]]) {
    for (const value of [undefined, [], [field('extra'), field('another')]]) {
      const source = input([3]); wells(source)[slot] = value;
      assert.throws(() => compileVisual(source), e => e instanceof CompileError && e.message.includes(`WATERFALL_${error}_REQUIRED`));
    }
  }
  for (const value of [[], [dim('breakdown')], null]) {
    const source = input([3]); wells(source).breakdowns = value;
    assert.throws(() => compileVisual(source), /WATERFALL_BREAKDOWN_UNSUPPORTED/);
  }
});

test('waterfall rejects invalid values, overflow and duplicate categories without inventing deltas', () => {
  for (const [deltas, error] of [[[null], /WATERFALL_VALUE_INVALID/], [['1'], /finite number or null/], [[Infinity], /invalid result cell/], [[1e308, 1e308], /WATERFALL_TOTAL_OVERFLOW/]]) {
    assert.throws(() => compileVisual(input(deltas)), e => e instanceof CompileError && error.test(e.message));
  }
  const source = input([1, 2]); source.rows[1].category = 'C0';
  assert.throws(() => compileVisual(source), /duplicate categories/);
});

test('waterfall preserves empty/unavailable states without manufacturing a Total bar', () => {
  for (const [deltas, state] of [[[], 'empty'], [null, 'unavailable']]) {
    const c = compileVisual(input(deltas)); assert.equal(c.state, state);
    assert.deepEqual(c.option.xAxis.data, []); assert.ok(c.option.series.every(s => s.data.length === 0));
  }
});

test('waterfall display settings retain signed decimals and sort before accumulation', () => {
  const source = input([10, -4]);
  Object.assign(config(source), { legend: { visibility: 'HIDDEN', position: 'LEFT' }, dataLabels: { visibility: 'VISIBLE' }, tooltip: { tooltipVisibility: 'HIDDEN' }, sortConfiguration: { categorySort: [{ fieldSort: { fieldId: 'category', direction: 'DESC' } }] } });
  source.definition.waterfallChartVisual.opensightFormatting = { decimalPlaces: 2 };
  const c = compileVisual(source), [assist, visible] = c.option.series;
  assert.deepEqual(c.option.xAxis.data, ['C1', 'C0', 'Total']); assert.deepEqual(assist.data, [-4, -4, 0]);
  assert.equal(c.option.legend.show, false); assert.equal(c.option.legend.orient, 'vertical'); assert.equal(c.option.tooltip.show, false);
  assert.equal(assist.label.show, false); assert.equal(visible.label.show, true);
  assert.equal(visible.label.formatter({ data: visible.data[0], value: 4 }), '-4.00');
});
