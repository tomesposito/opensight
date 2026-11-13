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
The resume audit found that the compiler accepted internal `auto` / `none` mode
names as CUSTOM season lengths. It now requires an integer 2–366 before mapping
to the engine configuration, matching chart and bundle validation. Regression
cases cover normalization, wells projection, both native compiler dialects and
bundle import. The focused suites remain **64 passed / 0 failed / 0 skipped**.
Logs from the resumed verification are retained under
`.opensight/insight-forecast/verification/`.

`npm run build:demo --workspace @opensight/web` passed, including strict
TypeScript and embed builds. Log:
`.opensight/insight-forecast/verification/demo-build.log`.
This is a rebuilt local static demo, not a deployed server.

## Static demo and screenshots

The updated Insight browser tour passed **15 captures, 0 page errors and 0 external
requests**, including forecast selection, the short-history unavailable sentence
in light and dark chrome, and the named non-date import error with a blocked
preview. Every capture passed the 1440-pixel viewport horizontal-overflow check.
Artifacts and `summary.json` are in `.opensight/insight-forecast/browser/`.
The refreshed [Insight summary](images/insight.png) and
[forecast unavailable state](images/insight-forecast.png) are retained as
shareable feature screenshots.

Visual inspection against the local `qs-author-light-flow.jpg` reference and the
previous Insight screenshot retains the Data → Visuals/field wells → sheet flow.
The unavailable sentence wraps within the card, and the preset and date requirement
remain visible in the properties and field panels. No new layout gap was found.
There is no matching QuickSight forecast-narrative reference, so this comparison
does not measure exact wording or pixel fidelity. No network access or GitHub
issue creation was used for this phase-plan fallback.

The environment's default Chromium could not start without its runtime policy;
the installed Playwright headless Chromium completed the local tour. HTTP(S)
requests were blocked throughout. The README's stale statement that Forecast is
unsupported and the same outdated note in the chart-forecast documentation were
corrected. The maintained repository adaptation of `readme-gif.mjs` passed with
**262 frames and zero browser errors or external requests**; the refreshed README
hero is **960×600 at 10 fps for 26.2 seconds** and includes the new Forecast preset
and its honest short-history message.

## Honest divergences

Sentence composition is OpenSight's; QuickSight's exact narrative wording is
not replicated. Forecasting remains the shared deterministic exponential-smoothing
implementation, not QuickSight's proprietary ML algorithm. Missing calendar
periods are not interpolated, and short seasonal histories use the engine's
nonseasonal fallback. The pinned demo contains only three date buckets, so its
forecast correctly reports insufficient history. Visual fidelity is not measured.
