# SR4b operator runbook

Concrete bootstrap and operation guide for the private deployment. This is a
runbook, not an automation: every step is an explicit operator action. No
step here runs from the public repository or its workflows.

## 0. Prerequisites

- OpenTofu **1.13.1** and AWS provider **6.68.0** (see D-36 for pins and
  licenses). Install explicitly; verify checksums before use.
- AWS IAM identity with administrative rights for bootstrap only. Routine
  workflows use the short-lived OIDC roles, never this identity.
- A private GitHub repository for deployment orchestration (you create it;
  no issue or script here creates it).
- GitHub plan capabilities reviewed: environment reviewers/protections and
  self-approval prevention if available; otherwise the enforced-approval
  fallback below. ⏳ Tom's decision (D-36).

## 1. Establish OIDC trust

1. In the private repo, record the numeric `repository_id` and
   `repository_owner_id`, the protected ref (`refs/heads/master`), and the
   pinned controller workflow commit.
2. Build the trust document with `node ops/serverless/ci-policy.mjs`
   (functions `ciTrust`, `ciPolicy`, `ciDeny`): issuer
   `https://token.actions.githubusercontent.com`, audience
   `sts.amazonaws.com`, exact subject — no wildcards.
3. Apply the `ci-access` module (`ops/serverless/modules/ci-access`):
   OIDC provider, CI roles (`plan`, `apply`, `deploy`, `restore`,
   `maintenance`) with 1-hour max sessions and explicit secret/escalation
   denies. Verify with `tofu plan` review before `tofu apply`.
4. Test the kill switch (`disable-ci` in `ops/serverless/ci-access.mjs`):
   confirm already-issued sessions die and new assumptions are rejected.
   The shutoff lives outside Terraform ownership.

## 2. Establish private state

1. Create the private S3 state bucket: versioning on, public access
   blocked, SSE-KMS with a separately administered key policy.
2. Use native S3 locking (`use_lockfile = true`). Distinct state keys and
   access policies per environment/root. Never local state after a backend
   error; never commit state, plans, or secrets (enforced by
   `ops/serverless/ci-check.mjs`).
3. Import bootstrap resources into a separately protected administrative
   root. Application destroy cannot own bootstrap state.

## 3. Build a release (public repo)

1. Merge to `master`. The public `ci.yml` builds, tests, and publishes a
   release: OCI image, frontend archive, SBOM, license inventory, and the
   manifest binding source commit, digests, compatibility, and provenance.
2. The manifest's `licenses` digest proves the D-27 license policy passed.
   A public merge never deploys — the workflow has zero AWS trust.

## 4. Plan and apply infrastructure (private repo)

1. Dispatch the `plan` template
   (`ops/serverless/workflow-templates/plan.yml`) with the environment and
   configuration revision. It produces a digest-bound plan envelope (24h
   validity) in restricted operational storage.
2. Review the plan. Record operator approval bound to the exact envelope
   digest (separately if GitHub protections are unavailable).
3. Dispatch the `apply` template with the envelope digest and approval ref.
   It reacquires the lock, rechecks drift/expiry, and applies only those
   bytes. Never synthesize a replacement plan.

## 5. Deploy a release (private repo)

1. Verify the release manifest and approval envelope (see
   `ops/serverless/promotion-gate.mjs` for the offline checks).
2. Dispatch the `deploy` template
   (`ops/serverless/workflow-templates/deploy.yml`). The release controller
   runs: drain → fence epoch → backup with registry linkage → version-pinned
   migration under advisory lock → alias switch as a recorded set → smoke
   checks → reopen on CAS.
3. A failed or cancelled workflow never reopens the gate. Recovery proves
   the owning run stopped, advances the fence, and reconciles the operation
   record before continuing.

## 6. Rollback

- **Code/frontend:** drain/fence again, select the retained verified image
  and frontend manifest, restore the alias/HTML set, smoke-check, reopen.
  Preserves live data and key versions.
- **Infrastructure:** keep admission closed, inspect actual resources and
  latest state, create/review a corrective plan, apply under lock. Never
  restore old state as if it undid AWS changes.
- **Data:** prefer forward repair. Otherwise use the `restore` template with
  explicit approval: restore into an isolated target, verify registry/object/
  key evidence, reconcile deletions, advance the epoch, and cut over only
  after membership/recovery review.

## 7. Retention (⏳ Tom's decision; D-36 records D-25 proposed defaults)

30 days image/frontend/migration bundles (extended by pins), 7 days saved
plans, 30 days operational logs, 7-day backup window; tombstones and
registry/fence history outlive all backups.

## 8. Never

- Commit `.env`, credentials, `*.tfvars`, `*.tfplan`, `.terraform/`,
  crash logs, state, plans, backups, or exports to either repo.
- Let a public PR job assume AWS roles or read deployment secrets.
- Promote `latest`, a movable tag, an unchecked CI cache, or an arbitrary
  fork artifact.
- Run `-lock=false`, force-unlock without evidence, or roll state backward.
