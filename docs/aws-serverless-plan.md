# Phase 5 — AWS serverless readiness and development deployment

**Direction confirmed 2026-10-10; detailed phase specification proposed for review.**
[D-18](itd/D-18-serverless-development-deployment.md) selects Lambda and Aurora
Serverless v2 for a lightly used developer/tester deployment. This document is
referenced by `SOLUTION_DESIGN.md` §11. No infrastructure, private repository,
workflow, dependency or application change is implemented by this design commit.
Resource creation, publishing and cloud acceptance runs need a separately
reviewed deployment plan; this document does not authorize spending.

## 1. Scope and expected experience

The first audience is an operator and an authorized test agent using synthetic
data. Retain real email/password/TOTP authentication, tenant/namespace isolation,
owner-only prepared data, RLS/CLS, usage gates and worker limits. Agent testing
does not imply a new identity type, authentication bypass or operator access to
tenant data. Its account, privileges and secret handling are private configuration.

The static application loads while database compute is paused. An explicit
connect/sign-in action may show **Starting your workspace…** and bounded retry
progress. Normal testing covers enrollment, login, upload, preparation, query,
manual refresh and authorized embedding. Existing device-local authoring drafts
remain device-local; deploying the API does not create shared save/publish UI.

Preserve H7 job/delivery semantics for selected schedules. No scheduled jobs are
installed merely to keep the deployment awake. Enabled user schedules necessarily
wake it when due. No HA, latency SLA, recovery deadline or free-tier promise is made.
Custom customer hostnames, paid AI providers and arbitrary external connectors
are not implicitly enabled. H8's local reference and offline demo remain distinct.

## 2. Target topology and private inputs

| Component | Proposed contract |
| --- | --- |
| Canonical origin | Operator-supplied HTTPS origin, Route 53 alias and DNS-validated ACM certificate; use placeholders in public files |
| Frontend | Normal hosted web build in private S3 through CloudFront origin access control; no offline-demo flag |
| API ingress | Same-origin CloudFront API behavior through API Gateway HTTP API to a Node 24-compatible Lambda container image |
| Metadata | One private Aurora PostgreSQL Serverless v2 writer; supported engine pinned at deployment; zero minimum ACUs and 300-second idle pause |
| SQL client | Existing PostgreSQL transaction/RLS boundary through `pg` in VPC-connected Lambda; separate operator and restricted tenant roles |
| Analytical execution | Bounded DuckDB workers and shared post-processing, with native libraries built for the deployed Linux architecture |
| Durable bytes | Private regional S3 uploads/artifacts with authoritative PostgreSQL manifests; local `/tmp` and heap are disposable caches |
| Background work | EventBridge Scheduler/queued worker triggers for actual durable occurrences; retry/dead-letter handling and database deduplication |
| Configuration | Private environment values and AWS-managed secret storage; no secret values in public build arguments, frontend variables, logs or source |
| Operations | Bounded log retention, service metrics, budget alerts, artifact cleanup and tested backup/recovery |

Use one selected region for tenant metadata, uploads, artifacts and backups.
CloudFront distributes static public application assets globally. Disable caching
of API, auth, embed bootstrap and tenant responses, including error caching;
do not claim regional confinement of all network transit. The region, canonical
origin, zone ID, account/role identifiers, bucket names, identity addresses and
test credentials are private inputs. No live account identifiers or DNS inventory
are recorded here.

CloudFront/API Gateway change transport headers. The adapter must validate the
approved ingress and canonical host/origin, preserve rejection of spoofed identity
and forwarded headers, and never infer tenant membership from host or caller IP.
Define and test the trusted peer used by authentication rate limits. Resolve the
existing web client's `/api` prefix/rewrite convention explicitly. Include embed
shell/assets/bootstrap routing. Reject unknown paths without touching metadata
where possible; keep operator and migration surfaces inaccessible to anonymous
callers. Do not weaken the existing boundary merely to accept proxy headers.

## 3. Database lifetime, wake-up and networking

The Lambda composition must not acquire H8's lifetime advisory lock or start its
interval scheduler. Replace their guarantees before removing either mechanism:
durable occurrence claims, fencing and manifest compare-and-swap protect work;
an exclusive maintenance gate protects migrations and recovery. Normal request
transactions retain current tenant context, rollback and unsafe-role checks.

Close database connections on every invocation outcome before returning control
to Lambda, including errors and cancellation; do not depend on idle timers in a
frozen environment. No periodic application health query, database heartbeat,
provisioned Lambda concurrency or RDS Proxy in this profile. RDS Proxy holds
connections that prevent Aurora auto-pause. Maintenance may still wake Aurora.

