# Issue #140: dashboard width beside Ask O

The app shell's `main` is now the named `dashboard-content` inline-size
container. At a content width of 600px or less, dashboard cards use the existing
compact layout: one column, 16px gaps, 340px minimum card height, bounded table
cards and 235px minimum chart content height. Inline grid placements remain
intact and apply again when the content grows. This breakpoint leaves room
above the grid's 350px of fixed gutters and preserves the desktop layout at a
1280px viewport even with Ask O open.

The existing mobile viewport rules still apply. Ask O continues to reserve
400px above 760px and overlay at or below 760px, with its existing 150ms
transition and reduced-motion behavior. No dependencies or configuration were
added; `SOLUTION_DESIGN.md` was not changed.

## Regression coverage

`packages/web/test/q-panel-transition.test.mjs` now builds a real dashboard grid
using the production stylesheets and VisualCard markup, including inline
placements that end at grid line 37, chart containers and a table card.

- At 761px, 900px and 1280px: measure before opening, after docking, and after
  closing. Check every card and chart against main's content edges, the docked
  panel's left edge, and the grid's horizontal scroll extent. Closing restores
  the original card placements.
- At 1280px: preserve 36 columns and 10px gaps with the panel open and closed.
- At a fixed 1920px viewport with no panel: reduce main's content width through
  601px, 600px and 284px, then restore it. This proves the compact behavior is
  driven by available width rather than the viewport or panel presence.
- At 500px and exactly 760px: retain overlay behavior and compact cards.

The expanded tests failed against the original CSS, including the rightmost
card extending beneath the panel at 900px. With the fix, the targeted file
passes **10 tests / 0 failed / 0 skipped**. Measurements allow for the browser's
vertical scrollbar; it can further reduce the content width.

## Static demo review

Rebuilt the single-file demo and embedded entries with
`npm run build:demo --workspace @opensight/web`, including strict TypeScript.
Captured the actual synthetic sales dashboard before and after the change,
using offline Chromium at 1280×800 and 900×800. Both runs reported zero page
errors and zero external requests.

At 900px with Ask O open, the content and grid end at x=476 and the panel starts
at x=500. Before the fix, the rightmost visual ended at x=542 and the grid had
66px of horizontal overflow. Afterward, every card ends at x=476 and the grid
has zero horizontal overflow. The charts stack within the compressed content.
Closing the panel restores the original grid.

The 1280px screenshots are byte-for-byte identical before and after the fix in
all three states: closed, open and closed again. README screenshots and the
hero GIF were therefore left unchanged, as requested. Captures, geometry JSON
and verification logs are local artifacts in `/tmp/opensight-issue-140/`.
These are local static-demo captures, not a deployed server; visual fidelity
against QuickSight remains unmeasured.

## Full-suite verification

The root suite runs with `TZ=UTC TMPDIR=/tmp npm test`; the temporary directory
is outside the checkout for the private-operator conformance fixtures. The
initial invocation received SIGTERM during compilation before any tests ran.
It was restarted in a persistent terminal without changing test expectations.

The completed run exited successfully: **3,999 passed / 0 failed / 33 skipped**,
including the 32 Python SDK tests. All skips require live PostgreSQL; there
were no cancellations or todos. No existing CSS assertion needed adjustment.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 803 | 0 | 31 |
| Bundle parser | 199 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK (JavaScript) | 28 | 0 | 0 |
| Headless SDK (Python) | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 505 | 0 | 2 |
| Web | 2,144 | 0 | 0 |
| Root conformance | 88 | 0 | 0 |
| **Total** | **3,999** | **0** | **33** |
