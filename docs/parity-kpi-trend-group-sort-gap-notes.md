# KPI trend groups and sorting: verification and captures

Slice: `parity-kpi-trend-group-sort` (phase-plan fallback, no GitHub issue).
All work stays on `work/parity-kpi-trend-group-sort`; no merge or push.

## Contract coverage

The slice implements one categorical/date trend well, strict TrendGroupSort,
grouped queries, typed ordering, SUM totals, gap-preserving sparklines, minimal
KPI options, final-two-group comparisons, authoring and retained imports.
The configuration and limits are described in
[the semantics document](parity-kpi-trend-group-sort.md).

The default order is ascending, including chronological date order. Null trend
keys are last in either direction. An explicit sort list requires one entry;
clearing removes the key. Target values and Pivot RowLabelSort remain unsupported.
Visible progressBar/trendArrows are retained with warnings and do not render.

The automotive regression extracts a reduced real SUM KPI. It preserves the
source measure/trend IDs and columns, aggregation and descending field sort,
and uses the supported comparison/sparkline subset. Hierarchy, formatting,
conditional-formatting and sparkline tooltip properties are outside this slice.
The full automotive dashboard also contains non-SUM and unbound/numerical-trend
KPIs; those are not claimed supported.

## Focused verification

The dedicated web test file has 40 passing tests, including both dialects,
malformed configuration cases, strict unknown-key gates, nulls, chronological
ordering, stable typed ties, immutable inputs, overflow, governed non-SUM
rejection, zero denominators, authoring controls, storage, import/edit/clear,
remaps, O-generated replacement, retained options and automotive fixture extraction. A query-engine regression checks
native KPI grouped SUM planning for DuckDB and Postgres and fixture evaluation.
The existing 68 bundle-roundtrip tests were also checked during implementation.
After the full-suite findings were fixed, 105 focused tests passed across the
KPI, author UI, display settings, pivot options and table row-sort suites.

One legacy query-engine assertion in `test/malformed.test.mjs` rejected every
KPI `SortConfiguration`, including `{}`. It now rejects unsupported KPI
`CategorySort` instead; the empty configuration is a no-op after this slice
admits KPI sorting. No compiled-output baseline was updated. Existing
pivot/table TrendGroupSort rejection assertions remain intact. Two legacy UI
expectations in `author-ui.test.mjs` now expect the KPI Trend group well and its
Data hint, with categorical fields enabled; they previously asserted that KPI
dimensions were unavailable. The two dialect cases in `table-row-sort.test.mjs`
now accept an empty KPI sort configuration; their rejection of KPI `rowSort`
remains unchanged. These are the only existing assertion updates.
Trend-less KPI complete compiled-output comparisons still pass unchanged.
The broader suite also caught unnecessary cloning in trend cleanup on rejected
unrelated edits. Cleanup now preserves the original visual object when there
is nothing to clear; the existing display-settings and pivot-options tests
remain unchanged. The new KPI invalid-edit test also checks object identity.
Initial focused runs exposed a query-test import/signature mistake and an overly
strict storage check for unknown imported trend columns; these were corrected
before the full suite.

## Full root verification

The final full root `npm test` completed with exit code 0, `TZ=UTC` and the
installed Playwright headless shell through `OPENSIGHT_CHROMIUM`.

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
| Query engine | 868 | 0 | 2 |
| Web | 3,310 | 0 | 0 |
| Root conformance and site | 110 | 0 | 0 |
| **Total** | **6,271** | **0** | **37** |

There were 6,308 tests in total, no cancellations and no todos. All 37 skips
are existing live-Postgres cases: no `DATABASE_URL` or live TLS Postgres is
configured. No test was newly skipped. The final uninterrupted run's log is
`/tmp/opensight-kpi-trend-root-verified.log`. This total includes the 32 Python
tests, which report separately from Node's summaries.

The initial attempt ran alongside browser captures and hit the existing H4
resource-pressure timing test: maximum execution 4,583.7ms exceeded 3,000ms,
and competing-tenant latency 8,747.4ms exceeded 6,000ms. That attempt was stopped
before restarting full verification without captures or builds running alongside
it. No timing threshold or test assertion was relaxed.

The next complete workspace run passed the API suite, including H4 at its
original thresholds. It exposed the obsolete KPI rejection assertions described
above and the reducer identity regression. Those were corrected before the
final root run; no unrelated behavior or timing expectation was changed.

## Demo and captures

The static single-file demo and embed artifacts were rebuilt locally. These are
local artifacts, not a deployed server. `capture-kpi-trend-sort.mjs` checks field assignment, ASC/DESC order, reset,
save/reload, trend removal and both chrome themes. It reports no browser errors
or external requests. Eight Bar/Line/Table/Pie light/dark captures match the
pre-slice demo SHA-256 hashes exactly. KPI controls use 12px Arial-family text;
the 1440px viewport has no horizontal overflow, and the selected direction is
visually distinct in both themes.

New feature captures: [light](images/kpi-trend-sort.png) and
[dark](images/kpi-trend-sort-dark.png). Visual comparison with the local
`qs-author-light-flow.jpg` reference preserves Data → Visuals/wells → dominant
sheet flow. This reference contains no matching KPI trend panel, so no KPI
pixel-parity claim is possible. The sheet remains light when editor chrome is
dark, as before. Review found and corrected the trended-KPI sample-data notice:
these previews group synthetic rows across all regions.

The README tour is refreshed by `capture-kpi-trend-tour.mjs`, a short offline
adaptation of `~/workspace/tools/screenshots/readme-gif.mjs`, assembled with its
ffmpeg palettegen/paletteuse commands. The existing long tour attempted a now
disabled preparation action; the short tour shows the current static screens
and the new KPI controls. The completed tour contains 43 frames and reports no
browser errors or external requests. The assembled GIF replaces
`docs/images/opensight-tour.gif`.

Local capture evidence is in `/tmp/opensight-kpi-trend-captures/acceptance.json`;
pre/post screenshots and hashes are beside it. The demo build logs and full test
logs are in `/tmp/`, outside the repository.

## Scope and remaining limits

All eight scoped work items are complete. No dependency was added. No AWS call, network build/download, deployment,
merge or push was performed. `SOLUTION_DESIGN.md` is unchanged. No GitHub issue
was created because the brief forbids network access and names no issue.
Visual fidelity is not measured; the screenshots are a local regression and
layout check, not a broader parity claim.
