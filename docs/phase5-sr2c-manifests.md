# Phase 5 SR2c — authoritative manifests and hydration

This frozen build contract connects SR2a SQL authority to SR2b artifacts. It adds
the asynchronous cache seam to hosted source/prep execution, retaining the local
H8 cache as the default. Production composition still requires durable storage
reservations and prearmed recovery before accepting external obligations.

## SQL authority

Extend `DurableCoordinator.admit` with an optional internal SQL-only callback,
called after allocating admission/claim and before the final SQL-time deadline
check. Supply immutable server-derived admission details. Callback failure rolls
back usage, admission, claim and all business/outbox writes. `describe(handle)`
returns an immutable snapshot only for a handle branded by that coordinator;
description is not a live authorization check. Publication still uses `publish`.

Add explicit frozen-maintenance `migrateManifests`, under the existing advisory
migration lock. Require the exact SR2a schema marker and compatible SR1 control;
refuse active, undrained, foreign or partially existing schemas. Idempotence verifies
the marker/checksum; migration does not open admission or change role grants.

Tables are `sr_manifest_schema`, current `sr_manifest` and immutable
`sr_manifest_versions`. Current rows use the complete deployment/tenant/namespace/
owner/kind/resource key with composite foreign keys to claims and admissions.
History uses that key plus generation. Both scoped tables force PostgreSQL RLS
and receive no tenant-role grants. Retain history and claim tombstones; this build
has no object/history deletion or interval cleanup.

`ManifestStore.admit` atomically creates running state, removes previous readable
authority and appends an H1 invalidation event with refresh admission. Its input
contains internal source/recipe definition versions from the already validated
H3 graph; the root definition is always included. Query admission makes no manifest
change. Validate all definitions inside that transaction, including source active
state and SQL-time upload expiry.

Ready publication requires the same live coordinator handle, full scope, claim,
fence, generation, root version, revisions and deployment epoch as running state.
Validate an immutable artifact reference against the full owner identity and
current H4 bounds. The transfer/recovery caller must have verified its exact S3
version and checksum; this SQL component performs no S3 I/O. Publish ready state,
append an immutable history record and completion outbox in one transaction.
Failure publication obeys identical fencing, accepts only a bounded named error
code and leaves no readable artifact. A terminal generation cannot publish again.
An obsolete worker cannot replace either a newer success or failure.

## Dependency validation

Use D-29's bounded, flattened certificate. Each successful manifest read returns
a locally branded immutable snapshot of the reference, generation/fence, definition
version, SQL refresh time, definition set and complete artifact dependency set.
Only genuine reads from the same store and attempt may contribute certificates.
Snapshot caller arrays before awaiting; reject conflicting versions/generations,
cycles/self-dependency and foreign identities. The producer's root and every
consumed certificate's definitions and tokens form the new complete certificate.

Every read rechecks current tenant/member/role, revisions, maintenance epoch and
live reader admission through `coordinator.publish`. In that transaction require
ready current state, matching claim fence/generation/root version and matching
producer revisions/epoch. Check all certificate definitions and current dependency
tokens, including active/expiry checks using SQL time. An artifact whose claim
was released normally stays ready; revocation or a replacement fence denies it.
Lost outbox notifications, metadata outages and valid old local bytes cannot
bypass these checks. No fallback to a live source on an artifact miss.

Revalidate the same snapshot after hydration and before result publication. A
refresh between these checks returns a named stale/unavailable error. The manifest
module supplements existing H3 full-graph RLS/CLS, session and endpoint checks;
it never grants a caller ownership of another user's source.

Bound serialized manifest/certificate metadata to the smaller of 1 MiB and one
eighth of the admitted H4 working-byte ceiling; refuse oversize stored records
before materializing them from SQL. Charge adapter-held certificate metadata to
the WorkScope. A finite flattened certificate avoids unbounded recursive SQL
walks; existing statement/lock/deadline limits still apply. Return named errors
without SQL diagnostics, bucket names or object paths.

## Hosted cache seam

Define `HostedCacheAdapter` with awaitable `read`, `refresh`, `invalidate` and a
publication `verify` hook. HostedData/HostedPrep await every cache call. Keep the
existing local cache implementation and behavior; inject an alternative through
HostedData's constructor rather than constructing AWS clients in shared code.

Implement `ArtifactCache` for one admitted attempt and invocation. Parse only the
existing server-generated owner-scoped cache keys/stamps and match them to the
attempt's authentic context/revisions. Read current SQL authority, download the
exact artifact, decode under H4 and revalidate before returning a bounded table.
Dispose the local artifact in `finally`. Track the genuine read certificates and
verify them again from the hosted publication hook. Original cached-input times
must remain unchanged; consuming a ready root records its SQL refresh timestamp.

Refresh requires the matching manifest admission. Load the bounded table, preserve
consumed provenance, encode it, invoke an explicit `prepareWrite` callback and only
then upload and publish through the current fence. The callback must durably
reserve storage and prearm recovery in the later obligation integration; omission
fails before load/write. No success acknowledgement or default no-op production
callback exists. Failures attempt only fenced error publication and always dispose
local files. Lease loss cannot publish a failure over another attempt.

The adapter has no warm cache or poll. Metadata edits already advance H1 revisions;
its awaited `invalidate` verifies key ownership without deleting history. Local
Blaze memory remains bounded by H4 and is discarded with the invocation.

## Acceptance

Root tests cover frozen/idempotent/foreign/undrained migration; admission callback
rollback; atomic running invalidation/outbox; ready/failure/history atomicity;
forged/cross-attempt snapshots; restart hydration; equal resource IDs across
tenants/owners; dependency refresh/expiry/edit/delete/recreate; lost notifications;
revocation during hydration; obsolete worker publication and authority outage.
Use real SQLite transactions and a live PostgreSQL integration test for composite
foreign keys, forced RLS, separate pools and concurrent publication.

Test the cache adapter with actual native Parquet bytes and injected object
transport, including provenance and query/prep parity with the local cache, and
prove missing/failed storage preparation prevents S3 writes. These are local
integration proofs; actual AWS role/object/operation acceptance follows runtime
composition. Run root `npm test`, report exact counts, rebuild and compare the
demo. There is no user-visible UI change or bundled dependency addition.
