# Phase 5 SR3 — durable background execution (issue #85)

This implements the non-AWS portions of checkboxes 1–6 under the frozen
[ITD D-24](itd/D-24-serverless-job-dispatch.md). SR3b's idle embed UI remains a
separate completed slice. Local tests do not establish cloud acceptance.

## Implementation and evidence map

| Checkbox | Implementation | Local evidence |
| --- | --- | --- |
| 1. Freeze | D-24, including immutable recurring due identities; separate spec commits before implementation | The v1 envelope and existing SR2 schema checksums are preserved |
| 2. Operations / scheduling | `dispatch.ts`, `durable-execution.ts`, `job-dispatch.ts`, `durable-jobs.ts`, `serverless-worker.ts`; existing Terraform work/recovery queues and three DLQs | `dispatch-aws`, `durable-execution`, `durable-jobs`, `sr3-queue` tests |
| 3. Crash gaps / recovery | Prearmed initial mutations and operator replay; receipt-owned continuations; SQL fences, bounded retries, cancellation and terminal outcomes | Lost commit/send/outbox/outcome/mail receipts, obsolete publishers, duplicate events, replay denial and fifth-attempt continuation tests |
| 4. Real SMTP | `serverless-mail.ts` composes `smtpFromEnvironment`; the Lambda path has no default stub | Secret/configuration tests, injected SMTP protocol tests, real renderer with recipient RLS/CLS, current owner/tenant/recipient checks |
| 5. IPv6 | `egress.ts` and `InvocationAws` pin exact regional endpoints; SMTP pins IPv6 and verified TLS | Endpoint/profile rejection, socket options, TLS-error and no-fallback tests |
| 6. Fault injection / idle | No event runner tick, unconditional heartbeat, queue receive loop or global running-state reset | Transaction/transport fault injection, source-bound single-record broker model, fake-timer zero-idle-query test; full root suite |

Test files live in `packages/api/test/` and are included automatically by root
`npm test`. Existing SR2 native worker/admission/refresh tests and H7 tests remain
in that suite. The local broker model proves how returned failures interact with
the configured retry policy; actual AWS redelivery and DLQ behavior remain a
cloud gate.

## State and migration

Run the existing serverless migration under frozen, drained maintenance before
activating this image. It adds `sr_execution_schema`, `sr_execution`, and
`sr_job_due`, verifies ownership/checksums, and extends runtime grants. Tenant SQL
has no access to these private coordination tables. Startup and private setup
check the new marker. Runtime requests never run migrations.

Each execution row has a monotonic BIGINT fence, random attempt token, attempts,
lease deadline, state and safe error code. Database time and the control epoch
fence claims. A lease is at most 110 seconds and is bounded by the invocation's
remaining work time and event expiry. SR2 continues to own native admission,
resource claims, capacity containment and publication; scheduled and manual
refresh share those claims. Active ingestion may renew its SR2 lease. There are
no renewals or SQL queries when there is no incoming obligation.

The source queues retain messages for four days, use 720-second visibility and
redrive after five receives. Work/recovery/Scheduler DLQs retain messages for
fourteen days. Scheduler entries are one-shot, with flexible windows disabled,
delete-after-completion, and five retries within one hour. Business execution
allows five claims within the event's 24-hour window (or an earlier expiry).
Transport/store outages remain unacknowledged. Authoritatively recorded terminal
outcomes acknowledge only after any committed continuation has been dispatched.

A report due event creates/coalesces an occurrence and arms its next due. Refresh
arms its next due from completion, including terminal compute failure. Refresh
completion creates alert occurrences using the existing transition rules.
Recipients receive separate events and fresh renders. Prepared refresh settings
use the same durable job writes. Editing/stopping work revokes its business
revision; old scheduled hints verify SQL and become no-ops. Obsolete one-shot
Scheduler entries delete themselves after firing. An expired current due event
stops that job revision and records `DISPATCH_EVENT_EXPIRED`; it does not silently
revive an overdue schedule. An operator can review and explicitly edit/re-enable
the job as a new revision.

Completed parents can still have undispatched children after a crash. Redelivery
flushes those children before acknowledging even when the parent itself is
already terminal. No process-local lock or broker deduplication confers authority.
Result publication also prearms result metadata expiry; retained object bytes
continue to use the existing grace/pin-aware cleanup protocol.

## SMTP and endpoint configuration

