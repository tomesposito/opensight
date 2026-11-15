# Hosted Ask O cancellation and answer receipts (#229)

Hosted `POST /api/o/generate`, `/api/o/calculation`, `/api/o/plan` and
`/api/o/revise` accept an optional `Idempotency-Key` header: 1–512 ASCII
letters, digits, underscores or hyphens. Invalid keys return 400
`METADATA_INVALID`. `/api/o/status` and `/api/o/query` have no receipt contract.
Without a key (or without a configured receipt store), answer behavior is
unchanged except for cancellation checks. The local plane is unchanged.

A key identifies a request within its tenant, namespace, user and route.
The fingerprint is SHA-256 of canonical JSON containing the path and request
body; object property order does not matter. Reusing an unexpired key with a
different body returns 409 `IDEMPOTENCY_CONFLICT`. Receipts expire 60 minutes
after creation; an expired receipt is treated as absent and a subsequent
request generates and charges anew. Expiration cleanup also runs independently
of key reuse, as described below.

Only the validated answer-function result is stored, never raw provider text.
A plan stores its whole answer, including failed/credit-limited tiles and the
delivered count. The receipt is written as `pending` before credit commit and
flipped to `committed` after success. Commit failure or cancellation after
persistence leaves it pending. Retrying a pending receipt completes the stored
credit count without generating again; committed receipts return the stored
result verbatim without a provider call, additional credits or analytics recount.
Both replay paths send `Idempotent-Replayed: true`. The original managed/BYO
credit mode is retained; token-spend accounting is unchanged.

Delivery still requires the route's authorization recheck, source resolution
and current schema access. The receipt's authorization, policy and configuration
revision stamp must also still match (`METADATA_REVISED`, 403 otherwise), so a
past answer cannot bypass later column restrictions or changed governed metrics.
Authorization failures deliver nothing. Provider, validation, PII and
post-provider recheck failures create no answer receipt and charge no answer
credits.

Cancellation is checked after provider completion and immediately before credit
commit, including pending-receipt recovery. An aborted request fails with
`EXECUTION_CANCELLED` (409). A disconnect while the provider is still running
creates no receipt and consumes no answer credits; a retry generates again.
Provider token spend remains recorded as operator cost even for cancelled or
rejected answers. A disconnect after successful credit/receipt commit can recover
the stored answer with its key.

Concurrent attempts for the same scoped key fail closed with 409
`IDEMPOTENCY_CONFLICT`, including identical requests. A separate database
reservation is acquired before any provider call and released in `finally`;
it contains no answer. Its unique key also excludes other serverless workers.
The reservation leases for one minute and renews every 20 seconds during work.
A worker that loses its lease cannot persist or recover a charge. After a crash,
a retry may conflict until that lease expires, then recover the pending answer.
Normal later retries replay immediately after the first attempt finishes.

There remains one narrow double-charge window: credit commit and the receipt's
transition to `committed` are separate transactions. If the process dies (or the
receipt update fails) after the charge succeeds but before that transition, the
receipt stays `pending` and its retry commits the stored count again. Receipts do
not provide atomic exactly-once accounting across those two transactions.

`initializeAiAnswerReceipts` creates `ai_answer_receipts` and
`ai_answer_receipt_reservations` on the membership database for single-node
startup. Serverless invocations perform no DDL; the additive owner migration
creates these tables and grants runtime access. Both stores participate in tenant
erasure and backup/restore; snapshots predating them remain supported. Receipts
use their own database store so reader AI users need no metadata write capability.
No endpoints, web-client retries or dependencies were added.

## Expiration cleanup and tenant admission (#249)

Every `run()` starts by pruning expired receipts and abandoned reservations in
its first transaction, before acquiring its reservation and reading a replay.
`HostedAIReceipts.pruneExpired()` exposes the same cleanup for maintenance without
generating an answer. Each table is processed in batches of at most 500 full
primary keys, stopping after a short batch or 20 batches per table. A call removes
at most 10,000 expired rows per table; repeated calls converge on a larger
backlog. Requests from any tenant trigger this global cleanup. Scope-specific
cleanup also lets the current key recover even if the global batch budget is
exhausted.

