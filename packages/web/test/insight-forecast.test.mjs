import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInsight, insightWells, rebindInsight, InsightError } from '../build/test/insight-configuration.js';
import { DEFAULT_FORECAST_CONFIG } from '../build/test/forecast.js';
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
