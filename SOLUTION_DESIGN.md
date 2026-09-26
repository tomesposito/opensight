# OpenSight — Solution Design

> **Living document.** This is the project's source of truth for vision, architecture, and
> technical decisions. It changes as we learn. Every significant decision is recorded here
> with its options and reasoning, so nobody has to hold the whole design in memory.
>
> - **Status:** Draft — Phase 0 (research)
> - **Last updated:** 2026-09-26
> - **Name:** OpenSight *(decided 2026-09-26 — see OQ-1)*

## Changelog

| Date       | Change |
|------------|--------|
| 2026-09-26 | Query-engine slice: D10 records the local DuckDB architecture, typed planning stages, explicit synthetic security binding and deferred semantic gates. |
| 2026-09-26 | Review fixes: provisional format boundary, recursive inventory validation, public package entry, regression tests/CI, query/render fixture and explicit Phase 1 compatibility/execution gates. Real-export archive work remains blocked. |
| 2026-09-26 | Initial draft: vision, compatibility contract, architecture, decisions D1–D9, phased plan. Repo scaffold + bundle-parser spike started. |
| 2026-09-26 | bundle-parser spike builds clean (tsc strict) and summarizes the sample fixture; committed locally as `3655cc3`, ready to push once GitHub is connected. |
| 2026-09-26 | Published as public repo `tomesposito/opensight`. Added Phase 0 export runbook (capture a real `QUICKSIGHT_JSON` bundle via AWS CLI) and public-repo hygiene rule: placeholders only, redact any real export before keeping it as a fixture. |

---

## 1. Vision & Purpose

Build a **completely open-source business-intelligence platform** that matches Amazon
QuickSight's full capabilities and is **bidirectionally compatible** with it: any asset
that exists in QuickSight (data source, dataset, analysis, dashboard, theme, folder) can
be exported from QuickSight and imported here, and vice versa.

### Why this matters

- Existing open-source BI tools (Superset, Metabase, Lightdash, Grafana) are good products,
  but none of them speak QuickSight's language. Migrating off QuickSight today means
  rebuilding every dashboard by hand.
- If OpenSight natively reads and writes QuickSight's **asset bundle format**, migration
  becomes a one-click import. That compatibility is the project's moat — not a feature,
  the strategy.
- "Full capabilities" is proven, not claimed: a conformance suite round-trips real
  QuickSight bundles and diffs rendered output.

### Design principles

1. **Compatibility first.** The observed QuickSight bundle format will be the canonical
   interchange model. Preserve it across separate API and execution representations.
2. **Vertical slices over horizontal layers.** Every phase delivers something a user can
   see: import a bundle → query data → render a dashboard.
3. **Boring technology where possible.** Postgres for metadata, DuckDB for queries,
   React for UI. Novelty budget is spent on the expression engine and the conformance
   suite, nowhere else.
4. **Spec-driven development.** Significant work starts as a section in this doc
   (or a linked ADR), not as code.

---

## 2. Goals / Non-Goals

### Goals

- Import QuickSight asset bundles (analyses, dashboards, datasets, data sources, themes)
  and render them faithfully.
- Export assets back out in QuickSight's bundle format.
- A query engine fast enough to replace SPICE for typical dashboard workloads.
- QuickSight's calculated-field function surface (aggregations, date math, period-over-period,
  string/conditional functions).
- Filters, parameters, controls, and interactivity (cross-filtering, drill-down).
- Row-level and column-level security.
- Embedding (SDK + iframe), scheduled email reports, threshold alerts.
- A QuickSight-compatible API surface (subset, growing over time) so existing tooling works.

### Non-goals (for now)

- QuickSight Q natural-language querying — revisit after dashboards are solid (Phase 4+).
- Paginated/pixel-perfect reports — Phase 4 candidate, not Phase 1.
- Multi-region / multi-tenant SaaS hosting — the project ships self-hostable software;
  hosted offerings are a deployment concern, not a product goal.
- Reaching 100% of QuickSight's API on day one — the API grows behind the conformance suite.

---

## 3. Compatibility Contract

This is the heart of the project. Three layers, in priority order:

### 3.1 Asset bundle import/export (highest priority)

QuickSight's `StartAssetBundleExportJob` / `StartAssetBundleImportJob` APIs move assets as
bundles of JSON definition files. OpenSight must:

- **Import:** accept a bundle exported from real QuickSight and reconstruct the analysis /
  dashboard / dataset / theme faithfully.
- **Export:** produce bundles in the same format so assets can move back to QuickSight
  (this is also what makes the project *safe* to adopt — no lock-in either direction).

