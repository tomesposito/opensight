---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-12
labels: [itd]
---

## Purpose

Make committed work recoverable without an always-running database poller.

## Scope

Outbox dispatch, due occurrences, cancellation, dead letters and real delivery.

## Out of Scope

Exactly-once email, service-principal continuation and new scheduling semantics.

### ✅ ITD D-24 — What event protocol closes the commit-to-dispatch crash gap?

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

1. ✅ **Arm a delayed recovery event before committing business work; persist
   outbox/occurrences atomically and use fenced, idempotent event consumers.**
2. Poll the outbox on a permanent interval.
3. Send only after commit and recover on the next user request.

#### REASONING

Option 1 is selected: a redundant event can reconcile the commit after a crash,
and only actual work causes retries. It requires an explicit intent protocol;
"transactional outbox" alone does not solve external dispatch. Option 2 is
simpler but conflicts with idle pause. Option 3 leaves schedules/invitations
stranded indefinitely when no user returns. CDC/logical replication is not a
hidden fourth choice because it has pause, cost and operational implications.

#### IMPLICATIONS

**Records and event envelope:** add `sr_dispatch_intent` keyed by random intent
ID with scope, initiator, canonical request hash, expiry, state
`prepared/committed/aborted`, and operation/outbox references. It contains no
plaintext credential or executable caller input. `sr_outbox` has an opaque UUID
event ID, scope, aggregate ID/revision, kind, payload schema version, due time,
delivery state. The additive `sr_execution` record owns attempts and claim fence. Unique `(scope, aggregate, revision,
kind)` makes repeated publication idempotent. Events ≤4 KiB have exactly `{version: 1, deploymentEpoch: positive integer,
eventId: opaque identifier, kind: "execute" | "due" | "recover"}`. For recovery,
`eventId` identifies an intent; otherwise it identifies an outbox record. Scope,
aggregate, revision and business kind are resolved from SQL, never the message.
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
concurrency and no in-process consumer loop. Worker timeout is 120s
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
and logically retires the old schedule (its one-shot entry expires automatically); stale triggers no-op against current SQL revision.

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
and cancels pending delivery/outbox work. Checks during active work and before every publication are authoritative;
queued obsolete events become no-ops without requiring a cancellation hint. Stop/transfer/delete of an owner retains HQ-13's explicit
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

**Frozen SR2 interfaces (issue #85, 2026-10-12):** retain
`DurableDispatch.prepare/commit/commitOn/dispatch/recover/inspect/terminal`,
`DispatchTransport.recover/dispatch`, the v1 dispatch schema/checksum and
`DurableCoordinator.admit/renew/publish/revoke/release`. An additive, frozen/drained
migration installs `sr_execution_schema` and `sr_execution`; it does not rewrite
SR2 migrations. The execution row is keyed by deployment/event, references its
outbox row, and records a monotonic fence, random attempt token, attempt count,
lease deadline, state and safe error code. Claims use database time under the
control lock; they live no longer than 110 seconds and are never renewed while
idle. An overlapping live claim is retryable, never an acknowledged no-op.
After a crash, the incoming SQS receipt remains the recovery vehicle. Five
business claims or event expiry ends automated execution, recording terminal
failure and updating the referenced operation/occurrence/delivery where applicable.
Transport/store failures remain unacknowledged for the broker DLQ; application
terminal failures are recorded in SQL. No SQL transaction spans external I/O.

H7 retains its job, occurrence and delivery records and public validation rules.
Job mutations prearm through `DurableDispatch` before the atomic job/outbox write.
Business kinds add `job-due`, `job-execute`, and `job-deliver`; the envelope does
not grow. A job-due aggregate identifies a revision and due instant; execute and
deliver aggregates identify the occurrence and delivery. Due handling coalesces
using H7's existing unique keys. Work created while processing an incoming event
is committed with its outbox under that event's intent and flushed before ack;
a replay of an already completed parent still flushes pending children. This
receipt-owned continuation closes the outcome-to-next-event gap without an idle
poller. It permits up to 50 per-recipient delivery events, published individually.
Reports arm their next due when claimed; refresh arms its next due from completion
(including failure). Alert occurrences remain tied to refresh occurrence IDs.
Configured prepared refresh schedules use the same mechanism. Job stop/revision,
owner disposition, occurrence state and current H1 revisions fence every attempt.
The Lambda composition must never instantiate H7's polling recovery as its worker.

The new event runner preserves `JobStore.checkRun`, active membership, owner
build permission, tenant status, source and recipient RLS/CLS checks. It renders
fresh for each recipient on every attempt and stores no rendered body in the
outbox or execution record. The send callback checks the execution token/fence,
current job/occurrence, current owner and recipient authority, and the recipient's
current address before DATA. A claimed delivery interrupted after starting SMTP
is marked ambiguous on recovery; replay requires explicit acceptance of duplicate
mail, keeps its stable Message-ID, and never resets attempts, expiry or authority.
Private operator replay is identifier-scoped, reauthorizes current business state,
refuses terminal/obsolete/expired work, and reissues only bounded outstanding work.
There is no blind queue redrive or automatic revival of failed business work.

Deployment delivery resolves the configured SMTP secret at invocation entry to
`SMTP_USER`/`SMTP_PASSWORD` options for `smtpFromEnvironment`; missing host, sender
or secret returns `SMTP_NOT_CONFIGURED`, never `StubMailTransport`. Implicit TLS,
SNI and certificate verification remain mandatory. A typed egress selector accepts
only the configured IPv6 profile and exact regional Secrets/SQS/Scheduler/SES
hosts; S3 keeps its gateway route. Invalid profiles/destinations return
`EGRESS_ROUTE_UNSUPPORTED` / `EGRESS_ENDPOINT_INVALID`; no NAT, paid endpoint,
IPv4 retry or TLS downgrade is inferred. Transport family and endpoint selection
are injectable in local tests; only the operator can prove actual reachability.
Existing non-Lambda local/reference scheduling behavior remains supported.

**Acceptance:** terminate at every commit step, including lost recovery ack,
concurrent recovery/commit and lost outbox receipt; duplicate/out-of-order hints,
past-due schedules, edit/cancel while queued/running/sending, expired worker,
revoked recipient, failed mail authorization, DATA/receipt ambiguity, poisoned
event/schema, broker DLQ routing and operator replay. Fake-timer idle tests assert
zero DB queries when no obligation exists. Run the full root test suite. Actual
SQS/Scheduler/SES delivery, IAM, Terraform apply, subnet/IPv6 reachability and
service alarms/retention remain Tom's cloud evidence. WAF/IP allowlist and
resource/cost decisions remain separate gates. This freeze authorizes no AWS
calls, spending, private repository creation or live workflow activation.

Evidence: [SR2 runtime integration](../phase5-developer-handoff.md),
[Lambda SQS error handling](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html),
[SQS event-source configuration](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html),
[Scheduler retry/DLQ](https://docs.aws.amazon.com/scheduler/latest/UserGuide/configuring-schedule-dlq.html).
