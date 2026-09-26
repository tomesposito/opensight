# Web explorer and Builder v0

React 19 / ECharts 6 / Vite 8 provide fixture and API definition exploration,
plus the Phase 1b **Author** mode. D2, D4, §3.2 and Phase 1b of
`SOLUTION_DESIGN.md` guide these slices; that spec is unchanged. This is a local
definition explorer and authoring preview, not a general QuickSight runtime or
a fidelity claim.

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

### Local API workflow

Use two terminals from the repository root after `npm install`:

```sh
# Terminal 1: default fixture root, http://127.0.0.1:3000
npm run build --workspace=@opensight/api
PORT=3000 npm start --workspace=@opensight/api

# Terminal 2: Vite (normally http://127.0.0.1:5173)
VITE_OPENSIGHT_API_URL=/api npm run dev --workspace=@opensight/web
```

`VITE_OPENSIGHT_API_URL` is the API route prefix; `/api` is also the default when
unset or blank. Vite proxies `/api/*` to `http://127.0.0.1:3000/*`, removing the
prefix. This keeps browser requests on the web origin because the local API does
not provide CORS headers. The value can instead be a same-origin path or an
absolute URL (including an existing path prefix); a cross-origin server must
provide CORS itself. Setting it directly to `http://127.0.0.1:3000` with the
current API bypasses the proxy and will be blocked by browser CORS. Vite env
values are public, read at dev startup/build time; restart/rebuild to change them.
Production API mode needs an equivalent reverse proxy or a CORS-enabled server;
the dev proxy is not bundled into the static build or Vite preview.

The **Mode** selector starts at `fixtures` on every page load. This mode
uses only generated assets and makes no definition requests, keeping the static
demo usable offline. Choose `api` to load the selected example live, or enter an
analysis/dashboard resource ID and choose **Load definition**. The bundled
examples target `analyses/renderable-sales/definition` and
`dashboards/e0772d4e-bd69-444e-a421-cb3f165dbad8/definition`. The real analysis is
also available as `2f99f271-1f84-4a57-9843-31646734d5c9` (select Analysis).
There is no list API; the example picker is local, not resource discovery.

Loading and failures are shown explicitly. Use Load definition to retry; errors
never switch to fixture definitions. Switching mode/example or issuing another
request aborts the previous fetch and ignores any late completion. The client
checks HTTP errors, JSON/envelope validity, matching resource ID and nonempty
definition `Errors`. It reads the full `Definition` actions, never metadata
actions or a synthetic `ResourceType` wrapper.

### API definitions versus chart data

**Only definitions are live. The query engine is not behind HTTP.** API mode
does not fetch data, execute SQL, aggregate CSV, evaluate filters/calculations,
connect to sources, or establish source permissions. All visible numbers still
come from the pinned, precomputed fixture results.

Rows and aliases are reused only when resource kind + ID and the **entire
converted definition** match the reviewed fixture definition (JSON object key
order ignored; array order and absent fields retained). Matching just a visual
ID would attach stale totals after a filter or calculation change. Any definition
difference, including a presentation-only edit, conservatively makes every
chart's data unavailable. Unknown resources also preview definitions with no
rows. The real archive has no rows in either mode. Response names/request IDs do
not affect this match; definition defaults/options and opaque extensions do.
The comparison authorizes displaying local fixture oracles only; it says nothing
about current remote dataset/source security or whether live queries are safe.

### API-to-bundle conversion

`src/definition-converter.ts` explicitly maps known PascalCase members into
`BundleDefinition`, `BundleSheet`, `BundleVisual` and the parser's existing
generic `BundleVisualBody` extension properties. It introduces no new canonical
archive types. Bar/KPI/line/table projections are provisional renderer adapters,
not evidence of those shapes in a real `.qs` export. The converter checks the
definition/dataset/sheet/visual envelopes; the compiler validates rendered wells,
fields and configuration. This is not a complete QuickSight schema validator.

