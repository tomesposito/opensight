# Analyst notebooks (#164)

Notebooks combine ordered SQL, markdown and visual cells. Authors can publish
parameterized apps for their namespace without an administrator approval gate.
Every app run uses the **viewer's own permissions**, including every declared
input dataset. Publishing never grants data access. Python, R and notebook AI
assistance are outside v1 and require separate decisions.

This slice runs on `createApiServer` (local or organization mode). The separate
`createHostedApiServer` has no notebook routes or storage. The static demo shows
an API requirement and cannot create or execute notebooks.

## Storage and permissions

`ApiOptions.notebookStorePath` configures the dedicated atomic JSON store; omit
it for ephemeral library/test use. The local CLI defaults to
`.opensight/notebooks.json`; override with `OPENSIGHT_NOTEBOOK_STORE`. Files use
copy-on-write, temporary file + fsync + rename, serialized mutations, and strict
validation on load. Invalid JSON or malformed state fails startup with
`NOTEBOOK_STORE_CORRUPT`. One process owns a store file.

Notebook fields are `id`, `namespaceId`, `ownerId`, `name`, `published`,
`parameters`, ordered `cells`, `version`, `createdAt` and `updatedAt`. Names are
1–120 characters; there are at most 100 cells, 10,000 characters per SQL or
markdown cell, and 200 parameters. Cell IDs are unique. Visual cells reference
an earlier SQL cell. Unknown properties, invalid references and limits produce
named `NOTEBOOK_*` errors. There are at most 1,000 notebooks per store.

Owners can view drafts. Published notebooks are visible within the namespace.
Only the owner or workspace administrator can edit/manage; editing and creation
also require the existing `build` capability. Readers cannot author. An
administrator can edit/delete an unpublished notebook by ID, but cannot read
another owner's draft through GET/list. Cross-namespace requests return 404.
PATCH requires the current `version`, otherwise `NOTEBOOK_VERSION_CONFLICT`.

