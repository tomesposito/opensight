---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-10
labels: [itd]
---

## Purpose

Make committed work recoverable without an always-running database poller.

## Scope

Outbox dispatch, due occurrences, cancellation, dead letters and real delivery.

## Out of Scope

Exactly-once email, service-principal continuation and new scheduling semantics.

### 🚧 ITD D-24 — What event protocol closes the commit-to-dispatch crash gap?

#### CONTEXT

H7 persists occurrences/deliveries but its current runner assumes one scheduler
and resets running state on recovery. An outbox followed by an unprotected send
can strand committed work if Lambda dies between them. Periodically scanning
PostgreSQL would prevent the selected idle behavior. Email acceptance followed
by a lost SQL receipt remains ambiguous even with durable queues.

#### THE PROBLEM

How can every committed obligation acquire durable external recovery while
preserving cancellation, current authorization and bounded idle behavior?

#### OPTIONS CONSIDERED

1. [WIP] Arm a delayed recovery event before committing business work; persist
   outbox/occurrences atomically and use fenced, idempotent event consumers.
2. [WIP] Poll the outbox on a permanent interval.
3. [WIP] Send only after commit and recover on the next user request.

#### REASONING

Option 1 is proposed: a redundant event can reconcile the commit after a crash,
and only actual work causes retries. It requires an explicit intent protocol;
"transactional outbox" alone does not solve external dispatch. Option 2 is
simpler but conflicts with idle pause. Option 3 leaves schedules/invitations
stranded indefinitely when no user returns. CDC/logical replication is not a
hidden fourth choice because it has pause, cost and operational implications.

#### IMPLICATIONS

**Records and event envelope:** add `sr_dispatch_intent` keyed by random intent
ID with scope, initiator, canonical request hash, expiry, state
`prepared/committed/aborted`, and operation/outbox references. It contains no
plaintext credential or executable caller input. `sr_outbox` has a monotonic
event ID, scope, aggregate ID/revision, kind, payload schema version, due time,
delivery state, attempts and claim fence. Unique `(scope, aggregate, revision,
kind)` makes repeated publication idempotent. Events ≤4 KiB contain only version,
deployment epoch, event/intent ID, kind and opaque scope/resource references.
Never include rows, tokens, SMTP bodies, recipient addresses or secrets.

**Commit protocol, required for every transition creating an external obligation:**

1. Authorize and admit the proposed action. In a short transaction create a
   `prepared` intent with 60-second commit eligibility; bind its idempotency key
   and request digest. This is not an accepted business operation and does not
   create an occurrence/source/schedule or expose success to the caller.
2. Send a recovery message containing the intent ID to the dedicated SQS recovery
   queue with a 60-second delay. Require a successful acknowledgement before
   entering the business transaction. A send timeout/ambiguous response means
   **do not commit business work**; duplicate orphan messages are harmless.
3. In the business transaction lock the intent row and recheck `prepared`,
   request digest, current authorization and unexpired commit eligibility using
   database time. Write the occurrence/operation/schedule mutation and its outbox
   records, then set intent `committed`, all atomically. The D-23 transaction
   deadline applies. Reply only after commit; retries return the same authorized
   operation for the same request digest.
4. Attempt immediate outbox publication within the invocation deadline. Mark a
   row dispatched only after acknowledgement. If publication or its receipt
   transaction is ambiguous, leave it pending; the prearmed recovery event
   guarantees another attempt while the queue retention/retry contract holds.
5. Recovery locks the same intent. If committed, reconcile its pending outbox;
   if still prepared at/after expiry, atomically abort it. This row lock resolves
   a late-commit race: recovery cannot declare absence while an unseen transaction
   can later commit, and an aborted intent cannot authorize a new commit. Lock/
   store unavailability retries the event, never treats it as absent success.

Crash before step 2 leaves only an unaccepted prepared intent; it can be expired
on the next scoped activity/operator maintenance and has no business work to
dispatch. Cap such intents (8/owner, 32/tenant), collect expired entries before
admission, and refuse more if metadata is unavailable. A separate periodic DB
cleanup is unnecessary. Crash after recovery is armed always has either no
business effect or a discoverable committed outbox. The recovery path uses the
same event as its retry vehicle; it does not recursively create new business
intents just to retry dispatch.

**Queues and schedules:** use standard SQS work and recovery queues, each with
a DLQ, batch size 1, partial-batch failure reporting enabled, bounded Lambda
concurrency and no in-process consumer loop. Candidate worker timeout is 120s
(110s work, final 10s cleanup); SQS visibility 720s (six times timeout), max
receive count 5, source retention 4 days and DLQ retention 14 days. Business
attempts also stop after 24h or an earlier operation/source expiry. Exceeding
those bounds records terminal failure if SQL is available and emits a safe
alarm; transport failure while SQL is down reaches DLQ rather than silent success.
These limits bound automated retries, not guarantee a recovery deadline.

