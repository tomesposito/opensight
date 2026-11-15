/**
 * Statistical forecasting for line/area charts (issue #235): classical exponential
 * smoothing (ETS) over the chart's own series — deterministic, no DOM, no
 * ECharts types, no ML. The product labels this a "statistical forecast"
 * everywhere it appears; QuickSight's forecast is proprietary ML and this is
 * deliberately not a clone of it.
 *
 * Candidate family: level-only (SES), Holt trend, damped trend, and the
 * Holt-Winters seasonal variants of each when a season length applies.
 * Smoothing parameters are fit by a bounded deterministic grid search
 * minimizing one-step-ahead squared error; the winner is picked by corrected
 * AIC. When any candidate's AICc correction is undefined (too few
 * observations for its parameter count), every candidate is compared by
 * plain AIC instead — one common criterion for the whole comparison, never
 * a per-candidate mix (issue #260). Finite observations can still overflow
 * intermediate arithmetic (a residual near 1e200 squares past the double
 * range), so scoring and sigma carry a scaled/log-domain SSE, every fit is
 * validated finite before it can win, and every returned number is checked
 * — when no finite model remains the result is null, the surfaces'
 * unavailable state (issue #261). Same input, same output, every run.
 *
 * Prediction intervals come from the one-step residual variance, widening
 * with horizon through the model's exact state-space psi-weights:
 * Var(h) = sigma^2 * sum_{j=0}^{h-1} psi_j^2.
 *
 * Synchronous work is bounded (issue #262): the seasonal state rotates
 * through a ring buffer (O(1) per observation, not an O(m) array copy),
 * fitted values are retained only for each candidate's winning grid
 * point, and the grid search carries a step budget — when the full grid
 * would exceed MAX_FORECAST_GRID_STEPS filter steps for a series, a
 * deterministic coarser grid tier is used instead, down to a
 * single-point tier, so total work stays linear-bounded per series no
 * matter how long the history is.
 */

export type ForecastGrain = 'YEAR' | 'QUARTER' | 'MONTH' | 'DAY';

export interface ForecastConfig {
  enabled: boolean;
  /** Future periods to project. Default 3. */
  periodsForward: number;
  /** Trailing periods whose fitted values render alongside the actuals. Default 0. */
  periodsBackward: number;
  predictionInterval: 80 | 90 | 95;
  /** 'auto' proposes a period from the grain; a number is a custom period. */
  seasonality: 'auto' | 'none' | number;
  /** Imported QuickSight boundaries: clamp the forecast and its interval. */
  lowerBoundary?: number;
  upperBoundary?: number;
}

export const DEFAULT_FORECAST_CONFIG: ForecastConfig = {
  enabled: true, periodsForward: 3, periodsBackward: 0, predictionInterval: 95, seasonality: 'auto',
};

export const MIN_FORECAST_POINTS = 4;

/** One item of a dated series after chronological preparation: the decoded
 *  period start and the item's index in its source (display) order, so fitted
 *  values computed chronologically can be mapped back to displayed rows. */
export interface ChronologicalEntry<T> { item: T; date: Date; index: number }

export type ChronologicalPreparation<T> =
  | { ok: true; entries: ChronologicalEntry<T>[] }
  | { ok: false; reason: 'invalid' | 'duplicate' };

/**
 * Shared chronological preparation for every dated forecast surface — chart
 * line/area overlays and Insight narratives (issue #259). The caller decodes
 * each item to its period-start date at the bound grain; preparation sorts
 * ascending by decoded period (stable for equal keys, though equal keys are
 * then rejected), and reports the two fail-closed states the surfaces share:
 * an item that does not decode to a period ('invalid'), and two items that
 * decode to the SAME period ('duplicate') — raw aliases such as `2024-01`
 * and `2024-01-01T00:00:00Z` at MONTH grain are one period, not two
 * observations. Anchoring to the latest period is `entries.at(-1)` here,
 * never the last row in display order.
 */
