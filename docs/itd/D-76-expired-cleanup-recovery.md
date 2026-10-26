---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-15
labels: [itd]
---

## Purpose

Recover stranded object-cleanup obligations whose events expired and were
terminalized, without replaying expired envelopes, hand-editing counters, or
shortening retention. Remote-dev scope: protocol, implementation, tests,
dry-run plan, operator acceptance procedure. AWS execution stays an operator
step after review.

## Scope

The 34 overdue cleanup obligations found by the #91 AWS inspection (exact
versions already absent per read-only S3 HEAD; gauges still holding the bytes),
and any future expired cleanup obligations in the same shape.

## Out of Scope

- The `AwsObjectDeletion` absence-classification defect: owned by the #91
  operator branch (`work/phase5-issue91-aws-acceptance`). This protocol reuses
  the collector as-is and benefits from that fix when it lands; it does not
  duplicate it.
- Quota adjustment, retention changes, DLQ redrive, arbitrary SQL.

### 🚧 ITD D-76 — How do expired object-cleanup obligations get recovered?

#### CONTEXT

Cleanup events carry a bounded envelope (`due_at`/`expires_at`, max 24h).
`DurableDispatch.inspect` terminalizes expired events, `DurableExecution.claim`
terminalizes expired work, and `DurableExecution.replay` refuses expired
envelopes (`DISPATCH_REPLAY_DENIED`). The #91 inspection found 34 cleanup
obligations across two pilot workspaces in exactly this state: every sampled
DLQ message matched an expired cleanup event, the exact S3 versions are already
gone (HEAD → 404), yet the ledger still holds the objects in `retiring` and
the gauges still count their bytes. Redriving the DLQ would acknowledge the
messages without releasing the storage — the envelopes reference dead outbox
rows that can never execute again.

#### THE PROBLEM

How can an operator release provably-absent objects' stranded quota with an
audited, bounded, replayable-safe procedure — reusing the collector's
exact-version proof and atomic ledger/gauge update — without inventing a
second deletion path?

#### OPTIONS CONSIDERED

1. ✅ **Prearm a fresh cleanup envelope per reviewed object, then run the
   unchanged `ObjectCollector`.** The recovery (`packages/api/src/object-recovery.ts`,
   `ObjectRecovery`) takes an explicit scope (deployment/tenant/namespace/owner)
   plus an explicit reviewed object-id list. For each object it rechecks, inside one
   transaction: current control epoch, ownership (the object row's
   tenant/namespace/owner must equal the scope — namespace isolation), object
   state, and the shared `objectProtection` check the collector itself runs
   (pins, minimum retention, accepted uploads, source bindings, cache
   manifests, result operations). It then prearms a FRESH outbox row
   — new event id, next aggregate revision, current epoch, fresh due/expires
   window, reusing the object's own `intent_id` (the outbox FK requires a live
   `sr_dispatch_intent` row) — terminalizes the superseded expired/old-epoch
   rows it replaces (exactly as `inspect()` would terminalize expired rows; the
   rows stay as audit evidence), and finally runs the unchanged
   `ObjectCollector.run` on the fresh envelope. The collector re-verifies pins
   and live references (accepted uploads, source bindings, cache manifests,
   result operations) under its own locks, proves exact-version absence
   (DELETE + HEAD 404 on the exact version, or HEAD-absence for unbound keys),
   and releases the gauge atomically with the ledger transition. A pending
   non-terminal obligation from the current epoch is resumed, never duplicated.
   Every per-object decision, superseded event id, new event id, revision, and
   epoch goes into a JSON audit report the CLI writes to an operator-chosen
   private path (mode 0600). Raw evidence never enters the repo.
2. Replay the expired envelopes with a relaxed expiry check. Rejected: it
   re-arms envelopes whose authorization context is stale and contradicts the
   D-24 envelope contract; a crash mid-replay has no prearmed recovery owner.
3. Hand-update the gauges/ledger in SQL. Rejected: no exact-version proof, no
   atomicity with the object state, unauditable.

#### REASONING

Option 1 is selected because it adds no second deletion path: the only code
that deletes objects and releases quota stays `ObjectCollector`/`ObjectLedger`.
The recovery is a bounded, audited *envelope replacement* — the same pattern
D-24 uses for continuations — plus strict input bounds (1–50 explicit object
ids, 60s–24h envelope window, identifier-validated scope). Idempotency falls
out of the existing machinery: already-absent exact versions release through
the normal proof path; a crash between prearm and collection leaves a pending
obligation the next run resumes; duplicate runs find `deleted` objects and
report `already-complete`; epoch changes abort with zero writes (fail closed);
403s/timeouts leave the obligation pending and the gauge untouched. The
operator-only CLI (`storage:recover`) needs no principal session, uses the
existing `PostgresMetadataDatabase` adapter (correct `?`→`$n` conversion) with
explicit verified TLS/CA for Aurora, and guarantees connection close in a
`finally` (idle database pause). Non-dry runs require the queue and Scheduler
configuration listed below, validated before opening the database. The CLI
shares one invocation-owned AWS transport between deletion and dispatch;
its transport audit records only acknowledged SQS or Scheduler deliveries.
Dry-run (`--dry-run`) performs the full assessment with zero writes, no AWS
credentials or dispatch configuration, and no delivery acknowledgements.

#### IMPLICATIONS

- The operator reviews the dry-run report before any real run; the reviewed
  object/event set is explicit — no blanket recovery.
- Superseded rows are terminalized, never deleted; the audit report links each
  fresh envelope to the expired obligations it replaces.
- Protected objects (pins, retention, live references, indefinite manifests)
  are never force-cleaned; the collector prearms continuations for the next
  eligible window and the report says so. A `protected-continued` result
  requires an external SQS/Scheduler acknowledgement before the original
  obligation is terminalized. A rejected delivery leaves the continuation
  pending, the original unfinished, and the gauge unchanged; recovery resumes
  the oldest unfinished obligation to retry the same continuation.
