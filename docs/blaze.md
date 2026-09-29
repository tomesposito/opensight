# Blaze prepared datasets

Blaze caches a saved preparation pipeline's complete output in the self-hosted
API process. It is independent of AI settings. There are no new dependencies,
AWS services, disk cache files, or extension downloads.

In Data preparation, save the pipeline, select **BLAZE**, then **Refresh Blaze**.
Cross-source joins and advanced prep steps (pivot, unpivot, append, aggregate)
require Blaze under issue #15. Saving selects it automatically; refresh remains
explicit. This also applies through saved dependencies and when older metadata
loads at startup. Single-source simple pipelines may stay in direct query mode.
The execution panel shows state, last successful refresh, row count, and next
scheduled refresh. **View cached output** reads up to 100 cached rows and labels
the snapshot time. Draft step previews still execute the draft's source steps;
any cached join inputs are labeled with their own refresh times.

**DIRECT QUERY** executes the current saved pipeline for each query. A direct
pipeline may reuse a single cached input; its response lists cached inputs and their
times. Changing a mode never silently materializes data. The static demo retains
its offline sample badge and disables hosted execution controls. Arbitrary
prepared-dataset publication into analysis visuals remains a separate feature;
DatasetHeader supports prepared identity and execution controls, while the
existing analysis editor continues to use its sales fixture binding.

## API

All prepared-dataset resources require authenticated build capability and are
private to the owning user and namespace. Identity and source bindings cannot be
asserted in request bodies. `sales` is reserved for the existing fixture route.

| Resource | Method | Body / result |
| --- | --- | --- |
| `/api/datasets/:id/execution` | GET | Mode, interval, state, lastRefreshedAt, rowCount, bytes, nextRefreshAt, error, materializationReason (null when optional) |
| Same | PUT | `{ "mode": "BLAZE", "intervalMinutes": 5 }`; use null for manual-only |
| `/api/datasets/:id/refresh` | POST | `{}`; waits for refresh and returns current status |
| `/api/datasets/:id/rows` | GET | Up to 100 output rows, full rowCount, truncated flag, execution provenance |
| `/api/datasets/:id/query` | POST | Existing dimensions/measures/filters/calculations/parameters shape; aggregates plus execution provenance |

Direct mode requires `intervalMinutes: null`. Intervals are whole minutes from
1 through 525600. Settings persist with `OPENSIGHT_PREP_STORE`; they are host-side
settings rather than portable bundle properties. Imported bundles do not create
cache entries or grant access to another owner's sources.

Query responses include `execution: { mode, cached, refreshedAt, cachedInputs }`.
Each cached input has `datasetId` and `refreshedAt`. A direct query containing cached
inputs is not an all-live result. Cached reads never fall back to the source.
Numeric, string and datetime queries use the shared visual planner/evaluator,
including table and level-aware calculations. Boolean fields remain usable in
prep, output previews and joins; the existing visual query planner rejects them.
Integers outside JavaScript's exact numeric range are preserved as strings in
cached rows, and numeric visual evaluation refuses them explicitly.

## Refresh and failure

Refresh revalidates the saved pipeline, executes all output rows (not a preview
sample), checks bounds as rows arrive, and publishes only a complete snapshot.
During refresh, cached queries return `BLAZE_REFRESH_IN_PROGRESS`. A failed refresh
leaves no readable snapshot. Status retains the last-success time as history and
reports a safe named error/cause code; it never exposes driver connection details.
A successful refresh restores availability, including for an empty dataset.

| Error | Meaning |
| --- | --- |
| `BLAZE_NOT_READY` | No snapshot, including after restart |
| `BLAZE_INVALIDATED` | Pipeline, dependency or execution mode changed; refresh required |
| `BLAZE_EVICTED` | Capacity reclamation removed the snapshot |
| `BLAZE_REFRESH_FAILED` | Execution or authorization failed; safe cause code recorded |
| `BLAZE_PIPELINE_INVALID` | Saved pipeline no longer validates, including missing/expired sources |
| `BLAZE_DATASET_TOO_LARGE` | Row, accounted memory, text or provenance limit exceeded |
| `BLAZE_BUSY` | Another materialization/direct-output intake is running; retry |
| `BLAZE_MODE_REQUIRED` | Refresh requested while in direct mode |
| `BLAZE_MATERIALIZATION_REQUIRED` | Direct query refused for cross-source joins or advanced preparation |
| `BLAZE_CONFIG_INVALID` | Invalid environment or execution settings |

