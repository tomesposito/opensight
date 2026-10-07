import test from 'node:test';
import assert from 'node:assert/strict';
import { insightNarrative, InsightError } from '../build/test/insight-narrative.js';
const field = column => ({ id: column, column, dataSet: 'sales' });
const base = { category: field('region'), measures: [field('revenue')] };
const rows = [100, 300, 200, null].map((n, i) => ({ category: ['East', 'West', 'North', 'South'][i], values: [n] }));
const withComputation = (kind, options = {}, input = base) => ({ ...input, computations: { computations: [{ [kind]: { computationId: 'c', ...options } }] } });
test('narratives compute total, extrema and shares from aggregated rows without mutation', () => {
  const before = structuredClone(rows), n = insightNarrative(rows, base);
  assert.match(n.text, /Total revenue: 600/); assert.match(n.text, /Highest revenue: West \(300, 50.00% of total\)/);
  assert.match(n.text, /Lowest revenue: East \(100, 16.67% of total\)/); assert.match(n.text, /1 null group excluded/);
  assert.deepEqual(n.paragraphs[0].parts.filter(p => p.value !== undefined).map(p => p.value), [600]);
  assert.deepEqual(rows, before);
});
test('ranked narratives honor direction, default 3, configurable N and stable ties', () => {
  assert.match(insightNarrative(rows, withComputation('topBottomRanked', { type: 'TOP' })).text, /West \(300\); North \(200\); East \(100\)/);
  assert.match(insightNarrative(rows, withComputation('topBottomRanked', { type: 'BOTTOM', resultSize: 2 })).text, /East \(100\); North \(200\)/);
  const tied = [{ category: 'B', values: [4] }, { category: 'A', values: [4] }];
  assert.equal(insightNarrative(tied, base).text, insightNarrative(tied.toReversed(), base).text);
});
test('period and growth computations compare the latest calendar period in UTC', () => {
  const input = { ...base, category: { ...field('month'), dateGranularity: 'MONTH' } };
  const periods = [{ category: '2024-02-01', values: [150] }, { category: '2024-01-01', values: [100] }];
  for (const kind of ['growthRate', 'periodOverPeriod']) {
    const n = insightNarrative(periods, withComputation(kind, {}, input));
    assert.match(n.text, /150 vs 100; change 50 \(50.00%\)/);
    assert.match(insightNarrative(periods.slice(0, 1), withComputation(kind, {}, input)).text, /previous period unavailable/);
    assert.match(insightNarrative([{ category: '2024-02-01', values: [150] }, { category: '2023-12-01', values: [100] }], withComputation(kind, {}, input)).text, /previous period unavailable/);
  }
});
test('metric comparison uses the shared absolute-base percentDifference semantics', () => {
  const input = { ...base, measures: [field('revenue'), field('profit')] };
  assert.match(insightNarrative([{ category: 'East', values: [150, 100] }, { category: 'West', values: [50, 0] }], input).text, /difference 100 \(100.00%\)/);
  assert.match(insightNarrative([{ category: 'East', values: [-50, -100] }], input).text, /difference 50 \(50.00%\)/);
});
test('null, zero and empty inputs never invent values or percentages', () => {
  assert.match(insightNarrative([{ category: 'A', values: [0] }], base).text, /unavailable of total/);
  assert.match(insightNarrative([{ category: 'A', values: [null] }], base).text, /Total revenue: unavailable/);
  assert.deepEqual(insightNarrative([], base), { paragraphs: [], text: '' });
  const input = { ...base, measures: [field('revenue'), field('profit')], formatting: { decimalPlaces: 2 } };
  assert.match(insightNarrative([{ category: 'A', values: [12.5, 0] }], input).text, /difference 12.50 \(unavailable\)/);
});
test('every unsupported computation and missing binding fails closed even on empty rows', () => {
  const cases = [
    [withComputation('forecast'), 'INSIGHT_FORECAST_UNSUPPORTED'],
    [withComputation('anomaly'), 'INSIGHT_ANOMALY_UNSUPPORTED'],
    [{ ...base, computations: { customNarrative: { narrative: '${forecast.result}' } } }, 'INSIGHT_CUSTOM_NARRATIVE_UNSUPPORTED'],
    [withComputation('periodOverPeriod'), 'INSIGHT_TIME_REQUIRED'], [withComputation('growthRate'), 'INSIGHT_TIME_REQUIRED'],
    [{ ...base, category: undefined }, 'INSIGHT_CATEGORY_REQUIRED'], [{ ...base, measures: [] }, 'INSIGHT_VALUES_REQUIRED'],
    [withComputation('metricComparison'), 'INSIGHT_VALUES_REQUIRED'], [withComputation('future'), 'INSIGHT_COMPUTATION_UNSUPPORTED'],
    [withComputation('topBottomRanked', { type: 'TOP', resultSize: 21 }), 'INSIGHT_COMPUTATION_INVALID'],
    [withComputation('growthRate', { periodSize: 3 }, { ...base, category: { ...field('date'), dateGranularity: 'DAY' } }), 'INSIGHT_PERIOD_UNSUPPORTED'],
    [withComputation('totalAggregation', { futureOption: true }), 'INSIGHT_CONFIGURATION_UNSUPPORTED'],
  ];
  for (const [input, code] of cases) assert.throws(() => insightNarrative([], input), e => e instanceof InsightError && e.code === code, code);
});
test('invalid data and nonfinite math fail closed', () => {
  for (const values of [[Infinity], ['7'], [1e308, 1e308]]) assert.throws(() => insightNarrative(values.map((n, i) => ({ category: String(i), values: [n] })), base), /INSIGHT_VALUE_INVALID/);
  assert.throws(() => insightNarrative([{ category: 'A', values: [1] }, { category: 'A', values: [2] }], base), /INSIGHT_CATEGORY_INVALID/);
  for (const category of ['not-a-date', '2024-02-30', null]) assert.throws(() => insightNarrative([{ category, values: [1] }], { ...base, category: { ...field('date'), dateGranularity: 'DAY' } }), /INSIGHT_TIME_REQUIRED/);
});
