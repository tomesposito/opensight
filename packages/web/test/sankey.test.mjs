import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVisual, CompileError } from '../build/test/compiler.js';
import { init } from '../build/test/echarts.js';
import { convertDefinition } from '../build/test/definition-converter.js';

const dim = name => ({ categoricalDimensionField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' } } });
const measure = name => ({ numericalMeasureField: { fieldId: name, column: { columnName: name, dataSetIdentifier: 'data' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
const input = rows => ({ source: 'bundle', path: '$.sankey', bindings: {}, rows, definition: {
  sankeyDiagramVisual: { visualId: 'sankey', chartConfiguration: { fieldWells: { sankeyDiagramAggregatedFieldWells: {
    source: [dim('from')], destination: [dim('to')], weight: [measure('weight')],
  } } } },
} });
const config = source => source.definition.sankeyDiagramVisual.chartConfiguration;
const wells = source => config(source).fieldWells.sankeyDiagramAggregatedFieldWells;
const rows = [{ from: 'A', to: 'B', weight: 2 }, { from: 'B', to: 'C', weight: 4 }, { from: 'A', to: 'B', weight: 3 }];

test('sankey unions shared nodes and sums duplicate pairs without changing supplied rows', () => {
  const source = input(rows), before = structuredClone(source), c = compileVisual(source), series = c.option.series[0];
  assert.equal(series.type, 'sankey');
  assert.deepEqual(series.data.map(n => n.name), ['A', 'B', 'C']);
  assert.deepEqual(series.links, [{ source: 0, target: 1, value: 5, name: 'A → B' }, { source: 1, target: 2, value: 4, name: 'B → C' }]);
  assert.equal(series.tooltip.formatter({ data: series.links[0], value: 5 }), 'A → B: 5');
  assert.deepEqual(c.table.rows, [['A', 'B', 2], ['B', 'C', 4], ['A', 'B', 3]]);
  assert.deepEqual(source, before);
});

test('sankey uses typed node identities, null labels, zero links and collision-free pairs', () => {
  const source = input([
    { from: null, to: '(null)', weight: 3 }, { from: '(null)', to: 1, weight: 2 },
    { from: 1, to: '1', weight: 0 }, { from: 'a→b', to: 'c', weight: 4 }, { from: 'a', to: 'b→c', weight: 5 },
  ]);
  const series = compileVisual(source).option.series[0];
  assert.deepEqual(series.data.map(n => n.name), ['(null)', '(null)', '1', '1', 'a→b', 'c', 'a', 'b→c']);
  assert.equal(new Set(series.data.map(n => n.id)).size, 8);
  assert.deepEqual(series.links.map(l => l.value), [3, 2, 0, 4, 5]);
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 600, height: 360 });
  try {
    chart.setOption(compileVisual(source).option);
    assert.equal(chart.getModel().getSeriesByIndex(0).getGraph().nodes.length, 8);
    assert.doesNotMatch(chart.renderToSVGString(), /NaN|Infinity/);
  } finally { chart.dispose(); }
});

test('sankey fails closed on missing or multiple fields in each required slot', () => {
  for (const [slot, error] of [['source', 'SANKEY_SOURCE_REQUIRED'], ['destination', 'SANKEY_DESTINATION_REQUIRED'], ['weight', 'SANKEY_WEIGHT_REQUIRED']]) {
    for (const value of [[], undefined, [slot === 'weight' ? measure('extra') : dim('extra'), slot === 'weight' ? measure('more') : dim('more')]]) {
      const source = input(rows); wells(source)[slot] = value;
      assert.throws(() => compileVisual(source), e => e instanceof CompileError && e.message.includes(error));
    }
  }
});

test('sankey rejects invalid weights, overflow, cycles and zero-only flows before ECharts', () => {
  for (const [data, error] of [
    [[{ from: 'A', to: 'B', weight: null }], /SANKEY_WEIGHT_INVALID/],
    [[{ from: 'A', to: 'B', weight: -1 }], /SANKEY_WEIGHT_INVALID/],
    [[{ from: 'A', to: 'B', weight: '1' }], /finite number or null/],
    [[{ from: 'A', to: 'B', weight: Infinity }], /invalid result cell/],
    [[{ from: 'A', to: 'B', weight: 1e308 }, { from: 'A', to: 'B', weight: 1e308 }], /SANKEY_WEIGHT_OVERFLOW/],
    [[{ from: 'A', to: 'B', weight: 0 }], /SANKEY_ZERO_FLOW_UNSUPPORTED/],
    [[{ from: 'A', to: 'A', weight: 1 }], /SANKEY_CYCLE_UNSUPPORTED/],
    [[...rows, { from: 'C', to: 'A', weight: 1 }], /SANKEY_CYCLE_UNSUPPORTED/],
  ]) assert.throws(() => compileVisual(input(data)), e => e instanceof CompileError && error.test(e.message));
});

test('sankey pinned rows render to SVG; empty and unavailable inputs stay distinct', () => {
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 600, height: 360 });
  try {
    for (const [data, state] of [[rows, 'ready'], [[], 'empty'], [null, 'unavailable']]) {
      const source = input(data); config(source).dataLabels = { visibility: 'VISIBLE' };
      const c = compileVisual(source); assert.equal(c.state, state);
      chart.setOption(c.option, true);
      const svg = chart.renderToSVGString();
      assert.match(svg, /<svg/); assert.doesNotMatch(svg, /NaN|Infinity/);
      if (state === 'ready') { assert.match(svg, />A</); assert.match(svg, />B</); assert.match(svg, />C</); }
      else { assert.deepEqual(c.option.series[0].data, []); assert.deepEqual(c.option.series[0].links, []); }
    }
  } finally { chart.dispose(); }
});

test('sankey display controls and API conversion preserve fields, links and sorting', () => {
  const source = input(rows);
  Object.assign(config(source), { legend: { visibility: 'HIDDEN' }, dataLabels: { visibility: 'VISIBLE' }, tooltip: { tooltipVisibility: 'HIDDEN' }, sortConfiguration: { categorySort: [{ fieldSort: { fieldId: 'from', direction: 'DESC' } }] } });
  const c = compileVisual(source);
  assert.deepEqual(c.option.series[0].data.map(n => n.name), ['B', 'C', 'A']);
  assert.equal(c.option.legend.show, false); assert.equal(c.option.tooltip.show, false); assert.equal(c.option.series[0].label.show, true);
  const apiKeys = v => Array.isArray(v) ? v.map(apiKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), apiKeys(v)])) : v;
  const api = apiKeys(source.definition);
  const converted = convertDefinition({ DataSetIdentifierDeclarations: [], Sheets: [{ SheetId: 'sheet', Visuals: [api] }] });
  assert.deepEqual(compileVisual({ ...source, definition: api, source: 'api' }).option, c.option);
  assert.deepEqual(compileVisual({ ...source, definition: converted.sheets[0].visuals[0] }).option, c.option);
});