The IPv6 profile is selected by `OPENSIGHT_EGRESS_PROFILE=ipv6` (the default).
Secrets Manager, SQS and Scheduler endpoint overrides, if supplied as
`OPENSIGHT_SECRETS_ENDPOINT`, `OPENSIGHT_SQS_ENDPOINT` and
`OPENSIGHT_SCHEDULER_ENDPOINT`, must match their exact regional HTTPS endpoints
from D-19. S3 keeps its regional gateway route. SQS ignores returned queue hosts
as endpoint selectors. Unknown routes return `EGRESS_ROUTE_UNSUPPORTED`; invalid
hosts return `EGRESS_ENDPOINT_INVALID`. There is no inferred NAT, paid endpoint,
IPv4 retry, plaintext or certificate-verification downgrade.

Delivery requires these environment inputs:

- `OPENSIGHT_SMTP_HOST`: the exact regional `email-smtp.<region>.api.aws` host.
- `OPENSIGHT_SMTP_PORT`: `465` (implicit TLS).
- `OPENSIGHT_SMTP_FROM`: the configured sender.
- `OPENSIGHT_SMTP_SECRET_ARN`: the existing secret containing `username` and
  `password`; fetched at the send boundary on every attempt, using `AWSCURRENT`.

Missing configuration returns `SMTP_NOT_CONFIGURED`; invalid SMTP settings
return `SMTP_CONFIG_INVALID`. Sockets belong to the invocation and close on
completion, timeout or abort. The default deployment transport is real SMTP.
The factory/socket substitutions used by tests are explicit internal injections.

The validation Terraform prepares these inputs and narrowly grants the work
function access to the existing SMTP secret. It keeps the existing approved
synthetic sender/recipient policy. No resource was applied and no permission was
widened to public email. The existing SES sandbox restrictions may reject other
recipients until Tom supplies separately approved cloud configuration.

Before rendering and immediately before SMTP DATA, delivery checks the active
tenant, current owner/build permission, job version, occurrence revisions,
recipient membership/address, target access, source expiry, RLS and CLS. No SQL
transaction spans SMTP I/O. Acceptance of DATA is the external effect; loss of
QUIT does not resend. A permission change after the final authorization check
cannot retract a transmission. An accepted send followed by cancellation is
recorded as sent with `DELIVERY_ACCEPTED_AFTER_CANCEL`, while the occurrence stays
cancelled.

Interrupted sends and lost SQL receipts remain `ambiguous` in `sr_execution` and
surface `DELIVERY_AMBIGUOUS` on the delivery. SMTP cannot promise deduplication.
An explicitly approved retry uses the same Message-ID and renders/rechecks current
authority again; duplicate email is possible. Rendered mail bodies are not stored
in the execution/outbox records or reused from H7's old delivery cache.

## Operator recovery

Use the private administration command `replay-event` with the existing operator
authorization, an exact v1 event envelope, and an explicit boolean
`acceptAmbiguous`. It accepts one execute/due event ID, not a queue, scope, body,
recipient list or bulk-redrive request. The command checks current authority,
revision, expiry, entitlement and delivery state, prearms recovery before changing
outbox state, then rechecks and reissues the event. It never resets attempts or
fences. Terminal, expired, cancelled or obsolete work cannot be replayed. A live
claim must finish or expire first. Ambiguous mail requires
`acceptAmbiguous: true` and still cannot exceed the original retry/expiry bounds.

Do not delete the retained DLQ evidence until replay acknowledgement and SQL
outcome have been reviewed. An outage beyond retention needs deliberate,
identifier-scoped outbox reconciliation; there is no periodic database sweep.
Queue depth/age alarms should use service metrics without querying Aurora.

## Cloud evidence for Tom

The following remain unvalidated and are not authorized by this build:

- Actual SQS/Scheduler sends, source policies, redelivery, retention, DLQs and
  service-metric alarms; IAM/PassRole and private operator replay-role wiring.
- Actual Secrets Manager, Scheduler, SQS and SES endpoint reachability, IPv6
  socket use, DNS, TLS/SNI, authentication and bounded failures in each subnet/AZ.
- SES sender/recipient restrictions and real delivery, including the documented
  ambiguous-acceptance case; approved source-database routes.
- Terraform plan/apply and runtime/mapping activation, WAF/IP allowlist, resource
  placement and cost decisions. D-19 remains a cloud-validation candidate.

No AWS call, provisioning, spending, private repository creation or live workflow
activation occurred. No push or merge is part of this slice. Full-suite counts and
static-demo comparison are recorded in [the gap notes](issue-85-gap-notes.md).
