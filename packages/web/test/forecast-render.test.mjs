import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileVisual } from '../build/test/compiler.js';
import { init } from '../build/test/echarts.js';

const fixtures = JSON.parse(await readFile(new URL('../src/fixtures.generated.json', import.meta.url), 'utf8'));
const base = fixtures[1].sheets[0].visuals[1]; // LineChartVisual, MONTH date dimension, binding order_date -> month
const months = n => Array.from({ length: n }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);
const trendRows = months(12).map((month, i) => ({ month, revenue: 100 + 10 * i + ((i % 3) - 1) * 2 }));
const withForecast = (rows, forecast) => {
  const input = structuredClone(base);
  input.rows = rows;
  input.definition.LineChartVisual.ChartConfiguration.ForecastConfigurations = [forecast];
  return input;
};
const extras = option => option.series.filter(s => typeof s.id === 'string' && s.id.startsWith('forecast-'));

test('forecast config parses onto the model and renders dashed segment, band and divider', () => {
  const { model, option, forecastNote } = compileVisual(withForecast(trendRows, { PeriodsForward: 3, PeriodsBackward: 2, PredictionInterval: 95, Seasonality: 'NONE' }));
  assert.deepEqual(model.forecast, { enabled: true, periodsForward: 3, periodsBackward: 2, predictionInterval: 95, seasonality: 'none' });
  assert.equal(forecastNote, undefined);
  const found = extras(option);
  assert.equal(found.length, 3, 'band lower, band upper, segment');
  const seg = found.find(s => s.id.startsWith('forecast-seg'));
  assert.equal(seg.lineStyle.type, 'dashed');
  assert.equal(seg.markLine.data[0].xAxis, 11, 'divider at the last actual period');
  assert.equal(seg.data.length, 15);
  assert.equal(seg.data[11].forecastKind, 'join');
  assert.equal(seg.data[12].forecastKind, 'future');
  assert.ok(Math.abs(seg.data[12].value - 221.731) < 0.01, 'matches the pinned ETS forecast');
  assert.equal(seg.data[10].forecastKind, 'fit', 'periodsBackward renders fitted values');
  assert.equal(seg.data[9], null);
  const band = found.filter(s => s.id.startsWith('forecast-band'));
  assert.equal(band[0].stack, band[1].stack);
  assert.ok(band[1].areaStyle.opacity > 0);
  assert.deepEqual(option.xAxis.data.slice(-3), ['2026-01', '2026-02', '2026-03'], 'axis extends by grain steps');
});

test('forecast tooltip reads Forecast and shows the interval', () => {
  const { option } = compileVisual(withForecast(trendRows, { PeriodsForward: 3, PredictionInterval: 95, Seasonality: 'NONE' }));
  const seg = extras(option).find(s => s.id.startsWith('forecast-seg'));
  const text = option.tooltip.formatter([{ seriesId: seg.id, seriesName: seg.name, value: seg.data[12].value, data: seg.data[12], axisValue: '2026-01' }]);
  assert.match(text, /\(Forecast\): 221\.73 · 95% interval 215\.3–228\.16/);
});

test('fewer than 4 points: actuals only plus the quiet note', () => {
  const { option, forecastNote } = compileVisual(withForecast(trendRows.slice(0, 3), { PeriodsForward: 3 }));
  assert.equal(forecastNote, 'Not enough history to forecast — showing actuals. A forecast needs at least 4 data points.');
  assert.equal(extras(option).length, 0);
  assert.equal(option.series.length, 1);
});

test('seasonal requested with < 2 cycles: trend renders and the note says the seasonal part was skipped', () => {
  const rows = Array.from({ length: 18 }, (_, i) => ({ month: `2025-${String((i % 12) + 1).padStart(2, '0')}`, revenue: 50 + 20 * Math.sin(2 * Math.PI * i / 12) + i * 0.5 }))
    .map((r, i) => ({ ...r, month: `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}` }));
  const { option, forecastNote } = compileVisual(withForecast(rows, { PeriodsForward: 2, Seasonality: 'AUTOMATIC' }));
  assert.match(forecastNote, /Seasonality was skipped/);
  assert.ok(extras(option).length > 0, 'trend forecast still renders');
});

test('stored config on a non-date line chart is ignored with a warning and renders unchanged', () => {
  const input = withForecast(trendRows, { PeriodsForward: 3 });
  const category = input.definition.LineChartVisual.ChartConfiguration.FieldWells.LineChartAggregatedFieldWells.Category[0];
  category.CategoricalDimensionField = category.DateDimensionField;
  delete category.DateDimensionField;
  delete category.CategoricalDimensionField.DateGranularity;
  const { model, option } = compileVisual(input);
  assert.ok(model.warnings.some(w => w.includes('not a date dimension')));
  assert.equal(extras(option).length, 0);
  assert.equal(option.xAxis.data.length, 12);
});