The store retains the latest **20 runs per notebook**, append-only until retention
removes an old run, and up to **100 snapshots per notebook**. Retained results
are also bounded by aggregate byte budgets (#230): bytes are the JSON size of
the result payloads (`data` of run results and snapshots), counted separately
from metadata and cell text. One run retains at most **8 MiB** of results
(`OPENSIGHT_NOTEBOOK_RUN_BYTES`) — results are kept in cell order and a result
that does not fit loses its data to `NOTEBOOK_RESULT_BUDGET_EXCEEDED`, failing
any dependent visual. Each notebook retains at most **64 MiB** across its runs
and snapshots combined (`OPENSIGHT_NOTEBOOK_NOTEBOOK_BYTES`), and the whole
store at most **256 MiB** (`OPENSIGHT_NOTEBOOK_STORE_BYTES`); the budgets must
satisfy run ≤ notebook ≤ store. When a new run would exceed the notebook or
store budget, the oldest runs are evicted first (snapshots are explicit saves
and are never evicted); if snapshots alone leave no room, the new run is
executed and returned but not retained. A snapshot save that would exceed the
notebook or store budget is refused with `NOTEBOOK_SNAPSHOT_LIMIT_EXCEEDED`.
The same budgets are enforced when a persisted store is loaded, so an
over-budget file fails closed as `NOTEBOOK_STORE_CORRUPT`. Runs record the
executing user, notebook version, time, and each cell's outcome. GET history
returns newest first. Other callers see run metadata, never its result data.
Own historical results are withheld if current access or the security policy
fingerprint has changed. Re-run to obtain results under current permissions.
Deleting a notebook deletes its runs and snapshots: these are not audit-retained
assets. A later notebook referencing a deleted snapshot fails closed.

## SQL and data access

The dataset picker is populated from the executing caller's existing prep
resolver: private uploads, owned prepared datasets, permitted prep sources,
namespace input tables, the governed sales fixture where available, and the
caller's own permitted notebook snapshots. Prepared datasets use IDs
`prepared-<dataset-id>`; input tables use `input-table-<table-id>`. Use the exact
listed ID as a quoted table name, for example:

```sql
SELECT region, SUM(revenue) AS total
FROM "sales"
WHERE revenue >= $minimum
GROUP BY region
```

The cell declares `datasetRefs: ["sales"]` and a parameter such as
`{ "name": "minimum", "type": "number", "default": 0 }`. Parameters support
`string`, `number`, and `date` (ISO calendar date or UTC datetime). Names use the
existing query-engine identifier rules and must be unique. Bindings are scalar
typed values. Unknown, missing, invalid or undeclared SQL bindings fail with a
named error. Shared `validateParameters` validates declarations/defaults/values;
DuckDB receives bindings separately from the SQL text.

Every declared dataset must be accessible **before any SQL execution**, including
unused declarations. Failure yields `NOTEBOOK_DATASET_ACCESS_DENIED` with no
rows. Fixture rows/columns use the existing `planSourceRead` security compiler
and shared local ingestion; protected prep sources remain denied by the existing
prep compiler. Source materialization uses existing prep/Blaze bounds, refusing
oversized inputs rather than silently taking a partial input. Notebook SQL runs
only against these authorized memory tables, with no connector credentials.

Server-side constraints:

- DuckDB's built-in SQL parser accepts exactly one SELECT or WITH…SELECT.
  Nested SELECTs, nonrecursive CTEs, joins and set operations are checked too.
- Undeclared tables, schema/catalog-qualified relations, table functions, dynamic
  SQL, introspection and unsupported AST forms are refused. DDL/DML, COPY,
  ATTACH, PRAGMA, INSTALL and LOAD cannot run. Scalar/aggregate functions have an
  explicit reviewed allowlist (common aggregation, arithmetic, text and dates).
- A new in-memory engine has external access and extension installation/loading
  disabled, one thread, 256 MiB memory and zero spill allowance. User SQL executes
  inside `BEGIN TRANSACTION READ ONLY`. No user SQL reaches a source connection.
- The execution deadline is the existing prep/live MySQL limit of **10 seconds**
  per SQL execution. Materialization uses the prep path's own bounds. Outputs use
  the prep row cap (`OPENSIGHT_BLAZE_MAX_ROWS`, default 100,000, never higher for
  notebooks), 256 columns, the prep 16,384-character cell bound, and the #159
  **8 MiB** cache-entry size budget. One notebook run executes at a time per local
  server; concurrent requests receive `NOTEBOOK_BUSY`.
- An outer limit fetches one sentinel row to report truncation. `rowCount` counts
  returned rows, not an invented total. Results include columns/types, rows,
  `truncated`, elapsed milliseconds and execution time. Unsupported/nonfinite
  result types fail explicitly. No live result cache is introduced.

A failed cell records its named error. A visual depending on a failed or absent
SQL result reports `NOTEBOOK_DEPENDENCY_FAILED`; it never falls back to old data.
Single-cell execution runs only that cell, so a visual-only run needs a source
result and reports the dependency failure. Run all to execute its source too.

Visual specs choose bar, line, pie or table; a dimension; and a numeric measure
with SUM, AVG, COUNT, MIN or MAX. The web uses the shared prepared-data
planner/evaluator to aggregate the SQL result, then the analysis visual compiler
and `VisualCard`/ECharts. The compiler receives its existing explicit SUM result
bindings over one already-aggregated row per category; the selected aggregation
has already been applied by the shared evaluator. No second chart engine exists.
Charts over capped results visibly say so. Markdown renders safe headings,
bullets and paragraphs; text is escaped, with no raw HTML execution.

## Snapshots

“Save result as dataset snapshot” requires author capability and the caller's
latest successful SQL result for the current notebook version. It never saves
another user's run. The immutable snapshot carries the result's `asOf` timestamp,
row count and truncation flag. A refresh is an explicit re-run followed by saving
a new snapshot; it never changes an existing snapshot silently.

Snapshots are stored in the notebook store, listed on their originating notebook,
and exposed as `snapshot-<id>` datasets for the same caller's later SQL cells in
any accessible notebook. They retain original source lineage, caller ownership
and the security fingerprint. Source removal, permission/policy changes or loss
of notebook visibility prevents subsequent reads. Sharing a notebook cannot
share its author's snapshots. These are **stored dataset snapshots, not live
queries**. Registration as normal prepared/upload assets and dashboard/analysis
consumption remain follow-ons; there is no clean normal-asset ingestion seam in
this local composition. Scheduled refresh is not implemented.

## API

All routes are namespace-scoped through the existing identity/namespace routing.
Request bodies cannot supply identity or policy.

| Method | Route | Body / result |
| --- | --- | --- |
| POST | `/api/notebooks` | `name`, optional `cells`, `parameters`, `published`; creator owns it |
| GET | `/api/notebooks` | Visible summaries and `canCreate` |
| GET | `/api/notebooks/datasets` | Caller-accessible IDs, columns and snapshot as-of times |
| GET | `/api/notebooks/:id` | Notebook, permissions and caller-visible snapshot summaries |
| PATCH | `/api/notebooks/:id` | Required `version`; replace any of `name`, `cells`, `parameters`, `published` |
| DELETE | `/api/notebooks/:id` | Deletes notebook, history and its snapshots |
| POST | `/api/notebooks/:id/run` | `{ "parameters": { "minimum": 10 }, "cellId": "optional-cell-id" }` |
| POST | `/api/notebooks/:id/cells/:cellId/snapshot` | `{}`; saves caller's latest successful result |
| GET | `/api/notebooks/:id/runs` | Newest-first history, protected result bodies |

Local query metering has no hook in this composition: `hostedUsage` is connected
only to AI accounting here. Notebook runs therefore have the same local metering
status as ordinary local queries. Hosted quotas/metering must be connected to the
existing system when notebook hosted routes are implemented; no parallel meter
was introduced. See [gap notes](issue-164-gap-notes.md).