export function prepareChronological<T>(items: readonly T[], decode: (item: T) => Date | null): ChronologicalPreparation<T> {
  const entries: ChronologicalEntry<T>[] = [];
  for (let index = 0; index < items.length; index++) {
    const date = decode(items[index]!);
    if (!date) return { ok: false, reason: 'invalid' };
    entries.push({ item: items[index]!, date, index });
  }
  entries.sort((a, b) => a.date.getTime() - b.date.getTime() || a.index - b.index);
  for (let i = 1; i < entries.length; i++) {
    if (entries[i]!.date.getTime() === entries[i - 1]!.date.getTime()) return { ok: false, reason: 'duplicate' };
  }
  return { ok: true, entries };
}

/** Fail-closed shape check shared by the authoring draft validator and the compiler. */
export function forecastConfigValid(value: unknown): value is ForecastConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['enabled', 'periodsForward', 'periodsBackward', 'predictionInterval', 'seasonality', 'lowerBoundary', 'upperBoundary'].includes(k))) return false;
  if (typeof v.enabled !== 'boolean') return false;
  if (!Number.isInteger(v.periodsForward) || (v.periodsForward as number) < 0 || (v.periodsForward as number) > 100) return false;
  if (!Number.isInteger(v.periodsBackward) || (v.periodsBackward as number) < 0 || (v.periodsBackward as number) > 100) return false;
  if (![80, 90, 95].includes(v.predictionInterval as number)) return false;
  const s = v.seasonality;
  if (!(s === 'auto' || s === 'none' || Number.isInteger(s) && (s as number) >= 2 && (s as number) <= 366)) return false;
  for (const bound of ['lowerBoundary', 'upperBoundary'] as const) {
    if (v[bound] !== undefined && (typeof v[bound] !== 'number' || !Number.isFinite(v[bound] as number))) return false;
  }
  if (v.lowerBoundary !== undefined && v.upperBoundary !== undefined && (v.lowerBoundary as number) > (v.upperBoundary as number)) return false;
  return true;
}

/** Season length proposed by 'auto' from the chart grain (YEAR has none). */
export const autoSeasonLength = (grain: ForecastGrain): number =>
  grain === 'DAY' ? 7 : grain === 'MONTH' ? 12 : grain === 'QUARTER' ? 4 : 0;

const Z: Record<80 | 90 | 95, number> = { 80: 1.2815515655446004, 90: 1.6448536269514722, 95: 1.959963984540054 };

type Trend = 'none' | 'add' | 'damped';
interface Candidate { trend: Trend; seasonal: boolean }
interface Fit {
  candidate: Candidate;
  alpha: number; beta: number; phi: number; gamma: number;
  /** One-step fitted values aligned to the input points; null before the first predictable index. */
  fitted: (number | null)[];
  sse: number;
  /** Natural log of the true SSE (issue #261): the SSE itself overflows to
   *  Infinity for large-but-finite observations (residuals near 1e200 square
   *  past the double range), while its log stays a small finite number, so
   *  scoring and sigma can be computed in the log domain exactly when the
   *  direct value is unusable. -Infinity when every residual is zero. */
  logSse: number;
  /** False when the filter's own arithmetic went nonfinite (a fitted value
   *  or a residual overflowed): such a fit is rejected, never scored. */
  valid: boolean;
  errors: number;
  level: number; trendValue: number; seasonalState: number[];
  aic: number;
  /** Corrected AIC, or null when its correction is undefined
   *  (errors - k - 1 <= 0): the candidate has too few observations for
   *  its parameter count. Selection never compares a defined AICc
   *  against an undefined one (issue #260). */
  aicc: number | null;
}

const GRID = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95];
const PHIS = [0.85, 0.9, 0.95, 0.98];

/**
 * Workload budget for one series' grid search, in filter steps
 * (fits × observations), issue #262. The representative maximum the
 * old code handled worst — season length 366 at its minimum 732
 * observations on the full grid (5,610 fits) — is 4,106,920 steps and
 * stays on the full grid; longer series step down to coarser tiers.
 */
export const MAX_FORECAST_GRID_STEPS = 5_000_000;

interface GridTier { values: number[]; phis: number[] }
const GRID_TIERS: GridTier[] = [
  { values: GRID, phis: PHIS },
  { values: [0.05, 0.25, 0.45, 0.65, 0.85, 0.95], phis: [0.85, 0.95, 0.98] },
  { values: [0.15, 0.45, 0.75, 0.95], phis: [0.9, 0.98] },
  { values: [0.25, 0.65, 0.95], phis: [0.95] },
  { values: [0.35], phis: [0.95] },
];

