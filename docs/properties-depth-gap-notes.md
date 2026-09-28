# Issue #2 — Properties reference comparison

Compared the rebuilt static `packages/web/dist/opensight-demo.html` with the
supplied `qs-editor-newlook.jpg`, `qs-author-light-flow.jpg`, and prior OpenSight
`tour-i1-author-light.png` reference on 2026-09-28. The demo was opened from
`file://`; it is not a deployed server. No external page requests or browser
errors occurred. Browser tooling used the preinstalled Apache-2.0 Playwright
package and local Chromium; repository dependencies did not change.

The seven captures in `/tmp/opensight-issue-2-screenshots/` are:

| Capture | Finding |
| --- | --- |
| `pivot-sections-light.png` | Visual/Interaction tabs and every reference section appear in reference order, followed by the existing palette/theme sections. The left-to-right editor layout is retained. |
| `pivot-options-light.png` | Metric placement changes the actual table to metric rows; wrapping and explicit column widths apply. The sheet stays visible beside the options. |
| `pivot-interaction-light.png` | Filters, Filter actions, Drill-down hierarchy, and Parameter bindings are grouped under Interaction. Visual formatting is hidden while this tab is active. |
| `pivot-sections-dark.png` | Tab labels, section borders, and active-tab indication remain readable in dark editor chrome. The analysis theme remains independently configurable. |
| `bar-display-light.png` | The larger title, subtitle, right-side legend, numeric precision, and category spacing are visible in the rendered bar chart. |
| `pie-display-light.png` | The side legend reserves its own space. The tour exposed truncated percentage labels in small cards; wrapping now keeps the full percentage visible, with an SVG regression test. |
| `display-narrow.png` | At 1100 px, the existing responsive panels collapse and Properties can be reopened below the sheet. Controls remain usable and the selected visual retains its settings. |

Browser checks start at 1440×1050; the narrow check uses 1100×900. Capture
viewports retain those widths and expand to the page height to paint all content.
Full-page captures include sections below the initial viewport. Browser checks
also verified metric-row output, tab visibility, rendered bar label precision,
and zero external requests. These are targeted comparisons, not a quantitative
QuickSight fidelity measurement.

Remaining reference differences stay in their existing work areas: interactive
pivot group expansion/collapse is issue #5; denser editor chrome, more compact
section spacing, and canvas/card geometry remain layout fidelity work after the
issue #1 baseline. The supplied QuickSight screenshot also contains different
data and a more complex pivot. No new layout regression was found in this tour.
No GitHub issue was opened, changed, or closed during this offline build; these
notes are the handoff for the orchestrator's later review/publish loop.

Final verification on the resumed branch ran `npm test` from the repository root:
**1,050 passed / 0 failed / 1 skipped** across 1,051 tests. The only skip was the
live Postgres executor because `DATABASE_URL` was unset. Suite totals were API
90, bundle parser 183, embedding SDK 4, Q interpreter 32, query engine 353 plus
the one skip, web 385, and root conformance 3. The successful run used localhost
access for the API tests after the restricted sandbox denied listening on
`127.0.0.1`; no test or product changes were needed for that restriction.

The resumed review rebuilt the demo with
`npm run build:demo --workspace @opensight/web` and refreshed all seven captures.
The browser assertions passed with zero page errors and zero external requests.
Chromium's initial full-page captures intermittently omitted offscreen card paint.
The refreshed captures use software rendering, an expanded viewport, and a second
capture after repaint. The dark image shows the
pivot title, subtitle, and table correctly, with the analysis theme independent
of the dark editor chrome. Build output and reference/capture images remain
outside version control.
