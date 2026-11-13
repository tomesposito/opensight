# Insight forecast parity verification

This phase-plan fallback adds Forecast computations to Insight, reusing the
statistical chart forecast engine shipped under #235. There is no GitHub issue
for this slice. The authoring preset requires a date dimension; native API and
bundle computations retain their fields and forecast properties unchanged on
export. Validation rejects malformed properties before queries can execute.
Anomaly, custom narratives and other unsupported computation variants retain
their existing behavior.

The sentence reports the measure, forward horizon at its grain, final projected
period/value and prediction interval. It shares date decoding, chronological
ordering and number formatting with existing insights. Nulls are skipped;
duplicate periods fail closed. Short histories and zero horizons show an
unavailable line without invented computed values. Backward periods are retained
but do not affect the sentence. Empty results retain their existing empty state.

## Verification

The combined insight and chart-forecast suites passed **64 passed / 0 failed /
0 skipped**. They cover defaults and invalid properties, agreement with chart
validation, all four grains, interval/value agreement with `computeForecast`,
precision and renamed measures, nulls, duplicate dates, boundaries, authoring
preset dispatch, field rebinding and native import/query/SVG/export round trips.
The native query test aggregates an explicit six-period synthetic history through
the shared query planner/evaluator; it does not substitute precomputed narrative
values. The bundle-parser suite passed **201 passed / 0 failed / 0 skipped**,
including both native casing dialects and named malformed-forecast diagnostics.
Logs: `/tmp/insight-forecast-targeted-test.log` and
`/tmp/insight-forecast-parser-test.log`.

`npm run build:demo --workspace @opensight/web` passed, including strict
TypeScript and embed builds. Log: `/tmp/insight-forecast-demo-build.log`.
This is a rebuilt local static demo, not a deployed server.

## Honest divergences

Sentence composition is OpenSight's; QuickSight's exact narrative wording is
not replicated. Forecasting remains the shared deterministic exponential-smoothing
implementation, not QuickSight's proprietary ML algorithm. Missing calendar
periods are not interpolated, and short seasonal histories use the engine's
nonseasonal fallback. The pinned demo contains only three date buckets, so its
forecast correctly reports insufficient history. Visual fidelity is not measured.
