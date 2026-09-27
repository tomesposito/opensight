# Phase 2d: visuals, themes and author properties

The Author gallery includes scatter, combo, 100% stacked bar, area, funnel,
gauge, treemap, heatmap, box plot, word cloud, histogram, filled map and point
map, alongside the original bar, line, pie/donut, KPI, table and pivot.
Each type has field wells and a capability note. All use the existing ECharts
SVG renderer or semantic HTML tables.

## Rendering boundaries

- Scatter uses X and Y measures, with an optional third size measure. Combo
  uses the first measure for bars and the remaining measures for lines on a
  shared axis. Percentage bars normalize nonnegative measures per category.
- Box plots show min, interpolated quartiles and max of supplied result values;
  histogram bins also describe supplied values. Builder samples are grouped
  totals, not reconstructed raw observations. Histogram bins are configurable
  from 1 to 100. Gauge minimum and maximum are editable in Properties.
- Word clouds use a deterministic horizontal grid with weighted text, capped at
  80 words; their result table retains every supplied row.
- Filled maps require country names matching the bundled overview map. Point
  maps require numeric latitude and longitude. The synthetic sales dataset has
  neither: its default map assignments explicitly report the missing geo data.
  No coordinates are invented, and no tiles or geocoding service is contacted.
  [Map provenance and license](../packages/web/third-party/README.md) describe the
  Apache-2.0 data and historical-boundary limitations.
- Unknown visual variants and unsupported native options appear in the import
  report, remain in exported JSON, and cannot silently execute as another chart.

## Themes and formatting

Analysis themes set palette, font, canvas background, visual background and
text color. A visual can inherit the palette or override it. NEW LOOK selects
light/dark editor chrome independently of the analysis theme. Secondary resources
in an imported bundle keep their own themes.

Properties includes display settings, headers, cells, total/subtotal toggles,
row/column/value display names, and ordered conditional formatting rules. Numeric
cell rules include totals and subtotals. Bar, line, area, combo, percentage bar,
pie, scatter and funnel marks use rule colors; other chart types expose rules
in their result table. Percentage bars compare original values. Names and decimal
display settings do not change query bindings, numeric results or interaction
field identities. Hidden headers remain available to assistive technology.

These editable settings round-trip using explicit OpenSight extensions:

| Location | Extension |
| --- | --- |
| Analysis definition | `opensightTheme` |
| Visual body | `opensightPalette`, `opensightFormatting` |
| Gauge / histogram chart configuration | `opensightGauge`, `opensightBins` |
| Table chart configuration | `opensightSubtotalOptions` |
| Histogram / point-map wells | `opensightSample`, `latitude`, `longitude` |

They are not claims of native AWS formatting compatibility. Unsupported native
formatting is reported and retained. API projections recognize `OpenSight*`
extension keys while preserving their internal dictionaries verbatim. UI chrome
and canvas fitting are not exported as analysis semantics.

## Toolbar

File exposes the existing import and download actions. Edit focuses the analysis
title; Data opens the calculated-field editor; Insert adds a bar or focuses the
gallery. Sheets and Objects navigate existing content; Search finds visuals
across sheets and lists matching fields. Menus support keyboard disclosure,
Escape and outside-click dismissal.

FIT TO WIDTH switches between the available canvas width and a horizontally
scrollable 1200-pixel canvas without editing saved grid positions. PUBLISH
explicitly states that hosted publishing needs the AWS deployment and makes no
request. Undo/redo, remote data-source setup, text boxes and images are honestly
disclosed as unavailable.

## Validation and demo

`npm test` at the repository root already includes every web `test/*.test.mjs`:
compiler options and pinned-row SVG rendering for each type; API/bundle dialect
parity; gallery/wells and preview queries; unsupported import reporting; theme,
palette and formatting round-trips; toolbar callbacks/search; Properties edits;
and fitting without layout changes. Existing builder, bundle, controls,
interactions, drill and calculated-field tests run in the same suite.

```bash
npm test
npm run build:demo --workspace @opensight/web
```

The rebuilt standalone artifact is `packages/web/dist/opensight-demo.html`.
No runtime dependency was added for Phase 2d. ECharts is Apache-2.0; React,
React DOM, react-grid-layout and fflate are MIT. Browser checks use the locally
installed Apache-2.0 Playwright/Chromium tooling, without adding it to the app.

Visual review compares the supplied Phase 2c baseline and QuickSight editor
references with light/dark desktop (1440 × 900) and mobile (390 × 844) captures.
The seven-menu toolbar, fitting/publishing affordances, 19-type gallery, named
Properties sections and independent dark chrome close the scoped gaps. The
expanded gallery still takes more vertical space than the reference; collapsing
Visual build exposes the canvas. Exact QuickSight CSS, pivot expand/collapse
and Q features remain outside this slice. Proprietary reference screenshots
are not copied into the repository.

Validation on 2026-09-27: root `npm test` exited 0.

| Root test stage | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 32 | 0 | 0 |
| Bundle parser | 183 | 0 | 0 |
| Query engine | 340 | 0 | 1 |
| Web | 320 | 0 | 0 |
| Conformance | 3 | 0 | 0 |
| Total | 878 | 0 | 1 |

The skipped test is the optional live PostgreSQL executor (`DATABASE_URL` is
unset). TypeScript strict checking is part of the workspace test commands.
The file-based browser smoke check passed with no page errors, no HTTP(S)
requests and no page overflow at the mobile viewport; it also checked menu
routing/dismissal, canvas fitting, unchanged saved layouts and dark total-row
contrast. The final single-file demo is 1,572,479 bytes.