test('no forecast config: option is untouched', () => {
  const input = structuredClone(base);
  input.rows = trendRows;
  const { option, forecastNote } = compileVisual(input);
  assert.equal(option.series.length, 1);
  assert.equal(forecastNote, undefined);
});

test('camelCase bundle dialect parses forecast configurations with boundaries', () => {
  const input = {
    source: 'bundle', path: 'test.forecast', bindings: { order_date: 'month', revenue: 'revenue' }, rows: trendRows,
    definition: { lineChartVisual: { visualId: 'v1', chartConfiguration: {
      fieldWells: { lineChartAggregatedFieldWells: {
        category: [{ dateDimensionField: { fieldId: 'order_date', column: { dataSetIdentifier: 'sales_data', columnName: 'order_date' }, dateGranularity: 'MONTH' } }],
        values: [{ numericalMeasureField: { fieldId: 'revenue', column: { dataSetIdentifier: 'sales_data', columnName: 'revenue' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } }],
      } },
      forecastConfigurations: [{ periodsForward: 2, predictionInterval: 90, seasonality: 'CUSTOM', customSeasonalityValue: 4, lowerBoundary: 0 }],
    } } },
  };
  const { model, option } = compileVisual(input);
  assert.deepEqual(model.forecast, { enabled: true, periodsForward: 2, periodsBackward: 0, predictionInterval: 90, seasonality: 4, lowerBoundary: 0 });
  assert.ok(extras(option).length > 0);
});

test('malformed forecast configuration fails closed', () => {
  assert.throws(() => compileVisual(withForecast(trendRows, { PeriodsForward: 3, PredictionInterval: 42 })), /prediction interval/);
  assert.throws(() => compileVisual(withForecast(trendRows, { Seasonality: 'CUSTOM' })), /custom seasonality/);
});

const areaForecast = (rows, forecast) => {
  const input = withForecast(rows, forecast);
  input.definition.LineChartVisual.ChartConfiguration.Type = 'AREA';
  return input;
};

test('area forecast matches line fitted/future segments and ordered bands, retaining only the actual area fill', () => {
  const config = { PeriodsForward: 3, PeriodsBackward: 2, PredictionInterval: 95, Seasonality: 'NONE' };
  const { model, option, forecastNote } = compileVisual(areaForecast(trendRows, config));
  const line = compileVisual(withForecast(trendRows, config));
  assert.equal(model.kind, 'area');
  const actuals = areaForecast(trendRows, config);
  delete actuals.definition.LineChartVisual.ChartConfiguration.ForecastConfigurations;
  assert.deepEqual(model.warnings, compileVisual(actuals).model.warnings, 'no extra forecast warning on dated areas');
  assert.equal(forecastNote, undefined);
  assert.deepEqual(extras(option), extras(line.option), 'same forecast math and overlay options as line');
  assert.deepEqual(option.xAxis.data, line.option.xAxis.data);
  assert.deepEqual(option.xAxis.data.slice(-3), ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(option.series[0].areaStyle, { opacity: 0.3 });
  assert.deepEqual(option.series[0].data, trendRows.map(r => r.revenue));
  const [lower, upper, segment] = extras(option);
  assert.equal(extras(option).length, 3);
  assert.equal(Object.hasOwn(lower, 'areaStyle'), false);
  assert.equal(Object.hasOwn(segment, 'areaStyle'), false);
  assert.equal(upper.areaStyle.opacity, 0.16);
  assert.equal(segment.data[10].forecastKind, 'fit');
  assert.deepEqual(segment.data[11], { value: trendRows[11].revenue, forecastKind: 'join' });
  for (let i = 12; i < 15; i++) {
    const point = segment.data[i];
    assert.equal(point.forecastKind, 'future');
    assert.ok(point.lower <= point.value && point.value <= point.upper);
    assert.equal(lower.data[i], point.lower);
    assert.equal(upper.data[i], point.upper - point.lower);
    assert.ok(upper.data[i] >= 0);
  }
  const tooltip = option.tooltip.formatter([{ seriesId: segment.id, seriesName: segment.name, value: segment.data[12].value, data: segment.data[12], axisValue: '2026-01' }]);
  assert.match(tooltip, /\(Forecast\): 221\.73 · 95% interval 215\.3–228\.16/);
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 800, height: 500 });
  try {
    chart.setOption(option);
    const svg = chart.renderToSVGString();
    assert.match(svg, /stroke-dasharray/);
    assert.doesNotMatch(svg, /NaN|Infinity/);
  } finally { chart.dispose(); }
});

