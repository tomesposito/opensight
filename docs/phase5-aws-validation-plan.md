# Phase 5 — isolated AWS validation plan

**Prepared 2026-10-10; resource creation and spending are pending review.**
The operator approved preparing an IPv6-first validation alongside continued
developer work. This document describes the experiment, not a deployment that
has occurred. It does not authorize `apply`, account changes or test mail.

The initial target is US East (N. Virginia), with synthetic data and one operator.
Actual region/account/DNS/resource identifiers, recipients and credentials are
environment inputs and never committed. See [D-19](itd/D-19-serverless-egress.md)
and the [developer handoff](phase5-developer-handoff.md).

## 1. What this experiment establishes

1. The release's Linux/Node/native DuckDB image runs in Lambda and cleans up
   SQL sockets, workers, timers and temporary files after success and failure.
2. Private Aurora connections enforce verified TLS, separate operator/tenant
   roles, row-level security and transaction isolation.
3. The exact AWS service clients and SMTP transport work over IPv6 without NAT
   or paid interface endpoints; S3 uses its gateway endpoint.
4. Aurora reaches zero ACUs with no probes touching SQL, and resumes after a
   short pause and a pause exceeding 24 hours.

This first experiment is a subset of SR5, not its completion. It cannot establish
CloudFront provenance, WAF behavior, browser wake UX, S3 artifact correctness,
event recovery or production rollback before those components exist. SR1's
`SERVERLESS_STORAGE_REQUIRED` and maintenance gates stay closed. Do not hand-edit
admission tables to turn a platform probe into a nominally working application.

## 2. Proposed resource inventory

| Resource | Initial configuration |
| --- | --- |
| Network | 1 dedicated VPC, 2 private dual-stack subnets in distinct AZs, their route tables, 1 egress-only internet gateway, 1 S3 gateway endpoint, runtime/DB security groups |
| Database | 1 Aurora PostgreSQL Standard cluster, 1 `db.serverless` writer, engine 16.15 candidate verified orderable during review; min 0 / max 2 ACUs, auto-pause 300s; private IPv4 DB route; encryption, 1-day automated backup retention |
| Functions | 3 IAM-invoked container functions: SR1 request runtime (28s), migration runtime (120s), isolated platform probe (120s); each starts at 2,048 MiB and 512 MiB `/tmp`; no public URLs, API Gateway or provisioned concurrency |
| Invocation limits | Reserved concurrency 1 per function; operator runs SQL/compute probes sequentially; no live application/event executor attached to the SR1 fail-closed scheduler |
| Objects | 1 private versioned synthetic artifact bucket, block public access, bounded lifecycle; at most 1 GB of test objects |
| Images | 1 private ECR repository; exact image digest, at most 2 retained images / 2 GB estimated total; explicit cleanup after the experiment |
| Secrets | At most 4 Secrets Manager secrets: bootstrap DB, application operator DB, restricted tenant DB, SES SMTP; injected privately, not through IaC values/state; AWS-managed encryption keys |
| Event transport | 1 test SQS queue + 1 DLQ, 1 Scheduler group, at most 20 one-shot schedules; delete-after-completion; 1 scoped Scheduler-to-SQS role; no Lambda event-source mapping or recurring schedules |
| Email | SES sandbox; one verified operator-approved test identity and one tagged IAM SMTP user with sender/recipient-restricted SendRawEmail policy; access key generated privately outside Terraform; at most 20 synthetic mail attempts; no production-access request |
| Logs/metrics | 3 log groups, 3-day retention, no payload/secret logging; AWS service metrics and at most 4 alarms; no monitoring SQL queries |
| Operator/state foundation | 1 private versioned S3 state/evidence bucket, 1 customer-managed KMS key for state, separate lock/state access, scoped operator permissions; import bootstrap resources into their protected root |
| Cost notification | 1 experiment budget with proposed $10 and $20 notifications to an operator-supplied address; notifications do not stop spend |

No NAT Gateway, interface endpoints, RDS Proxy, reader instance, Redis, public
load balancer, CloudFront distribution, WAF, ACM certificate or DNS change belongs
to this first experiment. Public ingress and private GitHub OIDC deployment
bootstrap are later separately reviewed plans; the first probe can use the
existing operator CLI session. No long-lived AWS keys enter a workflow.

Execution roles are separate for request, migration and probe functions. The
request role cannot read the bootstrap DDL credential. The probe gets only
synthetic bucket/queue/schedule/secret access; `PassRole` is limited to its named
Scheduler target role. The experiment adds no general administrative role. The dedicated SMTP user has no console access; its key is created outside Terraform, with the derived regional SMTP password stored only in Secrets Manager. Cleanup explicitly revokes that key; state contains no access-key resource or secret payload.

Exact image/action/tool/provider versions and checksums, IAM documents, resource
names, secret references, subnet/AZ availability and the rendered IaC plan must
be supplied by SR4 before execution review. Recheck the engine and its zero-ACU
support then. A missing dependency is a failed preflight, not permission to
substitute an unreviewed service or increase limits.

## 3. Cost envelope

USD, no credits/free-tier assumptions. Aurora rates were checked with the AWS
Price List API for `us-east-1` on 2026-10-10: Standard serverless $0.12/ACU-hour,
storage $0.10/GB-month, I/O $0.20/million, excess backup $0.021/GB-month. Use 730
hours per month for the illustrative storage prorating below.

