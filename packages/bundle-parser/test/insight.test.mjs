import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBundleResource, parseSyntheticAnalysis } from '../dist/index.js';
const bundle = computations => ({ resourceType: 'analysis', analysisId: 'insights', name: 'Insights', definition: {
  dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 's', visuals: [{ insightVisual: { visualId: 'v', insightConfiguration: { computations } } }] }],
} });
test('insight parser retains known computations including unsupported forecasts', () => {
  for (const kind of ['totalAggregation', 'maximumMinimum', 'topBottomRanked', 'growthRate', 'periodOverPeriod', 'metricComparison', 'forecast']) {
    const raw = bundle([{ [kind]: { computationId: 'c', futureOption: 'preserved' } }]);
    assert.deepEqual(parseBundleResource(raw), raw);
  }
});
test('insight parser rejects unknown, malformed and anomaly computations by name in both dialects', () => {
  const api = value => Array.isArray(value) ? value.map(api) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), api(v)])) : value;
  for (const [computations, error] of [[[{ futureComputation: {} }], /INSIGHT_COMPUTATION_UNKNOWN/], [[{}], /INSIGHT_COMPUTATION_INVALID/], [[{ anomaly: {} }], /INSIGHT_ANOMALY_UNSUPPORTED/], [[{ totalAggregation: {} }], /computationId/i]]) {
    assert.throws(() => parseBundleResource(bundle(computations)), error);
    const raw = api(bundle(computations)); raw.ResourceType = 'Analysis';
    assert.throws(() => parseSyntheticAnalysis(raw), error);
  }
});
