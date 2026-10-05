# Issue #40 — pivot row-group expand/collapse

Implemented on `work/issue-40-pivot-expand-collapse` from `140686b1`, using the
issue acceptance criteria supplied in the brief. `SOLUTION_DESIGN.md` is
unchanged. No dependency, merge, push, deployment or remote issue update was
introduced. [Row-group semantics](pivot-row-groups.md) documents the persisted
formatting extension and the subtotal/visibility behavior.

## Renderer and bundle verification

The focused Node run passed **31 / 0 / 0** (passed / failed / skipped). It covers
typed path validation, independent visuals and nested groups, preservation of
child state, subtotal and grand-total retention, hidden-empty rows, metric rows,
recompilation, local drafts, and import/edit/export through JSON and `.qs`.
An authoring integration test confirms toggles do not trigger another API query.
All these tests run under root `npm test`.

`packages/web/scripts/capture-pivot-tour.mjs` exercised the rebuilt single-file
demo through visible UI controls with HTTP(S) blocked. The final run exited 0
with **8 captures, 0 page errors and 0 external requests**. It added a pivot,
assigned region/category rows, enabled totals/subtotals, and checked:

- Tab focus and Enter/Space activation, `aria-expanded`, and retained focus.
- Hidden descendants with an unchanged East subtotal, independent West state,
  restored detail rows and an unchanged grand total.
- A downloaded `.qs`, import of that archive with East still collapsed, an
  expansion edit, and JSON export with the updated state.
- Label-only anchors with subtotals disabled; multiple metrics on rows with
  one toggle per group; and dark chrome.

The tour uses the existing local Playwright/Chromium installation. Its initial
selectors were corrected to match the existing property sections and accessible
select names; the successful run covers every assertion. The sandbox cannot
start Chromium's socket setup, so the local browser ran outside it, with all
HTTP(S) requests blocked by the harness.

## Screenshot comparison and README media

Two additional baseline captures use the pre-change demo saved from `140686b1`.
Decoded RGB comparison finds **0 changed pixels** on Home (1440×1584) and the
existing bar authoring view (1440×1632). All final captures pass the document
horizontal-overflow check at a 1440×1100 viewport.

Visual inspection against `tour-i5-pivot-toggles.png` and
`qs-author-light-flow.jpg` preserves the +/− subtotal affordance, Data →
Visuals/field wells → sheet order, and docked Properties. New headers without
subtotals contain labels only. No new unresolved user-visible defect was found;
QuickSight visual fidelity remains unmeasured. References are not copied into
the repository.

Rebuilt `packages/web/dist/opensight-demo.html`; this is a static file, not a
deployed server. Re-captured the unchanged author image, added
`docs/images/pivot.png`, and refreshed the README hero using the maintained
adaptation of `~/workspace/tools/screenshots/readme-gif.mjs`. The capture has
**106 frames and 0 page errors**, including collapsed and expanded pivots.
FFmpeg assembled **960×600, 10 fps, 10.6 seconds** using the documented palette
commands. Other feature images depict unchanged surfaces.

Ignored `.opensight/issue-40/` retains test/build logs, the baseline demo,
browser captures, JSON comparison, synthetic exported bundles and GIF frames.

## Full repository verification

The root command uses the existing local PostgreSQL test service:

```sh
TZ=UTC DATABASE_URL=postgresql://postgres@127.0.0.1:5433/opensight npm test
```

The confirmed run exited **0** and reports **1,682 passed / 0 failed / 0 skipped /
0 cancelled**, including all live PostgreSQL tests and strict TypeScript checks.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 313 | 0 | 0 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| Interpreter | 32 | 0 | 0 |
| Query engine | 514 | 0 | 0 |
| Web | 611 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| **Total** | **1,682** | **0** | **0** |

The initial sandboxed attempt could not reach loopback PostgreSQL and was
stopped. The run outside the sandbox produced every passing summary, but its
command wrapper returned 143 afterward. A detached confirmation reproduced all
seven passing summaries and recorded exit **0** independently in
`full-tests-confirmed.exit`. `full-tests-confirmed.log` and `test-summary.json`
retain the complete results.

`npm run build:demo --workspace @opensight/web` exited 0, including fixture
preparation, strict TypeScript, the single-file demo and all embedding entries.
The screenshot and GIF capture scripts pass `node --check`.
