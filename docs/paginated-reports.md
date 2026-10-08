# Paginated reports — Phase 4, slice 1

This foundation provides a report document model, deterministic page layout,
real PDF export and an offline preview. It is not a QuickSight report import
format, a live dataset query feature or a hosted report repository.

## Resources and configuration

`@opensight/reports` exports `ReportDefinition`, `reportSchema` (JSON Schema
draft-07), `validateDefinition`, `layoutReport(definition, rowsByBand)` and
`renderPdf(definition, pages)`. The schema validator rejects unknown properties,
invalid values and unsupported bands without coercion or defaults. Validation
also checks unique band IDs, column bindings, calendar dates and page geometry.

The library has no environment configuration, filesystem or network access.
The caller supplies an explicit `date` (`YYYY-MM-DD`); identical definitions and
rows produce identical pages and PDF bytes. PDF metadata uses a fixed UTC epoch;
the report date is displayed in page content. Geometry is in millimetres, font
sizes in points. Page sizes are A4 (210 × 297), Letter (215.9 × 279.4) and Legal
(215.9 × 355.6), with portrait/landscape orientation and four nonnegative margins.

```ts
import { layoutReport, renderPdf, validateDefinition } from '@opensight/reports';

validateDefinition(definition); // input may be unknown JSON
const pages = layoutReport(definition, {
  orders: [{ region: 'North', amount: 25 }], // synthetic example; band ID key
});
const pdf: Uint8Array = renderPdf(definition, pages);
```

The complete synthetic example is `sampleReport()` in
`packages/web/src/report-drafts.ts`. Tests use only synthetic rows.

### Stateless API

`POST /api/reports/:id/pdf` (also `/reports/:id/pdf`) accepts
`Content-Type: application/json` with exactly `{ definition, rowsByBand }`.
The path ID must equal the definition ID. It labels this submitted document;
it does **not** identify a stored server resource. The response is a real
`application/pdf` attachment with `Cache-Control: no-store`.

The existing 1 MiB request limit applies. Query parameters and methods other
than POST are rejected. Report validation/layout failures return HTTP 422 with
`errorCode`, `message` and `path`; malformed HTTP/JSON requests retain the API's
existing 400/405/413 responses. Both API compositions support this route.
Authenticated compositions require build capability, reject forged identity
headers and scope namespace paths normally. The hosted composition rechecks
authentication and current role after reading the body. No server dataset is
accessed, so submitted dataset identifiers grant no data access authority.

### Local drafts and preview

The Reports section is available to authors (including the offline sample
persona). It lists, opens, updates and deletes definitions in browser storage,
separated by demo/local/hosted mode and hosted namespace/user. It supports a
new synthetic sample, definition JSON import/export, title/date/page setup
changes, Save draft, page navigation (`1 of N`) and Export PDF. Export runs the
same library in the browser, including in the single-file static demo.

Only definitions are saved; table rows are never stored by this draft store.
The limit is 20 reports and 1,048,576 UTF-16 characters (approximately 2 MiB).
Corrupt storage and quota failures surface as errors without overwriting corrupt
data or claiming a save succeeded. There is no autosave or cross-tab merge for
report definitions; Save draft is explicit. Export JSON preserves open work
when storage is unavailable.

The preview binds only the explicit `sample-report-sales` dataset to 72 bundled
synthetic rows and labels this **sample data**. Imported text-only documents
work without a data binding. Other table datasets show `REPORT_ROWS_UNAVAILABLE`
and hide PDF export until the caller uses the API/library with supplied rows.
No hosted API is needed for sample/text preview or PDF export. The rebuilt
static demo is a local artifact, not a deployed server.

## Document and layout semantics

- `version: 1`, `id`, `title`, `date`, `pageSetup`, `header`, `footer` and
  nonempty `body` are required. IDs use ASCII letters, digits, `_` and `-`.
- Header/footer `runs` contain `{ text, style? }` or `{ field, style? }`.
  Fields are `pageNumber`, `totalPages`, `date`, `reportTitle`, corresponding
  to the brief's `{pageNumber}` etc. These are structured placeholders,
  not interpolation inside arbitrary strings. Empty runs omit a repeating band.
