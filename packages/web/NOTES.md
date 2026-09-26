# Phase 0 web renderer

This continues the existing React 19 / ECharts 6 / Vite 8 scaffold on
`work/web-renderer`. D2 and D4 of `SOLUTION_DESIGN.md` guide this slice; that spec
is unchanged. This is a local fixture explorer, not a general QuickSight runtime
or a rendering-fidelity claim.

## Run

From the repository root (Node 24+):

```sh
npm install
npm run dev --workspace @opensight/web
npm test
npm run build
npm run preview --workspace @opensight/web
```

Vite serves on loopback. `dev`, `build`, and `test` first build the existing
bundle parser and regenerate `src/fixtures.generated.json`. The generated file
and build outputs are ignored; a fresh checkout needs no manually extracted ZIP
or copied public assets. Root `npm test` already runs every workspace, so its
existing script automatically includes this package. No browser is required.

## Runtime and data boundary

- React owns the dashboard, sheet selection, cards, diagnostic messages, and
  accessible data tables. The pure compiler owns visual normalization and
  ECharts options. Shared `BundleVisual` / `VisualBody` types come from the
  parser via **type-only** imports. Browser code imports no Node parser runtime.
- ECharts uses its modular imports and **SVG renderer**, which suits these small
  fixtures and permits the same registration to run in browser-free SVG smoke
  tests. This selects ECharts for the first slice without editing D4's status.
  React effects dispose charts and disconnect `ResizeObserver` on teardown;
  animation is disabled for deterministic output and reduced motion.
- Vite 8 uses Rolldown. The scaffold's obsolete object-form `manualChunks` is
  replaced with `rolldownOptions.output.codeSplitting` to keep ECharts/zrender
  in a separate vendor chunk; the lockfile records the resolved dependency versions.
- The Node preparation script reads the actual sanitized `.qs` with
  `parseQsBundle`, selects its dashboard member, and preserves the original
  visual definition in generated JSON. The `.qs` itself is not fetched or
  decompressed in the browser. Preparation does not query any source.
- **Precomputed results were chosen instead of browser CSV aggregation.** Sales
  rows come directly from `expected-queries.json`; neither its SQL nor DuckDB is
  executed by the app or preparation script. The existing query-engine suite
  separately checks these oracles. The fixed East filter, UTC month grouping,
  and discounted-revenue calculation are already reflected in those results.
  No filter controls suggest that the user can recompute the fixed results.
- Bindings use a field ID override, otherwise the source column name. The line
  field `order_date` explicitly binds to the oracle's `month` alias. The compiler
  does not infer aliases, aggregate raw rows, evaluate expressions, apply filters,
  or silently turn missing/non-numeric measures into zero.
- **The real export contains definitions, not underlying data.** Its pie is
  compiled with `rows: null`, an empty series, and a visible data-unavailable
  overlay. There are no invented country/death values. Actual data rendering is
  blocked because the Athena source and security policies remain unresolved.
  Unit tests supply clearly test-only rows to exercise its field bindings/sort.
- `scripts/fixture-pins.json` pins the complete real archive plus the sales
  definition, dataset/source responses, local security declaration, CSV and
  expected results. Preparation fails on *any* changed bytes, including new
  filters, parameters, calculations, transforms or security properties. The
  sales mapping also explicitly requires unrestricted dataset/source flags.
  These pins authorize only the reviewed, closed repository fixtures; they are
  not an arbitrary-import security validator. Review dependencies and refresh
  result oracles before deliberately changing pins. Arbitrary upload, source
  connection, query execution and export are outside this slice.

## Compiler scope and choices

`compileVisual` returns a normalized model, ECharts option, ordered table cells,
and `ready` / `empty` / `unavailable` state. It accepts already authorized and
aggregated rows. `CompileError` includes the source member/JSON property path.
Unsupported semantics fail instead of silently dropping a field well or visual.

The two input dialects are selected explicitly. Only the **observed camelCase
pie** is accepted for archive inputs. PascalCase bar, KPI, pie, line and table
shapes use the documentation catalog and synthetic fixture. No recursive casing
conversion or invented camelCase bar/KPI schema is introduced. API projections
are provisional and parser inventory success grants no execution permission.

| Visual | Implemented subset | Deliberately unsupported |
| --- | --- | --- |
| Pie/donut | One categorical field, one numerical SUM measure; labels, legend and tooltip visibility; one bound field sort; WHOLE/SMALL/MEDIUM/LARGE arc | Negative/null slices, small multiples, top-N/Other aggregation, center labels, custom palette |
| Bar | One category, one or more numerical SUM measures; vertical/horizontal; clustered/stacked; category/value axes | Color grouping, percent stacks, small multiples, reference lines, custom series |
| KPI | One numerical SUM aggregate; centered ECharts `graphic` text | Targets, trends, comparisons, conditional formatting, multiple rows |
| Line | One category/date group and numerical SUM measures; discrete result categories, explicit month alias; null gaps | Continuous date-axis inference, missing-month filling, secondary axes, forecasting |
| Table | One group-by field and numerical SUM measures; native HTML table from validated cells | Pivot, pagination, totals, custom formatting |

