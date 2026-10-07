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
| 2026-09-26 | Docs-only definition API catalog: 25 visual variants, 41 field-well structures, 8 filter variants, 4 parameter declarations and calculation/context helpers. Additive provisional API types remain separate from validated synthetic inventory and observed bundle types; endpoint contracts remain open. |
| 2026-09-26 | Real bundle grounding: sanitized AWS sample confirms four resource directories, lowercase envelopes and camelCase definitions; separate archive types, ZIP reader, acceptance/preservation tests and format notes. Complex exports and source conformance remain open. |
| 2026-09-26 | Query-engine slice: D10 records the local DuckDB architecture, typed planning stages, explicit synthetic security binding and deferred semantic gates. |
| 2026-09-26 | Review fixes: provisional format boundary, recursive inventory validation, public package entry, regression tests/CI, query/render fixture and explicit Phase 1 compatibility/execution gates. Real-export archive work remains blocked. |
| 2026-09-26 | Initial draft: vision, compatibility contract, architecture, decisions D1–D9, phased plan. Repo scaffold + bundle-parser spike started. |
| 2026-09-26 | bundle-parser spike builds clean (tsc strict) and summarizes the sample fixture; committed locally as `3655cc3`, ready to push once GitHub is connected. |
| 2026-09-30 | D14: hosted multi-tenant direction accepted — the owner's most important long-term vision. Hosted architecture spec merged (`docs/hosted-architecture.md`); HQ-1 (one namespace per tenant), HQ-2 (operator provisioning), HQ-12 (compatibility matching) and HQ-15 (dependency policy scope) decided; rollout slices H0–H12 defined; Phase 5 first trigger met (H1–H8 scheduled, H9–H12 still unscheduled). |
| 2026-09-29 | D13: Blaze horizontal-scaling architecture decided — Parquet artifacts on shared object storage + per-node memory when multi-node matters, Redis (or equivalent) for refresh coordination/invalidation only; `refresh`/`read` seam is the portability boundary. D8 status updated to the shipped in-process implementation (#12/#15). |
| 2026-09-29 | Issue #18: prep divergent paths (branching) specified — steps may name an earlier step as their left input, fan-out capped at 5 consumers per step (QuickSight parity), explicit output selector; linear pipelines unchanged. |
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
- Multi-region operation — not in scope for any planned phase.
- Multi-tenant SaaS hosting as the *default* product — the project still ships
  self-hostable software first. But hosted multi-tenant OpenSight is now the
  accepted long-term vision (owner decision 2026-09-30; see D14): an optional
  hosted offering with white-label embedding, built in rollout slices H0–H12.
  Single-node self-hosting remains the default product and the reference behavior.
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
The sanitized AWS `TotalDeathByCountry.qs` sample now supplies ground truth:
`analysis/{id}.json`, `dashboard/{id}.json`, `dataset/{id}.json` and
`datasource/{id}.json`, with lowercase `resourceType` envelopes and camelCase
properties throughout. There is no manifest in this four-member archive.
See [observed format and API mapping](docs/research/bundle-format.md) and
[fixture provenance/checksum](fixtures/real-bundle-sample/README.md).

`loadQsBundle` / `parseQsBundle` read ZIP members, dispatch those four resource types,
and preserve unknown JSON properties. `BundleDefinition` is a separate camelCase
layer; it is not the PascalCase `AnalysisDefinition` inventory used by the synthetic
loader or a `Describe*Definition` response. ZIP reading is bounded, does not extract
files, and rejects duplicate/unsafe paths, malformed members and path/envelope ID or
type mismatches. Unsupported resource directories fail explicitly; no asset is
silently dropped.

`SyntheticAnalysisDocument` and `fixtures/sample-sales-analysis.json` are explicitly
**provisional, reconstructed-from-docs** inventory aids. Their `ResourceType: Analysis`
envelope is an OpenSight invention, not evidence of an AWS file or response shape.
`loadBundle` is a historical alias for `loadSyntheticAnalysis`: it loads one synthetic
JSON document, not a `.qs` archive. Unknown JSON properties survive loading; the
validator certifies only the modeled inventory subset, not full AWS validity.

> **Phase 1 entry requirement: satisfied for initial archive import.** The sanitized
> AWS sample has dependencies and recorded provenance. Acceptance and structural
> JSON preservation/repacking tests cover all four observed members. Canonical types
> remain an observed subset: one sheet/pie per definition, ATHENA source and SPICE
> dataset. Calculated fields, parameters and filter groups are empty, so their item
> shapes remain opaque. Tom's complex export is still needed, as are export-to-AWS,
> API, semantic and rendering conformance. Test repacking is not an export API.

Keep the reconstructed regression fixtures alongside the sanitized real export.
Structural equality means preserving JSON values, unknown fields and absent optional
properties; it does not require identical ZIP compression, whitespace or key order.

### 3.2 API compatibility (growing subset)

Implement QuickSight API actions with identical request/response shapes, starting with
read paths and growing toward create/update. Keep three contracts separate:

| Contract | Shape and intended use |
|---|---|
| Archive member | Observed camelCase fields with lowercase `resourceType`; separate `BundleResource` / `BundleDefinition` types for import/export adapters |
| Definition API response | `DescribeAnalysisDefinition` / `DescribeDashboardDefinition` return `Definition` plus action-specific IDs, status, errors and other response fields; renderer reads these actions |
| Metadata API response | `DescribeAnalysis` returns `Analysis`; `DescribeDashboard` returns `Dashboard`; neither is a substitute for the full definition action |

References: [DescribeAnalysisDefinition](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DescribeAnalysisDefinition.html),
[DescribeDashboardDefinition](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DescribeDashboardDefinition.html),
[DescribeAnalysis](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DescribeAnalysis.html),
[DescribeDashboard](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DescribeDashboard.html).
API wire bodies, HTTP status/headers and SDK-decoded objects must also be recorded
separately; SDK metadata is not part of a JSON response body.

**Documentation inventory captured (2026-09-26, provisional):**
[API surface catalog](docs/research/api-surface.md) records both definition response
bodies and 224 related shapes from public AWS documentation, with source links,
direct members, required/optional flags and per-shape bundle evidence. No AWS
service calls or captured responses were used.

| Captured definition surface | Coverage |
|---|---|
| Response roots | `AnalysisDefinition`, `DashboardVersionDefinition`, sheet/tooltip-sheet definitions, dataset/topic declarations, defaults/options, errors and publication options; `Status` is HTTP status, outside the documented JSON body |
| Visuals and fields | All 25 `Visual` variants, their configurations, all 41 named field-well structures, dimension/measure/unaggregated fields, layer-map paths and aggregation helpers |
| Filters | All 8 `Filter` variants, category configurations, nested inner filters, scope and numeric/time/rolling-date bounds |
| Parameters | All 4 declaration variants, typed defaults, dynamic/rolling defaults, unset-value configurations and dataset-parameter mappings; separate control shapes |
| Calculations | Definition `CalculatedField`, visual `CalculatedMeasureField`, dataset `CalculatedColumn`/creation transforms as dependency context, rolling-date expressions and 10 insight computation variants |

The additive, type-only `QuickSightApi` namespace contains docs-derived PascalCase
projections for response bodies, definition context, fields/wells and parameters.
Optional detail fields and new standalone shapes do not change the existing
synthetic inventory or validators. In particular, current docs allow topic binding
and optional dataset identifiers on calculated fields/column references; the
synthetic parser still requires its original dataset bindings. Opaque API properties
remain opaque, and timestamp wire/SDK encoding is not inferred. The camelCase
`BundleDefinition` layer remains grounded only in the sanitized fixture: a pie and
its field wells are observed; calculation/parameter/filter item shapes are unknown.

**Still open:** complex bundle mappings, the remaining presentation/layout/action
graph, conditional requiredness and documentation/model drift, timestamp/long
serialization, calculation/filter/parameter semantics and source conformance. The
catalog is a dated reading of mutable docs, not a pinned service model or endpoint
contract; recognizing a type grants no new query or rendering capability.

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
| Bundle parser | `packages/bundle-parser` | Observed .qs ZIP import and synthetic inventory; export adapter still pending |
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
query-engine slices; first API slice (`packages/api`, plain `node:http`, local
definition endpoints) and web slice (`packages/web`, React + ECharts fixture
renderer) implemented 2026-09-26; full API/web remain future work.

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
**Status:** decided — first renderer slice (`packages/web`) compiles bundle visual
definitions to ECharts options for pie/donut, bar and KPI shapes over local
fixtures (2026-09-26); broader visual coverage remains future work.

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
**Status:** interchange principle decided; observed archive subset and import dispatch
implemented from the sanitized AWS sample (§3.1). Broader schema and export
conformance await more real samples; the synthetic/API layer remains separate.

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

**Status update (2026-09-29, issues #12/#15):** shipped as an in-process columnar
store (`BlazeTable`, one JS vector per column) in the API server rather than
DuckDB-Parquet files — zero new dependencies, bounded by env-configured memory
caps (`OPENSIGHT_BLAZE_MAX_BYTES` etc.), with the mandatory-materialization rule
for cross-source joins and advanced steps. The DuckDB-Parquet option remains the
conceptual ancestor of the D13 distributed design (Parquet artifacts on shared
object storage).

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

**Context:** Prove definition → SQL → CSV results without AWS, separately from
archive import and source-conformance work. The latter remains an execution gate.

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

### D11 — Hosting target

**Context:** Where OpenSight runs once there is something to deploy. Owner direction
(2026-09-26): assume the owner's AWS account when available; prefer free-tier and
serverless services where possible.

**Options:**
- **AWS serverless-first** — Lambda (TypeScript API) + API Gateway, S3 + CloudFront
  (frontend), RDS free tier (Postgres metadata), DuckDB inside the Lambda package or
  as a sidecar for the SPICE-equivalent cache on S3/Parquet.
- **Single VPS / Docker Compose** — simplest self-host story, but not the owner's
  target and a worse fit for the OSS "deploy to your own AWS" narrative.
- **ECS Fargate** — middle ground if Lambda packaging (native DuckDB bindings,
  250 MB limit) proves painful.

**Decision:** AWS serverless-first; free tier where it exists.
**Reasoning:** The architecture (stateless TypeScript API, DuckDB-in-process,
Postgres for metadata, static frontend) maps cleanly onto Lambda + S3 + CloudFront +
RDS. Serverless keeps idle cost near zero, which matters for the owner's cost
constraint. Fargate stays as the fallback if Lambda packaging fights the native
DuckDB bindings.
**Status:** decided as target; no infrastructure code until a later phase.

### D12 — Production data plane: Postgres, not DynamoDB; DuckDB stays local-only

**Context:** Owner direction (2026-09-26): for the hosted deployment DuckDB will
likely need swapping for DynamoDB or Aurora Serverless.

**Options:**
- **DynamoDB** — generous free tier and truly serverless, but it is a
  key-value/document store with no engine for ad-hoc GROUP BY and aggregation.
  Every analytical query would become a full-table scan aggregated in Lambda —
  reimplementing, worse, what DuckDB already does. PartiQL is not OLAP.
- **Aurora Serverless v2 (Postgres)** — best technical fit: real Postgres, and
  the query engine's generated SQL translates with dialect adjustments. But the
  ~0.5 ACU floor is roughly $43/month — real money against the owner's cost
  constraint.
- **RDS free tier (db.t3.micro Postgres)** — $0 for 12 months, real Postgres,
  and the same engine as Aurora, so graduating to Serverless v2 later is
  trivial. Not serverless (always on), but free beats serverless while learning.
- **S3 + Athena** — near-zero idle cost and pay-per-query, but multi-second
  latency and a different execution story; revisit for the SPICE-equivalent
  cache layer, not the primary query path.

**Decision:** Postgres in production — RDS free tier first, Aurora Serverless v2
when the free year ends or load demands it. DynamoDB is rejected for the
analytical query path (wrong data model; it would force scan-and-aggregate in
Lambda). DuckDB remains the local dev/test engine (zero setup, fast): the
query engine's planner/executor split absorbs the dialect difference through a
Postgres executor, and the engine's SQL is already the portability seam.
**Status:** decided; no infrastructure code yet.

### D13 — Blaze horizontal-scaling architecture

**Context:** Blaze (issues #12, #15) is an in-process columnar snapshot store in the
API server's heap: one JS vector per column, bounded by env-configured memory caps,
a single global refresh lock, no persistence. Correct for single-node self-hosted,
but three hard limits under load balancing: snapshots are not shared across
instances; one refresh at a time per process; a restart wipes the cache.

**Options:**
- **Sticky sessions + per-node Blaze** — simplest, but duplicates refreshes and
  source load across nodes; a band-aid, not an architecture.
- **Redis as the snapshot store** — wrong data model. A key-value store forces
  serialization plus a network hop on every query, giving back much of the
  cache's latency win. Redis (or equivalent) is the right tool for the
  *coordination* layer — distributed refresh locks, invalidation pub/sub — not
  for columnar snapshots.
- **Parquet artifacts on shared object storage + per-node memory** — a refresh
  writes a content-addressed `blaze/{dataset}/{generation}.parquet`; any node
  loads it into local memory (or memory-maps it via DuckDB, already a
  dependency). Scales horizontally with no cache cluster to operate, and queries
  stay in-process fast.

**Decision:** Keep the in-process store for single-node. When multi-node matters,
snapshots move to Parquet artifacts on shared object storage with per-node local
memory; Redis (or equivalent) only for refresh coordination and invalidation.
The `refresh(key, load)` / `read(key)` seam is the portability boundary —
execution modes, refresh lifecycle, named errors, and UI do not change.
**Reasoning:** Do not make poor scaling decisions in the foundation, but do not
pay distributed-systems cost before it is needed. The seam makes the future
backend a swap, not a redesign. Columnar artifacts preserve the layout that
makes Blaze fast; object storage is the cheapest durable shared layer.
**Status:** decided 2026-09-29 (owner direction); single-node implementation
shipped in #12/#15; distributed backend is a future phase with a defined seam.
Trigger: multi-instance deployment.

### D14 — Hosted multi-tenant direction accepted; rollout slices defined

**Context:** Owner decision 2026-09-30: hosted, horizontally scalable,
embeddable/white-label OpenSight is the project's most important long-term
direction. The hosted architecture spec (`docs/hosted-architecture.md`, merged
2026-09-30) is the proposal record: tenancy model, isolation guarantees,
embedding/white-label API surface, D13-based scaling plan, operations, 17 open
questions (HQ-1–HQ-17), and phased rollout slices H0–H12. This decision
reconciles the old §2 non-goal ("hosted offerings are a deployment concern, not
a product goal") with the new direction.

**Decisions recorded 2026-09-30 (from spec §7):**
- **HQ-1:** one namespace per tenant. Each tenant gets exactly one member
  namespace initially; a separate opaque `tenantId` lifecycle record is kept so
  a future one-to-many relationship needs no schema rework. One external
  identity may hold memberships in several tenants; each session selects and
  verifies exactly one.
- **HQ-2:** the operator/administrator provisions tenants. The operator plane
  (tenant provisioning, suspend/resume/delete) is separate from the tenant plane —
  the analogue of AWS, where the account administrator subscribes and configures
  QuickSight. Self-service signup, if ever wanted, is a product layer whose
  backend calls the operator API.
- **HQ-12:** compatibility matching. Hosted tenancy, identity and embedding APIs
  match QuickSight's shapes and semantics by default — but never by weakening the
  tenant boundary: OpenSight namespaces keep scoping assets and metadata
  (QuickSight's account-scoped assets are weaker isolation and are not adopted),
  the `tenantId` lifecycle record stays, and refresh stays fail-closed.
- **HQ-15:** no D3/D12 change. The MIT/Apache-2.0 rule governs bundled code;
  operator-installed server infrastructure must be open-source and freely
  available (the PostgreSQL License qualifies; SSPL/RSAL/BSL-style terms do not).
  What OpenSight ships is the MIT-licensed `pg` client.

**Still open (sequenced by the rollout, not decided here):** HQ-3 (auth model),
HQ-4 (prepared-dataset sharing), HQ-5 (white-label scope), HQ-6 (anonymous
embeds), HQ-7 (session lifetimes), HQ-8 (workload limits), HQ-9 (custom domains),
HQ-10 (availability/recovery commitments), HQ-11 (D11 serverless vs D12/D13
executor reconciliation), HQ-13 (job ownership), HQ-14 (metering units), HQ-16
(source lifecycle), HQ-17 (asset templates).

**D11 relationship:** D11 (AWS serverless-first) stands as the deployment target.
The spec's Docker Compose reference is a local reference/test harness, not a
reversal of the cloud decision. The executor question (long-lived workers vs
short-lived containers) is HQ-11 and explicitly unresolved.

**Pilot scope (first hosted release):** H1 tenant metadata/migration, H2 verified
tenant sessions and provisioning, H3 durable sources and complete data
authorization, H4 tenant budgets and worker containment, H5 embed configuration
and appearance, H6 registered embed sessions and SDK evolution, H7 tenant
automation and durable job ownership, H8 single-node hosted reference and pilot
gate. Explicitly out of the pilot until their HQs are decided: anonymous embeds
(HQ-6), custom embed domains (HQ-9), multi-node operation (H9–H10), HA claims
(H12, pending HQ-10 targets).

**Status:** decided; H0–H12 are the plan. H0–H8 (hosted correctness foundation,
single-node) are buildable now; H9–H12 (shared artifacts, distributed refresh,
replica safety, supporting-service HA) wait on the Phase 5 scale-out triggers.

---

## 6. Phased Delivery Plan

### Phase 0 — Learn the format (current)
- [x] Ground initial archive/member schemas in the sanitized AWS real export; document observed layout in `docs/research/bundle-format.md`.
- [ ] Capture Tom's complex export (runbook below) for nonempty parameters, filters, calculations and more visuals.
- [x] Repo scaffold + provisional `bundle-parser` inventory of reconstructed JSON.
- [x] Recursive inventory validation, strict indexed access, public exports, regression tests and CI.
- [x] Separate query/render specification with five visuals, source/dataset definitions, CSV and SQL data oracles.
- [x] Synthetic local query-engine slice: typed row planning, DuckDB SQL/CSV execution,
  five visual result checks, semantic rejection/oracle tests and execution gates (D10).
- [x] Add the sanitized real export alongside unchanged reconstructions; implement observed resource dispatch and acceptance/preservation tests.
- [x] Confirm D2 (TypeScript) with the local spike; record the initial API action
  inventory in §3.2 (captured API contract and endpoint gates remain open).
- [x] Catalog the public definition API shapes and add separate provisional API
  type projections (§3.2); preserve existing parser/runtime behavior.
- [x] First local definition API slice (`packages/api`): plain `node:http` server
  with `GET /analyses/{id}/definition` and `/dashboards/{id}/definition` reading
  local `.qs` bundles/fixtures; PascalCase responses per the API catalog, unknown
  properties preserved; 18 HTTP-level tests. No auth, no AWS calls (D2).
- [x] First web renderer slice (`packages/web`): React 19 + ECharts 6 + Vite app;
  pure visual compiler (bundle definition → ECharts options) for pie/donut, bar
  and KPI; renders the sanitized real bundle and synthetic fixtures from
  precomputed results (no in-browser DuckDB); 50 compiler/fixture tests (D4).
- [x] Web/API definition integration: `packages/web` fetches live definitions
  from the local API (`VITE_OPENSIGHT_API_URL`, default `/api` proxied to the
  API server in dev); PascalCase → camelCase converter reuses bundle-parser
  types; chart data is pinned only when the live definition deep-equals a
  reviewed fixture (otherwise an honest definition-only notice). Fixtures mode
  stays the offline default. 36 new client/converter/preview tests; full
  HTTP → convert → compile loop verified end to end (369/369 tests green).

#### Runbook — capture a real export (at a PC with AWS CLI v2)

Goal: a complex sanitized real `QUICKSIGHT_JSON` bundle, with all dependencies and
capture provenance, to extend coverage beyond the simple AWS pie-chart sample.
Use `loadQsBundle` to inventory the archive; the synthetic loader remains separate.

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

What happens next: compare the archive with the observed schemas in
`docs/research/bundle-format.md`, extend the distinct camelCase bundle types from
new evidence, and add acceptance/preservation tests. Keep API response captures in
separate contract fixtures. Retain existing regression fixtures and add complex
exports separately. Underlying test data must be provided separately; asset exports
do not contain it.

> **Public-repo hygiene.** This repository is public. Never commit real account
> IDs, ARNs, credentials, hostnames, or customer data. The commands above use
> placeholders (`YOUR_ACCOUNT_ID`, …) — keep it that way. Any real export kept
> as a fixture must be redacted first: replace account IDs/ARNs with example
> values and strip connection details.

### Phase 1 — Vertical slice

**Entry gate:** a sanitized real export with dependencies, provenance and observed
archive/member documentation (§3.1). This gate is **satisfied for initial import**
by the sanitized AWS sample. Complex-feature, export, API and source-conformance
gates remain open; synthetic regression tests do not establish those capabilities.

- Archive/resource dispatch and real acceptance/JSON preservation tests are implemented
  for the four observed types. Expand from complex exports and implement a production
  export adapter with AWS import verification before freezing archive types.
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

### Phase 1b — BI builder (authoring canvas) — NEW, pulled forward 2026-09-26

Tom: "This is what QuickSight looks like. We need to get the bi builder."
The definition explorer proved we can read and render definitions; the builder is
the product. The reference UX is the QuickSight analysis editor: fields panel,
visual-type picker, field wells, canvas with live preview.

**Builder v0 scope** (`packages/web`, new "Author" mode alongside fixtures/api):
- Dataset: the synthetic sales dataset (`order_id, order_date, region, category,
  revenue, profit`). Fields panel lists dimensions vs measures with types.
- Visual types: the five the compiler supports — bar, line, pie/donut, KPI, table.
- Field wells per type (click-to-assign, mobile-first; drag-drop later):
  bar → category + values; line → x-axis + values; pie → category + values;
  KPI → values; table → group-by + values. Wells show assigned fields, removable.
- Canvas: stacked visual cards (add / configure / remove / reorder). Each visual
  compiles live through the existing compiler — same preview, empty and error
  states as the explorer.
- Data boundary (same as API mode): precomputed fixture rows only; the query
  engine is not behind HTTP yet, so no live queries in v0.
- Save: authoring state serializes to camelCase bundle-format visual definitions
  (the compiler's input shape), validated against bundle-parser types; export as
  downloadable JSON; draft persists to localStorage.
- Out of scope for v0: drag-drop, filters, parameters, calculated fields, themes,
  grid layout, multi-sheet, undo/redo, server-side save.

**Acceptance:** well-assignment → definition serialization tests, compiler
round-trip on authored definitions, UI state tests; full suite green; single-file
demo rebuilt with the builder included.

### Phase 1c — Live query API — NEW 2026-09-26

Tom approved making builder data real: any field assignment should compute
actual aggregations instead of serving precomputed rows.

**Scope:**
- `packages/api` gains `POST /api/datasets/{datasetId}/query`. The request
  mirrors the query-engine `PlanRequest` (dimensions with optional MONTH
  granularity, measures with SUM/AVG/COUNT/MIN/MAX, static row filters) — an
  OpenSight-local shape, not the QuickSight API; documented as such.
- Dataset allowlist: only datasets with resolved local-CSV bindings (the sales
  dataset). Unknown or unresolved datasets → 404 with an honest message.
- Success → `{ columns, rows }`. Unsupported features → 422 carrying the
  engine's error code and message — an honest "can't compute", never silent
  wrong data. No auth in this slice (local dev); documented.
- `packages/api` depends on `@opensight/query-engine`. DuckDB native module
  runs on this machine; Lambda packaging stays a later D11 concern.
- `packages/web` Author mode: when wells are assigned, POST the query and
  render live rows; on 422 show the honest unsupported state; fixtures mode
  keeps precomputed rows for offline use.
- Static single-file demo keeps fixture rows in Author mode (no engine in a
  static file); the boundary is documented in the demo.

**Out of scope:** Postgres live scans (needs D8 gates), RLS/CLS, a
QuickSight-compatible query API shape, result caching, DuckDB-WASM.

**Acceptance:** API endpoint tests (200 / 404 / 422), web live-data path
tests, full suite green, demo rebuilt.

### Phase 1d — Builder v1 (QuickSight-parity authoring UX) — NEW 2026-09-27

Tom: "This still looks a long way from the quicksight analysis builder ui"
(with a screenshot of the QuickSight analysis editor). The v0 builder proved
the authoring loop; v1 closes the UX gap toward the reference: three-panel
layout, field-well pills, free-position canvas, sheets, pivot tables.

**Scope** (`packages/web` Author mode):
- **Three-panel layout**: left Data panel (dataset selector, field search,
  dimensions/measures with type icons, "+ CALCULATED FIELD" button); middle
  Visual build panel (visual-type gallery with icons, ADD, change-visual-type,
  field wells rendered as removable pills); right Properties panel
  (per-visual display settings; totals/subtotals toggles for pivot/table).
- **Free-position canvas**: drag + resize visual cards on a sheet grid
  (react-grid-layout, MIT). Layout persists per sheet in the authoring state.
- **Sheet tabs**: multiple sheets per analysis (add / rename / delete), each
  with its own visuals and layout.
- **Visual types**: add pivot table (compiler support: row/column
  dimensions, values, subtotals) alongside bar, line, pie/donut, KPI, table.
- **Calculated field editor**: dialog with expression text input; new field
  appears in the Data panel and is usable in wells (expression passthrough,
  same semantics as the bundle parser).
- **Filters (minimal)**: per-visual category multi-select filter pills;
  applied as static row filters through the live query API.
- **Top toolbar**: analysis title (editable), sheet actions, JSON export
  (existing), API/fixtures mode indicator.
- Keep from v0/v1c: live query on well assignment, localStorage drafts,
  downloadable JSON (camelCase bundle-format visual definitions validated
  against bundle-parser types), fixtures mode in the static demo.

**Out of scope for v1:** drag-drop field assignment (click-to-assign stays),
parameters UI + controls, cross-visual filtering, themes, undo/redo,
conditional formatting, server-side save, paginated reports.

**Acceptance:** layout/well/pill interaction tests, pivot compiler tests
(row/column/subtotal), drag-resize layout persistence tests, calculated-field
round-trip tests, filter application tests; full suite green; single-file demo
rebuilt with builder v1.

### Phase 1e — Bundle round-trip (import .qs → edit → export) — NEW 2026-09-27

The parser and the builder are two halves that don't touch. Round-trip makes
them one product: import a QuickSight asset-bundle export, edit it visually,
export it back out.

**Scope:**
- **Import UI** (Author mode): file picker + drag-drop for `.qs` ZIP files
  (also accept single bundle-JSON members). Parsed client-side with the
  existing `parseQsBundle` (`@opensight/bundle-parser` is already a web
  dependency). Zip bomb limits already in the parser apply.
- **Bundle → authoring state**: sheets become sheet tabs; visuals become
  cards with wells populated (dimensions/measures mapped to fields where the
  dataset resolves); parameters, filter groups, and calculated fields
  imported into their respective panels (read-only where v1 has no editor).
- **Import report**: modal listing what imported cleanly and what didn't —
  unsupported visual types or features are named honestly, never silently
  dropped.
- **Dataset binding**: imported visuals reference dataset ARNs/IDs we don't
  have. Unresolved bindings show an honest placeholder state; user can
  **remap a visual to the local sales dataset** (field-name matching where
  possible, manual well assignment otherwise) to get live data.
- **Export**: authoring state serializes to bundle-format JSON
  (camelCase, per-resource members per `STRUCTURAL_NOTES.md` conventions);
  **"Download .qs"** assembles a real ZIP client-side (MIT-licensed zip
  library — jszip or equivalent; verify license). Exported members validate
  against bundle-parser types.
- Static demo: import works fully client-side (no server needed); export
  downloads the file.

**Out of scope for 1e:** cross-account dataset resolution, theme import,
paginated-report visuals, parameter UI editing (display only), server-side
bundle storage.

**Acceptance:** round-trip tests (synthetic fixture `.qs` → import →
export → re-import; structural equality modulo documented extensions),
import-report tests (unsupported visual named, not dropped), ZIP assembly
tests (member paths/IDs consistent), dataset remap tests; full suite green;
demo rebuilt.
- Analysis authoring UI (basic).

### Phase 2a — Parameters & controls (interactive) — NEW 2026-09-27

Phase 1e imports parameters and filters into the builder as display-only.
Phase 2a makes them live: this is the slice of Phase 2 (Expression &
interactivity) that turns the builder from a static layout tool into an
interactive dashboard author.

**Scope:**
- **Control types**: dropdown (single + multi-select), numeric slider,
  date picker, text input — each bound to a declared parameter.
- **Parameter model**: extend the authoring state (string, number,
  datetime; single/multi-value per QuickSight semantics). Parameters
  created in the builder, imported from bundles, or both.
- **Wiring**: parameter values feed (a) visual filters as dynamic values,
  (b) calculated-field expressions referencing parameters, (c) control
  defaults and cascading (one control's selection narrowing another's
  options where the data supports it).
- **Controls UI**: QuickSight-parity controls strip above each sheet;
  add/remove/reorder controls; bind each control to a parameter.
- **Live update**: changing a control re-queries affected visuals through
  the live query API (debounced; parameter bindings validated against
  declared parameter types in the strict request allowlist). Fixtures
  mode recomputes client-side. Show a pending state on visuals while
  re-querying; never show stale data as current.
- **Import/export**: parameters/controls imported by the round-trip
  become live; export serializes them back to bundle format
  (parameters, filter groups referencing parameters, controls).

**Out of scope for 2a:** cross-visual filter actions (2b), drill-down
(2b), full calculated-field function library (2c), remaining visual
types and themes (2d), server-side parameter defaults.

**Acceptance:** control→parameter→filter→requery tests (live API and
fixtures mode), debounce and pending-state tests, parameter type
validation tests (bad bindings rejected), bundle round-trip tests with
parameters/controls, import-report coverage for controls; full suite
green; demo rebuilt.

### Phase 2b — Cross-visual filter actions & drill-down — NEW 2026-09-27

The second slice of Phase 2 (Expression & interactivity): visuals stop
being islands. Interacting with one visual filters the others, and
dimension hierarchies can be drilled.

**Scope:**
- **Filter actions**: click a bar segment / pie slice / table row, or
  brush a time range on a line chart, to filter other visuals on the
  sheet. Per-action configuration: which visuals are affected (all or
  selected), which fields the selection maps to. Clear-action control.
- **Drill-down**: dimension hierarchies (e.g. Year → Quarter → Month,
  Region → Country → City); drill up/down with breadcrumb on supported
  visuals. Hierarchies definable in the builder and imported from
  bundles where present.
- **Modes**: live query mode (actions/drill become query filters via
  the API) and fixtures mode (client-side recompute). Pending states
  while re-querying; never stale-as-current.
- **Honest states**: visuals that can't originate or receive an action
  (e.g. KPI as a target of a category filter it doesn't group by) say
  why, in the action configuration UI.
- **Import/export**: filter actions and drill hierarchies import from
  bundles and serialize back to bundle-format JSON (camelCase, per
  STRUCTURAL_NOTES.md conventions).

**Out of scope for 2b:** full calculated-field function library (2c),
remaining visual types and themes (2d), URL actions / navigation actions.

**Acceptance:** action→filter→requery tests (live + fixtures), drill
up/down/breadcrumb tests, hierarchy definition tests, bundle
round-trip tests with filter actions and drill config, honest-state
tests for non-participating visuals; full suite green; demo rebuilt.

### Phase 2c — Full calculated-field function library — NEW 2026-09-27

The third slice of Phase 2 (Expression & interactivity): calculated
fields grow from the v1 expression subset to the full QuickSight
function library, evaluated identically in every engine.

**Scope:**
- Implement the QuickSight calculated-field function catalog across
  categories: string, numeric, datetime, conditional (ifelse,
  coalesce, nullIf), aggregation (sum, avg, count, distinct_count,
  min, max, median, stdev, var, percentile), table calculations
  (runningSum, periodOverPeriodDifference,
  periodOverPeriodPercentDifference, percentOfTotal, difference,
  percentDifference), level-aware aggregations (sumOver, avgOver,
  countOver, minOver, maxOver with PRE_FILTER / PRE_AGG /
  POST_AGG_FILTER semantics), and type-conversion functions.
- One evaluator shared by the DuckDB path, the Postgres path, and
  the fixtures/client path so all three agree (cross-engine
  differential tests).
- Builder: function reference picker in the calculated-field editor
  with signatures and examples; syntax validation with
  QuickSight-style error messages.
- Bundle import: calculated-field expressions import verbatim;
  unsupported functions are reported honestly in the import report
  (named, per-expression) rather than silently dropped.

**Out of scope for 2c:** remaining visual types and themes (2d);
natural-language expression generation ("Build for me") stays a
Phase 4 investigation item.

**Acceptance:** per-function unit tests against documented QuickSight
semantics, cross-engine differential tests (DuckDB vs Postgres vs
client evaluator agree on the fixture suite), editor validation
tests, import-report coverage for unsupported functions; full suite
green; demo rebuilt.

### Phase 2d — Remaining visual types & themes — NEW 2026-09-27

The final slice of Phase 2 (Expression & interactivity): the visual
gallery grows to QuickSight's catalog and analyses get themes.

**Scope:**
- Renderer: add scatter plot, combo (bar+line), stacked 100% bar,
  area, funnel, gauge, treemap, heatmap, box plot, word cloud, radar chart, sankey diagram, waterfall chart,
  histogram, and geospatial (filled/point map — dependency-free or
  MIT/Apache-2.0 only; no commercial map tiles at runtime).
- Builder: all new types in the visual-type gallery with field-well
  definitions, live preview, and honest per-type capability notes
  (e.g. map needs geo fields).
- Themes: analysis-level theme (colors, fonts, background), the
  QuickSight "NEW LOOK" light/dark treatment, per-visual palette
  overrides; theme import/export in bundle JSON.
- Look-and-feel pass against `lookfeel-references/`: close the
  toolbar gap (File/Edit/Data/Insert/Sheets/Objects/Search menus,
  PUBLISH, FIT TO WIDTH affordances as honest stubs where no backend
  exists yet) and deepen the Properties panel (display settings,
  headers/cells/total/subtotal, row/column/value names, conditional
  formatting).

**Out of scope for 2d:** Q-style natural-language features (Phase 4);
pixel-perfect QuickSight CSS (ongoing).

**Acceptance:** compiler tests for every new visual type (options
shape + pinned-row rendering), builder gallery/well tests, theme
apply/round-trip tests, import-report coverage for unsupported
visuals, screenshot comparison against the 2c baseline and the
QuickSight references; full suite green; demo rebuilt.

### Phase 3 — Enterprise surface

#### Phase 3a — Scheduled refresh, email reports & alerts — NEW 2026-09-27

The first slice of Phase 3: analyses stay fresh and stakeholders get
notified without opening the product.

**Scope:**
- **Scheduled refresh**: per-dataset refresh schedules (interval,
  daily/weekly at a time, timezone-aware) against the DuckDB engine;
  refresh history and status per dataset; honest states when a source
  is unreachable (named error, last-good timestamp, never silently
  stale).
- **Email reports**: dashboard snapshots rendered server-side and
  sent via configured SMTP; per-user subscriptions with schedules;
  SMTP strictly via environment config — never in the repo, never in
  tests (stub transport in tests).
- **Threshold alerts**: alert rules on KPI/visual metrics (crosses
  above/below, percent change); evaluated on refresh; email
  notification first, webhook payload shape defined for later.
- All modeled as API resources (CRUD + run history) with validation;
  static demo shows honest "not configured / needs hosted API" states.

**Out of scope for 3a:** row/column-level security (3b), embedding
SDK, folders, sharing APIs (3c).

**Acceptance:** scheduler tests (fake timers), refresh history/status
tests, email assembly tests with stub transport, alert evaluation
tests, API resource validation tests; full suite green; demo rebuilt.

#### Phase 3b — Row/column security & namespaces — NEW 2026-09-27

The second slice of Phase 3: data governance. Until this ships,
protected datasets stay rejected (§3.4 fail-closed rule).

**Scope:**
- **Row-level security**: dataset rules mapping users/groups to row
  predicates; enforced in the query planner for DuckDB and Postgres
  paths (predicates pushed into SQL, never client-side); rule CRUD
  as API resources with validation.
- **Column-level security**: per-column grants (allow/deny) by
  user/group; denied columns rejected at query plan time with a
  named error, never silently dropped.
- **Namespaces**: multi-tenant namespaces for users, groups, assets;
  namespace-scoped asset listing and isolation tests.
- Enforcement tested against bypass attempts (direct query API with
  forged principals fails closed).

**Out of scope for 3b:** embedding SDK, folders, sharing APIs (3c).

**Acceptance:** RLS predicate tests (both dialects), CLS grant/deny
tests, namespace isolation tests, bypass-attempt tests (fail closed),
API validation tests; full suite green; demo rebuilt.

#### Phase 3c — Folders, sharing, embedding — NEW 2026-09-27

The final slice of Phase 3: asset organization and consumption.

**Scope:**
- **Folders**: folder CRUD as API resources; asset move/copy between
  folders; folder-level permissions inherited from namespace grants.
- **Asset sharing APIs**: share analyses/dashboards with users/groups
  (viewer/co-owner roles); revocation; share-listing endpoints.
- **Embedding SDK**: client-side SDK for embedding dashboards/visuals
  (URL signing, single-sign-on hooks as documented stubs against the
  3b principal model); embed URL generation endpoint.

**Acceptance:** folder CRUD/move tests, share/revoke tests, embed URL
signing tests, API validation tests; full suite green; demo rebuilt.

### Phase 4 — Parity & beyond
- Paginated reports, Q-like natural language (investigate, don't commit).
- Distributed query investigation (only if evidence demands it).
- Hosted reference deployment (Docker Compose / Helm) — superseded by the H0–H12
  rollout (D14); the single-node reference is slice H8.

**Tom's decisions, 2026-09-30:**
- Paginated reports: yes, eventually — future polish item, not a priority. Not queued as
  buildable work (do not file as an issue; the build loop would pick it up).
- Generative natural language: yes. Provider-config UI already ships (OpenAI, Anthropic,
  OpenAI-compatible; Bedrock stubbed pending AWS approval). Remaining work is a live API
  key + Bedrock/AWS decision, not new code.
- Hosted multi-tenant option: yes — the most important item and the long-term vision.
  Embeddable/white-label like QuickSight. Spec the hosted architecture first (tenancy model,
  isolation, embedding API, scaling plan), then slice into buildable issues. This overlaps
  the Phase 5 trigger ("decision to operate OpenSight as a hosted service").

### Phase 5 — Hosted & scale-out — FIRST TRIGGER MET, SCALE-OUT NOT SCHEDULED

The first trigger was met 2026-09-30: the owner decided to operate OpenSight as
a hosted multi-tenant service (D14). Per the hosted spec's §5, that trigger
schedules the *hosted correctness foundation* (H1–H8: tenant metadata, verified
sessions, data authorization, budgets, embedding, automation, single-node
reference) — not the distributed implementation. The remaining triggers are not
met: H9–H12 (shared Parquet artifacts, distributed refresh, replica safety,
supporting-service HA) stay unscheduled until measured load or an approved
availability target demands them.

**Triggers:** decision to operate OpenSight as a hosted service — met 2026-09-30,
schedules H1–H8; a deployment whose concurrent query load exceeds one node —
not met, schedules H9–H10; an HA requirement no single node can meet — not met,
schedules H12.

**Scope when triggered (per D13):**
- Blaze snapshots move from in-process heap to content-addressed Parquet
  artifacts on shared object storage (`blaze/{dataset}/{generation}.parquet`),
  loaded into per-node local memory (DuckDB memory-map, already a dependency).
  The `refresh(key, load)` / `read(key)` seam is the portability boundary —
  execution modes, refresh lifecycle, named errors, and UI do not change.
- Refresh coordination: distributed locks so one node runs each scheduled
  refresh; invalidation pub/sub so one node's invalidation reaches all nodes
  (Redis or equivalent — coordination only, never the snapshot store).
- Same treatment for the other single-process state: metadata store, session/
  auth state, refresh scheduler.

**Explicitly not in scope now:** no distributed-systems work is scheduled in
Phases 0–4. D13 exists so this phase is a swap, not a redesign.

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
├── fixtures/                 # synthetic regression specs + sanitized real export
├── packages/
│   ├── api/                  # QuickSight-compatible REST API (Phase 1)
│   ├── web/                  # React renderer + authoring (Phase 1)
│   ├── bundle-parser/        # observed ZIP import + separate synthetic inventory
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
tests, not renderer, QuickSight result or remote-pushdown conformance.
The parser also accepts the real four-member `.qs` fixture, checks IDs, camelCase
pie field wells and summaries, and preserves every member's JSON through test ZIP
repacking. Located malformed-member and ZIP error regressions, public camelCase
consumer typechecks and fixture account/ARN hygiene checks cover this import boundary.

**Required as the corresponding runtime is implemented:**

1. **Archive acceptance/round trip:** load the sanitized real export, dispatch every
   observed resource, then export and compare member structure, unknown fields,
   omitted properties and dependency references. Initial acceptance and test repacking
   pass for the AWS sample; a production exporter and AWS reimport remain pending.
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
| OQ-2 | Real bundle samples | **Initial import unblocked:** sanitized AWS sample and observed schemas checked in. Tom's complex export still needed for nonempty calculations/parameters/filters, additional visuals, security and other resource types. |
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

---

## 11. Deployment (AWS) — spec, 2026-09-26

**Target:** a live OpenSight Tom can open on his phone — no tunnels, no local
servers. Owner-approved direction; not yet built.

**Topology (all free-tier to start):**
- **Frontend** (`packages/web`): S3 static hosting + CloudFront. The Vite build
  already produces a static bundle; the single-file demo build proves the app
  runs with no server beyond API calls.
- **API** (`packages/api` + `@opensight/query-engine` with the Postgres
  executor): Lambda + API Gateway (HTTP API). The API is already stateless
  plain `node:http` with no framework — it ports to a Lambda handler with a
  thin adapter. No DuckDB native module in the Lambda package (that was the
  D11 packaging risk; D12 removes it).
- **Data** (D12): RDS `db.t3.micro` Postgres, free tier for 12 months. Holds
  datasets (migrated from local CSVs) and, later, metadata. Aurora Serverless
  v2 is the graduation path, same engine.
- **Total idle cost:** ~$0 (S3/CloudFront/Lambda/API Gateway free tiers;
  RDS free tier). The only metered cost is real usage.

**Deploy pipeline — two routes, owner's choice:**
1. **GitHub Actions (recommended):** push to `master` → build workspaces →
   run full test suite → deploy frontend to S3 + invalidate CloudFront →
   package and deploy Lambda → run smoke tests against the live URL. Push-to-
   deploy, full history, no local AWS tooling needed after setup.
2. **AWS CLI (manual):** same steps run by hand from an authorized machine.
   Faster to first deploy, but every release is manual.

**Prerequisites (owner actions):**
- AWS account access for deployments. No keys in chat, no keys in the repo —
  GitHub Actions uses OIDC (short-lived credentials, no stored secrets) where
  possible; the CLI route uses a named profile on an authorized machine.
- GitHub Actions workflow files cannot be pushed with the current PAT
  (`public_repo` scope only — API 404s on `.github/workflows/*`). The workflow
  must be added through the GitHub web UI or a re-scoped token. The pending
  CI workflow precedent is documented in `~/workspace/goals/opensight/
  hidden_files/ci-workflow-pending.yml`.
- Nothing is provisioned and no money is spent until the owner explicitly
  approves the build phase.

**Build order when approved:**
1. Query-engine Postgres executor + dialect pass (replaces DuckDB for the
   hosted path; DuckDB stays for local dev/test).
2. Lambda handler adapter for `packages/api` (keep `node:http` locally).
3. IaC for S3/CloudFront/API Gateway/Lambda/RDS (CDK or Terraform — decide at
   build time; keep it minimal and free-tier-pinned).
4. GitHub Actions pipeline (or AWS CLI runbook) + live smoke tests.

## 12. Issue #11 — multi-input dataset preparation (decided 2026-09-29)

This additive contract extends the existing version-1 prep pipeline. Existing
string input IDs and explicit right-column aliases retain their behavior. Right
outer joins already exist; this work completes reusable inputs and join editing.

**Input references and graph.** `PrepPipeline.input` accepts a connected source ID
(string) or `{dataset: dataSetId}`. A join's `config.source` accepts either of those
or `{step: stepId}`, referring only to an earlier step in the same pipeline.
The preceding step is always the left relation. Earlier results, including joined
results, may also be reused on the right. The canvas derives one input node per
unique source reference, with labeled connections to the main input or consuming
join(s); previous-step references connect to that step, not a fabricated source.
There is no separate editable inputs registry or duplicated pipeline data. Raw
source IDs, dataset IDs and step IDs occupy distinct reference namespaces. Moving
or deleting a referenced step leaves an explicit invalid-reference error until
repaired. Append, pivot and unpivot configuration/semantics are unchanged.

**Reusable prepared datasets.** Dataset references resolve to the current saved
pipeline owned by the authenticated user in the same namespace, never to cached
rows. The compiler expands them as SQL relations without inner preview limits or
datetime formatting. Dependencies are validated on every preview/save, including
steps after the selected preview stage. Missing/deleted/expired sources,
protected bindings, cycles (including replacing a dataset with a self-dependent
version), and cross-engine/connection combinations fail closed with named errors.
Expansion is bounded to 16 nested datasets and 500 total transformation steps per
compilation; each distinct dataset is compiled once. Cycles/invalid earlier-step
references use `INVALID_PREP_PIPELINE`; expansion limits use
`PREP_LIMIT_EXCEEDED`. Trusted host bindings still authorize every physical leaf.
References carry no connection strings, table names, authorization assertions or
cache settings, allowing future host-side source resolution for #12 without
pretending caching is available now.

**Join keys and outputs.** Inner, left, right and full outer equijoins accept one
or more `{left,right}` key pairs combined with AND. Keys must have identical prep
types (including INTEGER versus DECIMAL); users can add Change type explicitly.
Missing columns/type mismatches use `PREP_SCHEMA_MISMATCH` with the key and types
identified. Repeated identical key pairs are invalid. SQL null keys never match;
duplicate keys multiply rows. All left columns are retained, with null extension
for unmatched right rows. Right keys are retained only through the chosen output
mode; keys are never implicitly coalesced.

A join specifies exactly one output mode: existing nonempty
`columns: [{column,name}]`, or `prefix: 'right_'`, which includes **all** right
columns (including keys) in source order with that literal prefix. No automatic
suffixes or silently omitted columns. Generated names must satisfy the existing
128-character limit, and the combined schema must contain at most 256 columns.
Duplicate/case-ambiguous names (including collisions with left columns) fail with
`PREP_SCHEMA_MISMATCH`; explicit aliases can resolve them. Prefix is nonempty.

**Editor and hosted API.** The source picker distinguishes uploaded/connector
sources, saved prepared datasets, and earlier steps. Join keys show column types
and visible named validation errors while editing. Users choose prefix-all or
explicit aliases and can inspect resulting names before applying. Applying a
valid join automatically previews that stage through the existing hosted preview
endpoint before saving, bounded to 100 displayed rows (API maximum 500). The API
source listing includes owned prepared dataset summaries with derived columns;
unavailable dependencies report an availability error code. Saving persists only
pipeline metadata. Static-demo sample schemas permit multi-input configuration
and export, but live previews/saves say “Needs hosted API.” Dependency updates are
resolved afresh; the editor refresh action reloads source and dataset metadata.

**Portability and verification.** JSON and `.qs` import/export preserve all typed
references, join modes and step order; imports grant no source access. Bundle
members keep unrelated properties. Dependency datasets must be saved/rebound on
the destination host; importing a bundle does not automatically save them.
Verification includes all join types, composite/null/duplicate keys, mismatched
and missing keys, collisions and bounds, self/previous/prepared joins, subsequent
transforms, parameter/preview isolation, actual DuckDB-versus-Postgres (PGlite)
execution, authenticated API ownership/cycle/expiry checks, UI editing/errors and
bundle round trips. Rebuild the static demo and compare screenshots with available
references; record limits honestly. No new dependency, AWS call, merge, publish or
issue closure is part of this build.

## 13. Issue #12 — Blaze prepared dataset execution (decided 2026-09-29)

**Scope and modes.** Owned, saved prep datasets gain host-side `DIRECT_QUERY` or
`BLAZE` execution settings, separate from portable pipeline metadata. Existing
simple pipelines default to direct. Blaze is an ephemeral, in-process columnar scalar
store on the self-hosted API; no service, extension download, new dependency or AI
provider is involved. This implements the in-memory slice of D8, superseding its
proposed Parquet storage for this slice. Restart preserves configured modes and
intervals when the prep metadata store is configured, but never persists rows or
claims that a previous process's cache is ready.

**Issue #15 materialization contract.** Cross-source joins and advanced prep steps
(`pivot`, `unpivot`, `append`, `aggregate`) MUST materialize through Blaze before
serving saved output rows or visual queries. Single-source simple pipelines may
continue compiling to live SQL. The host checks the saved dependency graph:
advanced steps in reusable pipelines cannot bypass this rule; distinct connected
source IDs or distinct cached dataset inputs count as separate sources. Reusing
the same source or an earlier step alone does not make a join cross-source.
Save, dependency changes and startup promote required datasets to Blaze (manual
refresh by default), without automatically executing the pipeline. Selecting
DIRECT_QUERY for a required dataset fails with `BLAZE_MATERIALIZATION_REQUIRED`;
output routes enforce the rule independently. Execution status and prep controls
explain the requirement. Bounded draft previews remain available for editing and
validation; they do not publish dataset output or satisfy materialization.
Existing cross-engine limits still apply: materialize PostgreSQL inputs separately
before joining them to file/cached inputs in the local engine.

**Materialization and reads.** Manual refresh executes the complete saved pipeline
(including joins/aggregations, without a preview limit), normalizes typed output,
and publishes a complete snapshot only after validation and bounds checks. Source
results are consumed in bounded batches, with SQL scalar-size guards before driver
transfer. Cached query execution uses the existing shared visual planner/evaluator;
supported numeric/string/datetime fields retain shared semantics. Boolean columns
remain available in prep/cached previews and joins; the existing visual query
surface rejects unsupported Boolean fields by name. Direct queries execute the
current pipeline against its source, subject to the same bounded result intake.
`POST /api/datasets/:id/query` supports owned prepared datasets and returns explicit
execution provenance; `GET /api/datasets/:id/execution`, `PUT` on that resource
(`mode`, `intervalMinutes`, null disables scheduling), and `POST .../refresh`
manage execution. `GET .../rows` returns at most 100 output rows and provenance.
The existing `/prep/preview` always previews a draft's source execution and labels
any cached dependencies; it is not a read of the root dataset's Blaze snapshot.
The reserved fixture ID `sales` cannot be saved as a prepared dataset.

**Honesty and failure.** Every cached result carries mode, cached flag, snapshot
refresh time and dependency refresh times. Direct results with cached join inputs
identify those inputs and never claim all-live data. Status exposes last success,
row count, accounted bytes, state and named errors. Running refreshes block reads
(`BLAZE_REFRESH_IN_PROGRESS`); failed refreshes drop readable rows and block reads
(`BLAZE_REFRESH_FAILED`, with a safe cause code; invalid definitions use
`BLAZE_PIPELINE_INVALID`). There is no fallback to source or stale rows. Missing,
evicted or invalidated snapshots use `BLAZE_NOT_READY`, `BLAZE_EVICTED` or
`BLAZE_INVALIDATED`. Last-success timestamps are diagnostic history, never evidence
that an unavailable cache is readable. Switching direct discards the snapshot.
Saving/deleting a pipeline or changing its mode invalidates dependent snapshots;
generation checks prevent a concurrent refresh from publishing obsolete output.

**Limits and refresh scheduler.** Environment-only server limits default to
`OPENSIGHT_BLAZE_MAX_BYTES=67108864`,
`OPENSIGHT_BLAZE_DATASET_BYTES=16777216`,
`OPENSIGHT_BLAZE_MAX_ROWS=100000`, and
`OPENSIGHT_BLAZE_CELL_CHARS=16384`. Configuration must be positive safe integers,
with dataset capacity no greater than total capacity. Storage charges schema,
column slots and conservative scalar/string overhead (UTF-16), not just JSON
payload size. A single global intake reservation bounds simultaneous materialize
and direct-query intake; overlaps refuse with `BLAZE_BUSY`. Least-recently-read
snapshots are evicted until that reservation fits; the snapshot being refreshed
is released first. Oversized output refuses with `BLAZE_DATASET_TOO_LARGE`, never
truncates or publishes a partial snapshot. SQL execution keeps the existing
10-second timeout and DuckDB memory/no-spill limits. Accounted store capacity is
not an operating-system RSS limit: bounded driver batches, existing upload staging,
SQL working memory and evaluator/result copies have separate overhead, documented
for operators. No unbounded source result arrays are collected before checking.

Intervals are whole minutes, 1–525600, or null. The existing in-process one-second
scheduler checks due datasets, runs refreshes serially, coalesces missed intervals,
and sets the next due time from completion (also after failure); manual success or
failure resets that interval. No overlapping refresh or catch-up storm. It starts
with the API listener and stops on close; scheduled execution rechecks the owner's
current build capability. Restart begins empty and schedules the first refresh one
interval after startup. Manual refresh is available immediately.

**Reusable inputs and security.** This extends §12's direct-only dataset resolution:
a trusted host binding may substitute a ready Blaze snapshot for a dataset relation.
The existing `{dataset: id}` join API stays unchanged. Cached inputs run as bounded
temporary DuckDB relations using their stored schema; no source scan or pipeline
expansion occurs across a cache boundary. File/direct and cached joins, including
all-cached joins whose original sources were PostgreSQL, run locally. A direct
PostgreSQL relation mixed with a cached relation still fails the existing
cross-engine check; materialize both sides first. Ownership/namespace resolution,
protected-source refusal and graph validation remain fail-closed. Cache metadata
from HTTP bodies or imported bundles never grants access. Root refresh revalidates
its current pipeline and resolves dependencies anew. Source expiry does not erase a
valid standalone snapshot, but a refresh fails visibly if its sources are missing.

**UI and verification.** Prep shows mode, schedule, manual refresh, status, refresh
time, row count and a labeled cached-output view. Source pickers/canvas show execution
mode and cached dependency times. DatasetHeader accepts prepared dataset identity
and execution metadata for data-panel use while retaining the existing local sample
badge and sales flow; attaching arbitrary prepared datasets to the analysis editor
remains outside this issue's publication scope. Static mode disables hosted controls
and says “Needs hosted API”; its sample import is explicitly offline. Tests cover
full output, shared query semantics, source-free reads/joins, isolation/bypasses,
refresh failure and invalid pipelines, bounds/LRU, invalidation/races/restart and
fake-timer scheduling. Rebuild and screenshot-compare the demo; refresh affected
README screenshots. The sweep owner handles the hero GIF, merge, publish and issue
closure; this branch does none of those actions.

## 14. Issue #18 — prep divergent paths: branching from a single step (decided 2026-09-29)

This additive contract extends the version-1 prep pipeline from §12. Existing
linear pipelines validate and execute exactly as before; branching is opt-in
per step. QuickSight's new experience supports divergent paths — up to 5 paths
from a single step (e.g. one cleaned table feeding both an aggregate path and a
detail path). OpenSight adopts the same 5-path fan-out cap and a stricter
explicit-output model instead of QuickSight's implicit main-path selection.

**Graph model.** A step may name its left input explicitly via optional
`from: string` on `PrepStep`, referencing an earlier step in the same pipeline.
Default (unchanged): a step's left input is the preceding array element, and the
first step reads the pipeline input. Branching is any deviation from that
default — two or more steps whose resolved left input is the same step, or a
step whose `from` is not its immediate predecessor. The join right-side
`{step: id}` references from §12 keep working alongside `from`.

**Validation (fail closed).** `from` must name a step that appears strictly
earlier in `steps[]` — cycles are impossible by construction. Unknown,
later-or-equal-position, or self `from` references fail with
`INVALID_PREP_PIPELINE`; a first step may not carry `from` at all. Moving or
deleting a referenced step leaves an explicit invalid-reference error until
repaired, exactly like §12's join step references. Each step's left input is
resolved independently of array position, so array order must remain
topological (a step after its `from` and after any join-source step ref).
Disconnected steps — branches that feed nothing and are not the output — are
allowed and render as detached branches, not errors. At most **5 direct
downstream consumers** per step (resolved left inputs plus join right-side
`{step:}` refs); violations fail with `PREP_LIMIT_EXCEEDED`. `from` reuses
earlier results and never counts against the 32 import-step budget.

**Output selector.** Optional pipeline-level `output: string` names the output
step; default is the last step in array order (today's behavior). `output` must
name an existing step, else `INVALID_PREP_PIPELINE`. The compiler selects the
output stage for saved output and full-pipeline execution; the existing
`through` compile option remains the per-preview override (an explicit `through`
wins for that preview, otherwise `pipeline.output ?? last step`). Deleting the
output step resets `output` to the new last step. For Blaze materialization
(§13/#15), the mandatory-materialization rule is evaluated on the output path;
advanced steps on non-output branches keep bounded draft previews but never
publish saved output.

**Compilation.** Each step still compiles to exactly one CTE; shared upstream
stages are naturally reused by multiple consumers, so branching adds no new
compilation machinery beyond resolving each step's left input from
`from ?? previous step`. All steps still compile (not only the output path) so
every stage keeps valid columns and previews. Stage metadata (`stages[]`)
already keys previews by step id, so each path previews independently with no
schema change. Dialects, 50-step, and 500-expanded-step budgets are unchanged.

**Editor and hosted API.** The canvas renders the transformation graph as a DAG
(nodes: input + steps; edges: resolved left inputs) instead of the current
strictly ordered list; join/append secondary-source connections keep their
existing labeled rendering. Each step node offers **Add branch** (appends a new
step with `from` set to that step) and **Set as output** (moves the output
marker). The output step carries an explicit Output marker; selecting any step
previews that stage independently. `from`, fan-out, and output validation
errors surface as visible named errors and fail closed on save/preview. Static
demo permits branching configuration on sample schemas; live previews and
saves say “Needs hosted API” as today.

**Portability and verification.** JSON and `.qs` import/export preserve `from`
and `output`; the validator runs on import and grants no source access.
Verification: linear-default regression (byte-identical plans), `from` chains,
5-consumer cap (including join right-side refs), invalid `from` variants,
output default/override/delete-reset, delete-referenced-step repair errors,
import/export round trips, actual DuckDB-versus-Postgres execution of a branched
pipeline, UI branch creation/DAG rendering/per-path previews/output marker
moves/error states, bundle round trips. Rebuild the static demo and compare
screenshots; refresh the README hero GIF and affected feature screenshots —
branching changes user-visible UI. Update `docs/data-prep.md` (branching
semantics, output selector, the 5-consumer limit row). No new dependency, AWS
call, merge, publish or issue closure is part of this build; the sweep owner
handles those.
