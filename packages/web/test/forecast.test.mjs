import test from 'node:test';
import assert from 'node:assert/strict';
import { computeForecast, forecastConfigValid, DEFAULT_FORECAST_CONFIG, MIN_FORECAST_POINTS } from '../build/test/forecast.js';

const cfg = { ...DEFAULT_FORECAST_CONFIG };
const round = (xs, d = 4) => xs.map(x => x === null ? null : +x.toFixed(d));
const trendSeries = Array.from({ length: 12 }, (_, i) => 100 + 10 * i + ((i % 3) - 1) * 2);
const seasonalSeries = Array.from({ length: 24 }, (_, i) => 50 + 20 * Math.sin(2 * Math.PI * i / 12) + i * 0.5);

test('golden: trending series forecasts match pinned values and widen with horizon', () => {
  const r = computeForecast(trendSeries, 'MONTH', cfg);
  assert.equal(r.modelName, 'Holt trend');
  assert.deepEqual(r.future.map(p => [+p.value.toFixed(4), +p.lower.toFixed(4), +p.upper.toFixed(4)]),
    [[221.731, 215.2971, 228.1649], [232.7663, 224.9127, 240.6199], [243.8016, 233.0116, 254.5916]]);
  assert.deepEqual(round(r.fitted.slice(-3)), [190.3378, 200.011, 210.261]);
  const widths = r.future.map(p => p.upper - p.lower);
  assert.ok(widths[0] < widths[1] && widths[1] < widths[2], 'interval widens with horizon');
  // Deterministic: same input, same output.
  assert.deepEqual(computeForecast(trendSeries, 'MONTH', cfg), r);
});

test('fit selection: seasonal series with >= 2 cycles picks a seasonal model under auto', () => {
  const r = computeForecast(seasonalSeries, 'MONTH', cfg);
  assert.equal(r.seasonalApplied, true);
  assert.match(r.modelName, /Holt-Winters seasonal/);
  assert.deepEqual([+r.future[0].value.toFixed(3), +r.future[0].lower.toFixed(3), +r.future[0].upper.toFixed(3)], [56.3, 44.525, 68.075]);
});

test('fit selection: seasonal pattern with < 2 cycles does not fit seasonal; skip is reported', () => {
  const r = computeForecast(seasonalSeries.slice(0, 18), 'MONTH', cfg);
  assert.equal(r.seasonalApplied, false);
  assert.equal(r.seasonalSkipped, true);
  assert.ok(r.future.length === 3, 'trend forecast still renders');
});

test('seasonality none never fits seasonal; custom period is honored', () => {
  assert.equal(computeForecast(seasonalSeries, 'MONTH', { ...cfg, seasonality: 'none' }).seasonalApplied, false);
  const weekly = Array.from({ length: 21 }, (_, i) => 10 + (i % 7 === 0 ? 15 : 0) + i * 0.2);
  const r = computeForecast(weekly, 'DAY', { ...cfg, seasonality: 7 });
  assert.equal(r.seasonalApplied, true);
});

test('minimum points: fewer than 4 usable points refuses', () => {
  assert.equal(MIN_FORECAST_POINTS, 4);
  assert.equal(computeForecast([1, 2, 3], 'DAY', cfg), null);
  assert.equal(computeForecast([1, null, 2, null], 'DAY', cfg), null);
  assert.ok(computeForecast([1, 2, 3, 4], 'DAY', cfg));
});

test('lower clamp: non-negative series never projects a negative interval edge', () => {
  const r = computeForecast([5, 3, 4, 2, 3, 1, 2, 0], 'DAY', cfg);
  assert.ok(r.future.every(p => p.lower >= 0));
  const bounded = computeForecast(trendSeries, 'MONTH', { ...cfg, lowerBoundary: 225, upperBoundary: 240 });
  assert.equal(bounded.future[0].value, 225);
  assert.equal(bounded.future[0].lower, 225);
  assert.equal(bounded.future[2].value, 240);
  assert.equal(bounded.future[2].upper, 240);
});

test('flat series forecasts flat with a zero-width interval', () => {
  const r = computeForecast([10, 10, 10, 10, 10, 10], 'DAY', cfg);
  assert.ok(r.future.every(p => p.value === 10 && p.lower === 10 && p.upper === 10));
});

test('periodsForward 0 yields no future points but fitted values remain', () => {
  const r = computeForecast(trendSeries, 'MONTH', { ...cfg, periodsForward: 0 });
  assert.deepEqual(r.future, []);
  assert.equal(r.fitted.length, 12);
});

test('config validation is fail-closed', () => {
  assert.equal(forecastConfigValid(cfg), true);
  assert.equal(forecastConfigValid({ ...cfg, predictionInterval: 99 }), false);
  assert.equal(forecastConfigValid({ ...cfg, periodsForward: -1 }), false);
  assert.equal(forecastConfigValid({ ...cfg, seasonality: 1 }), false);
  assert.equal(forecastConfigValid({ ...cfg, seasonality: 'weekly' }), false);
  assert.equal(forecastConfigValid({ ...cfg, lowerBoundary: 10, upperBoundary: 5 }), false);
  assert.equal(forecastConfigValid({ ...cfg, extra: 1 }), false);
  assert.equal(forecastConfigValid(null), false);
});
