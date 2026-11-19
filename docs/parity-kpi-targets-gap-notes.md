# KPI targets: verification and captures

Slice: `parity-kpi-targets` (phase-plan fallback, no GitHub issue).
Work stays on `work/parity-kpi-targets`; no merge or push.

## Contract coverage

The slice adds one validated KPI target, aggregation at the primary result
grain, author/fixture/native/published query bindings, target text and View data,
progress bars, comparison arrows, Target value authoring, storage and retained
imports. See [configuration and semantics](parity-kpi-targets.md).

Targets do not change grouping. All-null targets remain null; duplicate trend
keys, invalid result cells and non-finite target sums fail closed. Trended
primary and target bindings require explicit SUM. Trend-less governed targets
retain explicit non-SUM aggregation; draft/query guards prevent adding a trend
to them. Progress fill clamps only the display, with the real ratio available
to assistive technology. Missing/null/nonpositive targets, null primary and
non-finite ratios draw no bar and retain a warning. Zero/unavailable comparisons
draw no arrow and retain a note. Hidden/absent options draw no adornment.

The regression uses a **constructed reduced fixture** in the established KPI
field-well shape. The automotive source contains empty target wells; no target
values are attributed to that fixture. Pivot RowLabelSort and Insight custom
narratives remain unsupported. Visual fidelity is not measured.

## Focused verification and existing assertions

The new `packages/web/test/kpi-targets.test.mjs` is reached by the existing web
and root test globs. Its 43 tests cover both dialects, malformed wells, aliases,
nulls/overflow, SUM enforcement, unchanged absent/empty-target output, query
grain and calculated dependencies, published aliases, target formatting,
progress clamping/warnings, arrow direction/order/visibility/accessibility,
authoring controls, invalid edits, shared source columns with distinct field
IDs, save/reload, remapping, O replacement, retained definitions and explicit
governed target aggregations. Two added native planner tests cover grouped and
ungrouped targets, direct/wrapped wells, DuckDB/Postgres SQL, fixture evaluation
and invalid/unbound targets. The original native trend test remains intact.
A separate browser regression bundles the current VisualCard locally and checks
mounted transitions when targets and arrows are added and removed without
reload. It uses the existing Vite and Chromium tools, with no new dependency.

The combined target/trend/bundle round-trip run passed 150 tests before the
final governed-target assignment guard was added; the final dedicated target
run passed all 43 tests. TypeScript compilation passed. No dependency was added.

Only `kpi-trend-group-sort.test.mjs` changes existing assertions: its two dialect
cases that copied the primary field into targetValues now expect the existing
duplicate-field-ID error instead of blanket unsupported-target rejection.
The two minimal-options cases now expect ↑/↓ prefixes on four comparison
labels each, because they explicitly request visible arrows. Their numeric
comparisons, ordering and primary-mode behavior are unchanged. No complete
compiled-output baseline was rewritten. The first full run caught two existing
query-engine semantic tests using multiple measures in trend-less KPI plans.
The new planner had inadvertently applied its single-primary constraint to
those plans. That constraint now remains trend-only, preserving their existing
behavior; the executor tests were left unchanged. The corrected executor and
native KPI regression run passed all 31 tests. The first web workspace run
passed all 3,354 tests, with no failures or skips. The complete root suite was
then restarted after rebuilding the demo and embed artifacts. Other-kind target rejection and the
existing malformed KPI compiler assertions remain intact.

Initial focused checks caught a test import of a nonexistent helper; the tests
now use the same native projection/conversion path as the predecessor suite.
They also confirmed that the existing bundle envelope rejects non-array wells,
non-object entries and missing variant wrappers before editable import. Valid
containers with unsupported fields/aggregations retain original definitions
and diagnostics. No envelope validation was weakened.

The tour exposed an ECharts lifecycle bug during live target assignment: disposal
of the old chart host cleared a newly nested host. Separate React root keys now
keep the old and new hosts distinct. The browser regression above reproduces
those transitions and passes. The capture harness also checks the SVG before
saving/reloading and after target removal.

## Full root verification

The final uninterrupted root `npm test` completed with exit code **0**, using
`TZ=UTC` and the installed Playwright headless shell:

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
| Web | 3,354 | 0 | 0 |
| Root conformance and site | 110 | 0 | 0 |
| **Total** | **6,317** | **0** | **37** |

There were **6,354 tests** in total, with no cancellations or todos. All 37
skips are existing live-Postgres cases: no `DATABASE_URL` or live TLS Postgres
is configured. No test was newly skipped. The total includes the 32 Python
tests, which report separately from Node's summaries.

Final log: `/tmp/opensight-kpi-targets-root-verified.log`; its recorded exit
status is `/tmp/opensight-kpi-targets-root-verified.exit`. The first attempt's
log is `/tmp/opensight-kpi-targets-root-first.log`. Browser captures and other
builds were stopped during both root runs; no timing threshold was relaxed.

## Demo and captures

The static single-file demo and embed artifacts were rebuilt locally. These are
local artifacts, not a deployed server. `capture-kpi-targets.mjs` checks target assignment, immediate chart rendering,
ASC/DESC order, progress/arrow accessibility, target data, save/reload, sort reset
and target removal. Its imported options are applied to the saved draft; there
is no invented options UI. It reports zero browser errors and external requests.
Eight Bar/Line/Table/Pie light/dark captures match pre-slice SHA-256 hashes exactly.
The 1440px viewport has no horizontal overflow; controls use 12px Arial-family
text and selected sort directions remain distinct in both chrome themes.

Feature captures: [light](images/kpi-targets.png) and
[dark](images/kpi-targets-dark.png). Visual review found no overlap between the
primary, comparison, target, progress bar and sparkline. The local
`qs-author-light-flow.jpg` reference retains Data → Visuals/wells → dominant
sheet flow. It contains no matching KPI target example, so this is a regression
and layout check, not a KPI pixel-parity measurement. The sheet stays light in
dark editor chrome, as before.

The README now links the current KPI feature capture. Its hero tour is refreshed
using `capture-kpi-trend-tour.mjs`, the predecessor's offline adaptation of
`~/workspace/tools/screenshots/readme-gif.mjs`, with Target value added. The tour
has 43 frames, no browser errors or external requests, and uses the reference
script's ffmpeg palettegen/paletteuse assembly commands. The static demo and
embed artifacts were rebuilt after the chart-host fix.

Local capture evidence is `/tmp/opensight-kpi-targets-captures/acceptance.json`;
the baseline, post-change captures and hashes are beside it. Capture/build logs
and tour frames are in `/tmp/`, outside the repo. Initial capture attempts needed
corrections for the current scoped draft collection and text inside collapsed
View data; those were harness fixes. Chromium required execution outside the
filesystem/syscall sandbox. These checks use only local files.

## Scope

Eight checkpoint commits cover the eight work items. No new dependency,
AWS call, network download, deployment, merge or push. `SOLUTION_DESIGN.md`
is unchanged. No GitHub issue is created because the brief forbids network
access and names no issue.