- Text bands have `kind: 'text'`, unique `id`, styled `runs` and optional
  `headingLevel` 1–3 (default bold 20/16/13 pt). Body text defaults to 10 pt.
  Style supports 8–32 pt, bold, italic and a six-digit hex color.
- Table bands have `kind: 'table'`, `id`, `datasetId`, ordered `columns`, optional
  `style` and optional `summary`. Each column has a `label`, a query-engine
  `ColumnType` and `field: { dataSetIdentifier, columnName }` taken from the
  engine's column expression reference. Each reference must match `datasetId`.
  Columns have equal widths and appear in definition order.
- `rowsByBand` uses table **band IDs**, allowing multiple bands bound to one
  dataset. Every table requires an explicit array; missing rows fail closed.
  Values reuse query-engine `ResultRow`/`ResultValue` (string, finite number,
  null); missing columns and declared-type mismatches fail. Extra result columns
  are not rendered. Null displays as an empty cell. No sorting, query execution,
  aggregation, formatting expressions or security policy evaluation happens here.
- Summary values are caller-supplied in column order, rendered once after the
  table. They are not computed totals. A summary moving to another page also
  gets a repeated column header. A table with `[]` renders an explicit **no data**
  row, including when a summary is present.
- Header/footer bands appear on every page. Pagination reserves their space and
  the width of four-digit page placeholders before computing the final count.
  Text flows line by line. Rows do not split across pages, and a table header is
  kept with its next row. The last exactly fitting row does not add a blank page.
- Drawing items are shared by the SVG preview and PDF. PDF text remains
  extractable; the document is not a screenshot. The renderer accepts only
  bounded text/rectangle items and fixed built-in fonts, never HTML, images,
  actions, links or uploaded fonts.

### Named errors and limits

| Code | Meaning |
| --- | --- |
| `REPORT_INVALID_DEFINITION` | Schema, calendar date, binding or margin error |
| `REPORT_UNSUPPORTED_BAND` | A body band other than text/table |
| `REPORT_INVALID_ROWS` | Missing band rows/column, invalid value or type mismatch |
| `REPORT_ROW_OVERFLOW` | A row or summary plus its repeated header cannot fit on an otherwise empty usable page |
| `REPORT_PAGE_OVERFLOW` | Header/footer consumes the body, a line cannot fit, or a column is too narrow |
| `REPORT_UNSUPPORTED_TEXT` | Text cannot be represented by the slice's built-in font |
| `REPORT_LIMIT_EXCEEDED` | Row, text, page or drawing-item limit exceeded |
| `REPORT_INVALID_LAYOUT` | PDF renderer received an invalid display list |

Limits: 100 body bands, 100 runs per band, 20 columns per table, 10,000 supplied
rows across the document, 2 million definition characters, 2 million displayed
row characters, 1,000 pages and
250,000 PDF drawing items. Request and browser storage bounds apply separately.

## Deliberate limits and queued follow-ups

Text measurement is **approximate**: character wrapping uses 0.6 × font size,
with 1.2 line height, two-millimetre cell padding and four-millimetre band gaps.
It may break words; it does not perform shaping, hyphenation or widow/orphan
control. PDF uses standard Courier; browser preview uses its local monospace
fallback. Slice 1 supports printable Latin-1 and line feeds. Other glyphs fail
with a named error instead of producing corrupt text. Unicode fonts, typography
and accessibility tagging require later work. **Visual fidelity is not measured**;
this is not pixel-perfect QuickSight parity.

Queued follow-ups remain visual/chart snapshots, scheduled distribution/email,
embedding, sub-report linking and further fidelity work. They are not controls
or simulated services in this slice. Live query execution is a future integration
seam: an authorized caller must fetch and authorize rows before handing them to
layout. Future server persistence/distribution needs its own resource and access
contract. This implementation makes no product decisions about those slices.

## Dependencies and checks

