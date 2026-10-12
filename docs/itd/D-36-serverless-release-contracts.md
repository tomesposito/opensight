---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-12
labels: [itd]
---

## Purpose

Freeze the SR4b (Issue #86) deployment/release contracts so the reusable
public artifacts, private workflow templates, and operator runbook have a
stable target. This record confirms what is decided and names what remains
Tom's explicit decision.

## Scope

Tool/provider/action pins and licenses, state custody, IAM/OIDC subjects,
retention, maintenance, migration and recovery contracts for the serverless
release package.

## Out of Scope

Creating the private deployment repository, configuring live OIDC trust,
applying infrastructure, publishing releases, spending, or GitHub plan
changes. Those are Tom's operator actions after review.

### ✅ ITD D-36 — What are the frozen SR4b release contracts?

#### CONTEXT

[D-25](D-25-serverless-release-artifacts.md) proposed the release-artifact
boundary, private workflow identity, bootstrap/state, deployment/migration
protocol, rollback procedures, and retention as drafts with Tom's decision
points explicitly open. [D-27](D-27-serverless-build-tooling.md) confirmed the
toolchain pins. SR4a froze the isolated validation package. #85 (SR3) merged
the durable dispatch interfaces ([D-24](D-24-serverless-job-dispatch.md)).
The public `ci.yml` already builds releases with manifest, SBOM, and
provenance; `ops/serverless/` carries the validation/ingress/ci-access
roots, operator scripts, and policy validators.

#### THE PROBLEM

SR4b must ship reusable public artifacts against frozen contracts without
inventing Tom's product/security decisions or authorizing any operator action.

#### OPTIONS CONSIDERED

1. ✅ **Freeze decided contracts, record proposed defaults, name open
   decisions.** Ship everything buildable now; Tom's explicit approvals gate
   only the operator actions.
2. Freeze everything including the open decisions by picking values. Rejected:
   product/security decisions are Tom's (standing rule); inventing them would
   require a revert later.
3. Ship artifacts without a frozen contract. Rejected: unreviewable against a
   moving target; the acceptance criteria in D-25 demand named contracts.

#### REASONING

Option 1 keeps the build honest. Everything below is either already decided
(✅), a frozen mechanical contract derived from decided inputs (✅), or an
explicit open decision for Tom (⏳) with the D-25 proposed default recorded
so review can proceed.

#### IMPLICATIONS

**Frozen pins and licenses (✅ decided, from D-27 and `action-pins.json`):**

| Tool | Pin | License |
| --- | --- | --- |
| OpenTofu | 1.13.1 | MPL-2.0 (operator/CI tool, not bundled) |
| AWS provider | 6.68.0 (`registry.terraform.io/hashicorp/aws`) | MPL-2.0-equivalent provider terms (tool, not bundled) |
| Lambda base image | `public.ecr.aws/lambda/nodejs@sha256:6720580baa6f3dbfb25849f4a3579f4a3179f0e01b0d1ba836a3cdfc06519c8c0bb71c6` | Upstream distribution (infrastructure, not relabeled) |
| AWS SDK clients | 3.1149.0 (Apache-2.0) + tslib 2.8.1 (0BSD, explicitly approved exception) | Per D-27 |
| GitHub Actions | Full-commit SHAs in `ops/serverless/action-pins.json` (checkout, upload/download-artifact, buildx, build-push, attest, configure-aws-credentials) | MIT / Apache-2.0 per pin record |
| Target | linux/arm64, Node 24 | — |

Application additions retain the AGENTS.md MIT/Apache-2.0 rule plus the single
approved tslib exception. Terraform/OpenTofu and providers are operator/CI
tools, never bundled into the application.

**State custody (✅ frozen contract):** private S3 backend, SSE-KMS with a
separately administered key policy, versioning on, public access blocked,
native S3 locking (`use_lockfile = true`); distinct state keys and access
policies per environment/root; Terraform workspaces are not the security
boundary. Plan role: state read + lock-object get/put/delete. Apply role:
additionally state write. Routine roles cannot delete state versions or
schedule key deletion. Bounded lock waits; `-lock=false` forbidden.
Force-unlock requires private operator evidence (owning run stopped, exact
lock ID, audit record). S3 versioning is recovery, never authorization to
roll state backward. No state, saved plans, or secrets in git — enforced by
`ops/serverless/ci-check.mjs` (`PRIVATE_CONFIGURATION_IN_GIT`).

**IAM/OIDC subjects (✅ frozen contract, implemented in
`ops/serverless/ci-policy.mjs`):** issuer
`https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`,
subject pinned to numeric `repository_id` + `repository_owner_id` +
`ref:refs/heads/master` + `event_name:workflow_dispatch` +
`job_workflow_ref:<private-repo>/.github/workflows/controller.yml@<commit>`.
No owner-wide or repository-wide wildcards. Explicit denies:
`sts:AssumeRole`, `secretsmanager:GetSecretValue`, `ssm:GetParameter*`,
`rds-data:*`. Session max 1 hour. Kill switch: explicit `Deny *` + closed
trust installed outside Terraform ownership, runnable only with the
operator's own credentials (a CI role cannot re-enable itself).

**Separated privileges (✅ frozen contract):** plan (read config/state, write
only its lock + private plan record), infrastructure apply (reviewed plan
only, limited PassRole, cannot alter own trust/state policy/permissions
boundary), application deploy (copy verified image/assets, update named
functions/versions/aliases, invoke private maintenance entrypoint; no
tenant-object read, secret fetch, direct SQL, or IAM administration),
maintenance runtime (VPC-local bounded migration/backup/recovery under the
maintenance gate; separate DDL role), API/worker runtime (D-19–D-24
data-plane permissions only). Public PR jobs receive zero AWS trust.

**Release manifest (✅ frozen contract, implemented in
`ops/serverless/release-manifest.mjs` + `ci.yml`):** binds repository,
source commit (40-hex), workflow ref (`refs/heads/master`), run ID,
platform (`linux/arm64`), OCI image digest, per-artifact SHA-256 digests
(`runtime.oci.tar`, `frontend.tar.gz`, `runtime-sbom.json`), schema/protocol
compatibility digest over the contract source set, lockfile digests,
Dockerfile digest, and the action-pin record. Build once; private deploy
copies verified bytes without rebuilding. Hosted frontend is a separate
artifact from the offline demo; the demo is never presented as a server.

**Deployment/migration protocol (✅ frozen contract, from D-25):** one
environment concurrency group (`cancel-in-progress: false`) plus the
conditional-write operation record in private operational storage; drain →
fence epoch → backup with registry linkage → version-pinned migration under
advisory lock → alias switch as a recorded set → smoke checks → reopen on
CAS. Rollback is three procedures (code/frontend, infrastructure, data),
never an automatic down-migration or old-writer startup.

**Retention (⏳ Tom's decision; D-25 proposed defaults recorded):** 30 days
current+previous image/frontend/migration bundles (extended by pins); 7 days
saved plan bytes; 30 days operational logs/run records; 7-day registered
backup window; security tombstones and registry/fence history outlive all
backups. Cost of retention/storage/KMS/CI needs Tom's approval before any
deployment.

**GitHub protections (⏳ Tom's decision):** use available environment
reviewers/protections and prevent self-approval where supported; if the plan
lacks them, require separately recorded operator approval bound to the
plan/release digest. Exact controls and plan cost are Tom's call — the
templates ship with the enforced-approval fallback, not an assumed
subscription.

**Origin-secret custody (⏳ Tom's decision):** D-20's CloudFront bearer
header/authorizer configuration may enter provider state; custody accepted
only in encrypted restricted state/plans, subject to Tom's review.

**Interface assumptions for this build:** #85's merged D-24 contract and
`packages/api/src/dispatch.ts` are the durable runtime interfaces; no new
assumptions introduced. SR4b adds no application code paths — only
packaging, templates, contracts, and validation.

**Acceptance (local, no AWS):** wrong OIDC subject denied; changed
artifact/provenance/plan/config refused; stale plan refused; secret-leak
scans green; migration interruption before/after each commit recovers;
schema/event compatibility both directions; partial alias promotion
detected; failed smoke keeps the gate closed; code rollback and corrective
plan verified; restore with newer deletions / missing keys / stale fences
fails closed. Cloud drills (trust, locking, Aurora restore, Lambda
rollback) belong to authorized SR5, not this record.