- Numerical measures require explicit `SUM` in this slice. It is a binding
  contract for precomputed values, not an instruction to sum them in JavaScript.
  KPI requires at most one aggregate row. Repeated categories fail because they
  indicate unaggregated or ambiguously grouped results. Cross-dataset fields,
  calculations inside field wells, unknown properties, actions, drill hierarchies,
  and nonempty unsupported wells are rejected with located errors.
- Pie outer radius is 70%; WHOLE has 0% inner radius. SMALL/MEDIUM/LARGE arc
  thicknesses use inner radii of 56%/42%/28% respectively. These are explicit
  OpenSight approximations: AWS documents enum choices, not pixel equivalence.
  A missing arc defaults to a whole pie. Zero-total pies do not fabricate equal
  slices. Bar/line null values remain gaps; KPI null is “No value”, distinct from
  0, an empty result set, and unavailable data.
- The real sample's descending measure sort is honored on a copied row array.
  Its no-count `OtherCategories: INCLUDE` options do not invent a limit or an
  Other bucket. Located rendering notes disclose this, subtitle omission, and
  simplified detailed tooltips. Explicit top-N limits are rejected.
- Titles are native React headings (respecting hidden visibility), with a
  measure/category fallback when the export provides no text. Rich-title HTML
  is never injected; it produces a warning and plain fallback. Tooltips use
  ECharts rich-text drawing rather than HTML. No external fonts or assets load.
- Layouts use a responsive 36-column CSS grid with observed spans. Missing real
  row/column indices default to zero. Row units are 46px with 10px gaps; fixed
  1600px QuickSight canvas geometry is not reproduced. Below 760px, cards stack
  in definition order. This is functional layout coverage, not screenshot parity.
- The HTML table visual is intentionally outside ECharts; there is no chart
  series that represents a semantic HTML table. Other chart cards expose their
  same validated cells through “View data”. Charts have accessible labels and
  the dashboard and sheet selectors support keyboard use.

## Validation and limitations

`npm test --workspace @opensight/web` runs strict TypeScript checks (including
`noUncheckedIndexedAccess`), compiles the pure renderer for Node, then runs the
Node test runner. Tests cover supported option shapes, real archive field
mapping, all sales result bindings, null/empty/zero behavior, unsupported inputs,
immutable sorting, grid extraction, dependency-pin drift, and ECharts SVG
rendering with the actual modular registrations. Browser checks supplement
these tests; root tests retain the existing parser and DuckDB query regressions.

Verified on 2026-09-26 with Node 24.20.0 and npm 10.9.4:

- Root `npm test`: **315 passed, 0 failed, 0 skipped** — bundle-parser 134,
  query-engine 131, web 50. After replacing a deprecated ECharts grid option,
  the final `npm test --workspace @opensight/web` again passed all 50 tests,
  including strict application/test compilation and five SVG smoke checks.
- Root `npm run build`: all three workspaces succeeded. Vite reported one
  bundle-size warning: the ECharts vendor chunk is 584.14 kB minified / 199.58 kB
  gzip, above its 500 kB warning threshold. This is recorded, not suppressed.
- A supplemental headless Chromium check exercised the production artifacts:
  real dashboard/unavailable pie; five sales cards/four SVG charts; KPI 500;
  table values East/500/450; pie data Hardware/200 and Software/300; 390px mobile
  stacking/resizing without horizontal overflow; switching back to the real
  fixture. There were zero page/console errors and zero external requests.
  The browser environment blocks local-network URLs, so Playwright routed
  requests to the built files from disk. This was a local smoke check with
  environment-provided browser tooling, not a new project browser dependency.
- `git diff --check` passed; `SOLUTION_DESIGN.md` and source fixtures are unchanged.

No captured QuickSight screenshots, pixel comparisons, browser import of general
bundles, chart interactions, source access, or API conformance are claimed. New
semantic support needs reviewed dependencies and conformance tests before a
broader renderer can safely execute it.

## Sources

The local [API catalog](../../docs/research/api-surface.md),
[real fixture notes](../../fixtures/real-bundle-sample/README.md), and
[sales fixture notes](../../fixtures/renderable-sales/README.md) are the input
authorities. Presentation details were checked against primary documentation:

- [ECharts modular imports and registration](https://echarts.apache.org/handbook/en/basics/import/)
- [ECharts donut radii](https://echarts.apache.org/handbook/en/how-to/chart-types/pie/doughnut/)
- [AWS DonutOptions](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DonutOptions.html)
  and [ArcOptions](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_ArcOptions.html)
- [AWS BarChartConfiguration](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_BarChartConfiguration.html)
- [AWS KPIFieldWells](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_KPIFieldWells.html)
- [AWS GridLayoutElement](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_GridLayoutElement.html)
- [Vite 8 migration](https://vite.dev/guide/migration) and
  [Rolldown code splitting](https://rolldown.rs/reference/OutputOptions.codeSplitting)
