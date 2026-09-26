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

1. **Compatibility first.** The QuickSight bundle format is the canonical interchange
   model. Internal representations must not drift from it without a documented reason.
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

The bundle JSON schema (as documented by `DescribeAnalysisDefinition`,
`DescribeDashboardDefinition`, etc.) is the canonical model. Internal storage may
normalize it, but export must reproduce it byte-equivalent in structure.

> **Phase 0 task:** capture real exports and document the exact schema, including the
> manifest/zip layout of export jobs. The sample fixture in `fixtures/` is reconstructed
> from AWS API documentation and must be replaced with a real export.

### 3.2 API compatibility (growing subset)

Implement QuickSight API actions with identical request/response shapes, starting with
read paths (`DescribeAnalysis`, `DescribeDashboard`, `ListAnalyses`, …) and growing toward
create/update. Versioned explicitly: the doc records which API version we track and which
actions are implemented.

### 3.3 Rendering fidelity

The conformance suite (Section 8) imports real bundles and compares rendered visuals
against QuickSight screenshots / data outputs. Fidelity is measured, not asserted.

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
│ bundles  │   export   │               │  query pushdown)          │  │
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

1. Web UI requests dashboard definition from API (QuickSight-compatible shape).
2. API resolves datasets → query planner builds SQL, compiling calculated fields,
   filters, and parameters into DuckDB SQL.
3. DuckDB executes against cached marts (SPICE equivalent) or pushes down to the
   live source (direct-query mode).
4. Results return; UI renders visuals with ECharts.

**Components and their homes in the repo:**

| Component | Repo path | Notes |
|---|---|---|
| API server | `packages/api` | QuickSight-compatible REST, auth, scheduling endpoints |
| Web UI | `packages/web` | Dashboard/analysis renderer + authoring (later phases) |
| Bundle parser | `packages/bundle-parser` | Import/export of QuickSight bundle JSON (spike → library) |
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
**Status:** proposed (to be confirmed by the Phase 1 spike).

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

**Decision:** Mirror the bundle format as the canonical model.
**Reasoning:** Every adapter layer is a place where fidelity dies. If the internal model
*is* the bundle shape, import/export is near-trivial and round-trip fidelity is
structural, not aspirational. We accept AWS's naming quirks as the price of
compatibility. Deviations, if ever needed, get their own ADR.
**Status:** decided.

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
- Always live pushdown to sources (no cache).
- External cache (Redis/Arrow Flight).

**Decision:** Scheduled materialization into DuckDB, with direct-query mode per dataset.
**Reasoning:** Matches SPICE semantics users expect (refresh schedules, "SPICE capacity"
becomes disk). DuckDB reads Parquet natively, so cached datasets are just files —
simple to reason about, back up, and inspect. Direct-query mode covers live-source
needs without a second system.
**Status:** proposed.

### D9 — Calculated-field expression engine

**Context:** QuickSight has a large proprietary function surface (aggregations like
`sumOver`, date functions, `periodOverPeriod*`, string/conditional logic). This must be
parsed and executed faithfully.

**Options:**
- Hand-written Pratt parser → compile to DuckDB SQL where possible.
- Embed an existing expression language (e.g., adapt a SQL parser like sqlglot).
- Interpret row-by-row in JS (simple, but slow and hard to push down).

**Decision:** Hand-written parser compiling to DuckDB SQL (proposed).
**Reasoning:** Compilation preserves pushdown (filters and aggregations stay in the
engine, not in JS). A Pratt parser is a known-quantity, few-hundred-line component;
the real work is the function library, which grows behind conformance tests, one
function at a time.
**Status:** proposed — spike in Phase 1.

---

## 6. Phased Delivery Plan

### Phase 0 — Learn the format (current)
- [ ] Capture real QuickSight asset-bundle exports (runbook below); document exact schema + zip layout in `docs/research/`.
- [x] Repo scaffold + `bundle-parser` spike (parses a reconstructed sample bundle).
- [ ] Replace sample fixture with a real export.
- [ ] Confirm D2 (TypeScript) with the spike; record API action inventory (which QuickSight
  API actions exist, prioritized for implementation).

#### Runbook — capture a real export (at a PC with AWS CLI v2)

Goal: one real `QUICKSIGHT_JSON` bundle, with all dependencies, to replace the
reconstructed sample fixture and ground the schema docs in `docs/research/`.

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

