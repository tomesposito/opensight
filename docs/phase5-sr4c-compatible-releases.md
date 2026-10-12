# Phase 5 SR4c — compatible release automation

Frozen contract, 2026-10-11. Decision: [D-34](itd/D-34-compatible-release-automation.md).

## Public CI and release

- Pull requests and changes to master run root `npm test`, hosted/demo builds,
  secret/path checks and offline policy tests. Dependency/tool acquisition is
  separate from network-disabled build execution. Isolated PostgreSQL integration
  runs on an internal container network, without AWS or production credentials.
- Use fresh standard Linux ARM64 runners, existing Node 24/base-image pins and
  lockfiles. Pin every action by its full reviewed upstream commit and record its
  license. Cache dependencies/build layers with separate PR and trusted scopes.
  Default token permissions are read-only; checkout does not persist credentials.
  Do not run untrusted PR code with `pull_request_target`, privileged
  `workflow_run`, deployment secrets, or an AWS-trusted OIDC identity.
- A trusted master release builds the image and frontend once. Publish an OCI
  image archive, hosted frontend archive and manifest as public release assets.
  The manifest binds source/workflow/run, target architecture, archive and OCI
  digests, frontend file digests, dependency/base-image pins and compatibility
  identity. Bind provenance to the manifest with GitHub artifact attestation.
  A publishing job has only the necessary artifact/attestation permissions.
- Release verification checks the exact source repository, trusted workflow/ref,
  source commit and artifact digests. Public merge/release never deploys to AWS.
  Export the existing dependency/license inventory with the release. Retain the
  deployed release and its rollback predecessor; remove disposable CI artifacts
  after seven days and bound caches to the included allowance.

## Private control and access

- A private deployment repository contains generic pinned orchestration only.
  Actual account IDs, role ARNs, domain names, tester credentials, state, plans,
  configuration and provider output never enter either repository. Inject
  configuration through repository settings/environment and protected AWS storage.
- Manual dispatch selects an immutable release. An independently written,
  expiring approval binds its manifest digest, source, expected current release
  and deployment configuration. Preflight verifies this before mutation role
  assumption. CI cannot write approvals or modify its IAM policies/trust.
- Separate preflight and application-deploy roles use GitHub OIDC. The custom
  subject binds repository/owner IDs, caller ref, event and a full-commit-pinned
  private reusable workflow. Capture the real subject privately during bootstrap;
  reject unexpected formats rather than trusting guessed claims or wildcards.
  Request 15-minute sessions and use a one-hour role maximum. No permanent AWS
  key is stored in GitHub. Scope deployment rights to named OpenSight resources.
- Application deployment has no direct SQL, application secret read, tenant
  object read, IAM administration, state mutation or arbitrary role assumption.
  It may copy the verified image into the existing ECR repository, update selected
  application functions/versions/aliases, publish frontend objects, invalidate
  frontend HTML, control those functions' admission and maintain its operation
  record. Smoke-test credentials are isolated to the synthetic tester identity.
  It may arm/cancel a one-shot watchdog only in the dedicated release schedule
  group, passing only that watchdog's invocation role to EventBridge Scheduler.
  It cannot change the watchdog, its role, or its admission-stopping authority.
- Bootstrap, approval, emergency shutoff, infrastructure administration and
  recovery use independent operator access. No new IAM user or access key.
  Do not enable a general infrastructure mutation role in this first slice.
- Independently callable `disable-ci` first places an unconditional deny on all
  CI roles, then removes their federation trust. Keep a private recovery receipt.
  Verify an already-issued session loses a previously permitted harmless action
  and a fresh workflow cannot assume a role. IAM propagation is bounded/retried;
  uncertainty is a failed drill, not successful revocation. The website's runtime
  roles and the shared OIDC provider are untouched. Re-enable requires an explicit
  operator action restoring only the reviewed policy/trust, with private evidence.
  Keep an AWS token-issue-time explicit deny after recovery so removing the
  unconditional incident deny cannot revive older sessions. Before reopening,
  refresh and verify that cutoff from independent operator access. Test an old
  session remains denied while a newly issued session succeeds.