| Context | Converted members |
| --- | --- |
| Definition | Dataset declarations (`Identifier`, `DataSetArn`), sheets and the known context containers below |
| Sheets/layout | Sheet ID/name/content type, visuals, layouts/configuration/grid, element ID/type and row/column indices/spans; screen canvas resize/viewport options |
| Visuals | `PieChartVisual`, `BarChartVisual`, `KPIVisual` → `kpiVisual`, `LineChartVisual`, `TableVisual`; IDs, title/subtitle visibility, plain/rich format text and chart configuration |
| Field wells | Pie/bar/line/table aggregated wrappers; category, group-by, values; colors/small multiples/target values/trend groups retained for compiler rejection when nonempty; KPI wells remain directly under `fieldWells` |
| Fields | Categorical/date/numerical dimension fields, numerical measures; field IDs, dataset/column references, date granularity and simple numerical aggregation enum (renderer still requires `SUM`) |
| Appearance/sort | Bar orientation/arrangement; donut arc thickness; data-label visibility/overlap; legend visibility; tooltip visibility/type/field-based options/field items; category field sort ID/direction and `OtherCategories` limit options |
| Definition context | Analysis defaults/new-sheet layout/content type, week start/excluded dataset ARNs, `QBusinessInsightsStatus` → `qbusinessInsightsStatus`, custom-action defaults with the API's lowercase `highlightOperation` and `Trigger`, query execution mode |
| Opaque containers | Calculated fields, parameter declarations, filter groups, actions and column hierarchies get camelCase container names; their items remain unchanged |

Mappings preserve values, order, optional absence and unknown properties. Unknown
subtrees/dictionary keys are never recursively recased, and source/destination
key collisions throw a located error. Unknown visual variants retain their key
and body and expose `visualId` for card identity; the compiler shows an unsupported
visual diagnostic. Unknown visual configuration/field features are retained so
compiler rejection cannot be bypassed by dropping them. Unsupported root/sheet
context is preserved without execution; a differing definition cannot reuse rows.

Rendering fallbacks remain explicit: rich titles use plain text or a generated
field title, subtitles are omitted with a note, detailed tooltips are approximated,
donut radii are approximate and non-limiting `OtherCategories: INCLUDE` shows all
supplied rows. Top-N, other aggregations, calculations inside wells, nonempty
actions/drill hierarchies and unsupported wells still fail. No API feature is
executed just because it converts. Missing/unsupported/invalid layouts use
full-width cards in definition order with a notice; valid grids use the existing
36-column renderer. Duplicate sheet/visual IDs reject the preview.

## Author mode (Phase 1b — Builder v0)

Choose **Author** in the Mode selector. Choose a visual type and **Add visual**;
the new card starts with revenue and a suitable dimension so it previews
immediately. **Configure** selects a card and exposes its title, chart type and
field wells. The Fields panel separates the four dimensions (`order_id`,
`order_date`, `region`, `category`) from the two measures (`revenue`, `profit`)
and shows the dataset's INTEGER / DATETIME / STRING / DECIMAL type badges.

Click a field in the panel or use a well's picker to assign it to the selected
card. Dimensions replace the existing dimension; bar, line and table accept both
measures in assignment order. Pie and KPI keep one measure, replacing the prior
one. Click an assigned field's × to remove it. All values use explicit SUM;
dates use MONTH granularity. Pie has a Donut checkbox.

| Visual | Wells |
| --- | --- |
| Bar | Category + Values |
| Line | X-axis + Values |
| Pie / donut | Category + Values |
| KPI | Values |
| Table | Group-by + Values |

Changing type keeps compatible assignments, reduces pie/KPI to the first
measure, and removes the dimension for KPI. Switching from KPI to a grouped
visual requires assigning a dimension again. **Remove** deletes a card; the
up/down buttons change canvas and export order. Cards stack on all screen
sizes, with the Fields panel above the canvas on mobile and beside it on larger
screens. Local well pickers avoid scrolling back to the panel on mobile. All
controls work with clicks or a keyboard; no drag-and-drop is required.

`src/authoring.ts` holds the pure immutable reducer and serialization;
`src/author-preview.ts` binds only the reviewed fixture results. Explorer and
Author share `src/VisualCard.tsx`, including the existing `compileVisual` call,
SVG charts, semantic HTML tables, View data, ready / Data unavailable / No
results / error states. Removing a required field shows the compiler error
until the well is repaired. A valid definition with no matching sample results
shows Data unavailable and can still be exported.

