# Insight period-to-date parity verification

This phase-plan fallback implements PeriodToDate for Insight. There is no GitHub
issue for the slice. Work stays on `work/parity-insight-period-to-date`, with a
checkpoint commit for each work item. No merge, push, dependency addition, AWS
call, external network access, `.github` change or `SOLUTION_DESIGN.md` edit is
part of this work.

## Behavior and compatibility

The computation sums the bound measure's aggregated groups in the UTC calendar
period containing the latest dated row. DAY, MONTH, QUARTER and YEAR are accepted;
an absent period granularity follows the bound date grain. The authoring preset
leaves the option absent. Null groups within the selected period are skipped and
disclosed. A trailing null still determines the latest period. Older periods
never contribute to the sum, including when their all-time total would overflow.

A finer-than-bound period, no non-null values in the selected period, or no dated
rows produces an explicit unavailable reason without a computed value. Duplicate
decoded periods fail with `INSIGHT_VALUE_INVALID`, and invalid dates or a non-date
binding fail with `INSIGHT_TIME_REQUIRED`. Other computations retain their
existing behavior, including the common empty state. Anomaly, TopBottomMovers,
UniqueValues and custom narratives remain unsupported.

The existing converter listed PeriodToDate but did not map its
PeriodTimeGranularity property. The mapping now applies specifically to that
variant. Tests verify PascalCase → camelCase → PascalCase identity, native bundle
import, real query aggregation, narrative/SVG rendering and downloaded `.qs`
export without losing or injecting properties.

## Verification

The focused parser and web Insight suites passed **49 passed / 0 failed /
0 skipped** after strict TypeScript compilation. Coverage includes both parser
dialects, malformed bodies and granularities, field projection and rebinding,
unbound-field rejection, authoring dispatch/serialization and non-date error
rendering. Calendar cases cover day/month/quarter/year defaults, finer rows in
monthly/quarterly/yearly periods, leap day, year and quarter boundaries, missing
periods, chronological ordering, null disclosure, zero/negative values, number
formatting, duplicate decoded periods and nonfinite arithmetic.

The first focused round-trip run exposed an incorrect test alias copied from the
forecast fixture (`month` instead of the query's `day` alias). Correcting the test
binding made both dialects agree; no production query behavior changed.

The final repository-root `TZ=UTC npm test` exited **0** on 2026-11-14:
**5,150 passed / 0 failed / 36 skipped / 0 cancelled** (5,186 tests, including
the Python SDK). All skips require live PostgreSQL: 35 require `DATABASE_URL`,
and one requires live TLS PostgreSQL configuration. `OPENSIGHT_CHROMIUM` pointed
to the installed Playwright headless shell throughout the successful run.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,294 | 0 | 34 |
| Bundle parser | 203 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 28 | 0 | 0 |
| Python SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 619 | 0 | 2 |
| Web | 2,654 | 0 | 0 |
| Root checks | 110 | 0 | 0 |
| **Total** | **5,150** | **0** | **36** |

Logs, exit status and machine-readable totals are in
`.opensight/insight-period-to-date/verification/` (`root-npm-test.log`,
`root-npm-test.exit`, `test-summary.json` and `focused-tests.log`).

Two sandbox attempts did not complete: the first process ended with signal 15
during dependency builds; the second reached API test startup and Node aborted
with an `InternalCallbackScope::Close` native assertion. The latter run was
stopped, and the unchanged root command was retried outside the sandbox. The
interrupted and aborted logs are retained. No test was removed, skipped to work
around those failures, or given a weaker assertion or timing limit.

## Static demo and captures

`npm run build:demo --workspace @opensight/web` exited **0**, including strict
TypeScript and all embed builds. `demo-build.log`, `demo-build.exit` and
`demo-sha256.txt` are retained in the verification directory. This is a rebuilt
local static demo, not a deployed server.

The offline acceptance tour completed **18 captures, 0 page errors and 0 external
requests**. Every capture passed the 1440-pixel viewport horizontal-overflow
check. In addition to the existing Insight scenes, it captures the new preset in
light and dark chrome and its non-date `INSIGHT_TIME_REQUIRED` state. The pinned
data correctly reports `Period-to-date revenue for 2025-04 (MONTH): 250.00.`
The narrative wraps within the card, its computed value is bold, and the date
requirement remains visible in the preset. Artifacts and `summary.json` are in
`.opensight/insight-period-to-date/browser/`.

Chromium's first sandboxed capture launch failed with `Operation not permitted`;
the successful capture ran outside the sandbox using the same installed
Playwright headless shell as the full suite. All HTTP(S) requests stayed blocked.

Visual inspection against the local `qs-author-light-flow.jpg` reference retains
the Data → Visuals/field wells → sheet flow and the dominant canvas. No new
persistent layout gap was found. There is no matching QuickSight PeriodToDate
narrative reference, so exact wording and pixel fidelity are not measured.

The original 15-scene Insight tour was also captured against the saved pre-change
demo and the rebuilt demo, clearing focus and allowing layout to settle equally.
Both runs had zero page errors, external requests and horizontal-overflow
failures. **14 of 15 captures are pixel-identical**; the remaining import-blocked
capture differs only in timed autosave status, its timestamp and local draft
count, with identical visual content. Evidence is in `baseline-tour/`,
`current-tour/` and `verification/tour-comparison.json` under
`.opensight/insight-period-to-date/`. The initial comparison with archived
forecast captures also showed focus and transient card-sizing differences;
the controlled comparison resolves those differences.

README media was not regenerated: the existing Insight tour's feature scenes
and its maintained capture script are unchanged, and the brief explicitly asks
to skip media refresh in that case. The new preset states are captured separately
in the acceptance artifacts. No GitHub issue was created for this phase-plan
fallback, and no external network access was used.

## Honest divergences

Sentence composition is OpenSight's. QuickSight's exact wording and visual
fidelity are not measured, and no ML behavior is claimed. The period is based on
the latest supplied row, not today's date; absent periods are not interpolated.
Only DAY, MONTH, QUARTER and YEAR are supported. Finer periods cannot be recovered
from coarser aggregate groups and are reported as unavailable. Empty/missing
query results keep the panel's existing empty/unavailable state, while the
PeriodToDate narrative carries the no-dated-rows reason.
