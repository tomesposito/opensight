# Issue #3 — Data panel reference comparison

Issue #3 follows the supplied brief without changing `SOLUTION_DESIGN.md`.
The Data panel describes the local assignable dataset with an import-mode badge,
verified metadata where available, semantic folders and accessible type icons.
No new dependencies were added.

Root verification on 2026-09-28: `npm test` completed with **1,068 passed / 0 failed /
1 skipped** (1,069 tests). The only skip was the live Postgres executor because
`DATABASE_URL` was unset. Totals: API 90, bundle parser 183, embedding SDK 4,
Q interpreter 32, query engine 353 passed plus 1 skipped, web 403, root conformance
3. The run allowed localhost listeners for the API tests; it made no external
service calls. The 44 bundle round-trip checks include preservation of imported
folder metadata and absence of derived presentation fields in native exports.

Both `npm run build --workspace @opensight/web` and
`npm run build:demo --workspace @opensight/web` succeeded. The latter produced
`packages/web/dist/opensight-demo.html`. The requested internal
`build-demo-shim.mjs` then refreshed the published **static file**; no server was
deployed. The production build retains the existing large-chunk advisory.

The internal `~/workspace/tools/screenshots/tour-i3.mjs` uses the preinstalled
Playwright Core and `/opt/meta-chromium/chrome`. It captured these six files in
`~/workspace/goals/opensight/hidden_files/lookfeel-references/`:

| Capture | Finding |
| --- | --- |
| `tour-i3-author-overview.png` | Selected bar visual, assigned region/revenue, all six base fields grouped once. Data → Visuals → sheet → Properties remains intact. |
| `tour-i3-dataset-detail.png` | Local sales dataset, SPICE badge, actual 8 sample rows, offline label and hosted refresh requirement are readable without truncation. |
| `tour-i3-collapsed-group.png` | Metadata closes with the keyboard; Geography and Sales stay expanded. |
| `tour-i3-collapsed-search.png` | Searching `re` hides Metadata and nonmatching fields; Geography is collapsed while revenue remains visible under Sales. |
| `tour-i3-author-dark.png` | Badge, metadata, folders and icons retain contrast in dark chrome. The chart retains its independently configured light analysis theme. |
| `tour-i3-author-full.png` | Full editor chrome and offline disclosures remain visible, including the unmeasured-fidelity footer. |

The tour passed keyboard collapse, search reveal/restore, no-match state, and
1100 px dock reopening checks, with **0 browser page errors / 0 external
requests**. Standard captures use a 1440×900 viewport. The dark capture paints
at 1440×1600 and crops the 1440×900 workspace; this avoids the headless Chromium
paint omission already documented in the issue #2 notes. Software rendering and
a second capture also prevent partial chart paint after scrolls. Final images
were inspected with the chart present. The images and tour are internal and
are not included in repository commits.

Compared against `qs-editor-newlook.jpg`, `qs-editor-classic.jpg`,
`tour-i2-author-overview.png`, and `demo-author-3a.png`: the badge, folder hierarchy
and geography/calendar icons bring the Data panel closer to the supplied
QuickSight examples. Unlike the older 3a stacked build controls, the current
issue #2 left-to-right layout is preserved. The Data rail remains 190 px, Visuals
216 px, sheet 758 px and Properties 220 px within the 1408 px workspace. All six
fields and Parameters fit the 900 px viewport. The panel is taller than the
issue #2 baseline because of the requested metadata and third folder heading;
no clipping, overlap, horizontal overflow or unintended visual regression was
observed. Dark icons are brighter than the old muted type glyphs.

Existing differences in overall editor density, notice/chrome height and the
fixed-sample chart remain; quantitative QuickSight fidelity is still unmeasured.
No new user-visible regression needs a new issue. No GitHub issue was changed or
filed during this offline build. No product decision or credential is needed to
complete issue #3; observing live refresh data requires a configured hosted API.
