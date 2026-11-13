import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInsight, insightWells, rebindInsight, InsightError } from '../build/test/insight-configuration.js';
import { computeForecast, DEFAULT_FORECAST_CONFIG } from '../build/test/forecast.js';
import { insightNarrative } from '../build/test/insight-narrative.js';
import { formatNumber } from '@opensight/query-engine/browser';
import { compileVisual } from '../build/test/compiler.js';

const field = column => ({ id: column, column, dataSet: 'sales' });
const time = { ...field('date'), dateGranularity: 'MONTH' }, measure = field('revenue');
const configuration = (properties, body = {}) => ({ computations: [{ forecast: { computationId: 'forecast', ...(properties === undefined ? {} : { forecastProperties: properties }), ...body } }] });
const normalize = (properties, body) => normalizeInsight(configuration(properties, body), [time], [measure]);
const dimension = f => ({ dateDimensionField: { fieldId: f.id, column: { columnName: f.column, dataSetIdentifier: f.dataSet }, dateGranularity: f.dateGranularity } });
const value = f => ({ numericalMeasureField: { fieldId: f.id, column: { columnName: f.column, dataSetIdentifier: f.dataSet }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } });
const invalidProperties = [null, [], 3, 'forecast',
  ...['periodsForward', 'periodsBackward'].flatMap(key => [-1, 101, 1.5, '3', null, Infinity].map(v => ({ [key]: v }))),
  ...[0, 85, 100, '95', null].map(predictionInterval => ({ predictionInterval })),
  ...['auto', 'unknown', null, 2].map(seasonality => ({ seasonality })),
  ...[undefined, null, 1, 367, 2.5, '12'].map(customSeasonalityValue => ({ seasonality: 'CUSTOM', customSeasonalityValue })),
  ...['lowerBoundary', 'upperBoundary'].flatMap(key => [Infinity, -Infinity, NaN, '10', null].map(v => ({ [key]: v }))),
  { lowerBoundary: 10, upperBoundary: 9 },
];

test('forecast normalization uses chart defaults and accepts all supported properties without mutation', () => {
  assert.deepEqual(normalize()[0], { kind: 'forecast', id: 'forecast', measure: 0, forecast: DEFAULT_FORECAST_CONFIG });
  assert.deepEqual(normalize({})[0], normalize()[0]);
  for (const seasonality of ['AUTOMATIC', 'NONE', 'CUSTOM']) for (const predictionInterval of [80, 90, 95]) {
    const properties = { periodsForward: 100, periodsBackward: 100, predictionInterval, seasonality, customSeasonalityValue: 366, lowerBoundary: -5, upperBoundary: 1000 };
    const before = structuredClone(properties), result = normalize(properties, { name: 'Projection' })[0].forecast;
    assert.deepEqual(result, { enabled: true, periodsForward: 100, periodsBackward: 100, predictionInterval, seasonality: seasonality === 'CUSTOM' ? 366 : seasonality === 'NONE' ? 'none' : 'auto', lowerBoundary: -5, upperBoundary: 1000 });
    assert.deepEqual(properties, before);
  }
  assert.equal(normalize({ periodsForward: 0, periodsBackward: 0, seasonality: 'CUSTOM', customSeasonalityValue: 2 })[0].forecast.seasonality, 2);
});

test('forecast rejects malformed properties and unknown keys before rows or wells can be queried', () => {
  const error = code => e => e instanceof InsightError && e.code === code;
  for (const properties of invalidProperties) {
    assert.throws(() => normalize(properties), error('INSIGHT_COMPUTATION_INVALID'), JSON.stringify(properties));
    assert.throws(() => insightWells(configuration(properties)), error('INSIGHT_COMPUTATION_INVALID'));
  }
  for (const properties of [{ future: true }, { enabled: true }, { PeriodsForward: 3 }]) assert.throws(() => normalize(properties), error('INSIGHT_CONFIGURATION_UNSUPPORTED'));
  for (const body of [{ future: true }, { periodsForward: 2 }, { category: dimension(time) }]) assert.throws(() => normalize(undefined, body), error('INSIGHT_CONFIGURATION_UNSUPPORTED'));
  for (const body of [null, [], 'forecast', 0]) assert.throws(() => normalizeInsight({ computations: [{ forecast: body }] }, [time], [measure]), error('INSIGHT_COMPUTATION_INVALID'));
  for (const body of [{ computationId: '' }, { computationId: 1 }, { name: 2 }]) assert.throws(() => normalize(undefined, body), error('INSIGHT_COMPUTATION_INVALID'));
  assert.throws(() => normalizeInsight(configuration(), [field('region')], [measure]), error('INSIGHT_TIME_REQUIRED'));
  assert.throws(() => normalizeInsight({ computations: [{ forecastComputation: { computationId: 'f' } }] }, [time], [measure]), error('INSIGHT_COMPUTATION_UNSUPPORTED'));
});

