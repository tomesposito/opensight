# Issue #74 — Hosted Data contracts

The issue brief specifies this repair; `SOLUTION_DESIGN.md` is unchanged.
No dependencies, AWS calls or hosted deployments are added.

The Data catalog distinguishes local `file`/`ephemeral` lists of bundle resources
from hosted `durable` lists of `{resource, version, execution}` records. The
catalog unwraps resources and retains optimistic versions separately from portable
bundle metadata. The prep editor consumes the same catalog.

Hosted source discovery supplies raw sources. The client derives owned prepared
dataset summaries (`ref: {dataset: id}`) with the shared prep compiler, using the
authorized source schemas and saved graph. This respects transformations, nested
datasets and the selected output stage without executing a preview or query.
The summaries also reach analysis source validation and source pickers. Server
queries still check authorization and cache readiness; schema discovery does not
assert that a Blaze snapshot exists. Schema failures keep an unavailable entry
with a named error; catalog admission failures never fall back to old data.

Hosted execution settings have no cache telemetry. The client labels the status
as unknown and leaves bytes, row counts, timestamps and next-run times unavailable.
It reads the prepared resource to obtain configuration and its version together.
Local cache status keeps its existing fields.

Duplicate and new recipes send `expectedVersion: 0`. Edits and deletes send the
version of the loaded recipe. Storage and refresh schedule changes send the
execution version read with their settings, then advance it from the acknowledged
write. A schedule dialog retains its opening version across background polls;
concurrent changes produce `METADATA_CONFLICT`, with no automatic overwrite or
retry. Successful schedule changes update the detail page's delete version.
Local requests omit version fields, preserving the local API's strict bodies.

Hosted refresh acknowledgements are followed by a settings read, never treated
as complete local cache status. Add/edit/remove schedules use the real hosted job
store; a host without automation exposes `HOSTED_AUTOMATION_UNAVAILABLE`. Missing
history, cache provenance and email support remain explicitly unavailable.

`packages/web/test/hosted-data-section.test.mjs` uses the real hosted route handlers,
`HostedData`, `HostedPrep`, SQLite metadata and existing source/job fixtures. Only
HTTP byte transport is replaced. Fresh fixture contexts model request admission;
bearer renewal after revision-changing writes remains an authentication concern.
The web test glob includes this suite in root `npm test`.
