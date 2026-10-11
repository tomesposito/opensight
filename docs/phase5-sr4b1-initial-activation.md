# Phase 5 SR4b1 — initial pilot activation

This is the first activation of the existing serverless validation deployment.
It preserves the current database, VPC, encryption keys, object bucket and state.
[D-33](itd/D-33-initial-pilot-activation.md) records the decision. This slice does
not implement D-25's general migration, drain, restore or CI release protocol.

## Platform promotion

Extend the existing validation Terraform root with `deployment_profile`, default
`validation`, and opt-in `pilot`. Keep existing resource addresses and ownership
tags; add `OpenSightStage=pilot` on promotion. A private promotion operator uses
the existing protected backend and exact-account/clean-source/plan-digest/state
receipt safeguards. It rejects deletion/replacement, paid edge changes, additional
databases/readers, NAT/public IPv4, provisioned concurrency and unpinned images.
Public ingress remains managed by its separate root.

Before any pilot mutation, install the cleanup guard: the legacy validation
operator checks the actual cluster tags and refuses cleanup when the deployment
is marked pilot. A stale local inventory cannot bypass that guard. Pilot plans
keep database deletion protection and retained buckets/state. The old synthetic
probe and its resources remain isolated; disable its concurrency after completing
the long-pause evidence and before application admission.

Pilot functions use the exact tested immutable ARM64 image. Request and private
administration remain 2,048 MiB with 512 MiB temporary storage; request timeout is
28 seconds and reserved concurrency one; administration timeout is 120 seconds
and reserved concurrency one. Add two 120-second, 2,048 MiB private worker
functions for work and recovery. Each has reserved concurrency two and an SQS
maximum concurrency of two, the smallest supported event-source cap. No
provisioned concurrency is configured. This avoids competing SQS pollers causing
avoidable throttled redeliveries at reserved concurrency one. Existing SQL tenant
and node budgets still control execution admission.

Add separate standard work/recovery queues and DLQs, one Scheduler group and
Scheduler DLQ. Source queues retain four days, visibility 720 seconds,
maxReceiveCount five; DLQs retain fourteen days. Use SSE-SQS and no public policies.
Event mappings use batch size one, zero batching window, partial batch failures,
and initially disabled consumers. EventBridge schedules are existing bounded
one-shot dispatch/recovery obligations, never recurring keepalive/database polls.
Scheduler roles can send only to this work queue and its configured DLQ. Existing
application dispatch uses five retries, one-hour maximum event age and deletion
on completion. The recovery queue receives only recovery envelopes.

Request and worker roles receive only the existing operator/tenant secret ARNs,
S3 read/write/delete-version permissions for `objects/v1/*` and `artifacts/v1/*`,
SendMessage to the two exact queues, CreateSchedule/GetSchedule in the one group,
and PassRole to the exact Scheduler role for that service. Only workers can
receive/delete messages, and only from their own queue. Bucket-level ListBucket
is needed to distinguish absent objects (404) from denied requests (403) during
recovery; it grants no object-content access outside the two prefixes. Private
administration alone also receives the bootstrap database secret. No runtime
role can read Terraform state, mutate IAM, access SMTP, or administer another
function. Existing bounded logs and dual-stack/S3 gateway routing remain.

The artifact bucket CORS allows only the configured HTTPS public origin, PUT,
GET and HEAD, with the exact signed upload headers and exposed version/checksum
headers. No wildcard origin. Existing one-day lifecycle remains limited to the
synthetic `probe/` prefix; SQL-managed business artifacts are not expired by an
independent bucket lifecycle rule.

## Initial identities and admission

Add an IAM-only administration entrypoint. All commands additionally require the
current deployment operator credential, a strict input schema, Lambda hosted
mode and frozen maintenance configuration. The administration handler also accepts the
existing strict `migrate` command, preserving the old migration entrypoint. No HTTP setup endpoint or arbitrary
SQL command is added. Continue using the existing composed migration function
for all five schema checkpoints and runtime-role grants.