The observed asset-bundle format will be the canonical **interchange** model. A
`QUICKSIGHT_JSON` export is a `.qs` ZIP containing asset definitions; it does not
include underlying data ([AWS export documentation](https://docs.aws.amazon.com/quicksight/latest/developerguide/assetbundle-export.html)).
We have no real export yet. Archive paths, member envelopes, resource discriminators
and dependencies remain **unverified**. No archive layout is specified or implemented.

`SyntheticAnalysisDocument` and `fixtures/sample-sales-analysis.json` are explicitly
**provisional, reconstructed-from-docs** inventory aids. Their `ResourceType: Analysis`
envelope is an OpenSight invention, not evidence of an AWS file or response shape.
`loadBundle` is a historical alias for `loadSyntheticAnalysis`: it loads one synthetic
JSON document, not a `.qs` archive. Unknown JSON properties survive loading; the
validator certifies only the modeled inventory subset, not full AWS validity.

> **Phase 1 entry requirement:** obtain at least one sanitized real export with
> dependencies and provenance before starting compatibility implementation. Inspect
> the actual archive, document member paths and schemas separately from API response
> contracts, then implement archive reading and observed resource dispatch (including
> dashboard exports from the runbook). Add real-export acceptance and structural
> round-trip tests before freezing the canonical model. Do not guess the ZIP layout.

Keep the reconstructed regression fixtures alongside the eventual real export.
Structural equality means preserving JSON values, unknown fields and absent optional
properties; it does not require identical ZIP compression, whitespace or key order.

### 3.2 API compatibility (growing subset)

Implement QuickSight API actions with identical request/response shapes, starting with
read paths and growing toward create/update. Keep three contracts separate:

| Contract | Shape and intended use |
|---|---|
| Archive member | Unknown until observed in a real export; used by import/export adapters |
| Definition API response | `DescribeAnalysisDefinition` / `DescribeDashboardDefinition` return `Definition` plus action-specific IDs, status, errors and other response fields; renderer reads these actions |
| Metadata API response | `DescribeAnalysis` returns `Analysis`; `DescribeDashboard` returns `Dashboard`; neither is a substitute for the full definition action |

References: [DescribeAnalysisDefinition](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DescribeAnalysisDefinition.html),
[DescribeDashboardDefinition](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DescribeDashboardDefinition.html),
[DescribeAnalysis](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DescribeAnalysis.html),
[DescribeDashboard](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DescribeDashboard.html).
API wire bodies, HTTP status/headers and SDK-decoded objects must also be recorded
separately; SDK metadata is not part of a JSON response body.

**Endpoint implementation gate:** first pin an exact AWS SDK package revision and
service-model revision/checksum in `docs/research/api-contracts.md`, with sanitized
recorded request/response fixtures (success and representative errors) for each action.
The service API date alone is insufficient to pin a changing model. No API endpoints
are implemented today; no SDK/model revision or captured API contract is claimed.
The docs-derived dataset/source response examples in `fixtures/renderable-sales/`
are explicitly reconstructions. Endpoint tests must compare recorded envelopes,
optional fields, error shapes and HTTP behavior; the UI must not depend on synthetic
fixture envelopes. Initial action inventory: the four Describe actions above, followed
by `DescribeDataSet`, `DescribeDataSource`, `ListAnalyses` and `ListDashboards`.

### 3.3 Rendering fidelity

The conformance suite (Section 8) will import real bundles and compare rendered visuals
against QuickSight screenshots / data outputs. Fidelity is measured, not asserted.

### 3.4 Preservation and execution are separate capabilities

Import/preservation may retain features that the runtime cannot execute. Import must
produce a capability report with `assetId`, JSON property path (and observed archive
member path when available), feature, reason and affected visuals/datasets. Inventory
success never grants execution permission. Unknown semantics default to unsupported.

Before every query, export of query results or render, check the complete dependency
graph, including dataset transforms, calculated fields, filter scopes and security.
An unsupported calculation blocks every dependent visual. An unsupported filter or
parameter blocks all visuals in its scope; if scope cannot be resolved, block the
whole asset. Show a located diagnostic and return an execution error; never silently
drop the feature or substitute unfiltered totals. Independent visuals can execute
only when their full dependency closure is supported.

From the **first runnable slice**, enforce dataset RLS/CLS and source restrictions or
explicitly reject execution of protected datasets. Phase 1 rejects them: no query,
preview, cache materialization or data export for an unresolved/protected dataset.
Missing security metadata is not evidence of an unrestricted dataset. Unknown policy
features and unresolved principals also fail closed. Phase 3 expands enforcement;
it does not introduce the first security check.

The initial execution allowlist is deliberately narrow: the five Phase 1 visuals,
explicit field wells, known dataset/source mappings, D9's calculation subset and a
static single-dataset category equality filter with a fully resolved scope and null
policy. General parameters, controls, windows, period functions, RLS and CLS remain
preservable but non-executable until their conformance tests pass. The bundle parser
only inventories JSON and grants no execution capability. The separate query-engine
package implements a synthetic local allowlist with explicit rejection gates (D10),
not QuickSight source-conformance certification.

---

## 4. Architecture

```
                        ┌─────────────────────────────────────────────┐
                        │                  OpenSight                   │
┌──────────┐            │  ┌─────────┐   ┌──────────────────────────┐  │
│  Web UI  │──queries──▶│  │ API     │──▶│ Query planner            │  │
│ (React)  │            │  │ (TS)    │   │ + expression engine      │  │
│ author + │            │  │ QS-compat│   └────────────┬─────────────┘  │
│ render   │            │  │ REST    │                │                │
└──────────┘            │  └────┬────┘   ┌────────────▼─────────────┐  │
                        │       │       │ DuckDB                   │  │
┌──────────┐            │       │       │ (SPICE equivalent:       │  │
│ CLI / SDK│───import──▶│       └──────▶│  cached marts + direct    │  │
│ bundles  │   export   │               │  source scans)            │  │
└──────────┘            │  ┌────────────▼─────────────┐             │  │
                        │  │ Postgres                 │             │  │
                        │  │ (metadata: assets, users,│             │  │
                        │  │  permissions, schedules) │             │  │
                        │  └──────────────────────────┘             │  │
                        │  ┌──────────────────────────┐             │  │
                        │  │ Scheduler                │             │  │
                        │  │ (refresh, email reports, │             │  │
                        │  │  threshold alerts)        │             │  │
                        │  └──────────────────────────┘             │  │
                        └─────────────────────────────────────────────┘
```

**Data flow for a dashboard render:**

1. Web UI requests `DescribeDashboardDefinition` / `DescribeAnalysisDefinition`;
   metadata comes from the separate `DescribeDashboard` / `DescribeAnalysis` actions.
2. API resolves dependencies and checks execution capabilities/security (§3.4).
3. A typed expression and relational planner binds fields and evaluation levels,
   then emits DuckDB SQL only for the supported subset (D9).
4. DuckDB executes over local data/cached marts or live Postgres scans. This is
   engine execution, not a guarantee of remote join/aggregation pushdown (D8).
5. Results return; UI renders visuals with ECharts.

**Components and their homes in the repo:**

| Component | Repo path | Notes |
|---|---|---|
| API server | `packages/api` | QuickSight-compatible REST, auth, scheduling endpoints |
| Web UI | `packages/web` | Dashboard/analysis renderer + authoring (later phases) |
| Bundle parser | `packages/bundle-parser` | Synthetic inventory today; observed archive import/export after the Phase 1 entry gate |
| Query engine | `packages/query-engine` | Planner + expression compiler on DuckDB |
| CLI | `packages/cli` | `opensight import/export/validate` for bundles |
| Conformance | `conformance/` | Bundle round-trip + rendering fidelity tests |
| Research notes | `docs/research/` | Bundle format findings, API surface notes |
| ADRs | `docs/adr/` | Decision records spun out of this doc when they get big |

---

## 5. Technical Decisions

Format: **Context → Options → Decision → Reasoning → Status.**
Status is one of `decided`, `proposed`, `open`.

### D1 — Analytical query engine

**Context:** Need a SPICE replacement: fast columnar execution for dashboard queries,
embeddable so a single-node deployment has zero operational overhead.

**Options:**
- **DuckDB** — embeddable columnar OLAP, excellent single-node performance, bindings for
  Node/Python, reads Parquet/CSV/S3 natively.
- **Apache DataFusion** — embeddable (Rust), more control over the planner, but younger
  ecosystem and weaker out-of-box SQL function coverage.
- **Trino/Presto** — distributed, proven at scale, but heavyweight: JVM cluster to
  operate, overkill before we have scale problems.
- **ClickHouse** — very fast, but a separate server process; more ops burden than DuckDB.

**Decision:** DuckDB.
**Reasoning:** It is the only option that is both embeddable (zero-ops single binary
path) and best-in-class for single-node analytics. Dashboard workloads are overwhelmingly
single-node-sized; we defer distributed execution until the conformance suite or real
users prove we need it. DataFusion remains the fallback if we ever need deep planner
customization.
**Status:** decided.

### D2 — API server language

**Context:** Must serve the QuickSight-compatible REST API, host the query planner, and
share types with the web UI.

**Options:**
- **TypeScript / Node** — one language across API + web, shared bundle-format types,
  largest contributor pool, DuckDB has official Node bindings.
- **Python / FastAPI** — strongest data-ecosystem libraries, but splits the codebase
  across two languages and duplicates the bundle type definitions.
- **Go** — great single-binary story, weaker BI/visualization-adjacent ecosystem.

**Decision:** TypeScript monorepo (API + web + shared packages).
**Reasoning:** Type-sharing between the bundle parser, API, and UI eliminates a whole
class of drift bugs — and drift from the bundle format is the project's #1 risk.
Contributor accessibility matters for an OSS project; TypeScript wins there.
**Status:** decided for shared packages by the strict TypeScript parser and local
query-engine slices; API and web remain unimplemented.

### D3 — Metadata store

**Context:** Assets, users, permissions, schedules, and audit log need durable,
relational storage.

**Options:** Postgres / SQLite / MySQL.

**Decision:** Postgres.
**Reasoning:** The asset graph (folders, sharing, RLS rules) is genuinely relational;
Postgres is boring, proven, and every host can run it. SQLite stays as the dev/test
default so contributors need zero setup.
**Status:** decided.

### D4 — Charting library

**Context:** Must reproduce ~15+ QuickSight visual types (bar, line, combo, pie/donut,
KPI, table, pivot, scatter, geospatial, funnel, gauge, …).

**Options:**
- **Apache ECharts** — huge visual catalog, canvas rendering (fast with large data),
  declarative option objects that map well to a compiler target.
- **Vega-Lite** — elegant grammar, but weaker on KPI/pivot/geospatial out of the box.
- **Custom D3** — maximum control, but we'd hand-build every visual type: months of work.

**Decision:** Apache ECharts (proposed).
**Reasoning:** Treat ECharts option objects as a *compile target*: the renderer compiles
a QuickSight visual definition → ECharts option. This keeps visual logic declarative
and testable in the conformance suite.
**Status:** proposed.

### D5 — Canonical data model = QuickSight bundle format

**Context:** What is the "source of truth" shape for an analysis/dashboard internally?

**Options:**
- Mirror QuickSight's bundle JSON exactly as the internal model.
- Design our own cleaner model with import/export adapters.

**Decision:** Preserve the observed bundle format as the canonical interchange model;
use separate API response types and typed execution plans. The current synthetic
envelope is not canonical. Keep raw properties through import/export, including
features unsupported by the query planner.
**Reasoning:** Structural fidelity requires evidence from real exports and explicit
adapters at API/execution boundaries. Similar definition objects do not establish
identical archive-member and API-response envelopes. Round trips must be tested,
not assumed to follow from a shared TypeScript interface.
**Status:** interchange principle decided; canonical archive schema and dispatch
blocked on the sanitized real-export entry requirement in §3.1.

### D6 — License

**Options:** Apache 2.0 / MIT / AGPLv3.

**Decision:** Apache 2.0 (proposed).
**Reasoning:** Permissive, enterprise-friendly (matters for QuickSight-competitive
adoption), patent grant included. AGPL would maximize copyleft protection but shrink
the adopter pool; for a compatibility play, adoption *is* the strategy.
**Status:** proposed.

### D7 — Monorepo tooling

**Options:** pnpm workspaces + Turborepo / npm workspaces / Nx.

**Decision:** pnpm workspaces + Turborepo (proposed).
**Reasoning:** Fast, disk-efficient, and Turborepo's task pipeline fits the
build→test→conformance flow. Revisit if contributor friction appears.
**Status:** proposed.

### D8 — SPICE equivalent (data caching/refresh)

**Context:** QuickSight's SPICE is an in-memory engine with scheduled refreshes. We need
the same UX: fast dashboards, scheduled data refresh, without the user running infra.

**Options:**
- Scheduled materialization into DuckDB (Parquet-backed, per dataset).
- Always execute over live source scans (no cache).
- External cache (Redis/Arrow Flight).

**Decision:** Scheduled materialization into DuckDB, with direct-query mode per dataset.
**Reasoning:** Matches SPICE semantics users expect (refresh schedules, "SPICE capacity"
becomes disk). DuckDB reads Parquet natively, so cached datasets are just files —
simple to reason about, back up, and inspect. Direct-query mode covers live-source
needs without a second system.

**Phase 1 direct-query contract:** DuckDB executes over **live Postgres scans**;
source-executed SQL is a separate future optimization. The PostgreSQL extension
provides specific pushdown mechanisms and `postgres_query` for explicit remote SQL,
not arbitrary remote execution of DuckDB plans
([extension documentation](https://duckdb.org/docs/current/core_extensions/postgres/overview)).

Before enabling Postgres, pin the exact Node binding and native DuckDB versions,
Postgres server version, and the `postgres` extension build/platform/checksum in a
committed query-engine lock manifest. Record the actual loaded extension metadata;
a floating `INSTALL postgres` is not a reproducible pin. The local slice now pins
Node API/bindings `1.5.5-r.5` and native DuckDB `v1.5.5` in
`packages/query-engine/duckdb-lock.json`, including observed statically linked
extensions and npm artifact integrity. No Postgres server or extension is enabled
or measured; those artifacts remain required before a remote-source spike.

The spike must inspect a representative query:
`SELECT region, SUM(revenue) FROM sales WHERE region = 'East' GROUP BY region`.
Run it against a seeded Postgres table with both selected and excluded rows and a
larger repeatable dataset. Capture DuckDB EXPLAIN/PROFILE, generated remote SQL
(`pg_debug_show_queries` or server-side logging), source rows/bytes transferred,
local memory and elapsed time. Compare with native Postgres results. Record which
projection, predicate and aggregation actually ran remotely; do not infer pushdown
from the final result or from the SQL dialect. Repeat with filter pushdown disabled
to measure the fallback cost. No remote-query measurement has been performed yet.

Fallback keeps supported semantics in DuckDB over bounded live scans, potentially
transferring all selected columns/rows across the network and repeating that cost
per query. Configure transfer, time and memory budgets and cancel with a diagnostic
when exceeded; never silently truncate results. Cached materialization is an explicit
dataset mode with freshness/cost implications, not an automatic semantic change.
A later Postgres SQL backend/`postgres_query` path needs its own dialect and semantic
conformance; security rejection in §3.4 always takes precedence over any fallback.
**Status:** proposed; version pins and remote-query evidence required before enabling
the Postgres path. Local SQLite fixture oracles do not satisfy this gate.

### D9 — Calculated-field expression engine

**Context:** QuickSight has a large proprietary function surface (aggregations like
`sumOver`, date functions, `periodOverPeriod*`, string/conditional logic). This must be
parsed and executed faithfully.

**Options:**
- Hand-written Pratt parser → compile to DuckDB SQL where possible.
- Embed an existing expression language (e.g., adapt a SQL parser like sqlglot).
- Interpret row-by-row in JS (simple, but slow and hard to push down).

**Decision:** Parser → typed expressions → relational plan → DuckDB SQL.
Parsing/function substitution alone cannot preserve calculation semantics. Follow
QuickSight's [evaluation order](https://docs.aws.amazon.com/quick/latest/userguide/order-of-evaluation-quicksight.html).

Each expression node carries source location, dataset/column binding, scalar type,
nullability, dependencies and evaluation level: row, PRE_FILTER, PRE_AGG, visual
aggregation or POST_AGG_FILTER/table calculation. Resolve calculated-field dependencies
topologically; report missing bindings and cycles at their property paths. The
relational planner owns row filters, grouping keys (visual grain), aggregation,
window partitions/order and post-aggregation filtering. Reject mixed grains or
unsupported evaluation levels rather than independently substituting SQL functions.

**Initial supported subset:** a single dataset; numeric literals and column references;
row arithmetic `+`, `-`, `*` with null propagation; SUM/COUNT/MIN/MAX/AVG at an explicit
visual grain; static category equality filtering before aggregation; and calendar
month grouping in UTC. Only enable each operation for QuickSight-compatible production
execution after captured result comparisons pass. D10 permits the explicitly
provisional synthetic local experiment before those captures. The renderable fixture
binds `{revenue} * 0.9` before SUM; no joins,
parameters, windows, level-aware aggregation, division or period functions are enabled
in the initial slice. Unsupported functions/levels follow §3.4.

Conformance must distinguish row ratios from ratios of aggregates, null operands,
all-null measures, zero denominators, and missing calendar periods. In particular,
[`periodOverPeriodDifference`](https://docs.aws.amazon.com/quick/latest/userguide/periodOverPeriodDifference-function.html)
uses date-based offsets: a missing February cannot make March compare with January
through a row-offset LAG. A later implementation needs calendar-key alignment at the
correct grain. Division/null/zero behavior must be established from captured source
results before enabling it, rather than inherited accidentally from the SQL backend.

`fixtures/renderable-sales/semantic-cases.json` records concrete local regression
oracles for these edge cases, marked provisional/deferred pending QuickSight result
capture. Tests execute their reference SQL separately from planner/result checks. The
local compiler rejects deferred division, aggregate-expression and period cases;
all-null aggregation executes. Neither local suite establishes source conformance.
Compilation keeps computation in DuckDB; remote Postgres execution is governed
separately by D8.
**Status:** typed row-stage architecture decided and implemented for the D10 local
slice; source semantics provisional, broader levels deferred to Phase 2.

---

### D10 — First local query-engine slice

**Context:** Prove definition → SQL → CSV results without AWS, while real-export and
source-conformance gates remain unsatisfied.

**Options:** Emit SQL directly from field wells / typed staged plan / interpret rows
in JavaScript. Use the legacy `duckdb` package / official Neo Node API and bindings.

**Decision:** `@opensight/query-engine` uses the official Neo Node API (and its native
`@duckdb/node-bindings` dependency), an in-memory DuckDB instance per execution, and
DuckDB SQL. No fallback, network source, extension install or remote pushdown is part
of this slice. Package versions and native engine identity are recorded alongside the
engine; npm's root lockfile pins native artifacts. This does not satisfy D8's Postgres gate.

Planning stages:

1. Validate the synthetic definition, requested visual, dataset/source linkage and
   explicit local CSV binding. Reject protected or unresolved security and unknown
   execution properties before opening data. Missing AWS security properties alone
   are insufficient: a trusted local fixture binding must declare both dataset and
   source unrestricted. This declaration is test configuration, never an AWS policy.
2. Normalize the five fixture visual field-well shapes and resolve column types.
3. Parse row expressions, bind dependencies topologically and annotate source spans,
   dataset bindings, scalar type, nullability and row evaluation level. Compile only
   the dependency closure used by the visual and applicable filters.
4. Project row calculations in dependency-ordered CTEs; apply static category equality
   filters before grouping; aggregate at the explicit dimension grain. Emit quoted
   identifiers, bound filter values, UTC calendar-month grouping and deterministic
   ascending dimension order. Field IDs map to result columns in the plan.
5. Execute generated SQL over the explicitly mapped local CSV with declared types
   and empty-cell nulls, then return JSON-compatible result rows. No raw-SQL execution
   API bypasses planning/security checks.

**Local data/results contract:** INTEGER → BIGINT, DECIMAL → DOUBLE, STRING → VARCHAR;
the initial DATETIME input subset accepts ISO date-only `YYYY-MM-DD` values at UTC
midnight. Other timestamp formats/offsets are rejected. Arithmetic is floating point
and null-propagating, not an exact financial decimal contract. Nonfinite cells/results
are rejected. COUNT counts non-null field values; empty/all-null SUM/AVG/MIN/MAX
return null. Integers outside JavaScript's safe range serialize as decimal strings.
Month output is `YYYY-MM`, with no filled calendar gaps. Result aliases use field IDs
except `month` for the fixture date dimension; duplicate aliases are rejected.

The caller selects a local data root; CSV headers/types and the resolved file boundary
are checked. Each run uses one thread, 256 MiB memory and no disk spill, closes native
resources in `finally`, disables extension autoload/install, and disables external
access after import. No generic query API, caching or preview path bypasses planning.

**Provisional semantics:** This user-requested Phase 0 experiment enables D9's small
subset for synthetic local fixtures only; it does not enable QuickSight-compatible
production execution before captured comparisons. SUM/AVG/COUNT/MIN/MAX, numeric
literals, column references, parentheses and row `+`, `-`, `*` are supported. Division,
aggregate expressions, windows and period functions remain explicit planning errors.
Every `semantic-cases.json` entry gets a planner test: supported all-null aggregation
executes; the three deferred cases prove rejection, with separate reference-oracle
execution documenting their proposed results. SQL-shape comparisons are structural,
since DuckDB date syntax, parameters and CTE staging differ from SQLite fixture SQL.

**Reasoning:** A typed dependency plan preserves row-before-aggregation semantics and
keeps unsupported features from silently changing totals. Local execution makes this
boundary testable without implying archive, API or source compatibility.
**Status:** decided for the synthetic local slice; QuickSight semantics remain provisional.

---

## 6. Phased Delivery Plan

### Phase 0 — Learn the format (current)
- [ ] Capture real QuickSight asset-bundle exports (runbook below); document exact schema + zip layout in `docs/research/`.
- [x] Repo scaffold + provisional `bundle-parser` inventory of reconstructed JSON.
- [x] Recursive inventory validation, strict indexed access, public exports, regression tests and CI.
- [x] Separate query/render specification with five visuals, source/dataset definitions, CSV and SQL data oracles.
- [x] Synthetic local query-engine slice: typed row planning, DuckDB SQL/CSV execution,
  five visual result checks, semantic rejection/oracle tests and execution gates (D10).
- [ ] Add a sanitized real export alongside the reconstructions; document observed archive/member schemas.
- [x] Confirm D2 (TypeScript) with the local spike; record the initial API action
  inventory in §3.2 (captured API contract and endpoint gates remain open).

#### Runbook — capture a real export (at a PC with AWS CLI v2)

Goal: one sanitized real `QUICKSIGHT_JSON` bundle, with all dependencies and capture
provenance, to satisfy the Phase 1 entry requirement and ground schema research.
The current single-JSON inventory loader cannot validate this archive.

Prerequisites: AWS CLI v2 with access to the QuickSight account. Pick the most
complex dashboard available — more visual types means better parser coverage.

1. Find the dashboard ID:

   aws quicksight list-dashboards --aws-account-id YOUR_ACCOUNT_ID --region YOUR_REGION

2. Start the export. `--include-all-dependencies` pulls in datasets, data sources
   and themes so the bundle is self-describing:

   aws quicksight start-asset-bundle-export-job \
     --aws-account-id YOUR_ACCOUNT_ID \
     --asset-bundle-export-job-id opensight-sample-1 \
     --resource-arns '["arn:aws:quicksight:YOUR_REGION:YOUR_ACCOUNT_ID:dashboard/YOUR_DASHBOARD_ID"]' \
     --include-all-dependencies \
     --export-format QUICKSIGHT_JSON \
     --region YOUR_REGION

3. Poll until `JobStatus` is `SUCCESSFUL`, then copy the presigned `DownloadUrl`:

   aws quicksight describe-asset-bundle-export-job \
     --aws-account-id YOUR_ACCOUNT_ID \
     --asset-bundle-export-job-id opensight-sample-1 \
     --region YOUR_REGION

4. Download promptly (the URL expires) into a private location. Sanitize the archive
   before keeping a fixture; retain relationships while replacing identifying values.
   Record capture date, export options, asset kinds, sanitization changes and checksum.

What happens next: inspect the actual archive and write observed member paths,
resource schemas and dependency relationships in `docs/research/bundle-format.md`.
Keep API response captures in separate contract fixtures. Only then implement archive
reading and resource dispatch, including the exported dashboard and its dependencies,
with acceptance and structural round-trip tests. A dashboard archive is not input to
the current synthetic analysis loader. Retain the inventory fixture for regression
coverage and add the sanitized export separately. Underlying test data must be
provided separately; asset exports do not contain it.

> **Public-repo hygiene.** This repository is public. Never commit real account
> IDs, ARNs, credentials, hostnames, or customer data. The commands above use
> placeholders (`YOUR_ACCOUNT_ID`, …) — keep it that way. Any real export kept
> as a fixture must be redacted first: replace account IDs/ARNs with example
> values and strip connection details.

### Phase 1 — Vertical slice

**Entry gate:** a sanitized real export with dependencies, provenance and observed
archive/member documentation (§3.1). This gate is currently **not satisfied**. Work
on synthetic regression fixtures can continue; it cannot establish bundle compatibility.

- Implement archive/resource dispatch from the observed export; add real acceptance
  and structural round-trip tests before freezing archive types.
- Use `fixtures/renderable-sales/` as a provisional query/render specification for bar,
  line, ordinary table, KPI and pie visuals. Compare against the eventual real source.
- Compile the supported aggregation + static-filter query to DuckDB SQL, with typed
  binding, dependency/grain analysis and the D9 subset; reject unsupported features.
- Execute local CSV first, then Postgres live scans after D8's version-pin and remote
  query inspection gates. Document transfer costs and bounded fallback behavior.
- Apply §3.4 capability checks before the first query. Reject RLS/CLS-protected or
  unresolved datasets until enforcement exists; report located unsupported features.
- Implement separate metadata and definition actions from §3.2 only after pinning the
  SDK/service model and recording contract fixtures. Renderer uses definition actions.

### Phase 2 — Expression & interactivity
- Full calculated-field function library (grown behind conformance tests).
- General filters, parameters, controls, cross-visual filtering, drill-down; until supported, refuse affected execution (§3.4).
- Remaining visual types; theme support.
- Analysis authoring UI (basic).

### Phase 3 — Enterprise surface
- Scheduled DuckDB refresh (D8), email reports, threshold alerts.
- Expand row-level / column-level security enforcement, namespaces, embedding SDK. Protected datasets are rejected from Phase 1 until this support is available (§3.4).
- Folder management, asset sharing APIs.

### Phase 4 — Parity & beyond
- Paginated reports, Q-like natural language (investigate, don't commit).
- Distributed query investigation (only if evidence demands it).
- Hosted reference deployment (Docker Compose / Helm).

---

## 7. Repository Layout

```
opensight/
├── SOLUTION_DESIGN.md        # this file — the living design doc
├── README.md
├── LICENSE                  # Apache 2.0 (proposed, D6)
├── package.json              # workspace root (proposed: pnpm + Turborepo, D7)
├── docs/
│   ├── research/             # bundle format notes, API surface inventory
│   └── adr/                  # decision records spun out of this doc
├── fixtures/                 # provisional inventory/render specs; future sanitized exports
├── packages/
│   ├── api/                  # QuickSight-compatible REST API (Phase 1)
│   ├── web/                  # React renderer + authoring (Phase 1)
│   ├── bundle-parser/        # provisional inventory; archive support after real export
│   ├── query-engine/         # planner + expression compiler on DuckDB (Phase 1)
│   └── cli/                  # opensight import/export/validate (Phase 1)
└── conformance/              # round-trip + fidelity tests (Phase 1+)
```

---

## 8. Conformance & Testing Strategy

**Running today:** Node 24+, `npm ci`, `npm run build`, `npm test`. CI runs build and
the full suite on pushes/PRs. TypeScript stays strict with `noUncheckedIndexedAccess`;
a consumer typecheck and runtime import exercise the public package exports. Tests
cover the checked-in summary/CLI output, omitted sheets and optional fields, malformed
nested objects with JSON paths, union cardinality/parameter variants, rich-text titles,
and preservation of unknown properties through a synthetic JSON round trip. The
render fixture checks source/field/layout linkage and executes handwritten reference
SQL against deterministic CSV in Node's in-memory SQLite. Those independent checks
establish data-oracle consistency. `@opensight/query-engine` additionally compiles all
five visuals and executes generated parameterized DuckDB SQL against that CSV,
comparing ordered rows and SQL shape to `expected-queries.json`. Tests cover each
semantic case, row-expression typing/dependencies/cycles, aggregation/null/filter
ordering, multi-dimension grain, CSV validation and malformed/protected/unsupported
inputs. Deferred semantic references also run in DuckDB as test-only oracles with a
calendar-date syntax adaptation; planner and executor must still reject those features.
Public-entry consumer typechecking and a native-version/extension lock check run with
the package tests. Root `npm test` includes both workspaces. These are local regression
tests, not renderer, real-export, QuickSight result or remote-pushdown conformance.

**Required as the corresponding runtime is implemented:**

1. **Archive acceptance/round trip:** load the sanitized real export, dispatch every
   observed resource, then export and compare member structure, unknown fields,
   omitted properties and dependency references. Blocked until the export arrives.
2. **Semantic conformance:** compare every enabled calculation and evaluation stage
   with captured QuickSight results. Include missing periods, nulls, zero denominators,
   row/aggregate ratios and filter ordering; deferred cases must cause execution errors.
3. **Rendering fidelity:** render the five fixture visual types and compare with
   QuickSight screenshots/data (tolerance-based visual equivalence).
4. **API contracts:** compare separate metadata and definition endpoints with recorded
   requests/responses against the pinned SDK/service-model revision (§3.2).
5. **Execution gates:** verify unsupported filters/parameters block their full scope,
   unsupported dependencies block dependent visuals, and RLS/CLS/unresolved policies
   block query, preview, caching and data export from the first runnable slice.
6. **Postgres integration:** pin binding/core/extension versions and capture actual remote
   queries, row/byte transfer, fallback costs and result equivalence (D8).

---

## 9. Open Questions

| ID | Question | Notes |
|---|---|---|
| OQ-1 | Project name | **Decided 2026-09-26: OpenSight.** "QuickSight" is an AWS trademark — not used in the name. The name is crowded on GitHub (6+ unrelated repos: cash-flow forecasting, marketing analytics, brand AI-monitoring, YOLO image annotation, video analytics, k8s manifests; none BI-related), but repo names are per-account so this does not block us; revisit only if discoverability becomes a problem. Rejected: "openquick" (active samuellawrentz/openquick collision + trademark-adjacent to QuickSight); openprism / openpulse / openlantern / openlumen (all crowded); OpenMeridian / OpenAperture / OpenFathom (clear on GitHub, but Tom preferred opensight). |
| OQ-2 | Real bundle samples | **Phase 1 entry blocker:** sanitized real export plus provenance/observed schema required. No ZIP layout assumptions or archive support until received. |
| OQ-3 | Auth model for Phase 1 | Start simple (local users + API keys)? OIDC from the start? Leaning simple-first, OIDC in Phase 3. |
| OQ-4 | Which QuickSight API version to track | Exact SDK revision + service-model checksum and recorded contracts required **before endpoints** (§3.2); no API implementation yet. |
| OQ-5 | Geospatial visuals | ECharts maps vs. dedicated mapping lib — decide in Phase 2 when visual coverage expands. |
| OQ-6 | Numeric and temporal source semantics | D10 uses DOUBLE arithmetic and date-only UTC input. Capture QuickSight null/COUNT/rounding/overflow and timezone behavior before enabling production semantics, division or broader timestamps; choose an exact decimal contract if required. |
| OQ-7 | Local engine lifecycle and budgets | Per-query in-memory instances suffice for small trusted fixtures. Define cancellation, source/result byte limits, pooling/cache freshness and a trusted policy resolver before exposing execution through an API. Local security assertions must never come from imported assets. |
| OQ-8 | Deferred semantic enablement | Obtain captured results for period gaps, zero/null division and row versus aggregate ratios; until then these cases remain planning errors, even though their proposed reference SQL has local oracle tests. |

---

## 10. How This Document Evolves

- Small updates: edit in place, add a changelog row.
- Big decisions: write the options/reasoning here first; spin out a full ADR in
  `docs/adr/` only when the discussion outgrows a section.
- Every phase kickoff re-reads this doc and updates statuses (`proposed` → `decided`,
  unchecked → checked).
- Nothing here is precious. When we learn something that contradicts it, we change the
  doc first, then the code.