Saving/deleting a dataset or changing its mode invalidates transitive dependent
snapshots. In-flight refreshes check a generation before publication so edits
cannot resurrect obsolete output. A successful refresh of an input does not
silently change another dataset's existing snapshot: that snapshot continues to
report the input refresh times used when it was built.

The one-second API scheduler refreshes due datasets serially and rechecks the
owner's current build capability. Missed occurrences coalesce. The next due time
is one interval after completion, including after failures and manual refreshes.
An already-running intake delays scheduled work; it does not overlap it. Scheduler
shutdown waits for its current operation before upload staging closes. Restart
restores settings but starts without cached rows or last-success claims; the first
scheduled refresh is one interval after startup. Upload sources must be uploaded
and rebound after restart, as in the prep API before Blaze.

## Bounds and capacity

Configure limits only through server environment variables; invalid values fail
startup. Values are positive safe integers. Dataset capacity cannot exceed total
capacity. No setting accepts a path, credential, or remote endpoint.

| Variable | Default | Meaning |
| --- | ---: | --- |
| `OPENSIGHT_BLAZE_MAX_BYTES` | 67108864 (64 MiB) | Total accounted cache plus intake reservation |
| `OPENSIGHT_BLAZE_DATASET_BYTES` | 16777216 (16 MiB) | Maximum accounted dataset and intake reservation |
| `OPENSIGHT_BLAZE_MAX_ROWS` | 100000 | Maximum full output rows; the next row refuses the dataset |
| `OPENSIGHT_BLAZE_CELL_CHARS` | 16384 | Combined textual length of one output row, conservatively guarding each scalar before transfer |

Storage is column arrays of normalized scalars. Accounting charges 256 bytes per
table; 128 plus twice the name length per column; 24 bytes per cell slot plus
8 for a scalar/null or 32 plus twice the length for a string. Cached provenance
also counts toward capacity (128 plus twice the ID/time lengths per entry), with
at most 1000 distinct input snapshot records. A candidate exceeding its limit is
refused before the offending row is appended; no partial snapshot is published.

Only one full-output intake runs at a time. Before it starts, the store reserves
one dataset's maximum capacity, evicting least-recently-read snapshots as needed.
Refresh releases its old snapshot first. Status reads do not update recency;
queries, cached previews and joins do. Refusals/evictions remain visible until a
successful refresh. A large reservation can evict a prospective cached dependency;
that refresh then fails explicitly and requires sufficient configured capacity.

Postgres reads use a read-only UTC transaction, a cursor with 32-row fetches,
and a 10-second execution deadline. DuckDB uses native streamed chunks, a
10-second interrupt timer, its existing 256 MB working-memory limit and no spill.
SQL guards replace oversized row scalars before they enter the Node driver and
emit a refusal marker. Rows beyond the configured maximum are never published.

These limits bound accounted retained cache and intake, **not total process RSS**.
Driver batches, native SQL working memory, temporary cached join tables, existing
upload staging, result rows and shared-evaluator copies consume additional memory.
DuckDB upload sessions have their own pre-existing limits. Size the API process
for those overheads; the Blaze capacity is not an operating-system memory limit.
Cached visual evaluation runs synchronously in Node, so large calculations may
block the event loop; this slice makes no measured latency or throughput claim.

## Blaze join inputs

The existing `{ "dataset": "lookup" }` reference selects the saved dataset's
configured mode. A ready Blaze input substitutes its cached schema/rows as a
private temporary DuckDB relation. It does not expand or execute the original
pipeline. Its original PostgreSQL/upload source can be unavailable while the
snapshot remains usable; refreshing then reports that source failure.

File/direct inputs can join cached inputs, and all-cached joins work even if their
original sources were PostgreSQL. A direct PostgreSQL relation mixed with a Blaze
relation still fails the existing cross-engine rule. Materialize both sides first.
All four join types, typed keys, null/duplicate semantics and explicit output
naming retain the prep compiler's behavior. Missing caches and protected bindings
fail closed, with no source fallback.

See [Issue #12 verification](issue-12-gap-notes.md) for tests and screenshots.
