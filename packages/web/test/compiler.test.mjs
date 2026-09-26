import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileVisual, CompileError } from '../build/test/compiler.js';
import { init } from '../build/test/echarts.js';

const fixtures = JSON.parse(await readFile(new URL('../src/fixtures.generated.json', import.meta.url), 'utf8'));
const real = fixtures[0].sheets[0].visuals[0];
const sales = fixtures[1].sheets[0].visuals;
const sample = kind => structuredClone(sales.find(v => Object.hasOwn(v.definition, kind)));
const body = input => Object.values(input.definition)[0];
const compile = kind => compileVisual(sample(kind));

test('real camelCase pie compiles without invented rows, with title fallback and observed WHOLE radius', () => {
  const { model, option, state } = compileVisual(real);
  assert.equal(model.kind, 'pie');
  assert.equal(model.title, 'deaths by country');
  assert.equal(model.sort.direction, 'DESC');
  assert.equal(model.measures[0].column, 'deaths');
  assert.deepEqual(option.series[0].radius, ['0%', '70%']);
  assert.deepEqual(option.series[0].data, []);
  assert.equal(option.series[0].showEmptyCircle, false);
  assert.equal(option.series[0].stillShowZeroSum, false);
  assert.equal(state, 'unavailable');
  assert.ok(model.warnings.every(w => w.startsWith(real.path)));
});

test('real field IDs bind to aggregate columns and sort numerically without mutating results', () => {
  const input = structuredClone(real);
  input.rows = [{ country: 'A', deaths: 2 }, { country: 'B', deaths: 10 }];
  const before = structuredClone(input);
  assert.deepEqual(compileVisual(input).option.series[0].data, [{ name: 'B', value: 10 }, { name: 'A', value: 2 }]);
  assert.deepEqual(input, before);
});

for (const [thickness, radius] of Object.entries({ WHOLE: '0%', SMALL: '56%', MEDIUM: '42%', LARGE: '28%' })) {
  test(`documented donut arc ${thickness} maps to an explicit inner radius`, () => {
    const input = sample('PieChartVisual');
    body(input).ChartConfiguration.DonutOptions = { ArcOptions: { ArcThickness: thickness } };
    assert.deepEqual(compileVisual(input).option.series[0].radius, [radius, '70%']);
  });
}

test('sales pie keeps the reference category names and measures', () => {
  assert.deepEqual(compile('PieChartVisual').option.series[0].data, [{ name: 'Hardware', value: 200 }, { name: 'Software', value: 300 }]);
});
test('vertical bar uses category/value axes and reference revenue', () => {
  const { option } = compile('BarChartVisual');
  assert.equal(option.xAxis.type, 'category');
  assert.deepEqual(option.xAxis.data, ['East']);
  assert.equal(option.yAxis.type, 'value');
  assert.equal(option.series[0].type, 'bar');
  assert.deepEqual(option.series[0].data, [500]);
});
test('horizontal stacked bars preserve independent preaggregated measures', () => {
  const input = sample('BarChartVisual');
  const config = body(input).ChartConfiguration;
  config.Orientation = 'HORIZONTAL';
  config.BarsArrangement = 'STACKED';
  const field = structuredClone(config.FieldWells.BarChartAggregatedFieldWells.Values[0]);
  field.NumericalMeasureField.FieldId = 'units';
  field.NumericalMeasureField.Column.ColumnName = 'units';
  config.FieldWells.BarChartAggregatedFieldWells.Values.push(field);
  input.rows[0].units = 7;
  const { option } = compileVisual(input);
  assert.equal(option.xAxis.type, 'value');
  assert.deepEqual(option.yAxis.data, ['East']);
  assert.equal(option.yAxis.inverse, true);
  assert.deepEqual(option.series.map(s => s.stack), ['values', 'values']);
  assert.deepEqual(option.series.map(s => s.data), [[500], [7]]);
});
test('KPI uses an ECharts graphic with exactly the reference aggregate', () => {
  assert.equal(compile('KPIVisual').option.graphic[0].style.text, '500');
});
test('KPI distinguishes zero, null, empty results and unavailable data', () => {
  const input = sample('KPIVisual');
  for (const [rows, label, state] of [[[{ revenue: 0 }], '0', 'ready'], [[{ revenue: null }], 'No value', 'ready'], [[], 'No results', 'empty'], [null, 'Data unavailable', 'unavailable']]) {
    input.rows = rows;
    const compiled = compileVisual(input);
    assert.equal(compiled.option.graphic[0].style.text, label);
    assert.equal(compiled.state, state);
  }
});
test('line uses the explicit month result alias and preserves the zero month', () => {
  const { option } = compile('LineChartVisual');
  assert.deepEqual(option.xAxis.data, ['2025-01', '2025-03', '2025-04']);
  assert.equal(option.series[0].type, 'line');
  assert.deepEqual(option.series[0].data, [400, 0, 100]);
  assert.equal(option.series[0].connectNulls, false);
});
test('ordinary table exposes the precomputed calculation without evaluating it', () => {
  assert.deepEqual(compile('TableVisual').table, { columns: ['region', 'revenue', 'discounted_revenue'], rows: [['East', 500, 450]] });
});
test('hidden title, data labels, tooltip and legend are honored', () => {
  const input = sample('PieChartVisual');
  body(input).Title.Visibility = 'HIDDEN';
  body(input).ChartConfiguration.DataLabels = { Visibility: 'HIDDEN' };
  body(input).ChartConfiguration.Tooltip = { TooltipVisibility: 'HIDDEN' };
  body(input).ChartConfiguration.Legend = { Visibility: 'HIDDEN' };
  const { model, option } = compileVisual(input);
  assert.equal(model.titleVisible, false);
  assert.equal(option.tooltip.show, false);
  assert.equal(option.series[0].label.show, false);
  assert.equal(option.legend.show, false);
});
test('rich title falls back to plain generated text and reports a located warning', () => {
  const input = sample('BarChartVisual');
  body(input).Title.FormatText = { RichText: '<img src=x onerror=alert(1)>' };
  const { model, option } = compileVisual(input);
  assert.equal(model.title, 'revenue by region');
  assert.match(model.warnings[0], /Title: rich title/);
  assert.equal(option.tooltip.renderMode, 'richText');
});
test('null chart measures remain gaps instead of becoming zero', () => {
  const input = sample('LineChartVisual');
  input.rows[0].revenue = null;
  assert.deepEqual(compileVisual(input).option.series[0].data, [null, 0, 100]);
});