## Compatible application promotion

1. Verify artifact provenance, digests and compatibility before accepting any
   release. Reject schema, coordination, authorization protocol, environment,
   runtime limits or infrastructure changes on this path. Such changes need a
   separately specified migration/infrastructure release. Code compatibility is
   an operator-reviewed contract, not inferred from a movable version label.
2. Serialize all operations using private workflow concurrency (no cancellation
   of a running deploy) and a conditional S3 operation record. Record the expected
   current release, target, phase and rollback snapshot. A stale lock never
   expires into automatic takeover. Recovery is an independent operator action.
   Legacy initial operators refuse mutations after transfer to recurring control.
3. Stage and verify artifacts. Stop new request admission using reserved
   concurrency zero, disable work/recovery event mappings, and stop their new
   invocations. Confirm control-plane state, then wait the maximum existing
   function timeout plus ten seconds. Waits are bounded and reported. Preserve
   SQS messages, schedules, outbox, storage, identities, SQL epoch and configuration.
   The low-traffic pilot may return temporary unavailable responses during release.
4. Update the application request/work/recovery/authorizer images only. The
   migration/probe functions and database remain untouched. Publish a checked
   numeric request version, promote its alias, and publish matching frontend HTML
   only after hashed assets exist. Retain prior frontend assets and release data.
   Infrastructure lifecycle rules exclude exactly the controller-owned code/
   alias attributes so a subsequent infrastructure plan cannot revert a release.
5. Restore the recorded admission/mapping settings after all updates validate.
   Run bounded public HTTPS, password/TOTP, small upload/ingestion/refresh/query
   and isolation checks using synthetic identities, never the owner's workspace.
   Keep test data/credentials and raw evidence private; quota is never bypassed.
6. Record success and release the operation lock. On a known code/smoke failure,
   re-quiesce, restore the exact compatible predecessor, verify and record rollback.
   On cancellation, ambiguous AWS state or unverified rollback, retain the lock
   and stop admission; no unconditional `finally` step reopens the application.
   A rerun inspects the recorded phase and refuses an unrelated operation.
7. Before changing admission, arm an independent AWS watchdog for fifteen minutes
   after preparation. The private mutation job has a twelve-minute hard timeout.
   The watchdog checks the exact operation ID in the conditional operation record;
   an unfinished matching operation stops all four functions and both mappings.
   Completed/rolled-back or unrelated operations are ignored. Successful completion
   cancels the schedule; schedules otherwise delete themselves after execution.
   A lost runner after reopening can therefore admit traffic until this bounded
   scheduled watchdog time plus AWS delivery/propagation delay. This is an
   independent recovery guard, not a hard real-time availability guarantee. An operator
   investigates and recovers the retained lock; the watchdog never reopens traffic.
   This is a small non-VPC Lambda and one-shot schedule, with no database access,
   recurring polling or standing compute. Its IAM role is distinct from CI roles.

## Acceptance and handoff

Prove wrong repository/ref/workflow and fork identities cannot obtain deploy
credentials; approved preflight is read-only; deploy cannot self-escalate or read
application secrets/state; and disabled credentials fail. Test approval tampering,
expiry/replay against another current release, concurrent deploy, partial failure,
rollback, cancellation, artifact traversal/corruption and stale provenance.
Run the full root suite and report exact counts; perform real PostgreSQL tests,
rebuild/compare the demo, and execute the published public CI in GitHub. In AWS,
test OIDC, revoke an active session and a new assumption, restore reviewed access,
then exercise a compatible promotion and rollback without bootstrap or DNS work.
Verify the public workflow again and record timing. Aurora idle evidence is a
separate observation, not a recurring release delay. Document commands and the
emergency console procedure in the private handoff; publish only sanitized facts.
