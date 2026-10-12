# SR4c — routine compatible application releases

The public repository builds and tests source without AWS trust. Its CI publishes
an immutable release named `build-<source commit>` containing an ARM64 OCI archive,
hosted frontend, dependency inventory, an attested manifest, and its provenance
bundle. PRs cannot publish or deploy. Every external action is pinned by commit;
OpenTofu, GitHub CLI, container bases and transfer tooling have immutable pins.

A private repository checks provenance, source/ref/workflow, every artifact digest,
the current release, runtime configuration, and an independently written approval.
It obtains short-lived AWS credentials through OIDC. The exact repository and owner
IDs, dispatch event, master ref and reviewed reusable-controller commit form its
AWS trust subject. Updating a workflow does not update AWS trust. The controller
checks out its own pinned commit rather than a mutable caller branch.

The read role cannot mutate the application. The deployment role controls only
selected function code/alias/admission, two event mappings, the application ECR
repository, public frontend bucket, deployment operation records and one-shot
watchdog schedules. It cannot administer IAM (its only PassRole grant is the
watchdog invocation role for Scheduler), read application secrets or tenant
objects, read Terraform state, or write approval records. Updating Lambda code
still carries the application's runtime authority; protect controller approvals.

## Operator commands

Use independent operator AWS access and an authenticated GitHub CLI. Keep the
private configuration directory outside all repositories, mode 0700, with files
0600. `OPENSIGHT_OPERATOR_DIR` selects it; `OPENSIGHT_GH_BINARY` optionally selects
an installed GitHub CLI. No local AWS key is copied to GitHub.

After reviewing the exact release for unchanged schema, durable protocols,
authorization semantics, environment and runtime limits:

```sh
node ops/serverless/ci-release-operator.mjs approve SOURCE_COMMIT
node ops/serverless/ci-release-operator.mjs preflight SOURCE_COMMIT
node ops/serverless/ci-release-operator.mjs deploy SOURCE_COMMIT
```

Approval binds the manifest SHA-256, source, current release and configuration for
four hours. Dispatching a workflow alone does not approve a release. A release
that changes the compatibility hash requires a separately reviewed migration
process. CI cannot renew an approval. Public release reruns cannot overwrite an
already published source release; select a new source commit for a new build.

The controller uses a conditional S3 lock and private workflow concurrency. It
stages verified artifacts, stops new admission, waits the old hard invocation
limit plus ten seconds (130 seconds for the pilot), then updates code and frontend.
It reopens admission only after promotion and runs a bounded synthetic workflow.
Existing queued work and SQL state remain intact. Schema changes, Terraform apply,
DNS/certificate setup, bootstrap, and database idle observations are outside this
routine path. Temporary unavailable responses are expected during the drain.

Terraform retains runtime configuration and infrastructure ownership. Separate
application function resources ignore only `image_uri`, and the ingress alias
ignores only `function_version`; migration/probe image ownership stays with the
operator. Explicit state moves preserve existing functions. `ci-adopted.json`
in the private operator directory prevents the initial deployment scripts from
mutating an adopted deployment. Preserve that marker with operator configuration.

## Emergency shutoff and recovery

From independent operator access, outside GitHub:

```sh
node ops/serverless/ci-access.mjs disable-ci
```

The command puts an unconditional explicit deny on both CI roles before closing
their OIDC trust. It verifies the stored policies and writes a private receipt.
That receipt deliberately does **not** claim propagation is verified: use the
private `revocation-probe` with an existing session and then a fresh `access-probe`.
The existing session must report `EXISTING_SESSION_ACCESS_REMOVED`; a new workflow
must fail at AWS role assumption. Runtime roles and the shared provider remain
unchanged. Before recovery, resolve the compromised GitHub access or controller.
`enable-ci` first writes and verifies `AWSRevokeOlderSessions`, denying every
session issued before recovery. It then restores the reviewed trust and removes
only the unconditional incident deny. The issue-time deny stays in place. Verify
an old session remains denied and a fresh access probe succeeds after recovery.

If CLI access is unavailable, use an independent AWS console identity: add the
inline `OpenSightEmergencyDeny` policy (`Effect: Deny`, `Action: *`, `Resource: *`)
to **both CI roles**, then remove their GitHub federation allow statements. Do not
remove the shared provider. Cancel pending GitHub runs and verify revocation.
If deployed application code is suspect, stop its admission and recover a known
release as well; revoking credentials does not undo an already deployed image.

A watchdog is armed before mutation for fifteen minutes after preparation; the
CI mutation job has a twelve-minute timeout. AWS delivery/propagation can add
delay. For a matching unfinished operation it stops all application admission;
it never reopens. A stale lock never expires into automatic takeover. Inspect
its recorded phase, actual function images/alias, frontend digests and current
release from independent operator access before recovery. Never delete a lock
merely to rerun. Known promotion failures re-quiesce and verify the exact compatible
predecessor; ambiguous commit/rollback state retains the lock for the operator.

## Cost and verification

Use standard public GitHub runners for builds and public release assets for the
large image archive. Private runners are ephemeral and used only for preflight,
deployment and access drills. Temporary build artifacts expire after one day and
are deleted after successful publication; caches separate PR and trusted scopes.
There is no persistent runner, NAT gateway, database poller or new IAM access key.
The watchdog is a small non-VPC Lambda invoked only for a release guard.

Keep detailed AWS configuration, test credentials, operation records and logs in
private storage. Publish only sanitized test counts and completed acceptance
results. An IAM configuration check is not a successful revocation drill, and a
published artifact is not a deployed application.