### Author data boundary

Author makes **no API requests or live data queries**. Previews use the same
pinned precomputed sales oracles as the explorer; the query engine is not behind
HTTP. No client-side aggregation, CSV loading, calculation, joining or filtering
is performed. The UI always discloses the fixed **region = East** subset and
UTC month grouping already present in those rows.

Only revenue by region, category or month, and overall revenue for KPI, have
reviewed results. Those grains may be presented in any compatible visual type.
`order_date` binds explicitly to the oracle's `month` column. Profit, order IDs
and multiple-measure configurations have no matching oracle: every value in
that preview is unavailable, rather than showing a partial or unrelated total.
The explorer's discounted-revenue calculation is not offered as profit. Fixture
generation still checks the complete dependency/security pins before either
mode can use these results. This author-only mapping never relaxes API mode's
whole-definition matching rule.

### Drafts and Export JSON

Edits, order and selected card automatically persist under localStorage key
`opensight.author.v0`. Re-entering Author or reloading and choosing Author
restores them, including unfinished wells. Draft loading validates the version,
IDs, field roles, cardinalities and selection. Invalid/unknown-version drafts
show a warning and remain untouched until the next edit. Storage access/quota
failures show a warning and leave the current in-memory canvas usable. Drafts
are local to the browser origin/device; they are not a server save or a backup.

**Export JSON** downloads `opensight-visuals.json`, an ordered JSON array of
camelCase `BundleVisual` objects. Each array element is the exact `definition`
input to `compileVisual({ source: 'bundle', definition, rows, bindings, path })`.
Export requires at least one card and complete wells in every card. It does not
require available preview rows. Serializer fields and return values are checked
against `@opensight/bundle-parser` types; the compiler's runtime normalization
validates every exported visual. Tests additionally pass serialized definitions
through the parser in a test analysis envelope. The parser deliberately leaves
unobserved bar/line/KPI/table configuration as opaque extensions, so compiler
checks enforce those provisional renderer projections. No Node parser runtime
is imported into the browser.

The download contains visual definitions only, referencing `sales_data`. It has
no result rows, aliases, draft metadata, dataset declarations, filter context,
sheet wrapper or ZIP archive. In particular, the fixed East preview filter is
**not** exported: these are visual definitions, not a reproduction of the sample
analysis's query context. A consumer supplies its own dataset context and
authorized preaggregated results. General bundle import/reimport is not claimed.

Drag-drop, filters, parameters, calculated fields, themes, grid layout,
multi-sheet authoring, undo/redo and server-side saving remain outside v0.

### Single-file demo

```sh
npm run build:demo --workspace @opensight/web
```

This rebuilds fixtures, runs strict TypeScript and emits
`packages/web/dist/opensight-demo.html` with inline JavaScript and CSS. Open it
directly for offline fixtures and Author, including charts and JSON downloads;
there are no external asset requests. File-URL localStorage behavior depends on
the browser; use the dev/preview server for a stable origin. API mode still needs
the separately served API and proxy described above. The normal split Vite
build remains available with `npm run build`. Generated demo/build files are
ignored rather than committed.

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
  connection, query execution and archive export are outside this slice. Author
  exports only the visual definitions described above.

## Compiler scope and choices

`compileVisual` returns a normalized model, ECharts option, ordered table cells,
and `ready` / `empty` / `unavailable` state. It accepts already authorized and
aggregated rows. `CompileError` includes the source member/JSON property path.
Unsupported semantics fail instead of silently dropping a field well or visual.

The two input dialects are selected explicitly. The observed camelCase pie and
the converter's camelCase bar/KPI/line/table projections share the same compiler
checks as the PascalCase fixture inputs. These projections use the documentation
catalog and synthetic fixture and do not expand the parser's observed archive
schema. Parser inventory success grants no execution permission.

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

Original renderer validation on 2026-09-26 with Node 24.20.0 and npm 10.9.4
(before API integration):

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

### API integration validation (2026-09-26)

Node 24.20.0 / npm 10.9.4; final root `npm test` exited 0, including strict
application/package builds and public TypeScript consumer checks:

