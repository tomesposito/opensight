# Phase 5 SR2d / SR3a — durable uploads and operation recovery

This build implements the confirmed D-28 experience using D-22 transfers,
D-24 prearmed recovery and SR2a–SR2c authority. It includes backend/runtime and
hosted-client integration for supported data paths. It does not create AWS
resources or open all hosted capabilities merely because an adapter exists.

## Invocation and authority

Keep tenant and control credentials separate and all connections/SDK clients
invocation-owned. Factor a shared internal SQL current-authority check used by
coordination and control operations: authentic TenantMetadata context, active
tenant, exactly one active identity/membership, current role/capability and exact
revisions. Lock control then tenant then resource/intent. Preserve coordinator's
existing control/limit/budget lock order for analytics. Short metadata/control
operations do not reserve a native analytics worker; native upload/query/refresh
work still requires full SR2 admission and H4 containment.

Every externally visible operation rechecks the original request/session or
event authority at its publication boundary. Metadata edits may invalidate their
own revision-bound session: acknowledge only the committed write, then require
fresh authentication for further work as existing H2 requires. Expiry uses SQL
time; invocation remaining time only limits containment.

Background invocation connection budget is 20 seconds, within a maximum 110-second
work window and 120-second function. This accommodates measured Aurora wake
without extending HTTP's existing explicit startup contract. No polling for a
database to become ready, retry loop within a failed invocation, warm pool or
unconditional recurring SQL task.

## Durable intent and dispatch

Create explicit frozen/drained migrations under the existing advisory lock.
Require exact prior schema checksums, refuse foreign/partial tables and leave
maintenance unchanged. New private tables have schema markers/checksums and
complete deployment/tenant/namespace/owner composite references; scoped tables
force PostgreSQL RLS. Runtime DDL and automatic role grants remain forbidden.

`sr_dispatch_intent` stores a random ID, full scope, kind, request digest,
idempotency-key digest, captured revisions, SQL commit deadline and state
prepared/committed/aborted. `sr_outbox` stores immutable random event IDs,
aggregate ID/revision, kind/version, due/expiry and pending/dispatched/terminal
state. Unique scope/aggregate/revision/kind prevents duplicate business effects.
UUIDs identify events; arrival order is never authority. No rows, credentials,
addresses, signed URLs or executable request payloads enter queue envelopes.

1. Authorize and create a prepared intent with 60-second commit eligibility.
   Expire old unaccepted intents on scoped activity. At most 8 prepared intents
   per owner and 32 per tenant; deny before further external effects when full.
2. Send its recovery envelope to the dedicated SQS recovery queue with delay 60.
   Require an acknowledgement. An ambiguous send does not authorize business
   commit; a duplicate orphan recovery message is harmless.
3. Reauthorize, lock the intent and check hash/state/SQL expiry. Atomically write
   business state, outbox and committed intent. Only a locally branded acknowledged
   preparation can take this path; retries reauthorize existing durable state.
4. Attempt immediate dispatch. Mark dispatched only after acknowledgement. Any
   uncertain receipt leaves pending work for the prearmed recovery message.
5. Recovery locks the same intent. Committed intents reconcile pending outbox;
   expired prepared intents become aborted. Early delivery/store failure retries,
   never acknowledges absence while a late business transaction could commit.

Use standard work and recovery queues, each with DLQ, one record per invocation,
partial failures, visibility 720 seconds, five receives, four-day retention and
fourteen-day DLQ retention. Workers stop attempts after 24 hours or earlier business
expiry. Queue service metrics can alert without SQL. Envelope version is 1 with
deployment epoch, event/intent ID and an allowlisted kind, at most 4 KiB. Validate
the exact configured queue ARN; an object notification cannot authorize ingestion.

Future due times use revision-specific one-time EventBridge Scheduler entries,
not a repeating dispatcher. Use deterministic names/tokens, no flexible window,
delete after completion, five retries/one-hour age and DLQ. On conflict GET and
compare the complete intended target/time before acknowledging dispatch. Past-due
events are sent once as a hint. A consumer acknowledges only after a terminal SQL
outcome or a durably armed continuation. Duplicates/obsolete epochs/revisions
cannot execute again. No global reset of H7 running jobs.

## Storage and immutable source bindings