4. Download promptly (the URL expires) and hand the file to the build agent.

What happens next: the bundle is validated against `bundle-parser`, the exact
schema + zip layout is documented in `docs/research/bundle-format.md`, and a
sanitized copy replaces the sample fixture in `fixtures/`.

Cost: the export is API calls only — no per-job charge. QuickSight bills per user
seat per month, independent of exports.

> **Public-repo hygiene.** This repository is public. Never commit real account
> IDs, ARNs, credentials, hostnames, or customer data. The commands above use
> placeholders (`YOUR_ACCOUNT_ID`, …) — keep it that way. Any real export kept
> as a fixture must be redacted first: replace account IDs/ARNs with example
> values and strip connection details.

### Phase 1 — Vertical slice
- Import a bundle → connect CSV/Postgres → render a dashboard with bar, line, table,
  KPI, pie visuals.
- `query-engine` spike: compile one visual's query (aggregation + filter) to DuckDB SQL.
- D9 spike: parse and compile a handful of calculated-field functions.
- Minimal API: `DescribeDashboard` / `DescribeAnalysis` returning bundle-faithful shapes.

### Phase 2 — Expression & interactivity
- Full calculated-field function library (grown behind conformance tests).
- Filters, parameters, controls, cross-visual filtering, drill-down.
- Remaining visual types; theme support.
- Analysis authoring UI (basic).

### Phase 3 — Enterprise surface
- Scheduled DuckDB refresh (D8), email reports, threshold alerts.
- Row-level / column-level security, namespaces, embedding SDK.
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
├── fixtures/                 # sample bundles (real exports replace reconstructions)
├── packages/
│   ├── api/                  # QuickSight-compatible REST API (Phase 1)
│   ├── web/                  # React renderer + authoring (Phase 1)
│   ├── bundle-parser/        # import/export bundle JSON (spike → library)
│   ├── query-engine/         # planner + expression compiler on DuckDB (Phase 1)
│   └── cli/                  # opensight import/export/validate (Phase 1)
└── conformance/              # round-trip + fidelity tests (Phase 1+)
```

---

## 8. Conformance & Testing Strategy

1. **Bundle round-trip tests:** import a real QuickSight export → export it back → diff
   against the original. Structural equality is the bar.
2. **Function conformance:** every calculated-field function gets fixture tests with
   known inputs/outputs, checked against QuickSight behavior.
3. **Rendering fidelity:** render imported dashboards headlessly, screenshot, and compare
   against QuickSight references (tolerance-based; exact pixel equality is not the goal,
   visual equivalence is).
4. **API compatibility tests:** contract tests against recorded QuickSight API
   request/response pairs.

---

## 9. Open Questions

| ID | Question | Notes |
|---|---|---|
| OQ-1 | Project name | **Decided 2026-09-26: OpenSight.** "QuickSight" is an AWS trademark — not used in the name. The name is crowded on GitHub (6+ unrelated repos: cash-flow forecasting, marketing analytics, brand AI-monitoring, YOLO image annotation, video analytics, k8s manifests; none BI-related), but repo names are per-account so this does not block us; revisit only if discoverability becomes a problem. Rejected: "openquick" (active samuellawrentz/openquick collision + trademark-adjacent to QuickSight); openprism / openpulse / openlantern / openlumen (all crowded); OpenMeridian / OpenAperture / OpenFathom (clear on GitHub, but Tom preferred opensight). |
| OQ-2 | Real bundle samples | Blocked on access to a QuickSight account with representative dashboards. |
| OQ-3 | Auth model for Phase 1 | Start simple (local users + API keys)? OIDC from the start? Leaning simple-first, OIDC in Phase 3. |
| OQ-4 | Which QuickSight API version to track | Pin when Phase 1 API work starts; record here. |
| OQ-5 | Geospatial visuals | ECharts maps vs. dedicated mapping lib — decide in Phase 2 when visual coverage expands. |

---

## 10. How This Document Evolves

- Small updates: edit in place, add a changelog row.
- Big decisions: write the options/reasoning here first; spin out a full ADR in
  `docs/adr/` only when the discussion outgrows a section.
- Every phase kickoff re-reads this doc and updates statuses (`proposed` → `decided`,
  unchecked → checked).
- Nothing here is precious. When we learn something that contradicts it, we change the
  doc first, then the code.