An expired receipt is protected while an unexpired reservation exists for its
exact tenant, namespace, user, route and idempotency key. This keeps a receipt
already read for replay available through the active attempt. Live reservations
and unexpired receipts are never pruned; after a reservation expires or is
released, its expired receipt becomes eligible. Both tables have `expires_at`
indexes, and receipts also have a `(tenant_id, expires_at)` index.
`CREATE INDEX IF NOT EXISTS` adds them when the initializer runs against an
existing database, including through the owner migration for serverless.

`HostedAIReceipts(db, clock, env)` accepts an optional environment argument,
defaulting to `process.env`; the existing `(db)` and `(db, clock)` forms still
work. The following limits apply to each tenant across all namespaces, users,
routes and keys, including pending and committed receipts:

| Variable | Default |
| --- | --- |
| `OPENSIGHT_AI_RECEIPT_PER_TENANT_MAX_ENTRIES` | 250 |
| `OPENSIGHT_AI_RECEIPT_PER_TENANT_MAX_BYTES` | 16,777,216 (16 MiB) |

Values must be positive safe integers written as decimal digits without leading
zeros; invalid values fail construction with an error naming the variable.
Inside `pending()`'s write transaction, after lease renewal, expired receipts for
the tenant are removed with the same active-reservation protection. Admission
then aggregates `COUNT(*)` and `SUM(LENGTH(answer) + LENGTH(revisions))` over the
remaining stored rows. The incoming row's size is the sum of
`Buffer.byteLength(JSON.stringify(answer))` and
`Buffer.byteLength(JSON.stringify(revisions))`; the budget excludes keys and
database overhead. Protected expired receipts still count toward admission.
If adding the row would exceed either limit, the transaction fails with
`IDEMPOTENCY_CAPACITY_EXCEEDED` (429) and inserts nothing. Other tenants retain
their own capacity, and replaying a stored receipt needs no new admission.

## Regression test names

- #249 initialization adds expiry and tenant indexes to existing receipt tables
- #249 unrelated tenant requests prune distinct expired receipts and abandoned reservations
- #249 pruning protects only the full scope of a live replay reservation until its lease expires
- #249 expiration maintenance bounds each table to twenty batches of five hundred and converges
- #249 tenant entry admission rejects overflow atomically across keys and namespaces
- #249 tenant byte admission counts answer and revisions and rejects oversized or aggregate overflow
- #249 pending admission reclaims receipts expiring during generation but protects active replays
- #249 receipt admission limits require positive safe integers
- #229 receipts preserve pending answers after commit failure and replay across store instances
- #229 receipt reservations exclude concurrent workers, release failures and fence expired owners
- #229 receipt fingerprints conflict, scope isolates keys and TTL regenerates after 60 minutes
- #229 active receipt reservations renew with fake timers and reject overlapping workers
- #229 disconnect before provider completion charges nothing and retry regenerates
- #229 response loss replays the identical answer without provider, credit or analytics recount
- #229 disconnect after credit commit recovers the answer with one total charge
- #229 changed request and simultaneous same-key attempts conflict before provider or charge
- #229 receipt keys isolate reader users
- #229 expired receipt regenerates and charges a fresh answer
- #229 pending receipt survives credit failure and retry completes its stored count
- #229 cancellation after validation keeps a pending receipt for a credit-only retry
- #229 calculation receipt replays the whole validated result and original credit count
- #229 plan receipt replays the whole validated result and original credit count
- #229 revise receipt replays the whole validated result and original credit count
- #229 invalid keys and rejected provider answers never create receipts or charges
- #229 authorization revocation blocks generated and replayed receipts
- #229 policy revisions block stale answer replay even while AI capability remains
- #229 keyed requests without a configured receipt store retain unkeyed behavior
- #229 BYO receipts replay without managed credits or additional provider calls
- #229 generate checks cancellation immediately before credit commit
- #229 calculation checks cancellation immediately before credit commit
- #229 plan checks cancellation immediately before credit commit
- #229 revise checks cancellation immediately before credit commit
- #229 serverless backups preserve answer receipts and migrate pre-receipt inventories
- #229 single-node backup restores optional durable answer receipts into older installations
- #229 tenant erasure removes optional answer receipts and in-flight reservations only for that tenant
