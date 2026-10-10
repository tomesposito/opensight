---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-10
labels: [itd]
---

## Purpose

Make a serverless release reproducible, privately authorized and recoverable.

## Scope

Reusable Terraform/build artifacts, GitHub OIDC, state custody, migrations and
code/infrastructure/data rollback.

## Out of Scope

Creating repositories, publishing workflows/images, obtaining credentials,
calling AWS, provisioning infrastructure or authorizing spending.

### 🚧 ITD D-25 — How should public artifacts become a controlled private release?

#### CONTEXT

[D-18](D-18-serverless-development-deployment.md) separates public reusable code
from private deployment control. H8's maintenance commands use a process-lifetime
lock and local backup registry; they are not a Lambda migration/restore runner.
[D-23](D-23-serverless-state-and-fencing.md) requires maintenance/schema gates and
fenced publication, while [D-24](D-24-serverless-job-dispatch.md) leaves durable
events that can outlive a code version. An old image, database snapshot or Terraform
state file alone therefore cannot define a safe rollback.

#### THE PROBLEM

How should a private operator promote public artifacts and recover a failed
release without leaking deployment data or reviving obsolete authority?

#### OPTIONS CONSIDERED

1. [WIP] Public immutable release artifacts/modules; explicitly dispatched private
   OIDC workflows with protected state and a gated migration/promotion protocol.
2. [WIP] Public repository workflows own both release builds and deployments,
   with deployment settings supplied through GitHub environments.
3. [WIP] Private operators rebuild releases and run infrastructure/migrations
   manually from workstations.

#### REASONING

Option 1 is proposed and follows D-18. It keeps deploy authority and operational
records private while letting anyone reuse and inspect the same artifact sources.
It costs a second repository, provenance verification and explicit recovery
machinery. Option 2 reduces orchestration but couples public workflow changes to
deployment authority and makes accidental disclosure harder to contain. Option 3
can bootstrap the system, but independently rebuilt bytes and workstation state
are a weak recurring release boundary. Tom retains the tooling-license, protection
and retention decisions below; none prevents completing this design proposal.

**SR4a implementation update:** [D-27](D-27-serverless-build-tooling.md) resolves
the initial tooling/pinning choice using OpenTofu and records the explicitly
approved tslib helper exception. The [frozen SR4a contract](../phase5-sr4a-packaging.md)
governs the isolated validation package. Full private release protections,
retention and migration/restore orchestration remain SR4b work.

#### IMPLICATIONS

**Repository and artifact boundary (proposed SR4 deliverables):**

| Public reusable material | Private operational material |
| --- | --- |
| Terraform modules, variable/output contracts, placeholder examples and offline policy tests | Environment roots pinned to module commits, workflow orchestration and configuration-variable names |
| Docker/build scripts, hosted frontend, migration/recovery scripts and synthetic tests | Environment values injected at runtime; private account, region, DNS, role and secret references |
| Trusted release workflow; image/frontend digests, SBOM, license inventory and provenance | Verified release selections and run records in protected operational storage |
| Generic plan/drain/migrate/promote/rollback workflow templates and runbooks | Explicit plan/apply/deploy/restore dispatch and restricted logs/results |

Neither repository contains `.env`, actual credentials, account identifiers,
private hostnames, Terraform state/saved plans, backups or tenant exports. Even
private environment roots use environment-variable injection, not committed
`.tfvars` values. Reject these in staged-content/CI checks as well as ignore rules;
include crash files, `.terraform/`, plan JSON, image layers and frontend bundles.
Commit dependency/provider lockfiles; they are not state. Browser artifacts use
the relative same-origin API contract from [D-20](D-20-serverless-ingress.md), never
server secrets or private configuration baked into frontend variables.

