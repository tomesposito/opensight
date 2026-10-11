# Phase 5 SR2d / SR3a evidence

## Dispatch, storage and transfer checkpoint

The build is in progress. This checkpoint is not runtime activation or deployment.
No cloud resource, queue consumer, public route, DNS record or tester account is
created by these changes.

- Shared SQL authority preserves coordinator checks and serializes control
  operations with H1 tenant edits. New private dispatch/object migrations require
  frozen/drained maintenance and exact predecessor checksums; they grant no roles.
- A recovery acknowledgement precedes the branded business transaction. Intents,
  business effects and outbox entries commit atomically; lost dispatch receipts
  remain pending. Real one-time Scheduler requests have deterministic identity and
  exact conflict comparison. There is no polling dispatcher.
- Object capacity reservations share H8 namespace accounting with metadata writes.
  Exact-version binding converts capacity; retention, backup pins, ambiguous writes
  and uncertain deletion keep bytes charged. Publication is fenced before cleanup.
- Artifact writes allocate their exact cleanup key before the prewrite callback.
  Planned handles cannot be forged, redirected or reused after an uncertain PUT.
- The actual SDK signs Content-Length, Content-Type, SHA-256, If-None-Match and
  AES256 headers. Required constraints are not hoisted to URL query parameters.
  HEAD/GET require the exact version and headers, and GET has a streaming byte/hash
  ceiling. Browser/S3 CORS and live signing remain deployment acceptance work.
- Gateway control JSON is bounded at 1 MiB, event/response envelopes at 2 MiB,
  and headers at 16 KiB. Oversize input is rejected before SQL. Background private
  invocations allow 20 seconds for Aurora connection while retaining a 110-second
  work window and invocation-owned cleanup. HTTP startup behavior is unchanged.

On the pinned ARM64 Node 24 environment, TypeScript compilation passed. The focused
set passed **62 / failed 0 / skipped 0 / cancelled 0**. This includes real local
PostgreSQL with independent pools, forced RLS and restricted-role bypass attempts;
SQLite crash/ambiguity injection; native Parquet; actual SDK presigning without
network; an 8 MiB object; and corrupt/truncated/overflow streams. These local tests
are not evidence of deployed S3 CORS, Scheduler delivery or Aurora wake behavior.
The patched-parser and existing hosted-usage suites also passed **21 / failed 0 /
skipped 0 / cancelled 0**. The full root suite, runtime/client integration, UI capture and deployment proof
remain required before this phase is complete.

## Dependency acquisition

D-30's official SheetJS 0.20.3 archive is Apache-2.0 with no dependencies. Its
SHA-256 matches the recorded decision and npm locks SHA-512 integrity. The stale
0.18.5 parser and its unused transitive helpers are removed. Exact
`@aws-sdk/s3-request-presigner` 3.1149.0 is Apache-2.0; the only additional transitive
entry is tslib 2.8.1 (0BSD), covered by the existing approved exception. Other SDK
transitives were already present and did not change. Dependency acquisition used
npm; compilation and tests had no external network access. This does not resolve
or suppress the separately recorded runtime base-image findings.

## Upload ingestion checkpoint

The control service now reserves raw/output storage and both cleanup obligations,
issues renewable short PUT capabilities, validates exact-version completion,
returns operation status and cancels publication with revision checks. Accepted
retries share one operation and event, including differently keyed completion
retries for the same immutable object. The initial profile admits two outstanding
uploads per owner and eight per tenant.

A contained worker claims the operation under SR2 admission, parses the bound raw
version, writes a staged immutable Parquet artifact and atomically publishes its
v4 source binding, usage conversion, operation result and event receipt. A lost
PUT acknowledgement recovers the stored key/checksum/descriptor without a second
write. Cancellation and membership revocation during publication create no source.
Upload ingestion preserves the existing accounting and does not charge a refresh.

Owner and embedded v4 readers resolve the current SQL object binding, verify exact
version/checksum/schema and recheck authority after hydration. Embedded reads
follow the existing dataset link to its actual owner; general source access
remains owner-only. Runtime adapters absent from a self-hosted process fail with
SOURCE_ARTIFACT_READER_REQUIRED rather than silently returning missing data.

Native ingestion tests passed **5 / failed 0 / skipped 0 / cancelled 0**, including
an upload → durable source → fresh-invocation SUM query. Control/source tests
passed **9 / failed 0 / skipped 0 / cancelled 0**. TypeScript passed. These are
service-level local checks; HTTP composition, protected result chunks, cleanup,
client integration and cloud deployment are still in progress. The complete root suite passed **2,352 / failed 0 / skipped 13 / cancelled 0**
(2,365 tests total). All skips are live-PostgreSQL integrations without DATABASE_URL
in the offline build. Breakdown: API 426 passed / 11 skipped; bundle parser 199;
embedding SDK 9; O interpreter 32; parity 11; query engine 504 passed / 2 skipped;
web 1,157; root conformance 14. Hosted frontend and static demo builds also passed.
The separate real-PostgreSQL dispatch/object checks described above passed without
skips; local SQL evidence does not replace the pending cloud acceptance.