Proposed wake contract: a minimal, throttled startup operation attempts bounded
connection/readiness, with no tenant details in the response. It must complete
within the API integration deadline, returning a named transient startup state
when the database is still resuming. The browser can retry startup with jitter
and a visible overall deadline; it must not automatically replay arbitrary writes,
password enrollment or TOTP acceptance. An agent may use the same bounded flow.
Do not send keep-alive requests from an idle browser. Prove cold resume after both
short and >24-hour inactivity; the latter can exceed the HTTP API's 30 seconds.
Specify abuse limits before exposing an unauthenticated database-wake capability.

Networking is a pre-build design gate, not an assumed free route:

- Direct PostgreSQL uses private VPC connectivity with verified TLS and the RDS
  trust chain. Do not expose Aurora publicly or replace the tenant SQL role with
  an administrator to simplify connectivity.
- Prefer S3 gateway endpoints for artifact traffic. Inventory every other
  runtime destination: secrets, event dispatch, email, source databases and any
  selected AI provider. VPC-connected Lambda does not gain public IPv4 internet
  access by being placed in a public subnet.
- Compare verified dual-stack/IPv6 egress with narrowly scoped service endpoints
  for required destinations. Price every fixed endpoint. Do not silently add a
  NAT Gateway or declare SMTP reachable without a tested network path.
- Data API is an alternative requiring a separate adapter decision and isolation
  proof, not a drop-in configuration for `pg`; its row/result limits conflict
  with existing large metadata/upload envelopes. Do not use it implicitly.

Before SR1 implementation, resolve the egress matrix and record the chosen
transport, supported destinations, recurring cost and license implications.
If that changes product scope, obtain a scope decision rather than silently
disabling a required feature. No cloud experiments are authorized by this file.

## 4. Durable artifacts, uploads and concurrency

