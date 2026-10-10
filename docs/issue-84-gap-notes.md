# Issue #84 — SR2 implementation evidence

## SR2a durable coordination

The [frozen coordination contract](phase5-sr2a-coordination.md) is implemented in
`packages/api/src/coordination-schema.ts` and `coordination.ts`. It provides
transactional aggregate admission, H8 refresh accounting, monotonically fenced
claims, bounded leases and SQL publication callbacks. Admission and publication
recheck current tenant, membership, role, revisions and maintenance/configuration.
Local worker exit and logical lease expiry are separate conditions: an obsolete
worker cannot publish, and its reserved capacity remains counted until confirmed
exit or the platform deadline plus quarantine.

The migration creates four tables only under explicit frozen maintenance. It
binds the existing H4 budget version and an entitlement snapshot derived from
`OPENSIGHT_ENTITLEMENTS`. It refuses foreign schema, changed configuration and
implicit resets. Claims retain scope/owner-bound attempt references and persistent
BIGINT fences. Tenant SQL receives no coordinator grants; scoped tables also
enable and force RLS. No additional bundled dependency is introduced.

The module is internal and not yet connected to Lambda tenant compute. Existing
maintenance, storage and dispatch guards remain. The current isolated AWS stack
has not received this schema or code; its pinned SR4a image remains unchanged.
There is no automatic migration, queue consumer or background SQL timer.

### Full verification

Root `npm test` ran offline in the pinned Linux ARM64 Lambda base, Node 24.21.0:
**2,274 passed / 0 failed / 13 skipped / 0 cancelled**, 2,287 total.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 362 | 0 | 11 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 502 | 0 | 2 |
| Web | 1,145 | 0 | 0 |
| Root conformance | 14 | 0 | 0 |

All thirteen skips require `DATABASE_URL`. Twelve are existing integrations;
the new SR2a integration was separately run successfully against local PostgreSQL
as described below. No tests or thresholds were relaxed. The test image rebuilt
both the hosted frontend and the offline demo after the full suite.

The rebuilt data landing demo was captured at 1280×800 and inspected. Its PNG
is byte-identical to the preceding SR4a capture; no UI source changed in SR2a.
The existing minimal-Linux-font icon gaps remain tracked in
[issue #87](https://github.com/tomesposito/opensight/issues/87) for SR3.
This comparison does not establish QuickSight visual fidelity. The demo remains
a static preview, not a deployed server.

### Focused verification

On 2026-10-10, all **19 focused tests passed / 0 failed / 0 skipped** on the
pinned Linux ARM64/Node 24 test base. This includes an actual PostgreSQL 16.15
test with independent pools and a restricted role. That test checks competing
admissions, persistent fences, composite foreign keys, enabled/forced RLS,
cross-scope reads, forbidden mutations and private configuration access.

The local test server used the official PostgreSQL image
`sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d`
on an internal Docker network, with synthetic data, temporary storage and no
published port. It did not contact AWS. PostgreSQL is operator/test infrastructure
under the repo's existing infrastructure-license rule, not a bundled dependency.

SQLite tests exercise actual transactions and rollback, competing coordinators,
full working/RSS reservations, refresh capacity, exact daily usage, duplicate
attempts, forged handles, revoked authority, expiry and late publication. Tests
also cover monotonic fences above JavaScript's safe integer range, cancellation
at BIGINT exhaustion, admission wait time and expiry inside publication. The
second SQLite connection proves persistence; PostgreSQL supplies the independent
pool/concurrency and RLS evidence. Neither is a claim of SR2 Aurora acceptance.

### Remaining #84 work

- Durable authoritative manifests/invalidation and the asynchronous hosted-cache
  adapter connecting SR2b's artifact mechanism to actual analytical callers.
- Upload reservation/completion/cancellation and current-authority checks at
  HEAD, ingest and source publication, following confirmed D-28 limits/UX.
- Durable operation/result framing, storage reservations and expiry, with D-24
  prearmed recovery before accepting work that creates an external obligation.
- Runtime integration and cross-engine/source/prep/report failure and parity
  evidence. Guarded application routes remain closed until that work is complete.
- Real browser signing/CORS and Aurora validation, alongside later SR3/SR4b
  event execution, idle client behavior and public deployment.

The new internal `publish` callback permits SQL work only. Artifact transfer,
analytics and SMTP must finish outside its transaction; publication then rechecks
authority. Callers must await contained-worker/socket exit before `release`.
Cancellation calls `revoke`; it is not proof that an old worker has stopped.
Later limit changes need a drained migration contract, not edits to the bound
configuration during active work. SR3 must also specify a background cold-wake
budget: SR1's short ordinary connection attempt is not by itself evidence that
an event can resume a sleeping database and complete.

## SR2b bounded artifact transfer

The [frozen transfer contract](phase5-sr2b-artifact-transfer.md) is implemented in
the query engine's `artifact-parquet.ts` and the API's `artifact-schema.ts` /
`artifact-transfer.ts`. The existing contained worker performs native encode and
decode. Artifacts preserve logical columns, original row order, numeric scalar
types, large integer strings, timestamp text and cached-input provenance.
Explicit DOUBLE parameter binding preserves negative zero, which DuckDB's
default integer inference otherwise changed in the round-trip test.

The native connection allows only its parent-created private file, disables
external access/extension installation and locks configuration. Heap, DuckDB
memory, RSS, row/text/decoded-byte and execution limits remain enforced by H4.
The parent checks file length and SHA-256 before native decode. Branded immutable
handles belong to one invocation, support idempotent disposal and expose no path.
Invocation cleanup owns all streams and removes remaining private directories.

The S3 transport derives keys from full scope/owner/resource identity and a UUID.
It sends conditional, checksummed PUTs; requires a real version ID; verifies that
exact version with HEAD; and pins GET to it. Streaming reads enforce the exact
length/checksum and discard partial files. Invalid references are denied before
I/O. Ambiguous writes are neither retried nor deleted speculatively. No endpoint,
bucket, credential or object path is accepted from an application request.

All **12 focused tests passed / 0 failed / 0 skipped** in the pinned Linux ARM64
environment. They exercise actual native round trips and file allowlisting,
scope/handle boundaries, caller mutation, corrupt physical schema and ordinals,
descriptor count/size mismatch, malformed/corrupt/truncated/surplus object bodies,
conditional/version-pinned SDK commands, cancellation and confirmed file/stream
cleanup. S3 responses are injected protocol fixtures; no cloud calls occurred.
No dependency was added.

Before integrating the subsequent upstream export fix, the full root `npm test`
run on artifact implementation `31f0bd2` passed **2,286 / 0 failed / 13 skipped /
0 cancelled**, 2,299 total. API: 372 passed and 11 live-PostgreSQL skips;
query engine: 504 passed and 2 live-PostgreSQL skips. All other suite counts
match the SR2a table above. No new skip was introduced. The pinned build also
rebuilt the hosted frontend and offline demo with networking disabled for build
and test execution.

The rebuilt 1280×800 data landing capture is byte-identical to SR2a and was
visually inspected. The existing Linux-font gaps remain tracked in #87. SR2b
changes no UI source, so no README image refresh is needed for its own changes.
This static demo comparison is not public deployment or a visual-fidelity claim.

This mechanism is intentionally not connected to a runtime route or factory.
SR2a admission, current SQL authority, durable manifests, storage reservations
and prearmed D-24 recovery must be integrated before accepting production
transfers. No successful upload alone makes a dataset readable. The isolated
AWS stack is unchanged, and this checkpoint supplies no browser CORS/signing or
real S3/Aurora acceptance evidence.