Add a private immutable-object ledger with server-generated ID/key, scope,
purpose, declared/verified bytes, checksum/type/version, retention deadline and
reserved/live/retiring/deleted state. Allocate the exact key before recovery is
armed. Extend SR2b with a branded planned write handle so the prewrite callback
can record that key; do not discover an ambiguous PUT's key by guessing or listing
another attempt's prefix. Require exact-version verification before publication.

Storage reservation and H1 metadata quota updates serialize on the same tenant
row. Preserve existing H8 namespace-scoped logical-byte accounting and entitlement
semantics, adding reserved/live object bytes through a separately scoped aggregate
gauge. The restricted tenant role may read that gauge under RLS, never mutate the
private ledger or inspect object paths. Do not release a reservation merely because
a worker died or a DELETE response is ambiguous. Convert or release it only with
an authoritative binding or confirmed exact-version absence. Report named quota
failures; accounting/store failures deny admission.

Retain previous object versions and manifests. Cleanup requires no current
source/manifest reference or backup pin, and a 24-hour orphan grace exceeding any
reader/worker deadline. Raw upload deletion additionally waits until all issued
signatures expire plus ten minutes. Logical expiry/cancellation is immediate;
physical deletion does not confer authority. Prearm cleanup before accepting each
storage obligation. Protect claim/operation/idempotency tombstones from object GC.

File-source binding version 4 records columns, row count, active/retired/expired
state, explicit source expiry and immutable ledger ID. Its payload is a verified
Parquet artifact, not a SQL secret row. Preserve version-3 encrypted sources and
PostgreSQL credentials for existing local/self-hosted behavior. A runtime without
the artifact reader fails explicitly on v4. H1 validates v4 policy links too.

Update both HostedSources and EmbedSources. General source/prepared access stays
owner-only. Embedded source hydration follows the existing authorized dataset
link to its actual owner, with current session, RLS/CLS and revision checks before
and after I/O. Do not allow the viewer to supply an owner, bucket, key or ledger ID.
Prepared cache reads continue to use SR2c's owner-bound manifests.

## Upload protocol

Internal routes follow D-20's authoring mapping:

- POST `/api/uploads/reservations`: Idempotency-Key and declared byte length,
  base64 SHA-256, exact media type, existing parser config/columns, explicit future
  source expiry and policy. Return reservation ID/revision, PUT capability, required
  headers and deadlines only after storage/recovery commit. Reserve raw plus bounded
  ingestion-output capacity; allow two outstanding uploads per owner/eight per
  tenant in the initial tester profile, with named admission errors.
- POST `/api/uploads/reservations/<id>/complete`: exact opaque version ID and
  Idempotency-Key. Authorize, HEAD that version and check length/type/checksum/SSE.
  Atomically bind it once, accept the ingest operation and outbox after recovery
  is armed. Return 202 with the same authorized operation on exact retry.
- GET reservation: scoped state/revision and operation/source IDs, never a URL
  echo. DELETE reservation with expected revision: idempotent cancellation.
- GET `/api/operations/<id>`: owner-scoped safe status/revision/error and result
  availability. DELETE with expected revision cancels pending/publication rights.

Normalize validated requests before hashing. Changed input under an existing key
returns IDEMPOTENCY_CONFLICT. Keep idempotency terminal records at least 24 hours;
never reuse a reservation/key. Reauthorization applies to every replay. URL renewal
uses the same immutable bytes/key and fresh authority, never a mutable slot.

Keep 8 MiB and the existing row/column/text/decoded-memory limits and file formats.
Reservation lifetime is ten minutes; PUT capability at most 60 seconds, bounded
by source/reservation expiry. Sign Content-Length, Content-Type, checksum,
If-None-Match and AES256 encryption. Explicitly prevent the SDK from hoisting
required constraints out of signed headers. Bucket policy/CORS must enforce the
same contract in the later AWS module, including exposing version/checksum.
Never use ETag as a digest or fall back to unsigned size enforcement.

The worker reauthorizes current owner, policy and expiry, obtains H4/SR2 admission,
GETs only the bound input version, streams with a hard length/hash ceiling and
parses through the existing contained worker. Upload ingestion retains H8's
existing upload accounting; it is not silently reclassified as a billed refresh.
An operation claim supplies monotonic fencing before the new source exists.
Publish the source, object binding, usage conversion and completed operation in
one fenced SQL transaction. A failed/expired/cancelled/obsolete worker publishes
no source, and cannot replace a newer terminal state. Do not include file bytes
in events or rely on invocation-local staging after acknowledgement.

