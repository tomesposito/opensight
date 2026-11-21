import test from 'node:test';
import assert from 'node:assert/strict';
import { computeForecast, forecastConfigValid, forecastGridTierIndex, DEFAULT_FORECAST_CONFIG, MIN_FORECAST_POINTS, MAX_FORECAST_GRID_STEPS } from '../build/test/forecast.js';

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

test('fit selection: a candidate whose AICc correction is undefined is not rewarded for escaping it', () => {
  // Five constant points (issue #260): level-only (k=2, 4 errors) pays an
  // AICc correction of 12, while Holt (k=4) and damped (k=5) have too few
  // observations for their corrections to be defined at all. The old
  // per-candidate fallback scored Holt and damped by plain AIC while
  // level-only paid the full correction, so Holt won despite identical
  // zero residual error and more parameters. With one common criterion
  // for the whole comparison (plain AIC for all, because some corrections
  // are undefined) the simpler candidate wins.
  const r = computeForecast([7, 7, 7, 7, 7], 'DAY', { ...cfg, seasonality: 'none' });
  assert.equal(r.modelName, 'level-only (simple exponential smoothing)');
  assert.ok(r.future.every(p => p.value === 7 && p.lower === 7 && p.upper === 7));
});

test('fit selection: when no candidate has a defined AICc, the common plain-AIC fallback still forecasts', () => {
  // Four points is the floor: level-only has 3 errors for k=2 (correction
  // denominator 0) and the trend candidates are further under water, so
  // NO candidate qualifies for AICc. Selection falls back to plain AIC
  // for all alike rather than refusing to forecast, and the exact linear
  // series picks the trend model that fits it with zero residual error.
  const r = computeForecast([1, 2, 3, 4], 'DAY', { ...cfg, seasonality: 'none' });
  assert.ok(r);
  assert.equal(r.modelName, 'Holt trend');
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

test('boundary clipping keeps intervals ordered when a boundary is disjoint from the raw interval', () => {
  const flat = [10, 10, 10, 10, 10, 10];
  // Lower boundary above the whole raw interval: estimate and both endpoints move up together.
  const raised = computeForecast(flat, 'DAY', { ...cfg, lowerBoundary: 20 });
  assert.ok(raised.future.every(p => p.value === 20 && p.lower === 20 && p.upper === 20));
  // Upper boundary below the whole raw interval: the mirror image.
  const lowered = computeForecast(flat, 'DAY', { ...cfg, upperBoundary: 5 });
  assert.ok(lowered.future.every(p => p.value === 5 && p.lower === 5 && p.upper === 5));
  // A boundary inside the interval clips only the side it names, preserving the rest.
  const inside = computeForecast(trendSeries, 'MONTH', { ...cfg, lowerBoundary: 225 });
  assert.equal(inside.future[0].lower, 225);
  assert.ok(inside.future[0].upper > 225, 'upper endpoint survives a lower-only boundary');
});

test('every future point is ordered across boundary and zero-floor combinations', () => {
  const histories = [
    [10, 10, 10, 10, 10, 10], // constant
    [20, 16, 12, 8, 4, 0], // descending to zero: raw forecast goes negative
    [5, 3, 4, 2, 3, 1, 2, 0], // noisy descending non-negative
    trendSeries,
    [-5, -10, -3, -8, -12, -6], // negative history: no automatic zero floor
  ];
  const configs = [{}, { lowerBoundary: 20 }, { upperBoundary: 5 }, { lowerBoundary: 20, upperBoundary: 26 },
    { lowerBoundary: -100 }, { upperBoundary: -1 }, { lowerBoundary: 0, upperBoundary: 0 }];
  for (const history of histories) for (const patch of configs) {
    const r = computeForecast(history, 'DAY', { ...cfg, seasonality: 'none', ...patch });
    for (const p of r.future) {
      assert.ok(p.lower <= p.value && p.value <= p.upper, `ordered ${JSON.stringify(p)} for ${JSON.stringify(patch)}`);
      if (patch.lowerBoundary !== undefined) assert.ok(p.lower >= patch.lowerBoundary || p.lower === patch.upperBoundary);
      if (patch.upperBoundary !== undefined) assert.ok(p.upper <= patch.upperBoundary);
      if (history.every(v => v >= 0) && patch.upperBoundary === undefined) assert.ok(p.lower >= 0, 'zero floor holds');
    }
  }
  // Descending non-negative history: the zero floor applies to the whole
  // point, so no endpoint or estimate projects below zero.
  const descending = computeForecast([20, 16, 12, 8, 4, 0], 'DAY', { ...cfg, seasonality: 'none' });
  assert.ok(descending.future.every(p => p.lower >= 0 && p.value >= 0 && p.upper >= 0));
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

test('nonfinite arithmetic: residuals that square past the double range still forecast finitely', () => {
  // Issue #261: every observation is finite, but (1e200)^2 overflows, so the
  // old SSE was Infinity, sigma was Infinity, and the returned interval
  // endpoints were infinite. The scaled SSE / log-domain scoring keeps every
  // returned number finite.
  for (const history of [[0, 1e200, 0, 1e200], [0, 1e200, 0, 1e200, 0, 1e200, 0, 1e200], [1e200, 2e200, 3e200, 4e200, 5e200, 6e200]]) {
    const r = computeForecast(history, 'DAY', { ...cfg, seasonality: 'none' });
    assert.ok(r, `forecast exists for ${JSON.stringify(history)}`);
    assert.ok(Number.isFinite(r.sigma), 'sigma is finite');
    assert.ok(r.fitted.every(v => v === null || Number.isFinite(v)), 'fitted values are finite');
    for (const p of r.future) {
      assert.ok(Number.isFinite(p.value) && Number.isFinite(p.lower) && Number.isFinite(p.upper), `finite point ${JSON.stringify(p)}`);
      assert.ok(p.lower <= p.value && p.value <= p.upper, 'interval stays ordered');
    }
  }
});

test('nonfinite arithmetic: when no finite model remains the result is unavailable, never nonfinite', () => {
  // Alternating extremes at the edge of the double range: every candidate's
  // filter overflows (initial trend and residuals alike), so computeForecast
  // returns null — the surfaces render their unavailable state.
  assert.equal(computeForecast([1e308, -1e308, 1e308, -1e308], 'DAY', { ...cfg, seasonality: 'none' }), null);
  assert.equal(computeForecast([-1e308, 1e308, -1e308, 1e308], 'DAY', { ...cfg, seasonality: 'none' }), null);
});

test('work bound: maximum-seasonality workload (m=366, n=732) forecasts seasonally on the full grid', () => {
  // Issue #262's representative maximum: season length 366 at its minimum
  // 732 observations. The old slice-and-spread rotation processed ~683M
  // seasonal-array elements per series here; the ring buffer makes each
  // observation O(1), and the full grid (5,610 fits x 732 = 4,106,920
  // steps) stays within MAX_FORECAST_GRID_STEPS, so results are the
  // full-grid results, not a coarsened approximation.
  assert.ok(MAX_FORECAST_GRID_STEPS >= 5610 * 732);
  // A sharp seasonal step pattern: one-step-ahead tracking cannot
  // anticipate the jumps, so the seasonal model wins on merit. (A smooth
  // slow sine at this season length is legitimately tracked one-step by
  // trend models and loses to them on the seasonal initials' AIC penalty.)
  const y = Array.from({ length: 732 }, (_, i) => 100 + ((i % 366) < 183 ? 20 : -20) + i * 0.01);
  const work = {};
  const r = computeForecast(y, 'DAY', { ...cfg, seasonality: 366 }, work);
  assert.ok(r, 'forecast exists');
  assert.equal(r.seasonalApplied, true);
  // Issue #298: the work bound is asserted as work, not just output.
  // Full grid = 5,610 fits (510 non-seasonal + 5,100 seasonal) plus one
  // winner re-run per candidate (6). Non-seasonal runs process n-1
  // steps, seasonal runs n-m: 513 x 731 + 5,103 x 366 = 2,242,701 steps.
  // Seasonal updates are exactly one ring-buffer write per seasonal
  // step (5,103 x 366) — the old O(m) rotation would have copied 366
  // elements per step here (~683M element copies for the same search).
  assert.deepEqual(work, { tierIndex: 0, fitsRun: 5616, filterSteps: 2242701, seasonalUpdates: 1867698 });
  assert.equal(r.fitted.length, 732);
  assert.ok(Number.isFinite(r.sigma));
  for (const p of r.future) {
    assert.ok(Number.isFinite(p.value) && Number.isFinite(p.lower) && Number.isFinite(p.upper));
    assert.ok(p.lower <= p.value && p.value <= p.upper, 'interval stays ordered');
  }
  // Deterministic: same input, same output.
  assert.deepEqual(computeForecast(y, 'DAY', { ...cfg, seasonality: 366 }), r);
});

test('work bound: a very long seasonal series still forecasts under the coarsened grid tiers', () => {
  // 20,000 observations at season 366 would be 112M full-grid steps —
  // far past the budget — so a coarser deterministic tier must take
  // over and still return a finite, deterministic forecast. Under the
  // old per-observation O(m) rotation this input could not finish in
  // reasonable time at any grid size.
  const y = Array.from({ length: 20000 }, (_, i) => 50 + 10 * Math.sin(2 * Math.PI * (i % 366) / 366) + (i % 7));
  const work = {};
  const r = computeForecast(y, 'DAY', { ...cfg, seasonality: 366 }, work);
  assert.ok(r, 'forecast exists');
  assert.equal(r.fitted.length, 20000);
  assert.ok(r.future.every(p => Number.isFinite(p.value) && Number.isFinite(p.lower) && Number.isFinite(p.upper)));
  assert.deepEqual(computeForecast(y, 'DAY', { ...cfg, seasonality: 366 }), r);
  // Issue #298: the coarsening actually happened, in exact work terms.
  // Tier 3's grid is 84 fits (21 non-seasonal + 63 seasonal) plus 6
  // winner re-runs: 24 x 19,999 + 66 x 19,634 = 1,775,820 filter steps,
  // inside the 5M budget. The unconditional full grid this replaces
  // would run 5,616 fits and ~110M steps on this fixture — a regression
  // to it fails these counts, not just a wall-clock hope.
  assert.deepEqual(work, { tierIndex: 3, fitsRun: 90, filterSteps: 1775820, seasonalUpdates: 1295844 });
  assert.ok(work.filterSteps <= MAX_FORECAST_GRID_STEPS);
});

test('work bound: tier selection steps down exactly at the budget thresholds', () => {
  // Issue #298. Tier fit counts (grid fits across all candidates):
  // non-seasonal 510 / 150 / 52 / 21 / 3 for tiers 0-4; seasonal adds
  // the gamma grid: 5,610 / 1,050 / 260 / 84 / 6. A tier holds while
  // fits x n <= MAX_FORECAST_GRID_STEPS (5,000,000), so each boundary
  // below is floor(5,000,000 / fits) on one side and +1 on the other.
  const cases = [
    // [seasonalAdmissible, last n on tier, tier, first n on next tier, next tier]
    [false, 9803, 0, 9804, 1],
    [false, 33333, 1, 33334, 2],
    [false, 96153, 2, 96154, 3],
    [false, 238095, 3, 238096, 4],
    [true, 891, 0, 892, 1],
    [true, 4761, 1, 4762, 2],
    [true, 19230, 2, 19231, 3],
    [true, 59523, 3, 59524, 4],
  ];
  for (const [seasonal, lastN, tier, firstN, nextTier] of cases) {
    assert.equal(forecastGridTierIndex(lastN, seasonal), tier, `n=${lastN} seasonal=${seasonal}`);
    assert.equal(forecastGridTierIndex(firstN, seasonal), nextTier, `n=${firstN} seasonal=${seasonal}`);
  }
  // The single-point tier is the floor: arbitrarily long series stay on it.
  assert.equal(forecastGridTierIndex(10_000_000, true), 4);
  assert.equal(forecastGridTierIndex(10_000_000, false), 4);
});

test('work bound: a short series performs exactly the full-grid work', () => {
  // Issue #298. 12 points, no admissible seasonality (12 < 2 x 12):
  // tier 0's 510 grid fits + 3 winner re-runs, each processing n-1 = 11
  // steps, and no seasonal work at all.
  const work = {};
  const r = computeForecast(trendSeries, 'MONTH', cfg, work);
  assert.ok(r);
  assert.deepEqual(work, { tierIndex: 0, fitsRun: 513, filterSteps: 5643, seasonalUpdates: 0 });
});