const rejections = [
  ['unknown visual', input => { input.definition = { HeatMapVisual: { VisualId: 'heat' } }; }],
  ['ambiguous visual union', input => { input.definition.KPIVisual = { VisualId: 'kpi' }; }],
  ['unobserved bundle bar', input => { input.source = 'bundle'; input.definition = { barChartVisual: { visualId: 'bar' } }; }],
  ['unknown configuration', input => { body(input).ChartConfiguration.ReferenceLines = [{}]; }],
  ['unsupported percent stack', input => { body(input).ChartConfiguration.BarsArrangement = 'STACKED_PERCENT'; }],
  ['color field well', input => { body(input).ChartConfiguration.FieldWells.BarChartAggregatedFieldWells.Colors = [{}]; }],
  ['field calculation', input => { body(input).ChartConfiguration.FieldWells.BarChartAggregatedFieldWells.Values[0] = { CalculatedMeasureField: { FieldId: 'x', Expression: 'sum({revenue})' } }; }],
  ['missing measure', input => { body(input).ChartConfiguration.FieldWells.BarChartAggregatedFieldWells.Values = []; }],
  ['extra category', input => { const w = body(input).ChartConfiguration.FieldWells.BarChartAggregatedFieldWells; w.Category.push(structuredClone(w.Category[0])); }],
  ['cross-dataset measure', input => { body(input).ChartConfiguration.FieldWells.BarChartAggregatedFieldWells.Values[0].NumericalMeasureField.Column.DataSetIdentifier = 'other'; }],
  ['unsupported aggregation', input => { body(input).ChartConfiguration.FieldWells.BarChartAggregatedFieldWells.Values[0].NumericalMeasureField.AggregationFunction.SimpleNumericalAggregation = 'MEDIAN'; }],
  ['missing result column', input => { delete input.rows[0].revenue; }],
  ['nonfinite measure', input => { input.rows[0].revenue = Infinity; }],
  ['string measure', input => { input.rows[0].revenue = '500'; }],
  ['duplicate aggregate category', input => { input.rows.push({ ...input.rows[0] }); }],
  ['unbound sort', input => { body(input).ChartConfiguration.SortConfiguration = { CategorySort: [{ FieldSort: { FieldId: 'missing', Direction: 'ASC' } }] }; }],
  ['explicit top-N', input => { body(input).ChartConfiguration.SortConfiguration = { CategoryItemsLimit: { ItemsLimit: 1, OtherCategories: 'INCLUDE' } }; }],
  ['actions', input => { body(input).Actions = [{ CustomActionId: 'click' }]; }],
];
for (const [name, change] of rejections) {
  test(`rejects ${name} with a located diagnostic`, () => {
    const input = sample('BarChartVisual');
    change(input);
    assert.throws(() => compileVisual(input), error => error instanceof CompileError && error.path.startsWith(input.path));
  });
}
test('KPI rejects target/trend wells and multiple aggregate rows', () => {
  for (const key of ['TargetValues', 'TrendGroups']) {
    const input = sample('KPIVisual');
    body(input).ChartConfiguration.FieldWells[key] = [{}];
    assert.throws(() => compileVisual(input), CompileError);
  }
  const input = sample('KPIVisual');
  input.rows.push({ revenue: 1 });
  assert.throws(() => compileVisual(input), /exactly one aggregate row/);
});
test('pie rejects null or negative slices', () => {
  for (const value of [null, -1]) {
    const input = sample('PieChartVisual');
    input.rows[0].revenue = value;
    assert.throws(() => compileVisual(input), /nonnegative/);
  }
});
test('date aliases are explicit and cannot silently fall back to a different column', () => {
  const input = sample('LineChartVisual');
  input.bindings = {};
  assert.throws(() => compileVisual(input), /missing result column order_date/);
});

for (const input of [real, ...sales.filter(v => !v.definition.TableVisual)]) {
  const name = Object.keys(input.definition)[0];
  test(`ECharts SVG renderer accepts compiled ${input.source} ${name} options`, () => {
    const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 600, height: 320 });
    try {
      chart.setOption(compileVisual(input).option);
      const svg = chart.renderToSVGString();
      assert.match(svg, /<svg[^>]+width="600"/);
      if (input.definition.KPIVisual) assert.match(svg, />500<\/text>/);
      if (input.definition.PieChartVisual) assert.match(svg, /Hardware/);
    } finally { chart.dispose(); }
  });
}