## Results and hosted composition

Control JSON is at most 1 MiB UTF-8; the application event/response envelope is
at most 2 MiB and headers at most 16 KiB. Reject oversize control input with
CONTROL_PAYLOAD_TOO_LARGE/413 before SQL work. Keep explicit startup/auth ingress
checks and operator-route denial. A control body is never silently truncated.

Inline results fit 1 MiB. Larger legal results use durable operations with immutable
ordered chunks at most 1 MiB, whole/chunk digests and bound schema/revisions.
Total result size still fits H4 resultBytes; return the existing budget error on
overflow and discard partial output. Each GET `/api/operations/<id>/result/<chunk>`
rechecks current reader/session/policy/source/operation authority before object
access and before bytes leave the API. No presigned/public result GET. Results
expire after fifteen minutes or earlier session/source expiry; return RESULT_EXPIRED.

Compose the coordinator, manifests, source reader, operation service and artifact
cache into the Lambda data paths. Expose the existing validated H3 graph's versions
to refresh admission; do not build a second prep evaluator. Recheck sessions and
complete dependency certificates before every response. Only implemented routes
pass SR1's storage gate. Recurring H7 jobs/delivery remain explicitly unavailable
until their dedicated integration; no old local scheduler is enabled in Lambda.

The separately IAM-invoked migration entrypoint uses the existing private schema
owner credential, not the runtime DML role, and composes SR2/SR3 migrations while
frozen/drained. Apply only explicit least-privilege runtime grants. Do not rerun
SR1's guarded bootstrap over a deployment containing durable admissions.

## Client and dependencies

Negotiate versioned serverless transport capabilities through the authenticated
session response; clear them with the session. Preserve local/self-hosted upload
behavior. The capable hosted form sends the actual File/Blob directly, computes
its SHA-256, supplies explicit future expiry and owner-private default policy,
then shows reservation/upload/ingestion status. The expiry field is explicit and
editable; do not silently choose retention. Poll only an outstanding operation,
with a bounded foreground lifetime, and expose cancellation/retry. Stop polling
on terminal state, unmount, hidden page or session change. Unmount alone does not
cancel already accepted durable work. Refresh/discovery finds completed sources.

Remove the obsolete hosted 640 KiB form ceiling for the negotiated direct path.
Show durable expiry accurately; do not say data vanishes on API restart. Await and
validate operation-result chunks before passing a complete result to the existing
query renderer. Preserve AbortSignal and session-generation checks; never send a
bearer to S3 or persist it with an operation identifier.

Add exact `@aws-sdk/s3-request-presigner` 3.1149.0 (Apache-2.0), verify all new
lockfile transitives and retain the approved tslib override. Update SheetJS using
D-30's verified official archive. Dependency acquisition is separate from offline
build/tests; neither adds deployment credentials to an image or public repository.

## Acceptance and release boundary

Use actual SQLite/PostgreSQL transactions, fake object/queue transports and the
native parser/codec. Inject termination or ambiguity before/after recovery send,
business commit, outbox send, HEAD/GET/PUT and source publication. Prove duplicate
delivery, cancelled/revoked owner, expired input, forged key/version/checksum,
conflicting idempotency body, overlapping storage reservations and obsolete worker
publication. Include wrong-tenant/owner and restricted-role bypass attempts.
No successful ingestion follows merely from an S3 notification.

Test max-size supported files, ZIP expansion, chunk overflow/revocation, source and
prepared query parity, preserved provenance and cleanup/usage receipts. Fake-clock
idle tests show zero SQL work without an accepted obligation. Test queue ARN/epoch,
background wake budget and partial-batch failure behavior. Local tests are not
proof of deployed S3 signing/CORS or actual redelivery; those remain live acceptance.

Run root npm test with exact counts. Rebuild the hosted frontend/demo, capture
changed UI and refresh required README assets. Record any visible gaps. Public
promotion additionally requires the idle-client contract, reviewed ingress,
private release configuration, base-image finding disposition and a real tester
workflow at the configured domain. A static demo or maintenance response is not
completion of deployment.
