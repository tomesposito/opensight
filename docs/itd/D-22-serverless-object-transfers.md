---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-10
labels: [itd]
---

## Purpose

Move file bytes outside synchronous Lambda request envelopes while retaining
tenant authorization, source expiry and bounded results.

## Scope

Upload reservation, immutable object binding, ingestion and result retrieval.

## Out of Scope

Public buckets, arbitrary object keys, multipart uploads and larger file formats.

### 🚧 ITD D-22 — How should tenant bytes cross the serverless boundary?

#### CONTEXT

The current parser accepts CSV, TSV, XLS and XLSX up to 8 MiB, 100,000 rows and
256 columns. Base64 increases the bytes further, exceeding Lambda's 6 MB
synchronous request limit before API Gateway's 10 MB limit matters. H3 sources
have an explicit future expiry and owner boundary; an S3 notification carries
neither current authorization nor a trusted dataset definition.

#### THE PROBLEM

How can direct object transfers preserve ownership, integrity, expiry and replay
safety while keeping control and result payloads below runtime limits?

#### OPTIONS CONSIDERED

1. [WIP] Scoped reservation, conditional presigned PUT, version-bound completion
   and asynchronous ingest; protected results retrieved through authorized chunks.
2. [WIP] Lower the current upload limit to fit base64 inside synchronous Lambda.
3. [WIP] Presigned unrestricted object upload/download with object-event ingestion.

#### REASONING

Option 1 preserves existing upload formats and limits. It adds a durable state
machine but makes overwrite and completion races testable. Option 2 changes
accepted files without product justification. Option 3 makes object possession
authority and cannot reauthorize protected results after revocation. Short-lived
download signatures still have an irrevocable validity window; no such relaxation
is proposed. Tom confirmed the asynchronous UX and 1 MiB control-envelope limit
on 2026-10-10 in [IDD D-28](../idd/D-28-serverless-upload-experience.md).
This record remains draft for the detailed transfer implementation contract.

#### IMPLICATIONS

Route names below are **internal** `/api/...` names, exposed through D-20's
authoring `/api/api/...` mapping. Credentials and scope always come from the
verified session, never request tenant/owner fields. Embed credentials cannot
create owner-only upload reservations.

| Route | Input | Authorized result |
| --- | --- | --- |
| `POST /api/uploads/reservations` | Idempotency-Key; byteLength, base64 SHA-256 checksum, exact media type, existing file config/columns/policy, source `expiresAt` | 201 reservationId, putUrl, required headers, upload deadline, completion deadline |
| `POST /api/uploads/reservations/<id>/complete` | Idempotency-Key; opaque S3 versionId from PUT response | 202 operationId, or the same prior authorized operation on exact retry |
| `GET /api/uploads/reservations/<id>` | No key/path input | State and operation/source IDs only; no signed URL echo |
| `DELETE /api/uploads/reservations/<id>` | Expected reservation revision | Idempotent cancel; cannot resurrect or recycle key |
| `GET /api/operations/<id>` | Verified caller | Safe state, progress/error and result availability |
| `DELETE /api/operations/<id>` | Expected revision | Cancellation request; publication checks it atomically |
| `GET /api/operations/<id>/result/<chunk>` | Integer chunk ordinal | Authorized bounded bytes with whole-result digest and chunk framing |

**Reservation schema:** tenant/namespace/owner, random reservation ID, immutable
random server key `uploads/<encoded-scope>/<reservation>/input`, config hash,
declared bytes/type/SHA-256, source expiry, reservation revision/state,
reserved storage bytes, bound S3 version, operation ID and idempotency hash.
Composite foreign keys bind scope and owner. A unique `(scope, owner, route,
idempotency-key)` record includes a canonical request digest; changed payload
returns `IDEMPOTENCY_CONFLICT` (409). Keep records 24h after terminal state, never
reuse an ID/key, and require current authorization even for an exact retry.

**State machine:** `reserved → verifying → ingesting → completed`; any nonterminal
state may become `cancelled`, `expired` or `failed`. Claim transitions by revision
CAS using D-23 fencing. Reservation expires 10 minutes after creation; presigned
PUT lasts at most 60 seconds and never beyond reservation/source expiry. URL
renewal while reserved requires fresh authorization and returns a signature for
the same immutable bytes/key, not a new mutable slot. Source expiry remains the
caller's explicit valid future time, subject to existing operator policy; it is
independent of the 10-minute upload window and is enforced on every later read.

Reserve H8 storage entitlement and a proposed maximum of 2 pending uploads/owner,
8/tenant before signing; release or convert the reservation atomically on terminal
transition so concurrent requests cannot spend the same quota. These proposed
concurrency caps need workload review, not a hidden change to H3.

