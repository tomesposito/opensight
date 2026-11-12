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
 * AIC. Same input, same output, every run.
 *
 * Prediction intervals come from the one-step residual variance, widening
 * with horizon through the model's exact state-space psi-weights:
 * Var(h) = sigma^2 * sum_{j=0}^{h-1} psi_j^2.
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
  sse: number; errors: number;
  level: number; trendValue: number; seasonalState: number[];
  aicc: number;
}

const GRID = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95];
const PHIS = [0.85, 0.9, 0.95, 0.98];

/** Run one candidate's filter over the points. m is the season length (0 when not seasonal). */
function runFilter(y: readonly number[], m: number, cand: Candidate, alpha: number, beta: number, phi: number, gamma: number): Fit {
  const n = y.length;
  const seasonal = cand.seasonal && m >= 2;
  let level: number, trendValue = 0;
  let s: number[] = [];
  if (seasonal) {
    level = y.slice(0, m).reduce((a, b) => a + b, 0) / m;
    if (cand.trend !== 'none') trendValue = n >= 2 * m ? (y.slice(m, 2 * m).reduce((a, b) => a + b, 0) / m - level) / m : 0;
    s = y.slice(0, m).map(v => v - level);
  } else {
    level = y[0]!;
    if (cand.trend !== 'none') trendValue = y[1]! - y[0]!;
  }
  const c = cand.trend === 'none' ? 0 : cand.trend === 'add' ? 1 : phi;
  const fitted: (number | null)[] = new Array<number | null>(n).fill(null);
  let sse = 0, errors = 0;
  const start = seasonal ? m : 1;
  for (let t = 0; t < n; t++) {
    if (t < start) continue;
    const yhat = level + c * trendValue + (seasonal ? s[0]! : 0);
    const e = y[t]! - yhat;
    fitted[t] = yhat;
    sse += e * e; errors++;
    const nextLevel = level + c * trendValue + alpha * e;
    const nextTrend = cand.trend === 'none' ? 0 : cand.trend === 'add' ? trendValue + beta * e : phi * trendValue + beta * e;
    if (seasonal) s = [...s.slice(1), s[0]! + gamma * e];
    level = nextLevel; trendValue = nextTrend;
  }
  const k = 1 + 1 // alpha + initial level
    + (cand.trend !== 'none' ? 2 : 0) // beta + initial trend
    + (cand.trend === 'damped' ? 1 : 0) // phi
    + (seasonal ? 1 + m : 0); // gamma + seasonal initials
  const aic = errors * Math.log(Math.max(sse, 1e-12) / errors) + 2 * k;
  // Corrected AIC; at the minimum-points floor the correction denominator
  // vanishes, so fall back to plain AIC rather than ruling every model out.
  const aicc = errors - k - 1 > 0 ? aic + (2 * k * (k + 1)) / (errors - k - 1) : aic;
  return { candidate: cand, alpha, beta, phi, gamma, fitted, sse, errors, level, trendValue, seasonalState: s, aicc };
}

function fitCandidate(y: readonly number[], m: number, cand: Candidate): Fit {
  const seasonal = cand.seasonal && m >= 2;
  const alphas = GRID, betas = cand.trend === 'none' ? [0] : GRID, phis = cand.trend === 'damped' ? PHIS : [1], gammas = seasonal ? GRID : [0];
  let best: Fit | undefined;
  for (const alpha of alphas) for (const beta of betas) for (const phi of phis) for (const gamma of gammas) {
    const fit = runFilter(y, m, cand, alpha, beta, phi, gamma);
    if (!best || fit.aicc < best.aicc) best = fit;
  }
  return best!;
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
  let best: Fit | undefined;
  for (const cand of candidates) {
    const fit = fitCandidate(y, m, cand);
    if (!best || fit.aicc < best.aicc) best = fit;
  }
  const fit = best!;
  const seasonal = fit.candidate.seasonal && m >= 2;
  const k = 1 + 1 + (fit.candidate.trend !== 'none' ? 2 : 0) + (fit.candidate.trend === 'damped' ? 1 : 0) + (seasonal ? 1 + m : 0);
  const sigma = Math.sqrt(fit.sse / Math.max(1, fit.errors - k));
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
    let value = raw, lower = raw - half, upper = raw + half;
    if (allNonNegative) lower = Math.max(lower, 0);
    if (config.lowerBoundary !== undefined) { lower = Math.max(lower, config.lowerBoundary); value = Math.max(value, config.lowerBoundary); }
    if (config.upperBoundary !== undefined) { upper = Math.min(upper, config.upperBoundary); value = Math.min(value, config.upperBoundary); }
    future.push({ value, lower, upper });
  }
  const trendName = fit.candidate.trend === 'none' ? 'level-only' : fit.candidate.trend === 'add' ? 'Holt trend' : 'damped trend';
  const modelName = seasonal ? `Holt-Winters seasonal (${trendName})` : trendName === 'level-only' ? 'level-only (simple exponential smoothing)' : trendName;
  return { fitted: fit.fitted, future, modelName, seasonalApplied: seasonal, seasonalSkipped, sigma };
}