For each actual enabled schedule create a revision-specific one-time Scheduler
entry targeting the work queue with a due hint and flexible window disabled.
Name it by a bounded hash of deployment/scope/job/revision/due; use deterministic
client token and delete-after-completion. Idempotent reconciliation GETs and
compares an existing schedule before treating a conflict as success. Only the
dispatcher can manage the deployment's schedule group/pass the exact target role.
Scheduler retries are bounded (5 attempts/1h) with its own DLQ target. There is
no repeating "check if any jobs exist" schedule.

A due hint is not permission to run and is not yet a committed occurrence.
The consumer reads current job/owner/revision, coalesces missed intervals according
to H7, and uses the intent protocol to insert the durable occurrence and execution
outbox before dispatch. Preserve the existing unique `(scope, job, jobVersion,
due)` key. Refresh's next due is computed from completion after success or
failure; manual and scheduled refresh share D-23's dataset claim. Alert events
are tied to refresh occurrence IDs and the existing transition/coalescing rules.
When a dispatcher finds a due time already past, it sends one coalesced due hint,
not a catch-up series. A schedule edit creates the new revision's intent/outbox
and retires the old schedule; stale triggers no-op against current SQL revision.

Upload/result expiry, claim expiry and orphan cleanup use the same per-obligation
event protocol. A running operation requiring a future recovery step must arm
that step before releasing its last incoming event receipt. A consumer deletes/
acknowledges its message only after committing the outcome or durably arming a
continuation. Crash before ack redelivers; terminal/obsolete/cancelled events
acknowledge after authoritative verification. Broker deduplication is never the
correctness mechanism.

**Execution and cancellation:** D-23 admission/fence protects each attempt;
never globally reset all running rows as H7's single-process recovery does.
Cancellation atomically increments the operation/job revision, revokes its claim
and cancels pending delivery/outbox work. Publish cancellation/cleanup hints for
in-flight workers; checks at renewals and before every publication are authoritative
even if the hint is lost. Stop/transfer/delete of an owner retains HQ-13's explicit
transfer-or-stop semantics and never creates a service principal. Completed
external effects cannot be undone by cancellation; expose safe terminal state.

**Delivery:** uniquely identify each `(scope, occurrence, recipient)` delivery.
Use a fenced send claim with `pending/sending/sent/cancelled/failed/ambiguous`
states and a stable dedupe key/Message-ID. Before rendering and again immediately
before SMTP DATA, resolve current active tenant, current owner, job revision,
recipient membership/permissions, source expiry and RLS/CLS. Render for that
recipient, not an old owner-wide body. Invitation delivery checks the current
invitation, membership, expiry and address; never send a revoked enrollment token.
Persist sensitive delivery material only encrypted/scoped when necessary;
event payloads and logs never contain it. Real SES SMTP is D-19's route, not a stub.

SQL authorization immediately before DATA is the send authorization linearization
point. Do not hold a SQL transaction across the SMTP network wait. A permission
change committed after that check may race with already-authorized transmission;
this is not retractable mail. If the check fails or cannot finish, close the
socket without DATA. SMTP timeout remains within the active worker budget.
Acceptance of DATA is the external effect; lost QUIT must not trigger a resend.
Crash after DATA acceptance but before receipt commit records/reconciles ambiguity
and may retry with the same dedupe key under H7's at-least-once semantics. SMTP
does not guarantee deduplication; duplicate mail remains a documented possibility.
Limit delivery attempts to 5 within 24h and reauthorize on every attempt.

**DLQ and recovery:** use queue age/depth service metrics and an operator alert
that does not query Aurora. Retain safe event IDs and error classes, not payload
dumps. A private operator replay checks deployment/schema epoch, current scope,
job revision, expiry, entitlement and delivery state before issuing a new recovery
attempt; bulk blind redrive is prohibited. No replay of revoked/expired work or
an ambiguous email without its ambiguity policy. An outage longer than retention
requires a reviewed operator outbox reconciliation on recovery; this is an explicit
availability limit, not an unconditional poller. Drain stops new admission,
disables dispatch/event mappings through private operations, and preserves durable
rows/DLQs for reauthorization on resume. Empty queues create no SQL invocations.

**Acceptance:** terminate at all five commit steps, including lost SQS ack,
concurrent recovery/commit and lost outbox receipt; duplicate/out-of-order hints,
past-due schedules, edit/cancel while queued/running/sending, expired worker,
revoked recipient, failed mail authorization, DATA/receipt ambiguity, poisoned
event/schema, full DLQ and operator replay. Fake-timer idle tests assert zero DB
queries when no obligation exists. SR5 validates actual redelivery/retention.

Evidence: [Lambda SQS error handling](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html),
[SQS event-source configuration](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html),
[Scheduler retry/DLQ](https://docs.aws.amazon.com/scheduler/latest/UserGuide/configuring-schedule-dlq.html).