test('forecast time and value bindings project, normalize and rebind without losing properties', () => {
  const config = configuration({ periodsBackward: 2, lowerBoundary: 0 }, { time: dimension(time), value: value(measure) });
  assert.deepEqual(insightWells(config), { category: [dimension(time)], values: [value(measure)] });
  assert.equal(normalizeInsight(config, [time], [field('profit'), measure])[0].measure, 1);
  const newTime = { ...field('invoice_date'), dateGranularity: 'YEAR' }, newMeasure = field('profit');
  const rebound = rebindInsight(config, [dimension(newTime)], [value(newMeasure)]);
  assert.deepEqual(insightWells(rebound), { category: [dimension(newTime)], values: [value(newMeasure)] });
  assert.deepEqual(rebound.computations[0].forecast.forecastProperties, config.computations[0].forecast.forecastProperties);
  assert.equal(normalizeInsight(rebound, [newTime], [newMeasure])[0].kind, 'forecast');
  assert.throws(() => normalizeInsight(config, [newTime], [measure]), /INSIGHT_FIELD_UNBOUND/);
  assert.throws(() => normalizeInsight(config, [time], [newMeasure]), /INSIGHT_FIELD_UNBOUND/);
});

test('forecast properties agree with chart validation and defaults', () => {
  const chart = properties => compileVisual({ source: 'bundle', path: '$', rows: null, bindings: {}, definition: { lineChartVisual: { visualId: 'chart', chartConfiguration: {
    fieldWells: { lineChartAggregatedFieldWells: { category: [dimension(time)], values: [value(measure)] } }, forecastConfigurations: [properties],
  } } } });
  for (const properties of [{}, { periodsForward: 0 }, { seasonality: 'CUSTOM', customSeasonalityValue: 12 }, { predictionInterval: 80, periodsBackward: 3, lowerBoundary: -10, upperBoundary: 10 }]) assert.deepEqual(normalize(properties)[0].forecast, chart(properties).model.forecast);
  for (const properties of invalidProperties) assert.throws(() => chart(properties), undefined, JSON.stringify(properties));
});

const series = [10, 14, 12, 20, 19, 25];
const narrative = (rows, properties, category = time, formatting = { decimalPlaces: 2 }) => insightNarrative(rows, { category, measures: [measure], computations: configuration(properties), formatting });
const seriesRows = series.map((n, i) => ({ category: `2024-0${i + 1}`, values: [n] }));
test('forecast sentences use the shared engine, final interval, formatting and chronological date labels at every grain', () => {
  for (const [grain, labels, finalPeriod] of [
    ['MONTH', seriesRows.map(r => r.category), '2024-09'],
    ['QUARTER', ['2023-Q1', '2023-Q2', '2023-Q3', '2023-Q4', '2024-Q1', '2024-Q2'], '2025-Q1'],
    ['YEAR', ['2019', '2020', '2021', '2022', '2023', '2024'], '2027'],
    ['DAY', ['2024-02-24', '2024-02-25', '2024-02-26', '2024-02-27', '2024-02-28', '2024-02-29'], '2024-03-03'],
  ]) {
    const rows = series.map((n, i) => ({ category: labels[i], values: [n] })), before = structuredClone(rows);
    const final = computeForecast(series, grain, DEFAULT_FORECAST_CONFIG).future.at(-1);
    const result = narrative(rows.toReversed(), undefined, { ...time, dateGranularity: grain });
    assert.equal(result.text, `Statistical forecast for revenue in 3 ${grain.toLowerCase()}s (${finalPeriod}): ${formatNumber(final.value, 2)}; 95% prediction interval ${formatNumber(final.lower, 2)}–${formatNumber(final.upper, 2)}.`);
    assert.deepEqual(result.paragraphs[0].parts.filter(p => p.value !== undefined).map(p => p.value), [final.value, final.lower, final.upper]);
    assert.deepEqual(narrative(rows, undefined, { ...time, dateGranularity: grain }), result);
    assert.deepEqual(rows, before);
  }
  assert.equal(narrative(seriesRows.map(r => ({ ...r, category: `${r.category}-01T00:00:00Z` }))).text, narrative(seriesRows).text);
  assert.match(narrative(seriesRows, { periodsForward: 1 }, time, { decimalPlaces: 1, names: { revenue: 'Sales' } }).text, /Statistical forecast for Sales in 1 month \(2024-07\): \d+\.\d;/);
});