/** Number of filter runs a tier performs across all candidates. */
function tierFitCount(tier: GridTier, seasonalAdmissible: boolean): number {
  const a = tier.values.length, p = tier.phis.length;
  let fits = a + a * a + a * a * p; // level-only, Holt, damped
  if (seasonalAdmissible) fits += a * a + a * a * a + a * a * a * p; // seasonal variants (gamma grid)
  return fits;
}

/** First (finest) tier whose estimated steps fit the budget; the
 *  single-point tier is the floor and is used even past the budget —
 *  six fits is the least work any ETS search can do. */
function pickGridTier(n: number, seasonalAdmissible: boolean): GridTier {
  for (const tier of GRID_TIERS) {
    if (tierFitCount(tier, seasonalAdmissible) * n <= MAX_FORECAST_GRID_STEPS) return tier;
  }
  return GRID_TIERS[GRID_TIERS.length - 1]!;
}

/**
 * Run one candidate's filter over the points. m is the season length
 * (0 when not seasonal). The seasonal state lives in a ring buffer:
 * `s[sHead]` is always the current period's seasonal index (the old
 * array's s[0]), and updating it advances the head instead of copying
 * the array — O(1) per observation where the old rotation was O(m)
 * (issue #262). The returned seasonalState is materialized once, in
 * the rotated order the old array held. When `collectFitted` is false
 * the fitted array is not retained (grid search discards all but the
 * winner's fitted values anyway).
 */
