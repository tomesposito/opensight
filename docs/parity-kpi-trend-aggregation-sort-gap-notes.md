# KPI trend aggregation sort: verification and gaps

Slice: `kpi-trend-aggregation-sort` (phase-plan fallback, no GitHub issue).
Branch: `work/parity-kpi-trend-aggregation-sort`; base: `124b6f76`.

## Contract and focused checks

The compiler accepts one bound aggregation sort in either dialect, validates
nested keys and measure membership, and applies shared aggregate/cell semantics
before KPI comparison, totals, sparkline and target rendering. Draft state,
storage/migration, import/export and Properties expose the same supported subset.
See [semantics and limits](parity-kpi-trend-aggregation-sort.md).

The dedicated web test file contains 48 passing tests covering both dialects,
all six aggregations and both directions, stable ties and nulls, invalid shapes,
trend and measure membership, targets, date grains and bindings, duplicate keys,
comparisons, immutable input, draft lifecycle, migration, editable/retained
imports, native-ID re-export, remaps and Properties interactions. The focused
run alongside existing KPI trend and target suites passed **131 / 0 / 0**
(passed / failed / skipped). The new file also passed with the normal isolated
Node runner outside the filesystem sandbox: **48 / 0 / 0**. It is included in
the existing web/root test glob without a package-script change.

Before production edits, the test compiler was built from base `124b6f76` and
84 complete compiled-output SHA-256 hashes were recorded. Cases cover both
dialects, absent/category/date trends, field ASC/DESC and no sort, targets, and
populated/empty/unavailable results. Every hash still matches. No existing test
assertion or baseline was changed. Initial focused failures came from a new
negative-test target fixture missing its required SUM wrapper; the fixture was
corrected so the test reaches the intended target-only sort rejection.

## Offline browser evidence

The reproducible script is
`packages/web/scripts/capture-kpi-trend-aggregation-sort.mjs`. It bundles the
actual Author component and styles in memory, mounts them in the normal editor
main container in a temporary file shell, and aborts all HTTP(S) requests.
It does not build or modify `packages/web/dist`, and is not a deployed server.
The installed Playwright tooling supplies the browser driver; no dependency was
added. Chromium requires execution outside the filesystem sandbox in this
session because its sandbox host cannot start there.

```sh
OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" \
  node packages/web/scripts/capture-kpi-trend-aggregation-sort.mjs
```

Captures: [light](images/kpi-trend-aggregation-sort-light.png) and
[dark](images/kpi-trend-aggregation-sort-dark.png). They show monthly revenue
sorted by Average descending, with its reordered sparkline, comparison and target.
The completed run reported **zero page errors and zero external requests**.
The script checks ascending/descending measure order, aggregation selection,
save/reload, reset to chronological field order and stale-sort cleanup after
removing the measure. Evidence and raw captures are written to
`/tmp/opensight-kpi-trend-aggregation-sort-captures/`.

At 1440 × 900 the controls use 12px Arial-family text, the selected direction
is distinct in both themes, and there is no horizontal page overflow. The editor
retains Data → Visuals/wells → sheet flow, compared visually with the available
`qs-author-light-flow.jpg` reference. Properties stays docked; the analysis theme
keeps the canvas and KPI light in both chrome themes. The reference has no
matching KPI measure-sort panel, so these are layout/regression checks, not a
measured QuickSight fidelity claim. The existing narrow reset button wraps its
label; the new selects fit within the dock.

The README tour does not exercise the new control, so its GIF is unchanged per
the brief. No static-demo rebuild was run; the supervisor handles it after merge.
No GitHub issue was created because this offline brief names no issue and
forbids network access.

## Native planner boundary

Final review confirmed the separate query-engine `planVisual` validator still
accepts only `FieldSort` for KPI trend sorts. A direct probe in each dialect
returned `QueryEngineError` / `UNSUPPORTED_FEATURE` for `AggregationSort`.
This remains outside the compiler/authoring work items in this brief. The new
compiler accepts native definitions supplied with result rows; authored previews
use grouped queries independently of this native validator. No native-plan
execution support is claimed.

## Full root verification

The first `TZ=UTC npm test` run passed every preceding workspace and reached
all 3,402 web tests. The default Chromium executable could not start in this
exec context: a direct startup probe returned exit code 13 and
`Hatch WebGL domain policy is required for browser startup`. Browser test pipes
reported `ECONNRESET`; web reported 3,007 passed, 5 failed and 390 cancelled,
with no skips. All new KPI tests and the 84 baseline comparisons passed in that
run. Root conformance did not execute because the workspace command failed.
No product assertion or timing threshold was changed.

The complete root suite was rerun from the repository root and exited 0:

```sh
TZ=UTC OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" npm test
```

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,500 | 0 | 35 |
| Bundle parser | 213 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 28 | 0 | 0 |
| Python headless SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 870 | 0 | 2 |
| Web | 3,402 | 0 | 0 |
| Root conformance and site | 110 | 0 | 0 |
| **Total** | **6,365** | **0** | **37** |

There were **6,402 tests**, with **zero cancellations and zero todos**. These
totals include the 32 Python tests reported separately from Node's summaries.
All 37 skips are existing live-Postgres cases: 36 require `DATABASE_URL` and one
requires live TLS PostgreSQL. No test was newly skipped. The full verified log
is `/tmp/opensight-kpi-trend-aggregation-sort-root-verified.log`; the first run
is `/tmp/opensight-kpi-trend-aggregation-sort-root-initial.log`.

All eight numbered checkpoints are complete. TypeScript and the full suite pass;
the working diff contains no dependency or package-lock change, no
`SOLUTION_DESIGN.md` edit, and no static-demo change. No AWS calls, network
downloads, merge or push were performed. The native planner boundary above
remains documented, and visual fidelity is not measured.

## Follow-up: native planner boundary closed

The subsequent `parity-kpi-trend-agg-sort-planner` slice closes the native
`planVisual` boundary documented in this historical report. Supported KPI
aggregation sorts now pass native validation; plans, SQL and grouped results
remain identical to no-sort definitions, with display ordering still owned by
the consumer/compiler. See the [planner contract](parity-kpi-trend-agg-sort-planner.md)
and [new verification evidence](parity-kpi-trend-agg-sort-planner-gap-notes.md).
