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

- Durable manifests and asynchronous source/prep hydration are implemented in
  SR2c below; connect their storage preparation and admission to the runtime.
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

After merging upstream issue #79's Excel-export escaping fix, the full root suite
on combined source `133b4f5` passed **2,290 / 0 failed / 13 skipped /
0 cancelled**, 2,303 total. Web now has 1,149 passing tests; other counts are
unchanged. The hosted frontend and demo rebuilt successfully again; the combined
source's inspected demo capture matches the preceding SR2b PNG byte for byte. No test
threshold or skip policy was relaxed. Staged secret and cross-platform path
checks passed at each implementation checkpoint.

This mechanism is intentionally not connected to a runtime route or factory.
SR2a admission, current SQL authority, durable manifests, storage reservations
and prearmed D-24 recovery must be integrated before accepting production
transfers. No successful upload alone makes a dataset readable. The isolated
AWS stack is unchanged, and this checkpoint supplies no browser CORS/signing or
real S3/Aurora acceptance evidence.

## SR2c authoritative manifests and hosted hydration

The [frozen manifest contract](phase5-sr2c-manifests.md) is implemented in
`manifest-schema.ts`, `manifests.ts` and `artifact-cache.ts`. Refresh admission
now supports an internal SQL callback: claim/usage allocation, running state,
removal of old readable authority and the invalidation outbox commit together.
Ready publication appends immutable object history; both success and failure
require the original live attempt, scope, fence, generation and current authority.
A terminal generation cannot publish again. Released producers leave valid ready
artifacts available; revoked or replaced claims do not.

[D-29](itd/D-29-manifest-dependency-validation.md) replaces the proposed descendant
walker with complete, bounded dependency certificates. Reads and publication
validate all consumed generations, definition versions, namespace revisions and
SQL-time source expiry. This rejects stale descendants even after outbox loss,
without a timer that would wake an idle database. Certificates originate from
branded reads belonging to the same attempt; imported definitions cannot inject
an object reference or freshness assertion into them.

HostedData and HostedPrep await the cache interface. The local cache remains the
default. The artifact adapter downloads and decodes the exact current object,
disposes its local file and rechecks authority after hydration and before result
publication. Prepared outputs retain original consumed-cache timestamps. Actual
native Parquet tests compare hosted source/query and prepared results with the
local executor, including RLS/CLS and revocation during download. Production
object writes remain gated on explicit durable storage/recovery preparation.

The expanded focused suite passed **37 / 0 failed / 0 skipped / 0 cancelled**.
It includes the SR2a regressions and the real PostgreSQL integration, extended to
prove concurrent manifest publication, immutable-history visibility, forced RLS,
cross-scope denial and private-schema mutation refusal. SQLite coverage also
proves full rollback, independent store restart, equal IDs across tenants/owners,
actual delete/recreate without fence reset, expiry, lost notifications, authority
outage, copied/cross-attempt handles and bounded metadata. No AWS calls or new
dependencies were used in these tests.

The first full root suite passed **2,305 / 0 failed / 13 skipped / 0 cancelled**,
2,318 total. It covered all implementation changes; three additional manifest
acceptance tests were then added and included in the focused result above. The
hosted frontend and static demo rebuilt in the pinned offline Linux ARM64 build.
The inspected 1280×800 demo capture is byte-identical to SR2b's final capture.
The existing minimal-Linux-font gaps remain #87; there is no UI-source change or
new QuickSight visual-fidelity claim.

Final root `npm test` on complete source/test checkpoint `c62e744` passed
**2,308 / 0 failed / 13 skipped / 0 cancelled**, 2,321 total. API: 390 passed
and 11 live-PostgreSQL skips; query engine: 504 passed and 2 live-PostgreSQL skips;
web: 1,149 passed; bundle parser: 199; embedding SDK: 9; O interpreter: 32;
parity: 11; root conformance: 14. This run used the same pinned test image with
the final acceptance test files copied in, root `npm test` and networking disabled.
No implementation or frontend source changed between the two full runs. Secret,
cross-platform path and whitespace checks passed at both implementation commits.