Public PR CI has no AWS trust, deployment secrets or persistent deployment runner.
It runs root `npm test` with exact passed/failed/skipped counts and the normal
build; release evidence requires isolated PostgreSQL tests as well. Only the
documented live-PostgreSQL skip is acceptable locally without PostgreSQL. Offline
IaC validation uses pinned dependencies and synthetic/provider-mocked inputs,
without refreshing real resources. Ordinary builds retain AGENTS.md's network
restrictions; dependency/tool acquisition and artifact publication are separate,
reviewed release steps. No privileged PR trigger checks out untrusted code.

**Build once, promote exact bytes:** a trusted release from an approved public
commit produces a manifest binding source commit, build workflow commit/run,
lockfile hashes, Node/native-worker/base-image versions, target architecture,
OCI image digest, frontend archive/file digests and migration checksums. Include
the readable/writable SQL schema range, event/artifact protocol ranges and the
previous releases compatible with that range. Bind SBOM/provenance to the digests;
private verification checks the expected repository, workflow, ref and source
commit, not merely that an artifact has a signature. Pin actions by full commit,
base images by digest and tools/providers by exact version/checksum; never promote
`latest`, a movable tag alone, an arbitrary fork artifact or an unchecked CI cache.

Propose a public OCI registry and matching public release archive. Private deploy
copies the verified single-architecture image to regional private ECR and checks
its digest without rebuilding; publish provenance separately if needed to retain
Lambda's supported image manifest. Validate the exact Linux/Node 24-compatible
image's DuckDB, child cancellation, read-only root and bounded `/tmp`. A local
image test is not deployed Lambda evidence. The hosted frontend is a separate
artifact from the offline demo; retain both release identities without presenting
the demo as a server. [Lambda image requirements](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html).