`bootstrap-initial` accepts version one, one private operation ID and exactly two
explicit tester definitions, each with unique tenant/namespace/user/subject IDs,
normalized email, display name, password and 20-byte canonical-base64 TOTP secret.
The local operator generates random UUIDs, 32-byte random passwords and independent
TOTP secrets into a 0600 file outside the repository. It never prints credentials
or sends onboarding email. The owner and automated tester have separate initial
workspaces, each with an administrator, so acceptance can prove cross-tenant denial.
Passwords use existing scrypt; TOTP uses existing authenticated encryption bound
to subject. This is an initial private provisioning operation, not a login bypass.
Real hosted login still requires password/TOTP and the current membership.

Bootstrap requires schema ownership, all five exact schema markers, epoch one,
maintenance state and no existing tenant/identity/business work. In one locked
transaction, create the two H1 tenants/namespaces/revisions/administrator resources,
active H2 identities/memberships and current auth key, then record metadata/audit
and idempotency receipts. No delivered invitation is fabricated. Bind idempotency
to a canonical input HMAC using the deployment encryption key; do not store a fast
unkeyed hash of the passwords. Exact retries return the prior result without
resetting credentials; changed input, populated databases, foreign schema,
retired auth keys and mismatched epochs fail closed. Use existing `h2_requests`
for a deployment-wide bootstrap-selection receipt and an operation-specific HMAC
receipt. The selection binds the one operation ID; deterministic H1 provision
operation IDs bind its two tenant scopes. Insert all receipts and identities in
the same transaction. An exact retry requires both receipts; a different operation
ID cannot create another initial pair. Do not add a password-bearing fast hash or
new credentials table.

`activate-initial` binds the bootstrap operation and expected epoch one to a
pinned release digest equal to `OPENSIGHT_RELEASE_DIGEST`. Under the same control lock, require the exact bootstrap
receipt, current schema/budget markers, two active tester memberships and current
key, and no accepted durable work/admission. Atomically change maintenance to
open without advancing the initial epoch; append an audit and activation receipt.
Exact retries while already open are idempotent. This command cannot reopen a
later frozen/draining deployment, advance an epoch, or substitute for D-25 drain
and recovery. Its deployment-wide receipt binds the bootstrap ID, release digest
and expected epoch; a prior activation followed by maintenance can never reopen
through this command. Runtime request/worker roles still cannot modify control
state.

## Operator sequence and acceptance

1. Complete the existing greater-than-24-hour Aurora pause/resume measurement;
   use CloudWatch to observe the quiet interval without SQL health checks.
2. Review/apply the additive pilot dependencies with consumers disabled. Publish
   exact function versions; keep the public live alias on the frozen version.
3. Invoke composed migration, private tester bootstrap and initial activation,
   recording sanitized results and keeping all payloads/credentials private.
4. Enable consumers and move the ingress live alias to the selected published
   request version only after release/configuration checks. The apex DNS stays
   absent until the existing ingress acceptance gate is satisfied.
5. Through real CloudFront HTTPS, verify finite startup, password/TOTP login,
   browser S3 CORS and exact-version upload, async ingestion, preparation and
   query results. Reauthenticate after revision-changing mutations as required;
   never relax session revocation to make the test pass. Prove the second tester
   cannot read the first tester's operation, source or dataset.
6. Close active clients, observe return to zero ACU and verify no idle browser
   API traffic. Record release/version/frontend-bound acceptance, then review
   and apply apex DNS. Verify the public hostname and real tester workflow.

Offline tests cover fresh bootstrap, exact/changed retries, no credential output,
wrong operator, existing identities, foreign schema/key, later-epoch/open/draining
and reopen attempts, real password/TOTP login and cross-tenant denial. Add live
local-Postgres verification of transaction/role behavior, policy tests for pilot
plan caps/cleanup guards, and Terraform mock coverage. Run root `npm test` with
exact counts and rebuild the demo. No new application dependency is required.

AWS facts: [SQS maximum concurrency](https://docs.aws.amazon.com/lambda/latest/api/API_ScalingConfig.html),
[reserved concurrency coordination](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html),
[S3 absence permissions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html).
