# Dataset preparation (issues #9, #11, and #14)

The Data preparation view builds an ordered transformation pipeline over sources
from the connector registry. Open it from Data sources → Prepare data, the mode
picker, or the analysis editor's Data → Prepare data menu. The left panel contains
configuration and the transformation catalog; the graph shows step order and
one node per connected or prepared input, with labeled connections to the steps
that use it. Repeated joins share a source node; an earlier-step reference points
back to that result. Select a node to preview that stage. Steps
can be edited, reordered, or removed. Downstream schema errors remain visible.

Adding data is a distinct action: **＋ Add data** stages a source (dataset,
connector table, uploaded file, or an earlier step's result) as an input node on
the canvas, visibly flagged until a Join or Append step is configured against it.
Adding the Combine step while an input is staged presets the step's source and a
default key; applying the step consumes the staged input. Join/append steps whose
own configuration is incomplete — or that an upstream edit broke — carry a red
unconfigured flag on the node with the validation message, so the fail-closed
validation is visible on the canvas, not only in the editor at apply time. Staged
inputs are a UI draft: they are not part of the saved pipeline or the exported
bundle.

## Dataset and bundle model

A dataset resource carries `opensightPrep`:

```json
{
  "version": 1,
  "input": "connected-source-id",
  "steps": [
    { "id": "rename-region", "kind": "rename", "config": { "column": "region", "name": "area" } },
    { "id": "net", "kind": "calculate", "config": { "name": "net_revenue", "expression": "{revenue} * 0.9" } }
  ]
}
```

Primary `input` and a join's `config.source` may also be
`{"dataset":"saved-dataset-id"}`. Joins additionally accept `{"step":"earlier-step-id"}`
to reuse an earlier result in the same pipeline, including a joined result. Their
left side is always the preceding stage. Moving/removing a referenced step leaves
an explicit validation error. Existing string references and version-1 bundles
remain valid. Append configuration is unchanged.

Source IDs are references, never SQL, credentials, URLs, or filesystem paths.
The host resolves them to existing connector bindings. An imported bundle cannot
grant access to a source. Each step has a stable ID and an exact, typed config;
unknown versions, step kinds, properties, and malformed configurations fail with
named errors. Workflow limits are documented in [Workflow limits](#workflow-limits).
Case-ambiguous output names fail.

The bundle parser validates this extension during JSON/ZIP import and export.
The prep UI exports `.qs` bundles, preserving unrelated members and unknown
properties on an imported dataset. Multi-dataset bundles offer a dataset picker.
Bundle metadata does not contain result rows. Source IDs must be rebound to
available sources after transfer to another host or after upload staging expires.
Referenced prepared datasets must be saved on the destination host; importing a
bundle does not save dependencies automatically.

## Workflow limits

Limits are chosen deliberately: QuickSight parity where it is cheap, tighter
bounds where a self-hosted engine benefits from them. Violations fail closed
with named errors (`INVALID_PREP_PIPELINE`, `UNSUPPORTED_PREP_STEP`,
`PREP_LIMIT_EXCEEDED`); nothing silently drops.

| Limit | OpenSight | QuickSight | Notes |
| --- | --- | --- | --- |
| Transformation steps per workflow | 50 | 256 | OpenSight's bound keeps compiled queries and previews bounded on self-hosted hardware |
| Import steps (source tables) per workflow | 32 | 32 | Each top-level input, join dataset/table source, and append source counts; step references reuse earlier results and do not count |
| Columns / list entries per step | 256 | 2048 per step, 2000 in final output | Applies to all bounded lists (columns, measures, values, steps lists) |
| Name length | 128 characters | — | Names must be non-blank, trimmed, and free of control characters |
| Calculated expression length | 10,000 characters | — | Expressions must be non-blank |
| Dataset-as-source nesting depth | 16 levels | 10 levels | Cycle-checked at save/refresh; unavailable or cyclic references fail with named errors |
| Divergent paths from a single step | supported via step references | 5 (SPICE only) | Step references point at earlier steps in the same pipeline |

The bundle parser enforces step, import, list, name, and expression limits at
import time; the API enforces dataset-reference nesting depth and cycle
detection when a pipeline is saved or executed.

## Transformation semantics

All steps compile to ordered SQL relations for DuckDB and Postgres. Every stage
is schema-validated, including stages after an explicitly requested preview.
References resolve against the preceding stage; calculated columns can use earlier
calculated columns. Filters use the same predicate compiler as Phase 2b. Scalar
expressions use the Phase 2c parser, type system, and per-dialect function library.

| Kind | Config | Semantics |
| --- | --- | --- |
| `changeType` | `column`, `type` | Types: INTEGER, DECIMAL, STRING, DATETIME, BOOLEAN. Numeric conversion, string parsing, and conversion to string are supported; other pairs fail explicitly. Decimal-to-integer truncates toward zero. Text parsing uses `parseInt`, `parseDecimal`, `parseDate`; invalid text becomes null. Boolean text accepts exactly `true`/`false`, otherwise null. Datetimes serialize in UTC. |
| `rename` | `column`, `name` | Rename one column; collisions fail. |
| `select` | `columns` | Keep a nonempty ordered column list. Missing/duplicate names fail. |
| `filter` | `filters` | AND of `{columnName, value, operator?}` or `{columnName, values}`. EQUALS, GREATER_THAN_OR_EQUAL_TO, LESS_THAN_OR_EQUAL_TO; lists support equality only. Values must match the type. Empty lists match nothing; null never matches. Boolean predicates are unsupported. Dates use ISO dates or UTC timestamps. |
| `calculate` | `name`, `expression` | Add a typed row expression. Visual aggregation, level-aware and table calculations are rejected here; their existing visual post-processing is unchanged. |
| `aggregate` | `groupBy`, `measures` | Measures are `{column, name, aggregation}`; SUM, AVG, COUNT, MIN, MAX. Empty group list aggregates the full input. COUNT counts nonnull column values. SUM/AVG require numeric input. Empty/all-null input follows SQL aggregate semantics. |
| `join` | `source`, `joinType`, `keys`, exactly one of `columns` or `prefix` | inner/left/right/full equijoin. Keys are `{left,right}`, combined with AND and requiring identical types. All left columns are retained; outer joins extend unmatched sides with nulls. Null keys do not match; duplicate keys multiply rows. Right keys are not coalesced into left keys. |
| `append` | `source` | UNION ALL; identical names and types required, order aligned by name. Duplicate rows are retained. |
| `pivot` | `groupBy`, `column`, `value`, `aggregation`, `values` | Values are explicit `{value,name}` output definitions with unique typed keys. Conditional aggregation produces a stable schema. Unlisted/null keys contribute no measure; their groups can still appear. No data-dependent column discovery. |
| `unpivot` | `columns`, `nameColumn`, `valueColumn` | Selected columns must share a type. Each input row produces one row per selected column. Names become values, null cells are kept, and unselected columns repeat. |

Join outputs use either nonempty `columns: [{column,name}]` aliases or a nonempty
`prefix`, which includes **all** right columns (including keys) in source order.
The prefix is literal: `prefix: "region_"` turns `manager` into `region_manager`.
There are no automatic suffixes or omitted columns. Duplicate/case-ambiguous
output names, names over 128 characters, and more than 256 combined columns fail
with `PREP_SCHEMA_MISMATCH`. Explicit aliases let users resolve collisions.
Repeated identical key pairs fail with `INVALID_PREP_PIPELINE`. Key mismatches
identify both names and types; INTEGER and DECIMAL require explicit conversion.
The editor shows these errors before Apply, alongside typed key choices and the
prospective right output names.

Prepared inputs resolve within the same owner and namespace. Direct inputs
expand the current saved definition as complete SQL relations;
preview limits and datetime serialization apply only to the requested output.
Each distinct dependency compiles once. Cycles fail with `INVALID_PREP_PIPELINE`;
more than 16 nested datasets or 500 expanded transformation steps fail with
`PREP_LIMIT_EXCEEDED`. Validation repeats on preview/save, including inside the
serialized metadata write. Deleting a dependency, losing a source, or changing a
dependency's schema cannot silently reuse old rows. The editor's Refresh sources
reloads source and saved-dataset metadata. Blaze inputs use their ready cached
snapshot and report its refresh time; unavailable snapshots never fall back to SQL.

Joins and appends require the same engine and configured connection. Cross-engine
federation is not implemented. Separately materialize PostgreSQL inputs into Blaze
before joining them with file/cached inputs in DuckDB. MySQL prep is explicitly
unsupported; the existing MySQL visual-query connector is unchanged. No prep operation opens an AWS service
or installs extensions. No new external dependency was added.

## Execution and previews

**Materialization contract (#15, implemented by #12): cross-source joins and
advanced prep steps — pivot, unpivot, append, aggregate — MUST materialize through
Blaze.** Single-source simple pipelines may keep compiling to live SQL. The rule
includes saved dependencies, so wrapping advanced preparation in another dataset
cannot bypass it. Distinct connected sources or cached dataset inputs count as
different sources; reusing one source or an earlier step alone does not.

Saving a required pipeline, changing its dependencies, or loading older metadata
selects Blaze without executing a refresh. Query/output routes require a ready
snapshot. Selecting DIRECT QUERY fails with `BLAZE_MATERIALIZATION_REQUIRED` and
the execution panel explains why. Save, then **Refresh Blaze** to publish output.
Bounded draft previews below are available for editing; they do not publish a
saved dataset or fulfill the materialization requirement.

Blaze defaults to 100,000 output rows, 16 MiB accounted capacity per dataset,
64 MiB total cache/intake capacity, and 16,384 combined text characters per row.
Environment variables configure the limits. Oversize results fail with
`BLAZE_DATASET_TOO_LARGE`; capacity pressure evicts least-recently-read snapshots,
which report `BLAZE_EVICTED`. These are accounted storage limits, not process RSS
limits. See [Blaze bounds and capacity](blaze.md#bounds-and-capacity) for all
variables, accounting, execution overhead, and the eviction policy.

Previews transform the full source, then return `limit + 1` rows internally.
The API defaults to 100 displayed rows and accepts 1–500. Aggregate results are
never computed from a pre-limited sample. Returned order is unspecified.

Responses contain `columns`, `rows`, `through`, `limit`, `returnedRows`, `truncated`,
`totalRows`, `rowCountLowerBound`, and `dialect`. `totalRows` is exact only when the
bounded query exhausts the output. Otherwise it is null and the lower bound is
`limit + 1`. The UI labels this distinction. This bounds response rows, not source
scan cost; joins/aggregates can inspect all input rows. Each query has a ten-second
execution limit. DuckDB upload sessions also have their existing 256 MiB memory
limit and no external access. Postgres runs in a read-only transaction, UTC, with
a statement timeout and a five-second connection timeout. Driver errors are
redacted into `PREP_EXECUTION_FAILED`. Unsafe-size integer results retain text
precision; nonfinite/unsupported results fail.

The shared compiler is exposed from the query engine's browser entry point for
schema checks. The static demo only configures pipelines against labeled sales
and region sample schemas. It never fabricates preview rows. It disables server saves and shows
“Needs hosted API.” Native demo drafts persist locally; imported bundles remain in
memory until exported. The hosted UI automatically refreshes the selected preview
after a valid applied change and ignores stale asynchronous responses.

## Authenticated HTTP resources

Every route requires hosted authentication and the `build` capability. Datasets
and upload sources are private to the verified user and namespace. Reader access,
cross-user/namespace references, and caller-supplied authorization assertions are
rejected. Protected or unresolved sources fail closed with
`PREP_SECURITY_REJECTED`; prep does not strip or bypass dataset security rules.

| Method | Resource | Request / response |
| --- | --- | --- |
| GET | `/api/prep-sources` | Visible connector and owned prepared sources, columns, and availability. Prepared summaries add `ref: {dataset:id}` and `name`; unavailable dependencies add `errorCode`. No physical table or connection details. |
| GET | `/api/prep-datasets` | Owned dataset resources and persistence mode. |
| PUT | `/api/datasets/:id/prep` | `{name,pipeline}`; create (201) or replace (200) after full schema validation. Returns `{resource,persistence}`. |
| GET | `/api/datasets/:id/prep` | `{resource,persistence}`. |
| DELETE | `/api/datasets/:id/prep` | Deletes the owned pipeline metadata; returns `{deleted:true}`. |
| POST | `/api/datasets/:id/prep/preview` | `{pipeline?,through?,limit?}`. Omit pipeline to use the saved version. Omit through for final output; null selects input; a step ID selects that stage. Unsaved draft preview is supported when pipeline is supplied. |

IDs in these dataset routes use letters, digits, underscore, or hyphen, up to 128
characters. Request bodies use the API's existing 1 MiB limit. Unknown fields and
query parameters are rejected. Stores hold at most 100 datasets per owner and
1,000 overall. Common errors include `INVALID_PREP_PIPELINE`,
`UNSUPPORTED_PREP_STEP`, `PREP_SCHEMA_MISMATCH`, `PREP_SOURCE_NOT_FOUND`,
`PREP_NOT_FOUND`, and `PREP_LIMIT_EXCEEDED`; expression errors keep their existing
Phase 2c names and paths. Invalid writes leave the prior resource intact.

## Host configuration and lifetime

`createApiServer({prepStorePath})` uses the existing atomic JSON store. Omit the
path for ephemeral library use. The CLI reads `OPENSIGHT_PREP_STORE`, defaulting to
`.opensight/prep.json`. One API process owns a store file; writes use restrictive
permissions and atomic rename. The API/UI identifies ephemeral persistence.

Uploads from issue #8 are immediately available through their existing private
DuckDB staging session. The prep API serializes execution with upload ingestion.
Upload tables disappear at restart. Pipeline metadata can survive restart, but
expired references fail explicitly until rebound. Blaze rows also disappear at
restart and must be refreshed; an in-process snapshot remains readable after its
upload source expires, with its original refresh time clearly labeled.

For Postgres, the authenticated host supplies `prepPostgresBindings`, each with
`namespaceId`, `userId`, `source`, and `config: {connectionEnv: 'ENV_VARIABLE_NAME'}`.
`source` has `id`, `connectorId: 'postgresql'`, `table`, optional `schema`, `columns`,
and a trusted `security` classification. These bindings are startup configuration,
not HTTP input. Connection strings come only from the named environment variable.
Combined sources must share that variable. Listing/validating metadata does not
establish a database connection. Library hosts configure authentication using the
existing `security` option; the basic CLI does not invent an authentication service.

Saving a pipeline persists metadata. A Blaze pipeline must be refreshed before
it can be reused as a cached prep input. Analysis dataset publication into field
wells remains separate hosted integration work.
Imported prepared datasets are never substituted with untransformed local fixture
rows. The UI states this boundary. Preview and export are available as documented;
no deployed-server or measured visual-parity claim is made.

## Verification

Root `npm test` includes malformed model/bundle tests, actual DuckDB/Postgres
(PGlite) execution comparisons for every step kind, upload executor checks,
authenticated HTTP CRUD/persistence/security tests, bundle preservation, and UI
interaction/stale-response tests. Live Postgres remains the pre-existing optional
integration suite. See `issue-12-gap-notes.md` for current run counts and visual
checks, and `issue-9-gap-notes.md` for the original prep build verification.

### Blaze execution (issue #12)

Saved datasets now have a host-side DIRECT QUERY/BLAZE switch, manual and interval
refresh, explicit cache status, and bounded output queries. A prepared input in
Blaze mode resolves to its cached rows with refresh-time provenance. Draft step
previews retain source-execution semantics and label cached dependencies. See
[Blaze prepared datasets](blaze.md) for routes, failure behavior and capacity.
