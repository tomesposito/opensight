# Issue #306 — consumed stored-child generations

Hosted computed tables record the generations of stored inputs selected under
their file-read leases. Execution returns that map to the shared publish/refresh
path. Stamp construction uses those captured generations without another
metadata read. A parent with G1 rows cannot acquire a G2 dependency stamp.

Execution and freshness checks use the same traversal: direct recipes are
expanded, while stored and Blaze inputs stop traversal. Only stored artifacts
actually read contribute generation IDs. Descendants behind a cached input
retain definition-version entries with a null generation; the full graph still
participates in policy, definition and source-revision checks. Older stamps that
included unconsumed descendant generations may conservatively become stale and
need an explicit refresh.

Immediately before publishing the parent pointer, the existing tenant metadata
transaction checks every consumed child's definition version, stored mode and
generation. This check is serialized with child refreshes and definition edits,
including a refresh during parent artifact writing. A changed generation rejects
publication with `STORED_GENERATION_CHANGED`; a changed or missing definition
uses `STORED_DEFINITION_CHANGED` (revision changes may reject earlier with
`METADATA_REVISED`). Missing execution provenance also rejects publication.

The existing failure path removes the unpublished artifact, releases its storage
reservation and keeps any last good parent generation serving with
`refresh-failed` status. A first publish leaves the parent empty. Retry explicitly
to consume the newer generation. Status/failure writes retain the generation CAS
introduced by #305.

Preview and direct execution use the same leased reads. Join diagnostics do not
publish parent artifacts; their bounded stored sampler already captures the
metadata pointer under a lease and rejects a changed snapshot before returning.
Reader dashboards continue recomputing the authorized recipe instead of reading
owner artifacts. This change adds no API request fields or dependencies.

## Regression coverage

`packages/api/test/computed-hosted.test.mjs` is included by the API package's
`test/*.test.mjs` glob and therefore by root `npm test`. The #306 regressions
cover pointer selection under a lease, consumed-only stamps, subsequent stale
labeling, direct recipes, append pipelines, join inputs, missing provenance, and
transactional definition/generation conflicts. For both first publish and
refresh, a real replacement Parquet generation is interleaved at the child read,
after execution, or immediately before metadata publication. Assertions check G1
rows and stamps, rejection, artifact removal, reservation release, preserved
parent rows and successful retry against G2.

## Verification and demo comparison

Final suite counts and the offline demo comparison are recorded after validation.