[ITD D-18](itd/D-18-report-pdf-rendering.md) records the renderer choice.
Installed package metadata was checked before adding dependencies:
`@exodus/schemasafe` 1.3.0 is MIT with no dependencies; `jspdf` 2.5.2 is MIT.
Its required dependencies are `@babel/runtime` (MIT), `fflate` (MIT), and
`atob`/`btoa` (MIT OR Apache-2.0). Optional packages in the lockfile have an MIT
or Apache-2.0 option; DOMPurify uses its Apache-2.0 option. License notices are
retained by the demo bundler. No new server infrastructure is required.

Run `TZ=UTC npm test` from the repo root. PDF extraction tests require local
Poppler (`pdftotext`), used only as an independent reader, never bundled/shipped.
Rebuild with `npm run build:demo --workspace @opensight/web`, then run
`node packages/web/scripts/capture-reports.mjs` with the local screenshot tools
and Chromium available. `dist` and temporary PDFs stay untracked.

## Verification and media findings (2026-10-08)

The final root `TZ=UTC npm test` run with the provided local Postgres connection
in `DATABASE_URL` exited **0**: **1,920 passed / 0 failed / 0 skipped**. Counts
by package: API 317, bundle-parser 199, embedding-sdk 9, O-interpreter 32, parity
11, query-engine 515, reports 18, web 813, root conformance 6. All live Postgres
integration tests ran. Strict TypeScript compilation passed as part of this run.

Focused report/library/API tests: **22 passed / 0 failed / 0 skipped**, including
the real hosted session/origin boundary and explicit auth/role/namespace bypass
attempts. Web report/navigation checks passed, and the command-palette regressions
were updated for the new Reports destination. PDF metadata was also tested under
`America/Los_Angeles` to prove it does not inherit the caller's timezone.

Poppler extracted a four-page synthetic library export: every page had the report
header, Region/Amount column headers and its correct `Page n of 4` footer. All 90
rows and escaped parentheses/backslash text survived. A separate browser download
was 74,606 bytes, three A4 pages, with repeated Order/Region/Product/Amount headers,
`Page 1 of 3` through `Page 3 of 3`, all 72 sample rows and the supplied 8,100 total.
`pdfinfo` found no PDF JavaScript or forms.

Final local Chromium capture exercised page navigation, final-page disabled
navigation, Save draft/reload/open and a real PDF download: **0 page errors /
0 external requests**. The Reports layout had no horizontal document overflow
at widths 1440, 760 and 390. The static demo and embed artifacts were rebuilt;
no `dist` output is committed.

The preview was visually compared with the available QuickSight analysis-editor
reference: compact Arial controls dock on the left, navy preview toolbar and a
dominant white document canvas. The reference is an analysis editor, not a
paginated-report editor; no report parity score can be inferred. The new report
preview exposes approximate text measurement and sample provenance, and retains
the global “visual fidelity not measured” footer. No new user-visible regression
was found in the captured flows; no GitHub/network action was taken in this build.

README media now includes Reports and refreshed Home, Author, empty Author,
auto-save, command palette, keyboard shortcuts, URL actions, toasts, radar,
Sankey, waterfall, insight, pivot, Q side panel, data sources, data preparation
and local-data chart captures. The requested
`~/workspace/tools/screenshots/readme-gif-44.mjs` was copied to a temporary file,
its stale demo URL redirected to the freshly built local demo, and a Reports
segment appended. Capture succeeded (27 frames, 0 page errors, 0 external
requests); ffmpeg assembled a 960px-wide GIF at 2 fps for readable playback.
The temporary script, frames, PDFs and private reference images remain untracked.
The older local-data capture also needed its Add visual selector disambiguated
and the current explicit team/value field assignment. The temporary adaptation
completed with 0 page errors and 0 external requests; product code was unchanged.

The first full run exposed an existing watchdog `/proc` disappearance race
(`ESRCH`); the targeted rerun passed. It also found three old command-palette
expectations for the pre-Reports navigation list; those were corrected and their
suite passed. The final full run uses `TZ=UTC` and the provided local Postgres
connection through `DATABASE_URL`, so the live integration suites run too.