The AWS validation functions remain unchanged and frozen; this local integration
is not a deployed app. Upload operations, storage reservation/recovery, runtime
activation and live browser/AWS acceptance remain the immediate deployment work.

Upstream issue #80's CSV-export formula guard was then merged without conflict.
Only `visual-export.ts`, its tests and web test configuration changed upstream.
The combined web suite passed **1,157 / 0 failed / 0 skipped / 0 cancelled**;
the hosted frontend and demo rebuilt offline. The combined demo was captured,
inspected and is byte-identical to the preceding SR2c PNG. Backend source is
unchanged from the complete 2,308-pass root run above; that earlier run is not
presented as a full root rerun of the subsequent upstream merge.

## SR2d client and runtime integration

Direct upload, bounded operation status/cancellation, source hydration and protected
result fragments now compose in the serverless runtime and browser. The final root
suite passed 2,378 / failed 0 / skipped 14 (all live-PostgreSQL-only skips), with
separate real-PostgreSQL role/migration checks. See the detailed
[SR2d evidence](phase5-sr2d-evidence.md). Synthetic browser captures and the README
GIF are current. The existing minimal-Linux font gap (#87) remains; no new product
layout gap was found. The tour harness was updated for the current connector dialog.

This is application implementation, not a public deployment. Idle embed/author
clients, cloud queue/CORS proof, ingress/release configuration and real tester
acceptance remain on the deployment path.

Upstream integration includes issues #87–#90. Its complete root suite passed
2,403 / failed 0 / skipped 14, followed by fresh hosted/demo builds and regenerated
README media. The navigation/data icons now use the upstream SVG fix; the earlier
glyph note is historical. This does not establish measured visual parity.

## SR3b idle clients

The accepted on-demand connection behavior now removes periodic authoring/session
and embed-status requests in the serverless profile. Idle embeds remove protected
data locally after 45 seconds and require Connect. The initial screen reuses the
existing sign-in styling; the embedded action uses existing embed button styling.
Synthetic browser checks show no initial/idle API requests, successful explicit
reconnect and no repeated bootstrap redemption. The refreshed demo tour reports
251 frames, zero page errors and zero external requests. No new visible layout
gap was found; QuickSight visual fidelity remains unmeasured. See
[SR3b evidence](phase5-sr3b-evidence.md) for exact test counts and the distinction
between local browser acceptance and the remaining public deployment work.

## SR4a public ingress

No product UI source changed. The rebuilt demo tour completed 251 frames without
page errors or external requests; 148 frames matched SR3b byte for byte. Visual
inspection found no new layout gap. README media still reflects the latest UI
phase. [Ingress evidence](phase5-sr4a-ingress-evidence.md) records the offline
suite and cloud checks separately; public application activation remains pending.

## SR4b1 initial activation candidate

No product UI source changed; the hosted frontend manifest is byte-identical to
SR4a. The rebuilt 251-frame tour completed without page errors or external
requests. Across frames and feature captures, 159 of 257 PNGs match the prior
capture exactly. Inspected differences are timestamps, focus animation and the
transient save toast. No new layout gap was found; existing README media remains
current. [Activation evidence](phase5-sr4b1-activation-evidence.md) records the
2,446-pass root suite and the remaining cloud activation/acceptance gates.

## SR4b2 row-lock repair comparison — 2026-10-11

The Linux ARM64 phase build rebuilt the demo and retained a byte-identical hosted
frontend/manifest. The new demo tour completed 251 frames with zero page errors
and zero external requests. Against SR4b1, 162 frames match byte for byte. The
inspected author frame differs in 109 pixels confined to the saved-time text
(x150–172, y97–107); its docks, field wells and sheet canvas match visually. No
new product UI change was introduced. README media remains current with the last
UI phase; visual fidelity against QuickSight is still unmeasured.

Real hosted acceptance exposed PostgreSQL row-lock permission denial at upload
reservation. This is addressed by SR4b2's constrained-column grant and tested
private repair, with fresh AWS browser acceptance required before DNS.