| Item over 72 hours | Light test assumption | Estimate | Higher-use scenario |
| --- | --- | ---: | ---: |
| Aurora compute | 10 total ACU-hours including wake/idle tails | $1.20 | $17.28 at 2 ACUs for all 72 hours |
| Aurora storage | 10 GB for 72 hours | $0.10 | $0.10 at the same storage |
| Aurora I/O | 1 million operations | $0.20 | $0.20 at the same I/O |
| Lambda | 1,000 total invocations, 2 GB, 10s mean billed duration, x86 first-tier rate | $0.34 | $4.01 if each lasts 120s |
| Secrets | 4 secrets retained for 72 hours, plus small request allowance | $0.17 | $0.17 |
| State KMS key | 1 key retained for 72 hours plus small request allowance | $0.11 | $0.11 |
| S3/ECR/logs/events/mail/metrics/transfer/backup | Small synthetic workload allowance: 1 GB objects, 2 GB images, 0.2 GB logs, 20 mail deliveries, no bulk transfer | $0.60 | $0.60 at the same usage |
| **Scenario total** | Rounded | **about $3** | **about $22.50** |

**Proposed working budget: $25 for one 72-hour experiment.** This is not approved
spending and not a hard upper bound. The higher-use scenario changes compute
only; extra invocations, I/O, storage, traffic, retries, bootstrap mistakes or
retention beyond 72 hours cost extra. Lambda billed initialization can add to
duration. Set an operator ledger of at most 1,000 total function invocations;
inspect service metrics for unexpected invocations and stop the harness if the
ledger or usage allowance is exceeded. Check costs daily, allowing for billing
delay. Reserve concurrency and Aurora max ACUs constrain rates, not total spend.

If Aurora never pauses, its compute alone can reach $175.20 over a 730-hour month
at this cap. Stop and investigate a failed pause test rather than leaving the
stack unattended. Pausing does not eliminate storage, secrets or key charges.
Retaining 4 secrets and the state key alone adds about $2.60/month, before any
storage/usage. Record retained resources and their expected charges explicitly.

The optional later pilot WAF (one ACL + three rules) adds roughly $8/month plus
requests; D-19's rejected-for-now endpoint profile adds $29.20/month for four
services in one AZ. Neither is included here. Domain registration, an existing
hosted zone, GitHub subscription changes and a future public pilot are outside
this incremental experiment estimate.

Rates: [Aurora](https://aws.amazon.com/rds/aurora/pricing/),
[Lambda](https://aws.amazon.com/lambda/pricing/),
[Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/),
[KMS](https://aws.amazon.com/kms/pricing/),
[S3](https://aws.amazon.com/s3/pricing/),
[ECR](https://aws.amazon.com/ecr/pricing/),
[CloudWatch](https://aws.amazon.com/cloudwatch/pricing/),
[WAF](https://aws.amazon.com/waf/pricing/).
The small-services line is a planning allowance, not a service-by-service quote.

## 4. Execution and acceptance sequence

1. **Review before apply.** Produce the exact IaC plan, permission diff, image
   digest and license inventory. Reprice the selected services, verify regional
   limits, record start/end times and receive explicit resource/cost approval.
   Approve the synthetic-data teardown separately from retaining state/evidence.
2. **Bootstrap and package.** Create/import the approved state foundation, apply
   the reviewed experiment plan, then populate secrets privately. Build once and
   deploy the verified image. Initial SQL role setup uses the bounded private
   operator/probe path, never a public database or an API migration route.
3. **Transport proof.** From the image test each subnet/AZ separately. Record
   IPv6 socket family, successful TLS/SNI and authorized Secrets/SQS/Scheduler/
   SMTP operations without logging credentials or sensitive headers. Prove S3
   gateway access and denial to an unrelated synthetic resource. Verify exact
   endpoint selection, including SQS QueueUrl behavior. Test DNS/TLS/permission
   failures; no route silently falls back to paid services. Synthetic mail is
   sent only after sender/recipient approval in step 1.
4. **Runtime/SQL proof.** Bootstrap isolated tenants and roles; test RLS bypass
   attempts and tenant-role refusal for owner/BYPASSRLS. Exercise SR1 startup in
   its legitimate maintenance state, failures/cancellation and native workers.
   The probe may test direct connection/readiness mechanics; it must not report
   the application ready or remove the SR2/SR3 guard. Record peak memory, duration,
   cleanup and absence of leaked connections after every case.
5. **Sleep/wake proof.** Finish all active work and schedules, close connections,
   then observe `ServerlessDatabaseCapacity` through AWS metrics. Do not run SQL
   health checks. Measure short-idle resume, then leave it untouched for over
   24 hours and repeat. Allow a 48-hour observation within the 72-hour window;
   log maintenance wakes separately. Zero-ACU failure blocks the cheap-idle claim.
6. **Close and account.** Stop the harness and delete outstanding schedules;
   disable invocation permissions or set concurrency to zero, then verify no
   ongoing calls. If still needed for investigation, explicitly retain the
   database with its charges; otherwise perform the previously approved synthetic
   teardown. Check final inventory, log actual costs when billing catches up,
   and save sanitized evidence plus a private retained-resource list.

Teardown removes the isolated cluster/instance and approved synthetic backups,
all object versions/uploads, images, functions, queues/schedules, experiment
secrets and networking once Lambda releases its ENIs. Do not delete pre-existing
resources, operator identities, shared SES configuration or the state foundation.
Any secret recovery window, snapshot, log group or retained KMS key must appear
in the residual-cost report. Never delete the state key while retained state or
evidence still needs it. Application Terraform destroy continues to preserve data
by default; the synthetic experiment needs an explicit reviewed cleanup path.

## 5. Handoff after this experiment

Publish sanitized measurements, not account inventories or raw logs. Feed image,
timeout, memory, endpoint and auto-pause findings back to SR2–SR4. A successful
probe only clears the relevant platform questions; final SR5 still requires the
implemented application, browser/ingress tests, durable job/storage failure tests
and restore/rollback drills. SR6 adds canonical DNS/TLS and human/agent smoke
tests after those gates pass.
