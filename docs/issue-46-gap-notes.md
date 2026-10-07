# Issue #46 — Sankey diagram verification

Implemented on `work/issue-46-sankey-diagram`, with `Issue #46:` checkpoint
commits. The first commit adds only “sankey diagram” to the Phase 2d visual
list in `SOLUTION_DESIGN.md`; later commits leave that contract unchanged.
No dependency, AWS call, deployment, merge, push or remote issue update was made.

The feature covers both definition dialects, the gallery and Source/Destination/
Weight wells, local/API previews, shared nodes, duplicate-link sums, display
controls, named import errors and unchanged bundle exports.
[Sankey semantics](sankey-diagram.md) records the supported options and deliberate
limits, including cycles, null/negative weights and all-zero flows.

## Screenshot tour and comparison

`packages/web/scripts/capture-sankey-tour.mjs` passed against the rebuilt demo:
**15 captures, 0 page errors and 0 external requests**. HTTP(S) was blocked.
The pre-build demo was saved from `dfbc2a4c`. At 1440×1100, every captured page
passed the horizontal-overflow check. The tour
covers baseline/current Home and empty/populated bar authoring, Sankey flows,
decimal labels, legend visibility, dark chrome, each missing well, invalid
sample profit weights, an unsupported native source sort in the import report,
and its blocked preview.

Decoded RGB comparison with the pre-build static demo found:

| Surface | Image size | Changed pixels | Bounding rectangle |
| --- | --- | ---: | --- |
| Home | 1440×1505 | 0 | None |
| Empty Author | 1440×1204 | 955 | (239, 483)–(413, 510) |
| Bar Author | 1440×1284 | 2,016 | (238, 483)–(414, 542) |

All changed pixels are in the gallery: Sankey was added and neighboring entries
moved. Existing chart, canvas, toolbar and dock geometry remained unchanged.
Visual inspection against the prior README media and the local
`qs-author-light-flow.jpg` reference retains the Data → Visuals/wells → sheet
flow. Labels show values rather than internal node IDs, and the capability note
and errors are visible. No new unresolved user-visible defect was found, so no
new issue or phase-plan entry is needed. QuickSight Sankey geometry and visual
fidelity remain unmeasured; reference images are not committed.

## Demo and README media

The final sequential `npm run build:demo --workspace @opensight/web` exited 0
and rebuilt the single-file demo and embed artifacts. Its demo SHA-256 matches
the artifact used for every static capture. The requested `build-demo-shim.mjs`
then exited 0 and updated the local static demo. This is a static artifact,
not a deployed server. An initial overlapping dependency build caused transient
missing-export errors; the sequential rebuild resolved them.

The maintained `capture-readme-tour.mjs` adaptation of the workspace's
`readme-gif.mjs` flow captured **127 frames with 0 page errors**, including
Sankey. The documented FFmpeg palette commands produced the hero GIF:
**960×600, 10 fps, 12.7 seconds**.

Refreshed Author empty/populated, radar, pivot, Q panel, URL actions, local data,
local drafts, expired draft and O-answer screenshots; added `sankey.png` and
updated the README to 21 visual types. Other feature images depict unchanged
surfaces. The Q-panel tour passed desktop/mobile geometry and keyboard checks
with no page errors or external requests. The local API/media tour passed with
**17 real synthetic-data queries, 0 hosted O requests, 0 page errors and 0
external requests**. URL-action capture likewise recorded no errors or external
requests. No media follow-up remains.

Evidence is retained under ignored `.opensight/issue-46/`: the pre-build demo,
browser captures and comparison JSON, README frames, and verification logs.
Only synthetic OpenSight screenshots are committed.

## Tests

The focused compiler, extra-visual, properties and builder runs passed
**71 passed / 0 failed / 0 skipped**, including rendered SVGs, shared typed
nodes, duplicate sums, invalid graphs, both dialects, well replacement and
removal, local rows, import preservation and query blocking.

The initial root run hit sandbox `listen EPERM` errors in local HTTP tests and
was stopped. The full suite was rerun with local socket access.

The final repository-root `npm test` exited **0**, with **1,716 passed / 0
failed / 12 skipped / 0 cancelled**. All 12 skips are live-Postgres checks
because `DATABASE_URL` was not set; no other tests were skipped. Strict
TypeScript checks and workspace builds passed.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 303 | 0 | 10 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 499 | 0 | 2 |
| Web | 659 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| **Total** | **1,716** | **0** | **12** |

`verification/root-npm-test.log` and `verification/test-summary.json` retain the
full result. `git diff dfbc2a4c --check` is clean. All commits remain on the
requested issue branch; master is unchanged and nothing was pushed.
