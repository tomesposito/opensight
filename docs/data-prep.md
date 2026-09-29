# Dataset preparation (issue #9)

The Data preparation view builds an ordered transformation pipeline over sources
from the connector registry. Open it from Data sources → Prepare data, the mode
picker, or the analysis editor's Data → Prepare data menu. The left panel contains
configuration and the transformation catalog; the graph shows step order and
secondary inputs for joins/appends. Select a node to preview that stage. Steps
can be edited, reordered, or removed. Downstream schema errors remain visible.

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

Source IDs are references, never SQL, credentials, URLs, or filesystem paths.
The host resolves them to existing connector bindings. An imported bundle cannot
grant access to a source. Each step has a stable ID and an exact, typed config;
unknown versions, step kinds, properties, and malformed configurations fail with
named errors. Maximums: 50 steps, 256 columns/list entries, names of 128 characters,
and calculated expressions of 10,000 characters. Case-ambiguous output names fail.

The bundle parser validates this extension during JSON/ZIP import and export.
The prep UI exports `.qs` bundles, preserving unrelated members and unknown
properties on an imported dataset. Multi-dataset bundles offer a dataset picker.
Bundle metadata does not contain result rows. Source IDs must be rebound to
available sources after transfer to another host or after upload staging expires.

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
| `join` | `source`, `joinType`, `keys`, `columns` | inner/left/full equijoin. Keys are `{left,right}`, combined with AND and requiring identical types. Right outputs are explicit `{column,name}` aliases. All left columns are kept. Null keys do not match; duplicate keys multiply rows. |
| `append` | `source` | UNION ALL; identical names and types required, order aligned by name. Duplicate rows are retained. |
| `pivot` | `groupBy`, `column`, `value`, `aggregation`, `values` | Values are explicit `{value,name}` output definitions with unique typed keys. Conditional aggregation produces a stable schema. Unlisted/null keys contribute no measure; their groups can still appear. No data-dependent column discovery. |
| `unpivot` | `columns`, `nameColumn`, `valueColumn` | Selected columns must share a type. Each input row produces one row per selected column. Names become values, null cells are kept, and unselected columns repeat. |

Joins and appends require the same engine and configured connection. Cross-engine
federation is not implemented. MySQL prep is explicitly unsupported; the existing
MySQL visual-query connector is unchanged. No prep operation opens an AWS service
or installs extensions. No new external dependency was added.

## Execution and previews

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
schema checks. The static demo only configures pipelines against a labeled sample
schema. It never fabricates preview rows. It disables server saves and shows
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
| GET | `/api/prep-sources` | Visible connector source IDs, columns, and availability; no physical table or connection details. |
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
expired references fail explicitly until rebound; no cached rows are returned.

For Postgres, the authenticated host supplies `prepPostgresBindings`, each with
`namespaceId`, `userId`, `source`, and `config: {connectionEnv: 'ENV_VARIABLE_NAME'}`.
`source` has `id`, `connectorId: 'postgresql'`, `table`, optional `schema`, `columns`,
and a trusted `security` classification. These bindings are startup configuration,
not HTTP input. Connection strings come only from the named environment variable.
Combined sources must share that variable. Listing/validating metadata does not
establish a database connection. Library hosts configure authentication using the
existing `security` option; the basic CLI does not invent an authentication service.

Saving a pipeline does not materialize a table or publish it into analysis field
wells. Analysis dataset publication remains separate hosted integration work.
Imported prepared datasets are never substituted with untransformed local fixture
rows. The UI states this boundary. Preview and export are available as documented;
no deployed-server or measured visual-parity claim is made.

## Verification

Root `npm test` includes malformed model/bundle tests, actual DuckDB/Postgres
(PGlite) execution comparisons for every step kind, upload executor checks,
authenticated HTTP CRUD/persistence/security tests, bundle preservation, and UI
interaction/stale-response tests. Live Postgres remains the pre-existing optional
integration suite. See `issue-9-gap-notes.md` for the run counts and visual checks.