function runFilter(y: readonly number[], m: number, cand: Candidate, alpha: number, beta: number, phi: number, gamma: number, collectFitted = true): Fit {
  const n = y.length;
  const seasonal = cand.seasonal && m >= 2;
  let level: number, trendValue = 0;
  let s: number[] = [];
  let sHead = 0;
  if (seasonal) {
    level = y.slice(0, m).reduce((a, b) => a + b, 0) / m;
    if (cand.trend !== 'none') trendValue = n >= 2 * m ? (y.slice(m, 2 * m).reduce((a, b) => a + b, 0) / m - level) / m : 0;
    s = y.slice(0, m).map(v => v - level);
  } else {
    level = y[0]!;
    if (cand.trend !== 'none') trendValue = y[1]! - y[0]!;
  }
  const c = cand.trend === 'none' ? 0 : cand.trend === 'add' ? 1 : phi;
  const fitted: (number | null)[] = collectFitted ? new Array<number | null>(n).fill(null) : [];
  // SSE accumulated in scaled form (issue #261): each squared residual is
  // divided by the running maximum |residual| before summing, so the sum
  // itself can never overflow for finite residuals; the true SSE is
  // sseScaled * errScale^2, recovered directly when that product is finite
  // (the ordinary path, bit-for-bit the old arithmetic) and through logSse
  // when it is not.
  let sseScaled = 0, errScale = 0, errors = 0;
  let valid = Number.isFinite(level) && Number.isFinite(trendValue) && s.every(v => Number.isFinite(v));
  const start = seasonal ? m : 1;
  for (let t = 0; t < n; t++) {
    if (t < start) continue;
    const yhat = level + c * trendValue + (seasonal ? s[sHead]! : 0);
    const e = y[t]! - yhat;
    if (!Number.isFinite(yhat) || !Number.isFinite(e)) { valid = false; break; }
    if (collectFitted) fitted[t] = yhat;
    const ae = Math.abs(e);
    if (ae > errScale) {
      if (errScale > 0) sseScaled *= (errScale / ae) ** 2;
      errScale = ae;
    }
    if (errScale > 0) { const r = e / errScale; sseScaled += r * r; }
    errors++;
    const nextLevel = level + c * trendValue + alpha * e;
    const nextTrend = cand.trend === 'none' ? 0 : cand.trend === 'add' ? trendValue + beta * e : phi * trendValue + beta * e;
    // Ring-buffer rotation: overwrite the consumed seasonal slot with
    // its updated value and advance the head. Only the updated slot can
    // change finiteness (the rest were verified finite when written and
    // initially), so checking it replaces the old whole-array scan.
    let seasonalFinite = true;
    if (seasonal) {
      const updated = s[sHead]! + gamma * e;
      s[sHead] = updated;
      sHead = (sHead + 1) % m;
      seasonalFinite = Number.isFinite(updated);
    }
    level = nextLevel; trendValue = nextTrend;
    if (!Number.isFinite(level) || !Number.isFinite(trendValue) || !seasonalFinite) { valid = false; break; }
  }
  // Materialize the seasonal state in rotated order (s0 = next period),
  // exactly the array the old slice-and-spread rotation maintained.
  const seasonalState = seasonal ? Array.from({ length: m }, (_, i) => s[(sHead + i) % m]!) : s;
  const sse = sseScaled * errScale * errScale;
  const logSse = sseScaled > 0 && errScale > 0 ? Math.log(sseScaled) + 2 * Math.log(errScale) : -Infinity;
  const k = 1 + 1 // alpha + initial level
    + (cand.trend !== 'none' ? 2 : 0) // beta + initial trend
    + (cand.trend === 'damped' ? 1 : 0) // phi
    + (seasonal ? 1 + m : 0); // gamma + seasonal initials
  // AIC from the true SSE when it is finite (the ordinary path, unchanged);
  // in the log domain when the SSE overflowed — the old code scored such a
  // fit errors * log(Infinity) = Infinity and then still returned it as the
  // winner when every candidate overflowed, leaking infinite endpoints to
  // the surfaces (issue #261). A zero SSE keeps the historical 1e-12 floor.
  const aic = errors === 0 ? Infinity
    : Number.isFinite(sse) ? errors * Math.log(Math.max(sse, 1e-12) / errors) + 2 * k
    : errors * (logSse - Math.log(errors)) + 2 * k;
  // Corrected AIC. When the correction denominator is not positive the
  // correction is undefined — report null instead of silently falling
  // back to plain AIC for this candidate alone: the old per-candidate
  // fallback removed the complexity penalty precisely from the
  // candidates with too few observations for their parameter count,
  // letting them beat simpler candidates scored with the full
  // correction (issue #260). computeForecast picks one common
  // criterion for the whole comparison.
  const aicc = errors - k - 1 > 0 ? aic + (2 * k * (k + 1)) / (errors - k - 1) : null;
  return { candidate: cand, alpha, beta, phi, gamma, fitted, sse, logSse, valid, errors, level, trendValue, seasonalState, aic, aicc };
}

/** A fit is usable only when every number it carries is finite (issue #261):
 *  the filter stayed finite, the score is a real number, and no fitted value
 *  overflowed. Nonfinite fits are rejected outright, never scored. */
function fitUsable(fit: Fit): boolean {
  return fit.valid
    && Number.isFinite(fit.aic)
    && (fit.aicc === null || Number.isFinite(fit.aicc))
    && Number.isFinite(fit.level) && Number.isFinite(fit.trendValue)
    && fit.seasonalState.every(v => Number.isFinite(v))
    && fit.fitted.every(v => v === null || Number.isFinite(v));
}

function fitCandidate(y: readonly number[], m: number, cand: Candidate, tier: GridTier): Fit | null {
  const seasonal = cand.seasonal && m >= 2;
  const alphas = tier.values, betas = cand.trend === 'none' ? [0] : tier.values, phis = cand.trend === 'damped' ? tier.phis : [1], gammas = seasonal ? tier.values : [0];
  let best: Fit | undefined;
  let bestScore = Infinity;
  for (const alpha of alphas) for (const beta of betas) for (const phi of phis) for (const gamma of gammas) {
    // Grid fits run without retaining fitted values (issue #262):
    // scoring never reads them, and only the winner's are returned.
    const fit = runFilter(y, m, cand, alpha, beta, phi, gamma, false);
    if (!fitUsable(fit)) continue;
    // Every grid point of one candidate shares k and errors, so the AICc
    // correction is a constant across the grid (or undefined for all of
    // them): ranking by AICc when defined and by plain AIC otherwise
    // picks the same grid point either way.
    const score = fit.aicc ?? fit.aic;
    if (score < bestScore) { best = fit; bestScore = score; }
  }
  if (!best) return null;
  // Re-run the winning grid point once, retaining its fitted values.
  // The filter is deterministic, so this reproduces the winning fit.
  const winner = runFilter(y, m, cand, best.alpha, best.beta, best.phi, best.gamma, true);
  return fitUsable(winner) ? winner : null;
}