test('faceted area forecasts each panel and measure from its own history and extends each axis', () => {
  const panels = [
    trendRows.map((r, i) => ({ ...r, category: 'Hardware', profit: 20 + i * 2 })),
    trendRows.slice(0, 6).map((r, i) => ({ ...r, category: 'Software', revenue: 300 - i * 7, profit: 80 - i * 3 })),
  ];
  const config = { PeriodsForward: 2, PeriodsBackward: 2, Seasonality: 'NONE' };
  const input = areaForecast(panels.flat(), config);
  const wells = input.definition.LineChartVisual.ChartConfiguration.FieldWells.LineChartAggregatedFieldWells;
  wells.SmallMultiples = [{ CategoricalDimensionField: { FieldId: 'category', Column: { DataSetIdentifier: 'sales_data', ColumnName: 'category' } } }];
  const profit = structuredClone(wells.Values[0]);
  profit.NumericalMeasureField.FieldId = 'profit';
  profit.NumericalMeasureField.Column.ColumnName = 'profit';
  wells.Values.push(profit);
  const { option, forecastNote } = compileVisual(input);
  assert.equal(forecastNote, undefined);
  assert.equal(option.xAxis.length, 2);
  assert.equal(option.series.length, 16, 'four actuals plus a segment and two band series per measure');
  assert.equal(extras(option).length, 12);
  for (const [panelIndex, rows] of panels.entries()) {
    assert.equal(option.xAxis[panelIndex].data.length, rows.length + 2);
    assert.equal(option.xAxis[panelIndex].data.at(-1), panelIndex === 0 ? '2026-02' : '2025-08');
    for (const [measureIndex, measure] of ['revenue', 'profit'].entries()) {
      const id = `${panelIndex}-${measureIndex}`;
      const actual = option.series[panelIndex * 2 + measureIndex];
      assert.deepEqual(actual.data, rows.map(r => r[measure]));
      assert.deepEqual(actual.areaStyle, { opacity: 0.3 });
      const segment = option.series.find(s => s.id === `forecast-seg-${id}`);
      const standalone = compileVisual(withForecast(rows.map(r => ({ month: r.month, revenue: r[measure] })), config));
      assert.deepEqual(segment.data, extras(standalone.option).find(s => s.id.startsWith('forecast-seg')).data);
      for (const prefix of ['forecast-seg', 'forecast-band-lo', 'forecast-band-hi']) {
        const series = option.series.find(s => s.id === `${prefix}-${id}`);
        assert.equal(series.xAxisIndex, panelIndex);
        assert.equal(series.yAxisIndex, panelIndex);
        assert.equal(Object.hasOwn(series, 'areaStyle'), prefix === 'forecast-band-hi');
      }
    }
  }
});

test('non-date area retains forecast configuration with an honest warning and unchanged actuals', () => {
  const input = areaForecast(trendRows, { PeriodsForward: 3 });
  const config = input.definition.LineChartVisual.ChartConfiguration;
  const category = config.FieldWells.LineChartAggregatedFieldWells.Category[0];
  category.CategoricalDimensionField = category.DateDimensionField;
  delete category.DateDimensionField;
  delete category.CategoricalDimensionField.DateGranularity;
  const { model, option } = compileVisual(input);
  assert.equal(model.forecast.periodsForward, 3);
  assert.ok(model.warnings.some(w => w.includes('not a date dimension')));
  assert.ok(model.warnings.every(w => !w.includes('not rendered for area charts')));
  assert.equal(extras(option).length, 0);
  delete config.ForecastConfigurations;
  assert.deepEqual(option, compileVisual(input).option);
});

test('area forecast preserves the line insufficient-history and seasonal-skip notes', () => {
  for (const rows of [trendRows.slice(0, 3), trendRows]) {
    const config = { PeriodsForward: 3, Seasonality: 'AUTOMATIC' };
    const area = compileVisual(areaForecast(rows, config));
    const line = compileVisual(withForecast(rows, config));
    assert.equal(area.forecastNote, line.forecastNote);
    assert.deepEqual(extras(area.option), extras(line.option));
    assert.deepEqual(area.option.series[0].areaStyle, { opacity: 0.3 });
    assert.match(area.forecastNote, rows.length < 4 ? /Not enough history to forecast/ : /Seasonality was skipped/);
  }
});

test('area with unparseable date values keeps the grain warning and omits overlays', () => {
  const { model, option } = compileVisual(areaForecast(trendRows.map((r, i) => ({ ...r, month: `invalid-${i}` })), { PeriodsForward: 3 }));
  assert.equal(extras(option).length, 0);
  assert.ok(model.warnings.some(w => w.includes('category values are not dates at the chart grain')));
});
