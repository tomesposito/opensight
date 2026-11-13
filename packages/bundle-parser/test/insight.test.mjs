import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBundleResource, parseSyntheticAnalysis } from '../dist/index.js';
const bundle = computations => ({ resourceType: 'analysis', analysisId: 'insights', name: 'Insights', definition: {
  dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 's', visuals: [{ insightVisual: { visualId: 'v', insightConfiguration: { computations } } }] }],
} });
const api = value => Array.isArray(value) ? value.map(api) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), api(v)])) : value;
test('insight parser retains other known computations and their unsupported properties', () => {
  for (const kind of ['totalAggregation', 'maximumMinimum', 'topBottomRanked', 'growthRate', 'periodOverPeriod', 'metricComparison']) {
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
    ...[undefined, null, 1, 367, 2.5, '12'].map(customSeasonalityValue => ({ seasonality: 'CUSTOM', customSeasonalityValue })),
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
