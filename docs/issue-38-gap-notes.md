# Issue #38 — radar chart verification

Implemented on `work/issue-38-radar-chart`. The first checkpoint adds only
“radar chart” to the Phase 2d renderer list in `SOLUTION_DESIGN.md`; subsequent
commits leave the spec unchanged. No dependency, deployment, AWS call, merge,
push, or remote issue update was added.

The implementation covers compiler/API conversion, gallery and Category/Color/
Values wells, shared live/fixture previews, named import failures, and unchanged
bundle round trips. [Radar semantics](radar-chart.md) documents the independent
axis scales, missing-value rendering, and supported subset of native options.

## Screenshot tour and comparison

`packages/web/scripts/capture-radar-tour.mjs` passed against the final rebuilt
static demo with **11 captures, 0 page errors, and 0 external requests**. All
HTTP(S) requests were blocked. The viewport was 1440×1100; every capture passed
the document horizontal-overflow check. The tour covers:

- Baseline and current Home and bar authoring pages, using a saved pre-build
  demo from the starting revision (`7a25ed33`).
- Radar Category axes, multiple measures and Color groups, decimal labels,
  legend visibility, resizing through the visible handle, and dark chrome.
- Missing Category errors, an unsupported native `shape` in a JSON import,
  its named `CompileError` in the import report, and the blocked preview.

Decoded RGB comparison found **0 changed pixels** on Home (1440×1584).
The bar authoring view (1440×1632) changed **3,557 pixels**, all inside the
gallery rectangle `(229, 689)–(415, 758)`: Radar was inserted and neighboring
entries moved. Existing chart, toolbar, canvas, and panel geometry were unchanged.

Visual inspection against the previous README author screenshot and the local
`qs-author-light-flow.jpg` reference retains the Data → Visuals/wells → sheet
flow and docked Properties. The chart is resizable in the dominant sheet area.
Early captures exposed overlapping data labels; the final implementation uses
ECharts overlap hiding, with a rendered-label regression test. Missing vertices
also have rendered-geometry tests, because native ECharts radar otherwise draws
them at the center. No new unresolved visual defect was found. QuickSight visual
fidelity remains unmeasured; references are not copied into this repository.

## Demo and README media

The final single-file Vite demo build exited 0. The explicitly requested
`~/workspace/goals/opensight/hidden_files/build-demo-shim.mjs` then exited 0 and
updated the local demo artifact. This is a static file, not a deployed server.

The maintained `capture-readme-tour.mjs` adaptation of
`~/workspace/tools/screenshots/readme-gif.mjs` captured **91 frames with 0 page
errors**, including a radar with a Color split. The documented FFmpeg palette
commands assembled the README GIF at **960×600, 10 fps, 9.1 seconds**.
Refreshed `docs/images/author.png` and `docs/images/opensight-tour.gif`, added
`docs/images/radar.png`, and updated the README's catalog count and radar note.
Other README feature images depict unchanged surfaces.

Initial capture attempts used the wrong JSON envelope and tried to change a
visual after saving without the required editor state. The successful harness
imports a single resource JSON and creates radar through the gallery, opening
the laptop Properties rail. These capture problems are resolved; no media
follow-up remains.

Evidence is retained in ignored `.opensight/issue-38/`: baseline/demo snapshots,
`browser/summary.json`, `browser/comparison.json`, captures, build logs, focused
and full-suite logs, and GIF frames/assembly. The reproducible capture script is
committed alongside the feature.

## Verification

The focused integration run passed **93 / 0 / 0** (passed / failed / skipped),
including radar SVG geometry, overlap hiding, builder wells, import preservation,
the converter, and the properties audit. Earlier unsupported-type tests used
radar as their placeholder; they now use a future visual so the same rejection
coverage continues after radar becomes supported.
