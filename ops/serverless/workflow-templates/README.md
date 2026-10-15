# Private workflow templates

These are executable **reusable templates**, not activated public workflows. Copy
only to the private controller repository. An owner-controlled manual wrapper
calls each reusable file at a reviewed 40-character commit. AWS trust must bind
immutable repository/owner IDs, `refs/heads/master`, `workflow_dispatch`, audience
`sts.amazonaws.com`, and that exact `job_workflow_ref`. Public PR jobs get no trust.

`OPENSIGHT_CONTROL_SOURCE` and `OPENSIGHT_PUBLIC_REPOSITORY` are private repository
variables selecting the reviewed public controller implementation. They are not
caller inputs. No workflow executes a candidate release's scripts with AWS access.

- `plan.yml`: pinned OpenTofu creates a real saved binary plan, validates policy,
  and stores private review JSON plus a digest-bound envelope.
- `apply.yml`: consumes an independently approved envelope, checks source,
  configuration, backend, provider/tool bytes, state and live resource observations, then
  applies **only the saved binary**. It never creates a replacement apply plan.
- `deploy.yml`: the existing compatible-release controller verifies provenance and
  independent approval, drains, promotes exact artifacts, checks public behavior,
  and supports a compatible code rollback. Its read/deploy roles stay separate.
- `maintenance.yml`: invokes a separately prepared, version-pinned backup or
  migration runner (`command: snapshot` or `migrate`). Fixed plans, operation CAS,
  registered snapshots and transactional receipts are checked by the runner.
- `restore.yml`: invokes a separately approved, version-pinned isolated restore
  runner. Successful completion means **held for security/membership review**;
  this workflow has no production cutover or reopen step.

All share `opensight-production-controller` concurrency with cancellation disabled;
S3's conditional `ci/operations/active.json` additionally serializes local operators
and workflows. Native encrypted S3 state locking remains enabled. A partial apply
retains the operation and its immutable consumption receipt for reconciliation.

## Private inputs and separate privileges

Upload `maintenance-config.json`, `maintenance.tfvars.json` and
`maintenance.backend.hcl` to the restricted, encrypted prefix
`maintenance/configs/<SHA-256 of maintenance-config.json>/`. Neither repository
contains those files. Runners fetch them into a mode-0700 directory with mode-0600
files. Plan/apply config fields are `version`, `account`, `region`, `deployment`,
`operationsBucket`, `kmsKey`, `root` (a checked-in `ops/serverless/...` root),
`publicCommit`, `privateCommit` (the reusable workflow commit), `tofuSha256` (the
unpacked pinned binary), `release` (manifest digest), and `allowedResourceTypes`.
The backend must explicitly enable `encrypt`, `kms_key_id` and `use_lockfile`.
Already-reviewed provider normalization is bound into the envelope; any new drift
requires a new review. No `TF_VAR_*` or `TF_CLI_ARGS*` environment overrides are accepted.

Plan receives resource/state reads and narrowly scoped state-lock, plan and
operation-record writes. Apply receives only the selected root's reviewed resource
mutations and state writes; both exclude approval writes, secret values, IAM trust,
bootstrap policies and permanent credential creation. The executable policy also
denies destroy/replacement, IAM/KMS changes, secret values, NAT/EIP and provisioned
Lambda capacity. Protected resource replacements require separate operator review.

Use the existing `modules/ci-access` policy map for separately reviewed role policies.
Set private variables `OPENSIGHT_PLAN_ROLE_ARN`, `OPENSIGHT_APPLY_ROLE_ARN`,
`OPENSIGHT_MAINTENANCE_ROLE_ARN`, `OPENSIGHT_RESTORE_ROLE_ARN`, and
`OPENSIGHT_OPERATIONS_BUCKET`. Do not grant a role authority to update its own
trust or the reviewed controller source variable. Maintenance/restore workflow
roles only read selected configuration/approval/operation metadata, inspect the
fixed runner and invoke its exact numeric version. They cannot create/update
runners, read database/SMTP credentials or alter production aliases/DNS.

The independent local operator reviews `review.json` and then runs:

```
node ops/serverless/saved-plan.mjs approve <plan-envelope-sha256>
node ops/serverless/maintenance-approve.mjs <invocation-record-sha256>
```

Approval is at most four hours and never beyond the plan's 24-hour expiry. CI
cannot write the approval prefix. The maintenance invocation record binds `mode`,
`configuration`, `operationId`, `planDigest`, qualified `runner`, `codeSha256`,
`environmentDigest` and `expiresAt`. The function's fixed plan additionally binds
source/target database, backup/version/digest, epoch and key versions. Review and
prepare the runner, drain/watchdog and active operation before approving invocation.

## Emergency revocation

Record all activated maintenance workflow pins in private `ci-config.json` under
`maintenanceWorkflows: {plan, apply, maintenance, restore}`. `ciRoleTrust` constructs
each exact workflow subject. `ci-access.mjs disable-ci` then denies existing
sessions across **all configured roles before removing new federation trust**.
Recovery preserves the issue-time deny and verifies new trust before removing the
emergency deny. Confirm both an existing-session denied API call and failed fresh
federation; STS caller identity alone is not a permission test.