**PUT capability:** S3 versioning and block-public-access enabled; server chooses
bucket, region and complete key. Sign exact Content-Length, Content-Type,
`x-amz-checksum-sha256`, encryption requirement and `If-None-Match: *`; constrain
signature age in bucket policy. No ACL, delete, list, read, copy or multipart
permission. Require conditional writes in policy for the upload principal.
Browser CORS permits only canonical origin, PUT and required signed headers;
expose version ID/checksum for completion. Browser supplies the exact file Blob;
its generated Content-Length must match the signature. SR2 tests actual browser
header/signature behavior; a failed test does not justify unsigned size limits.

The SDK must keep required conditional/checksum headers signed rather than
silently hoisting/removing constraints. ETag is not the integrity digest. The
browser's checksum describes requested bytes; S3 validates transfer and ingest
recomputes SHA-256 before trusting them. A leaked PUT URL can write only those
bytes for its brief lifetime, and cannot authorize ingestion after revocation.

**Completion:** authorize owner/active tenant/source policy; compare reservation
state and expiry; HEAD the server key at the submitted version; verify version,
size, media type, checksum and encryption. Never accept client key/bucket/URL.
Bind that version once, record an ingest operation and transactional outbox, and
return 202 after D-24 recovery is armed. Duplicate completion returns the same
operation; conflicting version/config fails 409. A verified object alone creates
no source. Worker reauthorizes, GETs only the bound version, verifies the complete
digest, then parses under H4 row/cell/memory limits. Publish source + reservation
completion + usage conversion in a fenced transaction after rechecking expiry,
owner and revisions. Source data is an immutable durable object/manifest; do not
put the 8 MiB input into a Lambda event or depend on process-local staging.

Replay of the PUT gets S3 412; concurrent conflicting writes may get 409. After
uncertain PUT outcome, inspect reservation/completion status, not unconditional
overwrite. Cancel/expiry blocks completion immediately even if a signed PUT
remains usable. Do not delete the current upload object or create a delete marker
until every signature has expired plus a 10-minute grace: conditional PUT must
not become writable again during its capability window. Version binding remains
mandatory even with conditional writes. Object events are hints only.

**Payload/result limits:** API control JSON is proposed at 1 MiB UTF-8 before
decoding, with a separate 2 MiB entire event/response envelope check; header budget
16 KiB at the application boundary (stricter upstream limits still apply). A
larger imported definition must receive `CONTROL_PAYLOAD_TOO_LARGE` (413), not
truncation; D-28 explicitly approves this ceiling without a separate definition
transfer extension in the initial deployment. Existing 8 MiB file, 100,000-row, 256-column and H4
cell/decoded-memory caps remain. XLSX compression never bypasses decoded bounds.

Inline results fit 1 MiB including JSON escaping; larger legal results become
durable operations with immutable result manifests and chunks ≤1 MiB (binary
base64 plus envelope ≤2 MiB). Total encoded/decoded result bytes must stay within
the caller's H4 `resultBytes` and deployment ceiling; object storage does not
raise it. Result descriptors record schema, ordered chunk digests, total rows/
bytes, revisions and original refresh provenance. No partial success on overflow:
return the existing budget error and discard partial objects. Preserve current
response shapes for inline success; version/explicitly negotiate operation
responses in the hosted client before enabling them for existing routes.

Each chunk request verifies current tenant, owner or applicable reader/session,
policy and operation revisions both before object access and before returning
bytes. No public/presigned result GET and no multi-tenant result cache. Expire
temporary results after 15 minutes or earlier session/source expiry/revocation;
return `RESULT_EXPIRED` (410). Already downloaded bytes cannot be recalled.
Cleanup is triggered by each reservation/result's durable expiry event (D-24),
with S3 lifecycle as a backstop; logical expiry never waits for lifecycle deletion.
Unreferenced objects retain 24h grace, except backup-pinned versions. Security
tombstones are separate from byte GC and are never removed by bucket lifecycle.

**Acceptance:** wrong-tenant/owner/key/version/checksum/media/length; expired
signature/source; duplicate completion/changed idempotency body; simultaneous PUT
and completion/cancel; delete-marker/replay attempts; crash at every transition;
permission change between HEAD/GET/parse/publish; ZIP expansion; max-size supported
files; multi-chunk overflow/revocation and no stale response. Tests must prove
there is no ingest triggered solely by an object event.

Evidence: [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html),
[S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html),
[PutObject checksum/conditional API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html).