| Workspace | Tests | Passed | Failed | Skipped / cancelled / todo |
| --- | ---: | ---: | ---: | ---: |
| API | 18 | 18 | 0 | 0 / 0 / 0 |
| Bundle parser | 134 | 134 | 0 | 0 / 0 / 0 |
| Query engine | 131 | 131 | 0 | 0 / 0 / 0 |
| Web | 86 | 86 | 0 | 0 / 0 / 0 |
| Total | 369 | 369 | 0 | 0 / 0 / 0 |

The 36 added web tests cover the checked-in PascalCase sales fixture against
`test/fixtures/sales.bundle.json` (a provisional expected projection), the real
API response against its original archive definition, all five converted visual
outputs, casing exceptions, immutable inputs, collisions, unsupported/malformed
shapes, mocked-fetch success/error/abort paths, and fixture-result/layout gates.
Root `npm test` already discovers these through the workspace test script and
`test/*.test.mjs`; no additional root script is needed.

Root `npm run build` passed all four workspaces. A final web rebuild also passed
strict TypeScript after adjusting HTML resource-ID validation. The existing
ECharts size warning remains: 584.14 kB minified / 199.58 kB gzip.

A supplemental Chromium smoke check passed using the final production assets:
default fixtures and fixture switching made no API requests; live sales rendered
five cards/four SVG charts/KPI 500; the live dashboard retained unavailable data;
a 404 cleared old charts; switching back to fixtures recovered; and 390px mobile
API mode had no horizontal overflow. There were zero page exceptions or external
requests. The browser environment blocks direct loopback navigation, so requests
were intercepted: assets came from disk and definition requests were forwarded
through the actual Vite proxy to a temporary local API. Temporary ports avoided
an existing listener on 3000. This is a supplemental smoke check, not a checked-in
browser-test dependency or source-fidelity claim.

The first sandboxed root test run had 355 passes and 14 API failures, all from
`listen EPERM` on loopback; the successful full run above used loopback access.
`git diff --check` passed. No AWS calls were made, and `SOLUTION_DESIGN.md` and
the source fixtures remain unchanged.

### Builder v0 validation (2026-09-26)

Node 24.20.0 / npm 10.9.4. Final root `npm test` exited 0, including strict
TypeScript application/test builds and the existing public consumer checks:

| Workspace | Tests | Passed | Failed | Skipped / cancelled / todo |
| --- | ---: | ---: | ---: | ---: |
| API | 18 | 18 | 0 | 0 / 0 / 0 |
| Bundle parser | 134 | 134 | 0 | 0 / 0 / 0 |
| Query engine | 131 | 131 | 0 | 0 / 0 / 0 |
| Web | 131 | 131 | 0 | 0 / 0 / 0 |
| Total | 414 | 414 | 0 | 0 / 0 / 0 |

The 45 new web tests cover field/type metadata, well assignment/removal,
type transitions, selected-card edits, reordering/removal, exact camelCase
serialization, parser acceptance and compiler/SVG round-trips, reviewed preview
grains, unavailable combinations, storage restore/validation/failures, and React
server-rendered canvas/preview states. Root `npm test` discovers both new test
files through the existing workspace and `test/*.test.mjs` scripts; no root
script change or browser dependency is needed. A standalone web run also passed
all 131 tests. The first sandboxed root run passed 400 and failed 14 API tests
with `listen EPERM`; the successful final run above used loopback access.

Root `npm run build` passed all four workspaces. The existing ECharts chunk
warning remains: 584.14 kB minified / 199.58 kB gzip. `npm run build:demo
--workspace @opensight/web` also passed and produced the 867,086-byte single-file
demo with Author included.

A supplemental Chromium 152.0.7977.82 check opened that demo directly from disk
and exercised all five types, SVG/table previews, field assignment/removal,
unavailable/error states, incomplete-export blocking, titles, reordering, donut,
downloaded JSON content, draft restore after reload, card removal and switching
between Author and fixtures. At 390px, well pickers worked and neither mode had
horizontal overflow. The browser reported zero page/console errors and zero
external requests. This used environment-provided Playwright/Chromium with local
socket access, not a new project dependency. The mobile screenshot was also
reviewed. `git diff --check` passed; no AWS calls were made, and
`SOLUTION_DESIGN.md` and source fixtures remain unchanged.

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