export interface ForecastFuturePoint { value: number; lower: number; upper: number }
export interface ForecastResult {
  /** One-step fitted values aligned to the (non-null) input points; null where not predictable. */
  fitted: (number | null)[];
  future: ForecastFuturePoint[];
  /** Winning model description, e.g. "Holt-Winters seasonal (additive trend)". */
  modelName: string;
  seasonalApplied: boolean;
  /** A season was requested (auto/custom) but history held fewer than 2 full cycles. */
  seasonalSkipped: boolean;
  sigma: number;
}

/**
 * Compute the forecast for one series. `values` are the series' ordered points
 * (nulls are skipped — the series is its ordered non-null points). Returns null
 * when fewer than MIN_FORECAST_POINTS usable points exist.
 */
export function computeForecast(values: readonly (number | null)[], grain: ForecastGrain, config: ForecastConfig): ForecastResult | null {
  const y = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const n = y.length;
  if (n < MIN_FORECAST_POINTS) return null;
  const m = config.seasonality === 'none' ? 0 : config.seasonality === 'auto' ? autoSeasonLength(grain) : config.seasonality;
  const seasonalAdmissible = m >= 2 && n >= 2 * m;
  const seasonalSkipped = m >= 2 && !seasonalAdmissible;
  const candidates: Candidate[] = [
    { trend: 'none', seasonal: false }, { trend: 'add', seasonal: false }, { trend: 'damped', seasonal: false },
    ...(seasonalAdmissible ? [{ trend: 'none' as Trend, seasonal: true }, { trend: 'add' as Trend, seasonal: true }, { trend: 'damped' as Trend, seasonal: true }] : []),
  ];
  // Candidate selection uses ONE criterion for every candidate in the
  // comparison (issue #260): corrected AIC when every candidate's
  // correction is defined, plain AIC for ALL candidates when any
  // candidate's correction is undefined. The old code fell back per
  // candidate, so a complex candidate with too few observations for
  // its parameter count escaped the correction entirely and beat
  // simpler candidates that paid it in full (five constant points
  // picked Holt over level-only). Excluding the undefined candidates
  // instead would make seasonal admission at two full cycles
  // (docs/forecasting.md) unwinnable for every season length — a
  // seasonal candidate's k includes its m seasonal initials, so its
  // correction is undefined at exactly two cycles — so the consistent
  // scoring is a common criterion, never a per-candidate mix.
  const tier = pickGridTier(n, seasonalAdmissible);
  const fits = candidates.map(cand => fitCandidate(y, m, cand, tier)).filter((f): f is Fit => f !== null);
  // No finite model remains (issue #261): the surfaces' unavailable result,
  // never a forecast carrying infinite or NaN numbers.
  if (fits.length === 0) return null;
  const useAicc = fits.every(f => f.aicc !== null);
  let best: Fit | undefined;
  let bestScore = Infinity;
  for (const fit of fits) {
    const score = useAicc ? fit.aicc! : fit.aic;
    if (score < bestScore) { best = fit; bestScore = score; }
  }
  const fit = best!;
  const seasonal = fit.candidate.seasonal && m >= 2;
  const k = 1 + 1 + (fit.candidate.trend !== 'none' ? 2 : 0) + (fit.candidate.trend === 'damped' ? 1 : 0) + (seasonal ? 1 + m : 0);
  // Sigma from the true SSE when it is finite (unchanged); in the log domain
  // when the SSE overflowed, where the old sqrt(Infinity / …) made every
  // interval endpoint infinite (issue #261). A zero SSE is a zero sigma.
  const sigmaDenominator = Math.max(1, fit.errors - k);
  const sigma = fit.sse === 0 ? 0
    : Number.isFinite(fit.sse) ? Math.sqrt(fit.sse / sigmaDenominator)
    : Math.exp(0.5 * (fit.logSse - Math.log(sigmaDenominator)));
  // State-space form x = [level, trend, s0..s_{m-1}] (seasonal state rotated so
  // s0 is the next period's index) for exact psi-weights and h-step forecasts.
  const c = fit.candidate.trend === 'none' ? 0 : fit.candidate.trend === 'add' ? 1 : fit.phi;
  const dim = 2 + (seasonal ? m : 0);
  const w: number[] = new Array<number>(dim).fill(0); w[0] = 1; w[1] = c; if (seasonal) w[2] = 1;
  const F: number[][] = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
  F[0]![0] = 1; F[0]![1] = c;
  F[1]![1] = fit.candidate.trend === 'add' ? 1 : fit.candidate.trend === 'damped' ? fit.phi : 0;
  if (seasonal) for (let i = 0; i < m; i++) F[2 + i]![2 + (i + 1) % m] = 1;
  const g: number[] = new Array<number>(dim).fill(0);
  g[0] = fit.alpha; g[1] = fit.candidate.trend === 'none' ? 0 : fit.beta; if (seasonal) g[dim - 1] = fit.gamma;
  const matVec = (M: number[][], v: number[]): number[] => M.map(row => row.reduce((acc, a, j) => acc + a * v[j]!, 0));
  const dot = (a: number[], b: number[]): number => a.reduce((acc, v, j) => acc + v * b[j]!, 0);
  let state: number[] = [fit.level, fit.trendValue, ...(seasonal ? fit.seasonalState : [])];
  let psiVec = [...g];
  let psiSumSquares = 1; // psi_0 = 1
  const z = Z[config.predictionInterval];
  const allNonNegative = y.every(v => v >= 0);
  const future: ForecastFuturePoint[] = [];
  for (let h = 1; h <= config.periodsForward; h++) {
    const raw = dot(w, state);
    state = matVec(F, state);
    if (h > 1) { psiSumSquares += dot(w, psiVec) ** 2; psiVec = matVec(F, psiVec); }
    const half = z * sigma * Math.sqrt(psiSumSquares);
    // One clipping range for the estimate and both interval endpoints
    // (issue #258): the floor combines the automatic zero floor for
    // non-negative histories with any imported lower boundary, and the
    // ceiling is any imported upper boundary. Clipping is monotonic, so
    // lower <= value <= upper always holds — clamping only one side used
    // to leave reversed intervals (negative chart band widths, reversed
    // Insight ranges) when a boundary sat outside the raw interval. A
    // validated config never has lowerBoundary > upperBoundary, so
    // floor > ceiling only when an explicit upper boundary sits below
    // the automatic zero floor; the explicit boundary wins and the point
    // collapses to it, still ordered.
    let floor = Math.max(allNonNegative ? 0 : -Infinity, config.lowerBoundary ?? -Infinity);
    const ceiling = config.upperBoundary ?? Infinity;
    if (floor > ceiling) floor = ceiling;
    const clip = (v: number): number => Math.min(Math.max(v, floor), ceiling);
    future.push({ value: clip(raw), lower: clip(raw - half), upper: clip(raw + half) });
  }
  // Last gate (issue #261): validate every number about to be returned. A
  // finite fit can still project past the double range over the horizon
  // (state growth times a huge sigma); if any fitted value, future endpoint
  // or sigma is nonfinite, the result is unavailable — the caller renders
  // its unavailable state instead of an invalid chart band or a narrative
  // number its own validation would reject.
  if (!Number.isFinite(sigma)
    || fit.fitted.some(v => v !== null && !Number.isFinite(v))
    || future.some(p => !Number.isFinite(p.value) || !Number.isFinite(p.lower) || !Number.isFinite(p.upper))) return null;
  const trendName = fit.candidate.trend === 'none' ? 'level-only' : fit.candidate.trend === 'add' ? 'Holt trend' : 'damped trend';
  const modelName = seasonal ? `Holt-Winters seasonal (${trendName})` : trendName === 'level-only' ? 'level-only (simple exponential smoothing)' : trendName;
  return { fitted: fit.fitted, future, modelName, seasonalApplied: seasonal, seasonalSkipped, sigma };
}
