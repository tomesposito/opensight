# Insight visual verification

Work is checkpointed on `work/parity-insight-visual`, using the requested
`Insight visual:` prefix. The first commit adds only the insight visual to the
Phase 2d catalog list in `SOLUTION_DESIGN.md`. No later commit changes the spec.
Master remains at `3f5fef3b`; there is no merge, push, deployment or GitHub issue
change. No dependency was added and no AWS service was called.

Implemented parser types and unknown-variant validation; native definition
conversion and computation-field projection; gallery and wells; deterministic
narratives; KPI-style graphic text rendering; computation presets and rank count;
named import errors and blocked queries; and preserved original exports.
[Insight semantics](insight-visual.md) lists the supported subset and divergences.
Forecasts, anomalies, custom templates and additional computation types remain
explicitly unsupported. Native insights without a category also remain blocked
under this slice's required one-category contract.

## Screenshot tour

`packages/web/scripts/capture-insight-tour.mjs` passed against the rebuilt static
demo: **16 captures, 0 page errors, 0 external requests**. The baseline was saved
before implementation from `3f5fef3b`. HTTP(S) was blocked throughout the tour.
Every capture passed the 1440-pixel viewport horizontal-overflow check.

The tour covers baseline/current Home and empty/populated bar authoring, insight
summaries, metric comparisons, configurable top/bottom lists, a missing-time
error, monthly growth with decimals, dark chrome, both missing required wells,
and the forecast import report and blocked preview. All values come from pinned
synthetic data. For example, revenue totals 900 (East 500, West 400), and monthly
revenue changes from 50 in March to 250 in April: +200 and +400%.

Decoded RGB comparison against the baseline:

| Surface | Size | Changed pixels | Location |
| --- | --- | ---: | --- |
| Home | 1440×1505 | 0 | None |
| Empty Author | 1440×1204 | 1,314 | 1,312 gallery pixels; two border pixels |
| Bar Author | 1440×1284 | 2,213 | Gallery, (236,481)–(406,542) |

The empty-editor border differences are at (441,637) and (1192,637), with channel
changes of one level. The gallery differences show the added Insight entry and
adjacent moved entries. No chart, toolbar or canvas geometry regression was
found. Visual inspection against the prior media and local
`qs-author-light-flow.jpg` reference retains Data → Visuals/wells → sheet flow.
QuickSight insight-specific visual fidelity remains unmeasured. Reference
screenshots are not committed, and no GitHub issue was filed as instructed.

The capture loop found and fixed punctuation wrapping and a selector's accessible
label. It also caught that actual grouped queries return `YYYY-MM` labels rather
than full ISO dates. The shared decoder now handles all four date-grain label
formats. Tests exercise actual fixture results and DuckDB/PostgreSQL labels.
All final captures pass; no capture-tool follow-up remains.

## Demo and README media

`npm run build:demo --workspace @opensight/web` and the requested
`node ~/workspace/goals/opensight/hidden_files/build-demo-shim.mjs` both succeeded.
The single-file demo and embed artifacts were rebuilt. This is a static demo,
not a deployed server.

The requested workspace `readme-gif-44.mjs` succeeded against the final local
shim artifact with 43 frames and no page errors. The maintained repository
adaptation includes the new Insight stop and succeeded with **145 frames and
no page errors**. Its FFmpeg palette/assembly output is the refreshed README
hero: **960×600, 10 fps, 14.5 seconds**.

Refreshed Author empty/populated, radar, Sankey, waterfall, pivot, Q panel, URL
actions, local-data, local-drafts, expired-draft and O-answer screenshots; added
`insight.png` and updated README coverage to 23 visual types. Other feature images
depict unchanged surfaces. The Q-panel tour passed desktop/mobile geometry and
keyboard checks with zero page errors or external requests. The local-data tour
passed with **17 real synthetic-data queries, 0 hosted O requests, 0 page errors
and 0 external requests**. The URL-action capture also passed.

Evidence is retained under ignored `.opensight/insight/`: baseline, browser
captures, comparison JSON, README frames, build/capture logs and the demo checksum.
Only synthetic OpenSight screenshots are committed.

## Tests

The final repository-root `npm test` exited **0**: **1,754 passed / 0 failed /
12 skipped / 0 cancelled** (1,766 total tests). All 12 skips are live-Postgres
checks because `DATABASE_URL` is unset; no other tests were skipped. Strict
TypeScript checks and workspace builds passed. All browser captures and GIF
encoding completed before the independent full-suite run.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 303 | 0 | 10 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 500 | 0 | 2 |
| Web | 694 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| **Total** | **1,754** | **0** | **12** |

Coverage includes totals, extrema/shares, stable ranked lists and configurable N,
null/zero/overflow cases, native/API and projected definitions, date and metric
comparisons, real pinned query rows and aliases, all named unsupported cases,
gallery/well controls, unchanged blocked exports, themed SVG text, plain-text
handling and narrow-card wrapping. Shared math and date labels are compared
against DuckDB and PostgreSQL (PGlite); fixture date-grain results are exercised
through the actual builder/compiler path.

An earlier web run found three chart-only audit assumptions; those audits now
verify graphic narratives and the correct text controls. The screenshot loop's
period-label failure was fixed and regression-tested before the final full run.
No thresholds or skip conditions were relaxed.

`verification/root-npm-test.log` and `verification/test-summary.json` retain the
full results. `git diff 3f5fef3b --check` is clean, and the final demo checksum
matches the captured artifact. The build, demo, media and verification work are
complete; the intentionally unsupported computation subset is documented above.