The rebuilt 1280×800 offline data-landing capture is byte-identical to the SR2c
capture. No user-visible UI changed at this checkpoint, so existing README assets
remain current. The previously recorded minimal-Linux font gap (#87) is unchanged;
this is a demo comparison, not deployed-site or visual-parity evidence.

## HTTP admission and cleanup checkpoint

The invocation adapter now composes durable admission, manifests, source hydration,
cache publication and upload control routes. It negotiates direct-upload capability
and keeps legacy base64 uploads, H7 scheduling/delivery and operator routes gated.
An HTTP admission remains held through final response verification. Native workers
and transfer sockets close before SQL releases capacity; aborted invocations and
unconfirmed cleanup retain the full containment deadline.

Refresh admission prearms cleanup for the superseded manifest before replacing
readability. Each new object has a storage reservation and recovery obligation
before PUT; binding converts the ledger in the same transaction as publication.
The private collector needs no active owner session. It checks source, manifest,
result and backup references under the publication locks, fences publication,
records an ambiguous PUT's exact version and releases quota only after confirmed
absence. Delayed cleanup commits a continuation and confirms dispatch before
acknowledging its original queue obligation. No recurring SQL collector is added.

TypeScript passed. The focused dispatch/upload/runtime/cache/cleanup set and its
separate real-PostgreSQL check passed **40 / failed 0 / skipped 0 / cancelled 0**.
The PostgreSQL check now covers forced RLS on all thirteen private scoped tables,
concurrent completion, cancellation and immutable storage. Local tests include
fresh-invocation hydration, failed recovery before refresh admission, transfer
shutdown failure, suspended-owner cleanup, uncertain DELETE, backup continuation
and duplicate delivery. These changes remain local build work: protected result
transfer, browser integration, production migration composition and cloud
acceptance are still required before activation.

## Protected results and private entrypoints checkpoint

Large legal results now reserve and prearm immutable JSON fragments before PUT,
then publish all verified bindings and the completed operation atomically. Each
fragment is at most 1 MiB. Authenticated reads check the originating author/embed
session, exact revisions, expiry, object version/hash and the complete cached
manifest dependency certificate before and after I/O. Failed partial writes leave
charged reservations with cleanup obligations and publish no readable result.
Chunk reads do not allocate a native analytics admission.

The private SQS entrypoint dispatches only recovery, ingestion and object cleanup.
The owner-only migration composes SR1 bootstrap (only on an empty database) and
all SR2 schemas in one frozen/drained transaction. Existing deployments retain
budgets, epoch and maintenance. Explicit runtime grants deny schema changes,
control/config writes and H7 mutations; the tenant role gets only the private
storage gauge's RLS-scoped SELECT. Migrations do not activate signing keys.

The focused result/migration/private-runtime/AWS-adapter suites passed **22 /
failed 0 / skipped 0 / cancelled 0**, including the real PostgreSQL owner migration
and runtime/tenant permission checks. Result tests cover fresh-invocation
reassembly, another session/owner, expiry, revocation during GET, a replaced cache
generation, partial PUT failure and corrupt/oversized streams. Browser integration
and live cloud acceptance remain in progress.

## Client integration and phase verification

Authenticated sessions negotiate the 8 MiB direct path, 1 MiB control limit and
bounded result fragments. Browser file transfer computes SHA-256 over the actual
Blob, sends only the five constrained object headers (Fetch supplies length),
requires the returned version and never forwards the API bearer to S3. The form
requires an editable retention deadline. Accepted operations have visible status,
revision-checked cancellation and explicit Check status after a bounded wait.
Hidden pages and unmount abort local requests without cancelling accepted work.
Capability and in-flight publication checks follow the original session generation.

Both authoring and embedded result clients validate every fragment and the complete
digest before publishing data. The embed shell supplies the negotiated result
ceiling. Startup additionally checks all five durable migration markers before
reporting ready. Unsupported storage modes fail closed.

Final root `npm test` passed **2,378 / failed 0 / skipped 14 / cancelled 0**
(2,392 total): API 443 passed / 12 skipped; bundle parser 199; embedding SDK 9;
O interpreter 32; parity 11; query engine 504 passed / 2 skipped; web 1,166;
root conformance 14. All skips are live-PostgreSQL integrations without DATABASE_URL
in the offline run; the separate real-PostgreSQL migration and coordination checks
are recorded above. Hosted and demo builds passed on pinned ARM64 Node 24.
The embedded session HTML is approximately 1.42 MB before transport encoding,
within the existing response envelope for the standard shell.

The real browser, using synthetic HTTP/object responses, confirmed one direct PUT,
no S3 bearer, exposed-version handling, explicit expiry and queued status with zero
page errors. This is browser integration evidence, not an AWS signing/CORS proof.
The README screenshot is labelled synthetic. The maintained README tour now follows
the connector dialog and accepts an environment-provided browser executable;
251 frames completed with zero page errors/external requests, then FFmpeg assembled
the refreshed GIF. Unavailable MySQL remains disabled. The offline demo remains a
demo; public ingress, idle clients and live tester acceptance are still pending.
