# Issue #48 — Sticky table and pivot headers

Implemented on `work/issue-48-sticky-table-headers`, branched from master
`418fc1fb`, with item checkpoint commits. `SOLUTION_DESIGN.md` is unchanged.
No package dependency, AWS call, deployment, merge, or push was added.

## Behavior

The shared `.table-scroll` stylesheet freezes all column headers at `top: 0`
and the first cell of every row at `left: 0`. Body labels, headers, and the
top-left corner use z-index 1, 2, and 3 respectively. Headers retain existing
theme/inline colors; body labels inherit the table background through their
row, preserving analysis surfaces, cell formatting, subtotals, and totals.
Conditional cell formatting still wins over the inherited background.

Table/pivot content now shrinks within its card, so vertical scrolling happens
inside `.table-scroll`. At the mobile breakpoint, these cards use the existing
340px minimum as their height, giving long tables a bounded viewport there too.
Dashboard, Author, and the static demo share this CSS. No renderer or data
semantics changed; unrelated admin/preparation tables retain their layout.

## Browser regression tests

`packages/web/test/sticky-table.test.mjs` is included automatically by the web
workspace's existing `test/*.test.mjs` glob and therefore by root `npm test`.
Its **18 tests** render the real `VisualCard` with synthetic rows and the shipped
stylesheet in Chromium. They check computed sticky positions and offsets,
actual cell coordinates after scrolling both axes, corner hit testing, layer
order, opaque backgrounds, custom/dark themes, mobile cards, hidden headers,
conditional formatting, and unrelated tables.

`test/chromium.mjs` uses Node's child-process streams and Chromium's DevTools
pipe, without an added npm dependency. Install a local Chromium/Chrome browser
and set `OPENSIGHT_CHROMIUM` to its executable if it is outside the common
locations checked by the helper. A missing browser fails clearly; tests are
never silently skipped. Test documents use a restrictive CSP with no external
resources. No local HTTP server or network data is needed by these tests.

## Visual verification and demo

`npm run build:demo --workspace @opensight/web` rebuilt
`packages/web/dist/opensight-demo.html` and the embed artifacts. This is a
static artifact, not a deployed server. Opening the single-file demo over
`file://` verified the computed sticky styles in the dashboard and in actual
Author table and pivot previews, with no page errors or external requests.

Scrolled table and pivot stress captures confirmed that labels and headers
remain visible and opaque. Chromium rendered the collapsed-border and
zero-spacing separate-border versions identically (0 changed pixels in each
1100×800 capture), so `border-collapse: collapse` is retained. Firefox and
WebKit were not exercised.

Comparison with the pre-change demo retained dashboard/card geometry and the
Data → Visuals/wells → sheet layout seen in the local QuickSight reference.
Home differed by 80 edge pixels at 1440×1505; the bar Author comparison differed
by 466 pixels at 1440×1284, including a one-pixel selection edge. No new
unresolved visual defect was found. QuickSight visual fidelity remains unmeasured.

The README hero GIF, pivot image, and dashboard image were refreshed. The
maintained repository adaptation of the workspace README capture script
produced 145 frames with zero page errors; FFmpeg assembled a 960×600,
10fps, 14.5-second GIF. Full-page feature captures scroll to the top first so
the sticky application header is captured in its normal position.

The initial README capture exposed an existing interaction between master's
sticky app header (z-index 60) and the fixed Ask Q panel (z-index 40): the header
covers the panel's close button. The supported Escape shortcut completed the
capture. Follow up in the next UI chrome maintenance pass; remote issue filing
is deferred to publishing because this build permits no network activity.
The application header/panel layering is unchanged by issue #48.

Local evidence, capture adaptations, and logs are retained under ignored
`.opensight/issue-48/`.

## Full-suite verification

The first root run inherited `TZ=America/Chicago`: all 712 web tests passed,
but the existing query-engine PostgreSQL scalar differential test failed when
converting an offset timestamp. It expected `2024-02-29T21:01:02.123Z` and got
`2024-03-01T03:01:02.123Z`. The targeted test passed under UTC; no query-engine
code or assertions were changed. Final verification uses `TZ=UTC npm test`
from the repository root. The initial run is preserved separately in
`root-npm-test-chicago.log`.

The final `TZ=UTC npm test` exited **0**: **1,772 passed / 0 failed /
12 skipped / 0 cancelled**. All skips require live Postgres with
`DATABASE_URL`; no browser tests were skipped. Strict TypeScript checks and
workspace builds passed.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 303 | 0 | 10 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 500 | 0 | 2 |
| Web | 712 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| **Total** | **1,772** | **0** | **12** |

`test-summary.json` records the counts, `root-npm-test.log` retains the complete
successful run, and `demo.sha256` verifies that the rebuilt demo survived the
full suite unchanged. `git diff master --check` is clean. All commits remain
on the requested branch; master is unchanged and nothing was pushed.