- Non-dry CLI runs fail closed with `DISPATCH_CONFIG_INVALID` before opening
  or writing the recovery database if dispatch configuration is missing,
  empty, or inconsistent. Set all seven keys: `OPENSIGHT_WORK_QUEUE_URL`,
  `OPENSIGHT_WORK_QUEUE_ARN`, `OPENSIGHT_RECOVERY_QUEUE_URL`,
  `OPENSIGHT_RECOVERY_QUEUE_ARN`, `OPENSIGHT_SCHEDULER_GROUP`,
  `OPENSIGHT_SCHEDULER_ROLE_ARN`, and `OPENSIGHT_SCHEDULER_DLQ_ARN`.
  Queue URLs/ARNs, AWS region and Scheduler destinations must agree. Pass
  the reviewed database deployment using `--deployment` (default `default`);
  that value also determines Scheduler identity, regardless of
  `OPENSIGHT_DEPLOYMENT` in the environment.
- `storage:recover` is the only new operator surface; no new tables, no
  migration, no schema checksum change.

## Dry-run plan

1. Operator selects the scope and the reviewed object set (from the #91
   inspection evidence: the 34 overdue obligations, per workspace).
2. `node dist/storage-recover-cli.js --tenant <t> --namespace <n> --owner <o> --objects <id,…> --audit-path <private-path> --dry-run`
   (sqlite dev path via `OPENSIGHT_METADATA_DATABASE`, or postgres via
   `OPENSIGHT_METADATA_POSTGRES` + `OPENSIGHT_METADATA_POSTGRES_CA`).
3. Review the JSON report on stdout and the audit file: every object must show
   `decision: "replace"` (or an expected `protected-*`/`already-complete`),
   with `supersededEventIds` matching the expired obligations from the
   inspection evidence and `aggregateRevision` one past the latest recorded.
   Any `scope-mismatch`, `unknown-object`, or `unexpected-state` stops the
   run — fix the reviewed set, do not proceed.
4. Confirm no writes happened: outbox row count and gauge values unchanged
   (the report's `dryRun: true` plus a `storage:inspect` before/after diff).

## Operator acceptance procedure

1. Confirm D-76 is approved (this file shows ✅) and the #91 operator branch's
   `AwsObjectDeletion` absence-classification fix is merged — the recovery
   relies on correct 404 classification for the DELETE+HEAD proof path.
2. Run the dry-run plan above against the pilot Aurora (read replica if
   available for the plan step; the real run needs the writer).
3. Configure all seven queue/Scheduler environment keys above, the invocation's
   AWS credentials/region, and `OPENSIGHT_ARTIFACT_BUCKET`. Run without
   `--dry-run`, one workspace at a time, with the reviewed `--deployment`.
   Invalid dispatch configuration stops before any database recovery work.
   Expected per object:
   `decision: "recovered"`, `newEventId` distinct from every superseded id.
   The CLI exits non-zero if any object reports `failed`, `epoch-changed`,
   `obligation-expired`, `scope-mismatch`, `unknown-object`, or
   `unexpected-state` — investigate, do not rerun blindly.
4. Verify with `storage:inspect`: `pendingCleanupBytes`/`overdueCount` drop by
   exactly the recovered objects' bytes; `reservedBytes`/`liveBytes` reconcile
   with the ledger (`sr_object` rows `deleted`, `sr_storage_usage` gauges).
5. Keep the audit files private (they contain object ids and event ids).
   Attach the report summary — not the raw file — to issue #96 when closing.
6. If any object reports `protected-continued`, its continuation obligation is
   already prearmed in the outbox and externally acknowledged by SQS/Scheduler
   using the required dispatch configuration; no operator action needed until
   its window elapses. The audit file's `transport` array contains the delivery
   acknowledgement. Failed sends produce `failed`, never a successful
   continuation acknowledgement; rerunning recovery retries the same obligation.

## Verification

`packages/api/test/object-recovery.test.mjs` (12 tests, sqlite): exact-once
gauge release on an already-absent key; duplicate run is a no-op; partial
completion (crash between prearm and collection) resumes the pending
obligation; expired fresh envelopes are superseded, never replayed; epoch
change aborts with zero writes; pin, minimum-retention, and live-reference
deferral at plan time; a reference landing between prearm and collection
still prearms a continuation at run time; 403/timeout retain the obligation;
namespace isolation (foreign/unknown objects untouched); dry-run writes
nothing; input validation; `close()` settles the connection.

Issue #130 adds `packages/api/test/storage-recover-cli.test.mjs`, included by
the existing root `npm test` API glob. It verifies all required configuration
keys and URL/ARN validation before I/O, audit ordering and rejection propagation,
MD5-verified recovery/work queue sends, Scheduler acknowledgements and CLI
deployment identity, and denial-only dry-run transport. SQLite races cover
both an already-dispatched original and a fresh pending original (whose flush
also delivers and audits that original), external continuation receipts, and
failed delivery with unchanged gauge/object state. Retrying reuses the same
continuation id and settles quota exactly once when protection ends. The retry
test exposed selection of the future continuation instead of its unfinished
original; recovery now selects the oldest unfinished obligation first.
`DurableDispatch` and `ObjectCollector` are unchanged.

A schema-isolated `PostgresMetadataDatabase` race runs when `DATABASE_URL` is
set. CLI subprocess tests verify rejection before creating a SQLite database,
credential-free dry-run with no writes and mode-0600 audit, the required
Postgres CA, and non-success exit status. AWS calls are stubbed; these tests
do not constitute AWS operator acceptance or change this ITD's draft status.
