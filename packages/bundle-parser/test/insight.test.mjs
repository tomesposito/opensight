import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBundleResource, parseSyntheticAnalysis } from '../dist/index.js';
const bundle = computations => ({ resourceType: 'analysis', analysisId: 'insights', name: 'Insights', definition: {
  dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 's', visuals: [{ insightVisual: { visualId: 'v', insightConfiguration: { computations } } }] }],
} });
const api = value => Array.isArray(value) ? value.map(api) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), api(v)])) : value;
test('insight parser retains other known computations and their unsupported properties', () => {
  for (const kind of ['totalAggregation', 'maximumMinimum', 'topBottomRanked', 'growthRate', 'periodOverPeriod', 'metricComparison', 'topBottomMovers']) {
    const raw = bundle([{ [kind]: { computationId: 'c', futureOption: 'preserved' } }]);
    assert.deepEqual(parseBundleResource(raw), raw);
  }
});
test('insight parser rejects unknown, malformed and anomaly computations by name in both dialects', () => {
  for (const [computations, error] of [[[{ futureComputation: {} }], /INSIGHT_COMPUTATION_UNKNOWN/], [[{}], /INSIGHT_COMPUTATION_INVALID/], [[{ anomaly: {} }], /INSIGHT_ANOMALY_UNSUPPORTED/], [[{ totalAggregation: {} }], /computationId/i]]) {
    assert.throws(() => parseBundleResource(bundle(computations)), error);
    const raw = api(bundle(computations)); raw.ResourceType = 'Analysis';
    assert.throws(() => parseSyntheticAnalysis(raw), error);
  }
});

test('insight parser retains valid forecast computations unchanged in both dialects', () => {
  for (const forecastProperties of [undefined, {}, { periodsForward: 0, periodsBackward: 100, predictionInterval: 80, seasonality: 'NONE' }, { periodsForward: 100, predictionInterval: 90, seasonality: 'CUSTOM', customSeasonalityValue: 366, lowerBoundary: -5, upperBoundary: 100 }]) {
    const raw = bundle([{ forecast: { computationId: 'forecast', name: 'Projection', ...(forecastProperties === undefined ? {} : { forecastProperties }) } }]);
    assert.deepEqual(parseBundleResource(raw), raw);
    const native = api(raw); native.ResourceType = 'Analysis';
    assert.deepEqual(parseSyntheticAnalysis(native), native);
  }
});

test('insight parser reports malformed forecast properties with named errors in both dialects', () => {
  const invalid = [null, [], 1, 'invalid',
    ...['periodsForward', 'periodsBackward'].flatMap(key => [-1, 101, 1.5, '3', null, Infinity].map(v => ({ [key]: v }))),
    ...[85, '95', null].map(predictionInterval => ({ predictionInterval })),
    ...['auto', null, 2].map(seasonality => ({ seasonality })),
    ...[undefined, null, 1, 367, 2.5, '12', 'auto', 'none'].map(customSeasonalityValue => ({ seasonality: 'CUSTOM', customSeasonalityValue })),
    ...['lowerBoundary', 'upperBoundary'].flatMap(key => [Infinity, -Infinity, NaN, '10', null].map(v => ({ [key]: v }))),
    { lowerBoundary: 2, upperBoundary: 1 },
  ];
  const bodies = [
    ...invalid.map(forecastProperties => [{ computationId: 'forecast', forecastProperties }, /INSIGHT_COMPUTATION_INVALID/]),
    ...[null, [], {}, { computationId: '' }, { computationId: 'bad id' }, { computationId: 'f', name: 1 }].map(body => [body, /INSIGHT_COMPUTATION_INVALID/]),
    ...[{ future: true }, { periodsForward: 3 }, { forecastProperties: { future: true } }].map(extra => [{ computationId: 'f', ...extra }, /INSIGHT_CONFIGURATION_UNSUPPORTED/]),
  ];
  for (const [body, error] of bodies) {
    const raw = bundle([{ forecast: body }]);
    assert.throws(() => parseBundleResource(raw), error);
    const native = api(raw); native.ResourceType = 'Analysis';
    assert.throws(() => parseSyntheticAnalysis(native), error);
  }
});

