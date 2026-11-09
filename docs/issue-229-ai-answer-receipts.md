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
request generates and charges anew. Expired rows are replaced on key reuse.

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

## Regression test names

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
