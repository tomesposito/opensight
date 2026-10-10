# Phase 5 SR2b — frozen artifact transfer contract

This second #84 checkpoint implements the bounded Parquet and immutable-object
mechanism required by D-23. It is internal preparation, with no application route,
runtime factory wiring, SQL migration or cloud mutation. Durable manifests,
invalidation, storage reservations, D-24 prearmed recovery and the asynchronous
hosted-cache adapter remain the next integration contract. The existing runtime
storage/dispatch gates stay closed. A successful object transfer is not published
dataset authority.

## Interfaces and ownership

Add an internal artifact codec and S3 transport using the existing DuckDB and AWS
SDK dependencies. Every operation requires an active `InvocationScope` and a
live H4 `WorkScope`. The eventual runtime caller must additionally hold SR2a
admission and current SQL authorization. The transfer layer itself cannot grant
access or mint a reusable authorization context.

`encode(scope, table, limits)` writes a complete file in a unique child directory
of the invocation's private temporary directory and returns a branded, immutable
local artifact handle. `decode(scope, handle, limits)` verifies the exact encoded
length and SHA-256 before starting the native worker, validates physical schema,
and returns a bounded Blaze table. Handles cannot be copied, forged or reused in
another invocation. Closing a handle removes its directory, is idempotent and
prevents further use. Invocation exit removes all remaining files even after
failure or hard worker termination; next invocation entry handles process-kill
remnants under SR1's existing contract.

Limits are positive safe integers: encoded bytes, decoded bytes, rows, columns
and row text characters. Encoded/decoded bounds must fit H4 working bytes;
columns are at most 256, rows cannot exceed the H4 source row ceiling and the
row-text limit cannot exceed H4. Input/output copies count against working
memory. A handle's descriptor contains only format version, logical columns,
row count, conservative decoded bytes, encoded bytes, SHA-256 and original
cached-input provenance. All structured arguments are cloned and strictly
validated before the first await. Do not accept a caller path, URL or SQL.

## Lossless Parquet format v1

Use `opensight-parquet-v1`, ZSTD compression and an explicit zero-based row
ordinal. Logical names and types remain in the descriptor. Physical names are
generated (`c0`, etc.); no user identifier enters SQL. STRING/DATETIME use VARCHAR
and BOOLEAN uses BOOLEAN. INTEGER/DECIMAL use two nullable physical columns:
DOUBLE for finite JavaScript numbers and VARCHAR for canonical integer strings.
Exactly one is non-null for a non-null scalar. This preserves the existing
normalizer's large-integer strings without DOUBLE rounding, as well as the
original timestamp spelling. INTEGER numbers must be integral. No implicit
numeric/date coercion, NaN/infinity, nested values or unsupported logical types.

The descriptor retains original cached-input dataset IDs and refresh timestamps;
they are not replaced with hydration time. Bound columns/names, provenance count
(at most 256), dataset IDs (at most 512 characters) and timestamp syntax. Rebuild
the conservative Blaze byte count from the actual logical rows and provenance.
Validate the exact physical column names/types, contiguous ordinals, row count
and decoded byte count when reading. Invalid, partial or surplus content fails
closed with a named artifact error; there is no fallback to live sources.

Parquet encode/decode runs in the existing Linux child process with H4 heap,
native memory, RSS and deadline containment, independent watchdog and reaping.
The parent creates the private path; DuckDB is configured with that exact
`allowed_paths` entry, then disables external access and locks configuration
before executing fixed internal SQL. Extension auto-install/load and disk spill
remain disabled. Parameterize the path and scalar values. Decode with bounded
chunks and a row-text guard before materializing strings in JavaScript. The
worker has no AWS credentials or network endpoint configuration. Normal/error
completion closes DuckDB; parent cleanup handles killed workers.

## Immutable object transfer

The transport receives only operator-configured bucket/prefix and an
invocation-owned `InvocationAws`; no request selects either. Validate configuration
and generate keys from SHA-256 of the complete tenant/namespace/owner/kind/resource
identity plus a fresh UUID. Equal resource IDs in different scopes never share a
key. Identity fields are bounded and kind is source/prepared-dataset. Object
references contain this identity, generated key, exact version ID and descriptor.
They contain no bucket, endpoint, credentials or signed URL.

Upload streams the file with exact Content-Length, Parquet content type,
SHA-256 checksum and `If-None-Match: *`. Require a nonempty, non-`null` version ID
and then HEAD that exact version to verify length/checksum/content type. An
ambiguous/failed PUT may leave an orphan; do not retry or issue an unversioned
delete. The later obligation/recovery layer must reserve storage and prearm
cleanup before any production use. This checkpoint exposes no deletion or GC.

Download validates the reference against the server-derived full identity and
configured prefix before I/O. GET always specifies the exact version with
checksum mode enabled. Verify response version, size, content type and checksum,
stream to a new exclusive private file with a hard byte ceiling and incremental
SHA-256, then validate the completed digest before returning a branded handle.
Partial files are removed. No implicit latest-version read, cross-scope reuse,
multipart assembly, warm disk cache, unbounded `transformToByteArray` or retry.

Use `InvocationAws.call` for bounded request and body consumption, with WorkScope
cancellation connected to the request and stream. Await owned streams/file
handles closing on every path. Raw AWS/native diagnostics and object paths must
not escape; preserve existing cancellation/budget errors and otherwise return
named artifact integrity/unavailable/configuration errors.

## Acceptance

Root tests cover lossless typed round trips (null, Unicode, empty input, large
integer strings, decimals, timestamps, order and provenance), schema/count/digest
corruption, row/column/text/encoded/decoded caps, cancellation and file cleanup.
Use the actual native contained worker in the pinned Linux test environment.
Prove the file allowlist denies another temporary file and configuration changes.
S3 tests use injected SDK transport responses to verify conditional writes,
checksums, version-pinned HEAD/GET, scope-key isolation, malformed references,
short/extra/corrupt streams, aborted transfers and ambiguous writes without retry.
These are protocol tests, not claims of live S3/Aurora or browser CORS acceptance.

Run the full root suite, rebuild/capture the demo, scan public changes and record
exact counts. Later SQL authority, cross-engine hydration integration and real
AWS acceptance remain explicit #84/SR5 gates.
