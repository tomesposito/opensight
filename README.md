# OpenSight

[![License](https://img.shields.io/badge/License-Apache_2.0-teal.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-4d7c0f.svg)](package.json)

An open-source BI platform aiming for full QuickSight capability parity and
bidirectional asset compatibility — connect data, prepare datasets, build
analyses and dashboards, and ask questions in natural language. Self-hosted;
no AWS required.

![OpenSight tour: dashboard, back to top, O answer, authoring, radar, Sankey, waterfall, insight, pivot, saved drafts, and data tools](docs/images/opensight-tour.gif)

*Above: the offline demo — a dashboard, O answering "revenue by region" and
adding the chart to an analysis, saved drafts, data preparation, connectors,
and administration.*

## Run it

Requires **Node 24+ and npm**, a local checkout, and free ports **3000** (API)
and **5173** (web). Run both terminals from the repository root, using the default
local configuration (no hosted environment settings or external database needed).

**Terminal 1 — install, build, and start the local API:**

```bash
npm ci
npm run build --workspace @opensight/api
npm start --workspace @opensight/api
```

Wait for `OpenSight API listening on http://127.0.0.1:3000` and leave it running.
The build is required on a fresh checkout; `npm start` does not build the API.

**Terminal 2 — start the web app:**

```bash
npm run dev --workspace @opensight/web
```

Open **[http://127.0.0.1:5173](http://127.0.0.1:5173)**. Leave both terminals
running; stop each with Ctrl+C when finished.

On first load, the app checks the API and opens **Local workspace** without
sign-in. **Home** shows a sales dashboard with pinned synthetic sample results
and a fixed East-region filter; it does not query your uploaded data. To build
with your own CSV:

1. Open **Data → Data sources → Upload a file**, choose your CSV (and delimiter
   if needed), then select **Upload to staging**.
2. Select **Prepare this upload** to open **Data preparation**. Review the
   columns and preview rows, make any transformations, then **Save pipeline**.
3. Select **Build a chart**, then choose a Data field in Author to create a bar visual. Use **Add visual** to choose another type first.
4. Select **Save draft**. Reopen it through **Analyses → My analyses** in the
   same browser and origin. Draft definitions stay on this device; they are
   not synced or published and do not preserve uploaded rows.

Uploads stay in local DuckDB memory, are limited to **8 MiB**, and expire after
**24 hours or an API restart**. See [local data](docs/local-data.md) for the
workflow and limits, and [local drafts](docs/local-drafts.md) for source recovery.
If the API is unavailable, the first-run screen offers recovery guidance; an API
without local-data support or authentication instead offers setup and explicit
**Explore sample data**. See the [first-run guide](docs/first-run.md).

The **static demo** is a separate, no-backend preview with public samples:
it cannot upload files or run live queries and is not a deployed server. The
[first-run guide](docs/first-run.md#local-demo-and-development-sign-in) explains
how to build and open it.

## Features

### 📊 Dashboards and analyses

Author on a QuickSight-style canvas: 23 visual types (bar, line, pie/donut,
KPI, table, pivot, radar, sankey, waterfall, insight, scatter, combo, maps and more), parameters and controls,
filter actions, drill-down, themes, and `.qs` bundle import/export round trips.

The app opens to a working sales dashboard using pinned synthetic sample results
(fixed East-region filter; no live query). Choose **Author** to build an analysis,
or **Developer fixture preview** to inspect exported definitions. All existing
modes remain available under their role permissions. See
[sample dashboard and preview semantics](docs/issue-28-gap-notes.md).

![Default sales dashboard rendered from pinned sample results](docs/images/sample-dashboard.png)

Long dashboards and the connector gallery show a keyboard-accessible
[Back to top button](docs/back-to-top.md) after 600px of page scrolling, with
an instant jump when reduced motion is preferred.

![Authoring canvas with assigned fields and the Ask a question trigger in the toolbar](docs/images/author.png)

Field wells stay visible before a visual is selected. Choose a Data field to
create a bar, then keep assigning fields or change its type.

![Empty Author canvas with ROWS, COLUMNS and VALUES field wells](docs/images/author-empty.png)

Radar uses Category axes, an optional Color split, and one or more Values
measures. Nulls remain gaps; unsupported native options appear in the import
report. See [radar semantics and limits](docs/radar-chart.md).

![Radar preview with revenue by month and region](docs/images/radar.png)

Sankey connects Source and Destination dimensions using one Weight measure.
Equal values share nodes and duplicate links are summed; unsupported graph
shapes and native options fail closed. See [Sankey semantics and limits](docs/sankey-diagram.md).

![Sankey preview with revenue flowing from region to category](docs/images/sankey.png)

Waterfall accumulates signed Values from zero in category order, with green
increases, red decreases and a blue final Total. Categories and Values each
accept one field; breakdowns and unsupported native options fail closed.
See [Waterfall semantics and limits](docs/waterfall-chart.md).

![Waterfall preview with synthetic positive and negative revenue adjustments](docs/images/waterfall.png)

Insight writes rule-based narratives from your aggregated data: totals, contributor
shares, ranked categories, date-period changes and optional measure comparisons.
Forecasts, anomalies and custom narrative templates fail with named errors.
See [Insight semantics and limits](docs/insight-visual.md).

![Insight narrative showing revenue totals and category contributors](docs/images/insight.png)

Pivot row groups expand and collapse with +/−, Enter or Space. Enabled subtotals
stay visible, and group state survives draft saves and bundle round trips.
Works in the offline demo. See [pivot row groups](docs/pivot-row-groups.md).
Tables and pivots keep the header row and first label column visible while
scrolling in dashboard and Author previews, including the offline demo.

![Pivot with the East row group collapsed and its subtotal visible](docs/images/pivot.png)

### 🛠️ Visual data preparation

Build your own datasets on a transformation pipeline canvas: select fields,
add calculated columns, change types, rename, filter — and combine sources
with join/append steps. Branch from an earlier step, choose the output, and
preview each path against a local or hosted API.

![Data preparation canvas with hosted preview requirements](docs/images/data-prep.png)

### ⚡ Blaze cached datasets

Cache prepared datasets in the self-hosted API with manual or scheduled refresh,
bounded memory, visible refresh times and explicit failures. Cross-source joins,
pivot, unpivot, append and aggregate on the output path require Blaze; simple
single-source pipelines can use direct query. The static demo keeps these hosted controls disabled.
See [Blaze configuration and limits](docs/blaze.md).

![Blaze refresh controls and cached output from a local hosted API using synthetic data](docs/images/blaze.png)

### 🔌 Data source connectors

Start with CSV/TSV/JSON/Excel file uploads into DuckDB staging, then prepare
your data and build a chart. **Show unavailable connectors** reveals the rest
of the 23-entry catalog with honest setup and implementation states. PostgreSQL
requires an operator-provisioned hosted source; MySQL has no product API path.
The static demo shows the file setup with uploads disabled.

![Local Data sources view featuring file upload with unavailable connectors hidden](docs/images/data-sources.png)

The local stack accepts files without hosted authentication. Upload a CSV,
prepare its columns, save the pipeline and select **Build a chart**. See
[local data](docs/local-data.md) for size limits and expiry.

![Live chart from a locally uploaded and prepared CSV](docs/images/local-data.png)

### 💬 Ask Q

A shared right-side panel opens from **Ask a question** in Home and Author.
The panel contains the interpreted question, chart preview and alternatives;
Author also offers **ADD TO ANALYSIS**. Escape or Close returns focus to the
trigger. A local deterministic
interpreter queries the active dataset in the local workspace, including prepared
CSV uploads. The static demo answers using synthetic rows. Administrators can
configure a real AI provider
(OpenAI, Anthropic, Bedrock, or a custom endpoint) for generative answers,
gated by role.

![ASK Q side panel in Author with a synthetic sales preview and ADD TO ANALYSIS](docs/images/q-side-panel.png)

![O answer querying a locally uploaded CSV: North 6 and South 3](docs/images/o-answer.png)

### 👥 Built for teams

Five roles (administrator, author, author_ai, reader, reader_ai), single-use
invitations, row/column security with namespaces, folders, asset sharing, an
embedding SDK with signed URLs, scheduled refreshes, and dashboard reports.

### 🖼️ Embed appearance preview

Tenant administrators can configure exact parent origins, bounded lifetimes and
safe appearance tokens within operator policy. An offline preview covers loading,
empty, permission-error and expiry states with sample branding. Hosted sessions
now support registered dashboard/visual/Q/authoring experiences and anonymous
tag-scoped embeds, with single-use bootstrap URLs and a cookie-free SDK. Custom
domains remain separate, and the signed-URL SDK keeps its v1 behavior. See
[embedding configuration](docs/embedding-config.md) and
[session contracts and limits](docs/embed-sessions.md).

![Registered hosted embed using synthetic viewer-filtered data](docs/images/embed-session.png)

The separate [offline appearance preview](docs/images/embed-preview.png) shows
loading, empty, permission-error and expiry states.

### Tenant schedules and delivery

Hosted refresh, report and alert jobs have durable occurrence and delivery
histories. Reports render with each recipient's current data permissions.
Removing an owner requires the operator to transfer or stop their schedules;
unfinished work is cancelled. One scheduler runs initially, with at-least-once
delivery and dedupe keys. See [tenant automation](docs/tenant-automation.md).

![Tenant job and delivery history with synthetic recipients](docs/images/tenant-jobs.png)

![Operator transfer-or-stop choice using synthetic users](docs/images/job-owner-removal.png)

## Contributor quickstart

For development and verification, use Node 24+ and npm. From the repository root:

```bash
npm ci
npm run build
npm test
```

To use the app, follow [Run it](#run-it) above. An API without local-data support
or authentication shows this first-run setup screen; it is not the default local
workspace:

![OpenSight first run with authentication setup and a public sample demo](docs/images/first-run.png)

Parse a real QuickSight export. npm runs this script inside
`packages/bundle-parser`, so the input path is relative to that workspace:

```bash
npm run summarize --workspace @opensight/bundle-parser -- ../../fixtures/real-bundle-sample/TotalDeathByCountry.sanitized.qs
```

The expected [archive summary](fixtures/real-bundle-sample/summary.json) is checked
by tests, alongside the synthetic sample's
[CLI output](fixtures/sample-sales-analysis.summary.txt) and
[JSON summary](fixtures/sample-sales-analysis.summary.json).
The suite includes malformed-input regressions, public-entry
typechecking, local SQL data-oracle checks, generated DuckDB query/result
comparisons, and fail-closed execution checks for unsupported features and
protected/unresolved datasets.

After building, workspace consumers can import the public API:

```ts
import { loadQsBundle, summarizeQsBundle } from '@opensight/bundle-parser';
const inventory = summarizeQsBundle(await loadQsBundle('fixtures/real-bundle-sample/TotalDeathByCountry.sanitized.qs'));
```

`loadBundle` remains a historical alias for `loadSyntheticAnalysis`. Validation
errors include JSON paths and, for archive members, their ZIP path. Unknown
properties are retained; inventory success does not imply full schema validity
or execution support. Synthetic summary titles retain their `plain`/`rich`
format; rich markup is raw text and must not be inserted directly into HTML.

## Layout

```
packages/bundle-parser  Observed .qs archive import + synthetic JSON inventory
packages/api            Local definition and dataset-query API
packages/web            React renderer + authoring and bundle round trips
packages/query-engine   Typed synthetic planner + local DuckDB CSV executor
packages/cli            Archive import/export/validate (planned)
docs/research           Observed format and API contract research
fixtures                Sanitized real export + synthetic regression specifications
conformance             Controls-to-query integration; source fidelity planned
```

## Documentation

**Start here:** [SOLUTION_DESIGN.md](SOLUTION_DESIGN.md) records the vision,
architecture, decisions and phased plan. Feature guides live in
[docs/](docs/): [bundle round trips](docs/bundle-roundtrip.md),
[interactive controls](docs/parameters-controls.md),
[visuals and themes](docs/phase2d-visuals-themes.md),
[scheduled refresh, reports and alerts](docs/scheduled-refresh-reports-alerts.md),
[tenant job ownership and delivery](docs/tenant-automation.md),
[security and namespaces](docs/security-namespaces.md),
[folders, sharing and embedding](docs/folders-sharing-embedding.md),
[tenant embed configuration and appearance](docs/embedding-config.md),
[hosted embed sessions](docs/embed-sessions.md),
[data preparation](docs/data-prep.md), and the
[connector gallery](docs/connector-gallery.md). The hosted metadata foundation and
offline migration runbook are in [H1 tenant metadata](docs/h1-tenant-metadata.md);
hosted HTTP/session composition follows in H2.

## Contributing

Spec-first: propose the change against `SOLUTION_DESIGN.md`, build it on a
branch with checkpoint commits, verify the full suite (`npm test`), and keep
the README visuals fresh — every user-facing change refreshes the tour GIF
and screenshots above (see `AGENTS.md` §4).

## License

[Apache 2.0](LICENSE). Dependencies are MIT/Apache-2.0 only.
