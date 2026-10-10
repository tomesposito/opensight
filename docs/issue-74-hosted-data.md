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

`packages/web/test/hosted-data-section.test.mjs` uses the real hosted route handlers,
`HostedData`, `HostedPrep`, SQLite metadata and existing source/job fixtures. Only
HTTP byte transport is replaced. Fresh fixture contexts model request admission;
bearer renewal after revision-changing writes remains an authentication concern.
The web test glob includes this suite in root `npm test`.