test('insight parser retains valid period-to-date computations unchanged in both dialects', () => {
  for (const periodTimeGranularity of [undefined, 'DAY', 'MONTH', 'QUARTER', 'YEAR']) {
    const raw = bundle([{ periodToDate: { computationId: 'period-to-date_1', name: 'Revenue to date',
      time: { dateDimensionField: { fieldId: 'date', column: { columnName: 'date', dataSetIdentifier: 'sales' }, dateGranularity: 'DAY' } },
      value: { numericalMeasureField: { fieldId: 'revenue', column: { columnName: 'revenue', dataSetIdentifier: 'sales' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } },
      ...(periodTimeGranularity === undefined ? {} : { periodTimeGranularity }),
    } }]);
    assert.deepEqual(parseBundleResource(raw), raw);
    const native = api(raw); native.ResourceType = 'Analysis';
    assert.deepEqual(parseSyntheticAnalysis(native), native);
  }
});

test('insight parser retains valid unique-values computations unchanged in both dialects', () => {
  const raw = bundle([{ uniqueValues: { computationId: 'unique-values_1', name: 'Regions',
    category: { categoricalDimensionField: { fieldId: 'region', column: { columnName: 'region', dataSetIdentifier: 'sales' } } },
  } }]);
  assert.deepEqual(parseBundleResource(raw), raw);
  const native = api(raw); native.ResourceType = 'Analysis';
  assert.deepEqual(parseSyntheticAnalysis(native), native);
  const bare = bundle([{ uniqueValues: { computationId: 'u' } }]);
  assert.deepEqual(parseBundleResource(bare), bare);
});

test('insight parser rejects malformed unique-values bodies with named errors in both dialects', () => {
  const bodies = [
    ...[null, [], 3, 'invalid', {}, { computationId: '' }, { computationId: 'bad id' }, { computationId: 'x'.repeat(513) }, { computationId: 'u', name: 1 }].map(body => [body, /INSIGHT_COMPUTATION_INVALID/]),
    ...[{ future: true }, { value: {} }, { time: {} }, { resultSize: 3 }].map(extra => [{ computationId: 'u', ...extra }, /INSIGHT_CONFIGURATION_UNSUPPORTED/]),
  ];
  for (const [body, error] of bodies) {
    const raw = bundle([{ uniqueValues: body }]);
    assert.throws(() => parseBundleResource(raw), error);
    const native = api(raw); native.ResourceType = 'Analysis';
    assert.throws(() => parseSyntheticAnalysis(native), error);
  }
  // Only the active dialect's property names are allowed.
  assert.throws(() => parseBundleResource(bundle([{ uniqueValues: { computationId: 'u', Category: {} } }])), /INSIGHT_CONFIGURATION_UNSUPPORTED/);
});

test('insight parser rejects malformed period-to-date bodies with named errors in both dialects', () => {
  const bodies = [
    ...[null, [], 3, 'invalid', {}, { computationId: '' }, { computationId: 'bad id' }, { computationId: 'x'.repeat(513) }, { computationId: 'p', name: 1 }].map(body => [body, /INSIGHT_COMPUTATION_INVALID/]),
    ...[null, '', 'month', 'WEEK', 'HOUR', 1, [], {}].map(periodTimeGranularity => [{ computationId: 'p', periodTimeGranularity }, /INSIGHT_COMPUTATION_INVALID/]),
    ...[{ future: true }, { periodSize: 2 }].map(extra => [{ computationId: 'p', ...extra }, /INSIGHT_CONFIGURATION_UNSUPPORTED/]),
  ];
  for (const [body, error] of bodies) {
    const raw = bundle([{ periodToDate: body }]);
    assert.throws(() => parseBundleResource(raw), error);
    const native = api(raw); native.ResourceType = 'Analysis';
    assert.throws(() => parseSyntheticAnalysis(native), error);
  }
  // Only the active dialect's property names are allowed.
  assert.throws(() => parseBundleResource(bundle([{ periodToDate: { computationId: 'p', PeriodTimeGranularity: 'MONTH' } }])), /INSIGHT_CONFIGURATION_UNSUPPORTED/);
  const native = api(bundle([{ periodToDate: { computationId: 'p' } }])); native.ResourceType = 'Analysis';
  native.Definition.Sheets[0].Visuals[0].InsightVisual.InsightConfiguration.Computations[0].PeriodToDate.periodTimeGranularity = 'MONTH';
  assert.throws(() => parseSyntheticAnalysis(native), /INSIGHT_CONFIGURATION_UNSUPPORTED/);
});