H9's artifact identity/publication/hydration contract and H10's replica-safety
requirements in [hosted architecture §5](hosted-architecture.md#5-scaling-plan)
are launch prerequisites. Start with PostgreSQL durable leases/fencing and
authoritative revision checks; no continuously running Redis service is selected.
The detailed SQL lease/claim schema and async Blaze adapter must be specified in
the corresponding H9/H10 contracts before building them.

Artifacts are immutable and scoped by tenant, namespace, owner, dataset and
generation. Authorize before object access, verify digest/schema/decoded bounds,
and recheck current authority before returning results or publishing a generation.
Every read checks the authoritative manifest: warm local bytes never authorize
access or hide invalidation. Late workers, retries and overlapping old/new Lambda
versions cannot publish stale results. Deletion, dependency revision and tenant
suspension invalidate access before cleanup. Do not use sticky routing or a
concurrency limit as a replacement for these properties.

Keep H4 per-worker memory/time/row/result limits and add durable aggregate
admission where multiple invocations can bypass per-process counters. Bound
both tenant and deployment concurrency, including API and background workers.
H8 entitlements remain admission controls, not an AWS billing cap. Clear child
processes, sensitive temporary files and open handles before invocation exit.

The current 8 MiB upload can exceed Lambda's 6 MB synchronous request limit,
especially after base64 encoding. Specify a tenant-authorized, expiring direct-S3
upload reservation and completion protocol: server-chosen key, size/type/checksum
constraints, version binding, reauthorization at completion and before ingest,
and cleanup of abandoned objects. An object event alone cannot authorize ingest.
Prevent replay/overwrite races and cross-tenant key substitution. Preserve the
existing accepted formats and explicit source expiry; route larger result/export
payloads through an authorized bounded protocol rather than truncating them.

Parquet decoding, DuckDB working memory, scrypt authentication and response
serialization must fit the chosen memory allocation together. Benchmark the
native worker/watchdog on the exact Lambda-compatible image, including `/proc`,
child-process cancellation and `/tmp` behavior. Cache hydration must reproduce
the current query semantics and refresh timestamps after process replacement.

## 5. Asynchronous work and delivery

Interactive work receives a deadline below API Gateway's integration timeout.
Longer operations need a persisted operation ID and scoped status/result API,
with cancellation and current authorization on result retrieval. Lambda's longer
execution timeout does not extend the HTTP integration timeout. Bound background
tasks below Lambda's execution limit; split or explicitly refuse oversized work.

Persist each scheduled occurrence before dispatch. Use a transactional outbox,
idempotent event publication, leased claims and fencing. Resolve the commit-to-
dispatch crash gap with bounded event-driven reconciliation and dead-letter
handling; no unconditional database polling when no work exists. A duplicated
event must not create a second occurrence or bypass admission. Preserve H7's
coalescing, ownership removal, current recipient authorization and at-least-once
delivery semantics. Do not put tokens, rows, report bodies or credentials in event
payloads; events identify authorized durable work.

Real invitation delivery remains required. Keep email/password/TOTP enrollment
and real mail transport; test stubs are never deployed as successful delivery.
Initial enrollment may be operator-assisted through the existing API. A browser
enrollment screen is a separate UI slice if selected. Verify sender/recipient
requirements and SES sandbox status privately. Specify the chosen email transport
with its network path, rather than adding a background sender that cannot recheck
recipient permissions at delivery.

## 6. Public code, private operations and CI/CD

| Public application repository | Private deployment repository/environment |
| --- | --- |
| Source, synthetic fixtures, tests, Docker build | Environment selection and deployment orchestration |
| Reusable Terraform modules and placeholder examples | Version-pinned module calls and private environment-variable inputs |
| Generic migration/recovery/deploy scripts | Release/image digests and private run records |
| CI and reproducible release-image workflow | Plan/apply, deployment, smoke-test and rollback workflows |

Neither repository stores secret values, `.env`, state, saved plans, backups,
real exports or generated private outputs. Add appropriate ignore rules and
staged-content checks when IaC is implemented; `.gitignore` alone is insufficient.
Keep configuration injection consistent with the environment-only repo contract.
Terraform/provider executables are operator/CI tooling, not bundled application
dependencies. Review their exact licenses and those of shipped SDKs/base images
before selection; this document introduces no dependency or license exception.

Pipeline contract:

1. Public PR CI builds and runs root `npm test`, including an isolated PostgreSQL
   service when configured. Untrusted code gets no AWS credentials. Do not run it
   on a persistent self-hosted deployment runner or use privileged PR triggers.
2. Trusted release CI publishes an image and matching frontend artifact with a
   commit identity/digest and license/security checks. Never promote an arbitrary
   fork artifact. Pin third-party actions to reviewed commits.
3. Private workflows use GitHub OIDC with repository/workflow-context restrictions;
   no long-lived AWS access keys. Separate read/plan, infrastructure apply and
   application deploy permissions. Use environment protections where the GitHub
   plan supports them; restrict authorized refs and dispatchers in every case.
4. Bootstrap state storage/OIDC roles once through a separately reviewed operator
   action. Store Terraform state in private encrypted/versioned S3 with locking;
   retain plan output privately and apply the reviewed plan, not a new plan.
   Keep secret payloads out of Terraform inputs/resources/state where possible.
5. Begin with explicit private workflow dispatch for a verified release. Automatic
   trusted-release promotion is a later setting after rollback is demonstrated;
   merges to the public repository do not implicitly authorize AWS deployment.
6. Serialize deployments and maintenance. Gate/drain new work, reconcile in-flight
   claims, preserve backups and apply migrations before switching Lambda aliases.
   Restore traffic only after readiness; frontend/API versions must remain
   compatible. A weighted rollout is prohibited until overlapping versions and
   database compatibility are proven.
7. Run synthetic smoke tests with dedicated identities and safe logs. Retain the
   prior image/frontend release. Roll back code only when schema-compatible;
   destructive schema recovery uses the reviewed restore procedure.

The repo's Git Database API publishing process still applies. Check workflow-file
publication permissions at implementation time; do not assume an old credential
scope is current or silently bypass the publishing contract. Private repository
creation, OIDC trust changes, workflow activation and deployments are separate
external actions, not effects of this documentation change.

## 7. Cost controls and recovery

Use no provisioned Lambda concurrency, no database reader and no RDS Proxy in
the initial profile. Proposed initial Aurora maximum is 2 ACUs, subject to memory/
connection tests and operator review. Select Lambda memory, concurrency, worker
limits and queue retry counts from measurements, not presumed free-tier capacity.
Give logs, orphan objects, incomplete uploads and release images explicit bounded
retention. Preserve security tombstones and backup registry semantics through GC.

Estimate storage, I/O, ACU-hours including idle tails/maintenance, Lambda GB-seconds,
API/edge requests, DNS, secrets, networking, event delivery and backup retention.
Do not equate a browser testing hour with a database compute hour or assume credits.
At the published example rate of $0.12/ACU-hour in the selected pricing example,
20 awake hours averaging 1 ACU means $2.40 database compute only. Reprice the exact
region before deployment. No monthly spending ceiling has been authorized.

Budget alerts notify; they are not hard spend limits. Provide an operator stop
procedure that denies new API work, disables event dispatch/retries and lets
connections drain so Aurora can pause. Data storage remains chargeable. Pause and
resume must not orphan running claims or silently replay delivery side effects.

Aurora backups do not alone preserve OpenSight's deletion/revocation guarantees.
Specify a durable backup registry and consistent manifest/object-version capture,
retain newer tombstones outside the restore point, and protect encryption keys
independently. Test restoring into an isolated target with tenants held suspended,
sessions revoked and schedules stopped, followed by explicit membership review.
Never roll back the authoritative registry alongside an old database snapshot.
Terraform destroy must preserve data/backup resources by default; destructive
deletion requires a separate explicit operation and verified retention behavior.

## 8. Sequenced work and acceptance gates

Each implementation slice requires a frozen, buildable contract in
`SOLUTION_DESIGN.md` before its build branch. The unresolved choices below block
their dependent slices, not unrelated local design/implementation work.

| Slice | Work | Acceptance gate |
| --- | --- | --- |
| SR0 — design | Record D-18; resolve egress, ingress/wake, object-upload and durable claim contracts; define test envelope and resource estimate | Reviewed spec and exact dependency/license choices; no cloud resources |
| SR1 — runtime | Separate HTTP/Lambda composition, scheduler and migration entrypoints; invocation-scoped SQL lifecycle; trusted ingress and startup behavior | Local lifecycle/header/timeout/bypass tests; Linux native-worker checks; no open SQL connections or workers after completion |
| SR2 — H9/H10 storage and safety | Artifact adapter, upload protocol, durable admission, fencing, invalidation and recovery | Differential results; cold hydration; duplicate/late/crashed worker and two-instance isolation tests; old bytes never regain authority |
| SR3 — background work | Durable async operations, due-event dispatch, retry/dead-letter/cancellation, real email integration | H7 permissions/ownership/delivery tests; crash-gap reconciliation; idle deployment has no unconditional DB polling |
| SR4 — packaging and automation | Public modules, reproducible artifacts, private workflow templates, migration/restore/rollback runbooks | IaC validation and reviewed plan; no secrets/account configuration in public artifacts; OIDC and resource policies reviewed |
| SR5 — authorized AWS validation | Provision isolated test resources only after resource/cost approval; deploy and test selected workflows | Real Aurora role/RLS proof; resume after short and >24h pause; cold-start, payload, memory and artifact-load measurements; restore/deletion and rollback drills |
| SR6 — pilot release | Promote verified artifacts, configure canonical DNS/TLS, enroll operator/test identities, set budgets and retention | Human/agent smoke tests, measured idle pause, cost report, exact test counts and operating instructions |

Run the full root `npm test` after each build phase and report passed/failed/skipped
counts. The live-PostgreSQL skip is acceptable only without local PostgreSQL; AWS
release still requires actual Aurora integration evidence. No other skip substitutes
for a failing suite. Rebuild the demo and compare screenshots after each build
phase; refresh README screenshots/GIF whenever visible UI changes. Exercise both
normal authoring and embed flows; synthetic fixture success is not hosted proof.

SR5 evidence must include a multi-day idle observation without application probes
that wake the DB. Capture AWS-provided capacity/usage metrics and distinguish
maintenance wakes from application leaks. Test an idle open browser, expired
sessions, aborted requests and a completed scheduled job. Failure to reach zero
ACUs blocks the advertised idle-cost behavior. Tests of platform behavior belong
to the separately authorized cloud gate, not ordinary offline builds.

## 9. Reference evidence

Checked 2026-10-10; verify limits, supported versions and prices again at release.

- [Aurora auto-pause](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html): zero-ACU pause, connection/proxy constraints and resume latency.
- [Aurora pricing](https://aws.amazon.com/rds/aurora/pricing/): ACU, storage, I/O and other charges; the pricing example is not an account quote.
- [Lambda lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html) and [quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html): freeze/replacement and payload/runtime limits.
- [HTTP API quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html): 30-second integration deadline.
- [VPC Lambda egress](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html) and [SES endpoints](https://docs.aws.amazon.com/ses/latest/dg/send-email-set-up-vpc-endpoints.html): network paths must be configured and priced.
- [Data API limits](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.troubleshooting.html): row/result bounds requiring adapter design.
- [GitHub AWS OIDC](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws) and [Terraform S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3): short-lived workflow identity and private locked state.
