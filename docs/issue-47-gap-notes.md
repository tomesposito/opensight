# Issue #47 — Waterfall chart verification

Implemented on `work/issue-47-waterfall-chart`, with `Issue #47:` checkpoint
commits. The first commit adds only “waterfall chart” to the Phase 2d visual list
in `SOLUTION_DESIGN.md`; later commits leave that contract unchanged. No
runtime dependency, AWS call, deployment, merge, push or remote issue update
was made. Master remains unchanged.

The feature covers native API conversion, gallery and Categories/Values wells,
static/API previews, signed floating bars including crossings below zero, a final
Total, labels, legend and tooltip visibility, named validation/import errors,
and unchanged exports of blocked imports. [Waterfall semantics](waterfall-chart.md)
records supported options and deliberate compatibility limits.

## Screenshot tour and comparison

`packages/web/scripts/capture-waterfall-tour.mjs` passed against the rebuilt
static demo: **14 captures, 0 page errors and 0 external requests**. HTTP(S) was
blocked. The pre-build baseline was saved from `34c73eff`. Every captured page
passed the horizontal-overflow check at 1440×1100.

The tour covers baseline/current Home and empty/populated bar authoring,
waterfall revenue accumulation, a calculated signed scenario, decimal labels,
legend visibility, dark chrome, both missing wells, and unsupported breakdowns
in the import report and blocked preview. The signed scenario visibly creates
`ifelse({region} = 'East', {revenue}, -{revenue} * 2)` over pinned synthetic sales:
East contributes +500, West −800, and the final Total is −300. Responses and
chart data are not substituted by the capture script.

Decoded RGB comparison with the pre-build demo found:

| Surface | Image size | Changed pixels | Bounding rectangle |
| --- | --- | ---: | --- |
| Home | 1440×1505 | 0 | None |
| Empty Author | 1440×1204 | 1,061 | (236, 481)–(413, 510) |
| Bar Author | 1440×1284 | 2,061 | (236, 481)–(414, 542) |

All differences are inside the gallery, where Waterfall was added and adjacent
entries moved. Existing chart, canvas, toolbar and dock geometry stayed the same.
Visual inspection against prior README media and the local
`qs-author-light-flow.jpg` reference retains the Data → Visuals/wells → sheet
flow. Signed labels, colors, the negative Total, capability note and named
errors are visible. No new unresolved user-visible defect was found, so no new
GitHub issue or phase-plan entry is needed. QuickSight waterfall geometry and
visual fidelity remain unmeasured; reference images are not committed.

## Demo and README media

`npm run build:demo --workspace @opensight/web` exited 0 and rebuilt the
single-file demo and embed artifacts. The requested
`node ~/workspace/goals/opensight/hidden_files/build-demo-shim.mjs` also exited 0
and updated the local static demo. The captured demo checksum matches the
rebuilt artifact. This is a static artifact, not a deployed server.

The requested workspace `readme-gif-44.mjs` was attempted and failed after a
30-second timeout waiting for `#o-question`, because the current shell opens
that input through the Ask Q trigger. The maintained repository adaptation,
`packages/web/scripts/capture-readme-tour.mjs`, handles that navigation and now
includes Waterfall. It passed with **136 frames and 0 page errors**. The FFmpeg
palette-generation/assembly recipe produced the README hero GIF at **960×600,
10 fps, 13.6 seconds**.

Refreshed Author empty/populated, radar, Sankey, pivot, Q panel, URL actions,
local data, local drafts, expired draft and O-answer screenshots; added
`waterfall.png` and updated README coverage to 22 visual types. Other feature
images depict unchanged surfaces. The Q-panel tour passed desktop/mobile
geometry and keyboard checks with no page errors or external requests. The
local API/media tour passed with **17 real synthetic-data queries, 0 hosted O
requests, 0 page errors and 0 external requests**. The URL-action capture also
passed with no page errors or external requests after correcting its local
capture selector.

**Tooling follow-up:** update the workspace
`~/workspace/tools/screenshots/readme-gif-44.mjs` to open the current Ask Q trigger
before selecting `#o-question`, or use the maintained repository adaptation.
The README media refresh itself is complete.

Evidence is retained under ignored `.opensight/issue-47/`: the pre-build demo,
browser captures, comparison JSON, README frames, and verification logs. Only
synthetic OpenSight screenshots are committed.