Application additions still require MIT/Apache-2.0 license verification, including
transitives and shipped native components/base-image contents. Terraform CLI and
providers are separately installed operator/CI tools, never bundled in the app.
Current HashiCorp Terraform source carries BSL terms; D-18 did not grant a license
exception. Propose the Terraform module/backend contract below, leaving the exact
supported CLI/provider pins and their permitted tooling use for Tom's explicit
review before SR4. Do not silently pick an obsolete binary or substitute another
engine; a license conflict needs its own recorded resolution, not a waiver in a
Dockerfile. [Terraform license](https://github.com/hashicorp/terraform/blob/main/LICENSE).

**Private workflow identity:** begin with manual `workflow_dispatch` on an
allowlisted protected private ref, a verified release manifest and an environment.
A public merge/tag never deploys. Use short-lived GitHub OIDC sessions; grant
`id-token: write` only to the job needing it, with minimal other GitHub permissions.
No AWS access-key secrets, credential files, token output or shell tracing.

IAM trust fixes issuer `https://token.actions.githubusercontent.com`, audience
`sts.amazonaws.com` and an exact private-repository subject; no owner-wide or
repository-wide wildcard. Propose customizing `sub` with `repo`, `repository_id`,
`repository_owner_id`, `context`, `ref` and `job_workflow_ref`, binding immutable
identity, environment, allowed caller ref and pinned private reusable workflow.
AWS cannot be assumed to evaluate arbitrary GitHub claims as independent IAM
condition keys. Verify the actual subject format, including immutable repository
IDs where enabled, during authorized bootstrap; record only the expected template
publicly. An environment subject does not itself constrain the caller branch:
also restrict environment refs, workflow edits and authorized dispatchers. Deny
fork/PR, wrong repository/ref/environment/workflow and changed subject formats.
[GitHub AWS OIDC](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws),
[subject customization](https://docs.github.com/en/actions/reference/security/oidc).

Use available environment reviewers/protections and prevent self-approval where
supported. If the private repository's GitHub plan lacks those controls, require
a separately recorded operator approval bound to the plan/release digest, enforced
by the protected workflow before assuming mutation roles. Do not silently equate
dispatch access with review. Exact controls/plan cost are Tom's decision point.

| Identity | Permitted boundary |
| --- | --- |
| Plan | Read selected resource configuration/state and write only its lock and private plan record; no resource mutation or application secret fetch |
| Infrastructure apply | Apply reviewed infrastructure plan within the environment; limited PassRole to named workload roles; cannot alter its own trust, bootstrap state policy or permissions boundary |
| Application deploy | Copy verified image/assets, update named functions/versions/aliases and control event mappings; invoke the private maintenance entrypoint; no tenant-object read, secret fetch, direct SQL or IAM administration |
| Maintenance runtime | VPC-local bounded migration/backup/recovery under the maintenance gate; separate DDL credential/role, never the API's tenant role |
| API/worker runtime | D-19–D-24 data-plane permissions plus narrowly scoped lifecycle-fence publication; no Terraform state access, deployment/DDL authority or role assumption |
| Bootstrap/recovery operator | Separately authorized short-lived identity for state/OIDC setup, lock recovery or destructive restore; never a routine workflow's fallback |

Plan readers are privileged: state can contain credentials even without permission
to fetch application secrets. Infrastructure/apply and code-deploy rights are also
trusted capabilities, not a sandbox against a malicious approved release. Pin and
review every executable step. Workflow roles also maintain their scoped operation/
audit records, which contain no tenant content. GitHub-hosted ephemeral runners
call AWS control APIs; the private IAM-invoked maintenance Lambda uses D-19's PostgreSQL/secrets/S3
routes. No public DB endpoint, SSH tunnel, migration HTTP route or permanent runner
is needed. Budget any later route change explicitly.

**Bootstrap and private state:** a separately reviewed operator action establishes
OIDC trust, scoped roles, encrypted/versioned private S3 state and operational
storage before the first remote initialization. Import bootstrap resources into
a separately protected administrative root; application destroy cannot own them.
Do not keep bootstrap state on a workstation or fall back to local state after a
backend error. Use distinct state keys and access policies per environment/root;
Terraform workspaces are not the security boundary.

Require TLS, block public access, scoped bucket policies and SSE-KMS with separately
administered key policy. Select native S3 locking (`use_lockfile = true`) in a
reviewed compatible CLI; do not add a DynamoDB lock service implicitly. Plan gets
state read and lock-object get/put/delete; apply additionally gets state write.
Routine roles cannot delete state versions or schedule key deletion. Bound lock
waits and fail if locking is unavailable; forbid `-lock=false`. Force-unlock needs
private operator evidence that the owning run and maintenance invocation stopped,
the exact lock ID and an audit record. S3 versioning is recovery, not authorization
to roll state backward. [S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3).

Keep secret payloads outside Terraform wherever possible: manage secret references,
not application/SMTP/DB/signing-key values or secret-version data sources. D-20's
CloudFront bearer header and authorizer configuration can still enter provider
state when managed by Terraform; propose accepting their custody only in encrypted,
restricted state/plans, subject to Tom's origin-secret review. Inventory every copy
and rotate after suspected exposure. `sensitive` hides output; it does not remove
stored values. Do not claim `ignore_changes` prevents refresh from reading them.
No raw plan JSON, state, tokens or secret-bearing output in public logs/comments.
[Sensitive data in Terraform](https://developer.hashicorp.com/terraform/language/manage-sensitive-data).

Save the private binary plan with a digest-bound envelope: public/private commits,
module/provider/tool locks, environment/configuration revision, backend identity,
state lineage/serial and selected release digest. Store it encrypted in restricted
operational storage, outside Git and public CI artifacts. Proposed validity is
24 hours. Approval names this exact envelope; apply reacquires locking and consumes
those bytes, never creates a replacement plan implicitly. Check resource drift
and current configuration/state against the envelope before applying; changed
input, expired plan, drift or stale state requires a new plan/review. Partial apply
is reconciled against actual resources and current state; it is not retried as an
assumed atomic transaction. [Terraform automation](https://developer.hashicorp.com/terraform/tutorials/automation/automate-terraform).

**Deployment and migration protocol:** serialize apply, deploy, rollback and
maintenance with one environment concurrency group (`cancel-in-progress: false`).
Also conditionally create a record in private encrypted/versioned S3 operational
storage with run ID, target digest, phase and unique token; create with
`If-None-Match: *`, update with `If-Match` on the observed ETag. All entrypoints,
including operator recovery, must honor it. It does not expire into automatic
takeover when a workflow dies. Recovery proves the owning run/invocations stopped,
advances the maintenance fence and reconciles the
record before continuing. Terraform's state lock alone does not serialize SQL or
alias changes. Record each acknowledged phase, before/after alias versions, HTML
manifest and configuration revision so lost responses can be inspected.
[S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).

1. Verify artifacts, compatibility, current release and approved resource/cost
   plan. Stage immutable frontend assets and Lambda versions without traffic.
   Terraform owns structural resources/runtime configuration; the release
   controller owns image updates, published aliases and frontend objects. Declare
   precise code-attribute exclusions and keep aliases out of Terraform ownership;
   test that a later infrastructure apply cannot undo a release. Infrastructure
   changes affecting live traffic use the same maintenance protocol.
2. Through the private maintenance entrypoint, atomically set D-23's control gate
   to `draining` and advance its epoch. Block new admission/publication; disable
   dispatch and event-source mappings, retaining queues/outbox/DLQs. Wait for
   invocation exit or hard execution deadline plus D-23's 10s quarantine, not just
   a 30s lease expiry. Resolve ambiguous SMTP attempts per D-24. Persist
   `maintenance` only when old writers cannot still act; fail closed on uncertainty.
3. Capture a registered recoverable backup before DDL: metadata recovery point,
   exact manifest/object versions and digests, schema/release identity, required
   key versions and current independent deletion/revocation registry. Pin referenced
   bytes against GC. The registry stays outside the restored database and never
   travels backward with it. A snapshot without this linkage is not acceptance.
4. Run a dedicated version-pinned migration entrypoint with IAM-only invocation,
   no function URL and no startup-triggered DDL. Require the operation token/epoch,
   maintenance state and a bounded PostgreSQL session advisory lock scoped to the
   database/schema, released at invocation exit. Track migration ID, checksum,
   from/to schema and committed batch progress in a durable ledger. Transactional
   DDL/data batches commit their ledger entry atomically; nontransactional work
   needs explicit pre/postcondition recovery. Retry inspects committed state and
   refuses checksum/version mismatch. Advance the admitted schema range only after
   the complete migration validates. Use expand/backfill/validate first; postpone
   drops/rewrites until the documented rollback window closes.
5. Each migration invocation has a proposed 120s timeout, at most 110s work and
   10s cleanup, with bounded statements/locks and resumable batches. The workflow
   explicitly invokes continuations; a crash leaves maintenance closed, without
   an idle poller. Fresh bootstrap creates the control/ledger schema under the
   same exclusive lock before any application route is admitted. Reuse tested
   migration logic where applicable, not H8's lifetime launcher. API/startup and
   workers can check schema readiness but cannot repair or migrate it.
6. Verify restricted-role/RLS readiness and schema/event/artifact compatibility
   using the candidate versions. Switch API/startup/authorizer/worker aliases as
   a recorded set while the gate remains closed; no weighted rollout. Publish
   matching HTML only after its hashed assets are available. Keep prior assets
   and API compatibility for already-open clients; unsupported protocol versions
   return a named upgrade-required state without replaying mutations. Edge HTML
   propagation and multiple alias updates are not one atomic operation. Unsupported
   clients receive `CLIENT_UPGRADE_REQUIRED` (409) with a safe reload action.
7. Run bounded synthetic authoring/embed/isolation and rollback smoke checks
   through maintenance admission bound to the operation token and an explicit
   synthetic tenant/identity allowlist; no public header or request flag bypasses
   the gate. Restore admission/event mappings only after every release check
   succeeds, using CAS on the operation token/epoch. Reconcile due work under
   D-24's current authorization and missed-interval rules. Record completion and
   release the operation record;
   a failure/cancelled workflow never automatically reopens the gate.

**Rollback is three different procedures:**

| Failure | Required recovery |
| --- | --- |
| Code/frontend failure; prior release accepts current schema and protocols | Drain/fence again, select the retained verified image and frontend manifest, restore the complete alias/HTML set, run readiness/smoke checks, then reopen; preserve live data and current security key versions |
| Infrastructure failure or partial apply | Keep admission closed; inspect actual resources and latest state, create/review a corrective plan, then apply under lock; never restore old state as if it undid AWS changes |
| Incompatible/destructive migration or data loss | No automatic down migration or old-writer startup. Prefer a forward repair; otherwise use an explicitly authorized restore into an isolated target with registry/object/key verification and a separately reviewed cutover |

The independent registry uses a separately protected encrypted/versioned S3 prefix
and conditional updates through D-19's existing S3 route, not H8's local file or
Terraform state. Record deletion/revocation fences
there before acknowledging the corresponding lifecycle change; uncertain writes
leave recovery held. Register a backup only after its metadata/object inventory
is complete, with pins covering every retained version. Keep the authoritative
registry head and deployment epoch outside database/state rollback; an old S3
version is not an eligible replacement head. Missing history fails closed.

A data restore holds tenants suspended, revokes sessions/invitations and stops
schedules/deliveries before serving. Reconcile newer deletion/revocation records,
membership/policy/source expiry and usage controls; missing registry/key/object
evidence leaves the target held. Advance an independently retained deployment
epoch and preserve/advance fence high-water marks so old workers/events cannot
match restored counters. Reauthorize retained events individually, including mail
ambiguity; never blindly redrive queues against restored SQL. Reopen only after
explicit membership/recovery review. Old code cannot reinstate retired ingress or
signing keys: if a retained function version embeds retired configuration, publish
the old image digest as a new version with current security configuration and
revalidate it before moving aliases. This extends H8's held-restore safety, not its
local-file mechanism.

Retain current and previous successful image/frontend/migration bundles throughout
the rollback window; propose 30 days, extended by active release/backup pins.
Propose 7 days for saved plan bytes, 30 days for safe operational logs/run records
and a 7-day registered backup window; security tombstones and authoritative
registry/fence history outlive all associated backups. Exact retention and storage,
KMS, CI/registry and backup costs need Tom's approval before deployment. Cleanup
cannot erase current/rollback images, pinned object versions or required key
versions. Expired approval does not erase the safe audit of what was applied.

Routine plans deny destroy/replacement of Aurora, state, tenant/backup buckets,
registry and encryption keys. Combine module `prevent_destroy`, service deletion
protection where supported and independent IAM restrictions; removing a resource
block can bypass Terraform's lifecycle guard. No force-destroy bucket default.
Destructive retirement is a separate approved operator procedure with verified
retention/deletion semantics. [Terraform lifecycle](https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle).

**Tom's decision points:** confirm tooling/license pins; GitHub protections or
the enforced approval fallback; origin-secret state custody; rollback/backup/log
retention and their cost. Proposed defaults above let SR0 review proceed; they
are not approvals, implementation or spending authority. SR4 must freeze the
contracts and runbooks; SR5 separately authorizes and proves cloud behavior.

**Acceptance:** wrong OIDC audience/repository/ref/environment/workflow and public
PR credential denial; changed artifact/provenance/plan/config and stale-plan
refusal; state-reader isolation, parallel apply and abandoned-lock recovery;
secret-leak scans; migration interruption before/after each commit; old/new schema
and queued-event compatibility; partial alias/HTML promotion; failed smoke and
cancelled workflow remaining closed; code rollback and corrective infrastructure
plan; restore with newer deletions, missing keys/objects and stale worker fences.
Local tests use mocks/synthetic PostgreSQL and root `npm test`; actual trust,
locking, Aurora restore and Lambda rollback drills belong to authorized SR5.
No public workflow activation, credentials or AWS calls are part of this record.