test('forecast honors intervals, custom seasonality, boundaries, nulls and bound measure; backward periods do not change the sentence', () => {
  const properties = { periodsForward: 2, periodsBackward: 3, predictionInterval: 80, seasonality: 'CUSTOM', customSeasonalityValue: 2, lowerBoundary: 0, upperBoundary: 50 };
  const config = normalize(properties)[0].forecast;
  const final = computeForecast(series, 'MONTH', config).future.at(-1);
  const rows = [{ category: '2023-12', values: [null] }, ...seriesRows, { category: '2024-07', values: [null] }];
  const result = narrative(rows, properties);
  assert.match(result.text, /in 2 months \(2024-09\).*80% prediction interval/);
  assert.deepEqual(result.paragraphs[0].parts.filter(p => p.value !== undefined).map(p => p.value), [final.value, final.lower, final.upper]);
  assert.deepEqual(result, narrative(rows, { ...properties, periodsBackward: 100 }));
  const selected = insightNarrative(rows.map(r => ({ ...r, values: [999, r.values[0]] })), { category: time, measures: [field('profit'), measure], computations: configuration(properties, { value: value(measure) }), formatting: { decimalPlaces: 2 } });
  assert.deepEqual(selected, result);
  const bounded = narrative(seriesRows, { lowerBoundary: 20, upperBoundary: 26 });
  const expected = computeForecast(series, 'MONTH', { ...DEFAULT_FORECAST_CONFIG, lowerBoundary: 20, upperBoundary: 26 }).future.at(-1);
  assert.deepEqual(bounded.paragraphs[0].parts.filter(p => p.value !== undefined).map(p => p.value), [expected.value, expected.lower, expected.upper]);
});

test('forecast unavailable cases contain no invented computed values', () => {
  for (const [rows, properties, reason] of [
    [seriesRows.slice(0, 3), {}, /at least 4 usable data points/],
    [seriesRows.map(r => ({ ...r, values: [null] })), {}, /at least 4 usable data points/],
    [seriesRows.map((r, i) => i < 3 ? r : { ...r, values: [null] }), {}, /at least 4 usable data points/],
    [seriesRows, { periodsForward: 0, periodsBackward: 3 }, /no future periods requested/],
  ]) {
    const result = narrative(rows, properties);
    assert.match(result.text, /Statistical forecast for revenue: unavailable/); assert.match(result.text, reason);
    assert.deepEqual(result.paragraphs.flatMap(p => p.parts).filter(p => p.value !== undefined), []);
  }
  assert.deepEqual(narrative([]), { paragraphs: [], text: '' }); // Common empty-result state stays intact.
});

test('forecast rejects duplicate periods, invalid dates and nonfinite values before projecting', () => {
  for (const category of ['2024-01', '2024-01-01', '2024-01-01T00:00:00Z']) assert.throws(() => narrative([...seriesRows, { category, values: [1] }]), /INSIGHT_VALUE_INVALID/);
  for (const category of ['not-a-date', '2024-02-30', null]) assert.throws(() => narrative([{ category, values: [1] }]), /INSIGHT_TIME_REQUIRED/);
  for (const n of [Infinity, NaN, '3']) assert.throws(() => narrative([{ category: '2024-01', values: [n] }]), /INSIGHT_VALUE_INVALID/);
});
