# Serverless validation and initial pilot deployment

This implements the SR4a packaging contract in
[`docs/phase5-sr4a-packaging.md`](../../docs/phase5-sr4a-packaging.md).
The default profile creates isolated validation resources. The opt-in initial
pilot profile adds the durable queues and workers; public ingress has its own
root and acceptance gate. Lambda configuration stays frozen: the private initial
activation changes SQL admission only after migration and tester setup. Neither
profile creates recurring database wakeups.

The initial pilot workflow is documented in
[`pilot-README.md`](pilot-README.md). Recurring compatible releases use the
[private OIDC controller](../../docs/phase5-sr4c-compatible-releases.md).
Remote developers can [request a release and inspect production status](../../docs/phase5-release-requests.md)
without AWS access. General infrastructure, migration and restore execution
remain separate D-25 work.

## Build and local acceptance

Use the tool versions and Lambda base digest in
[D-27](../../docs/itd/D-27-serverless-build-tooling.md). Dependency acquisition is
separate from the offline `RUN --network=none` build/test steps. Docker receives
only the allowlisted build context, never operator credentials or private inputs.

```sh
docker build --platform linux/arm64 --provenance=false --sbom=false \
  --metadata-file /private/operator/runtime-build.json \
  --target runtime -t opensight-validation -f ops/serverless/Dockerfile .
docker run --rm --network none --read-only --user 1000:1000 \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m --entrypoint node -i \
  opensight-validation --input-type=module < ops/serverless/image-smoke.mjs
```

The test-only browser is Sparticuz Chromium 153.0.0, ARM64 pack SHA-256
`b6874fc0d7af15e16a15ef1b73177731f698c296c73d26aa4a90840c0777a338`, with the
MIT-licensed `@sparticuz/chromium-min` 153.0.0 extraction helper. Its upstream
Chromium notices remain in the test tool distribution. It is not an application
dependency and is absent from the runtime image. The browser runs offline.

The RDS CA file is the public AWS global trust bundle downloaded from
`https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`, SHA-256
`fe45bbebf92ad3e27a583bbb2ddd1553c521ed4d49af5514dc0a40372ea5395c`.
It contains public certificates, not private keys. Review and repin CA updates.
TLS verification is mandatory. The image and frontend `manifest.json` files list
file hashes; the build metadata supplies the final immutable image digest.

The test stage includes the full root test suite and rebuilds the demo. Its
`/frontend` directory is the separately built hosted frontend. The runtime copies
only production dependencies, compiled workspaces, embed HTML and the CA bundle.
The final image has no test browser, application source, test fixtures or operator
files. Record `node --version`, `rpm -qa` license inventory and image size in
private build evidence before publishing.

## Private operator workflow

Install AWS CLI and OpenTofu separately. All AWS commands below are **explicit
operator deployment actions**, never ordinary builds. Review the resource/cost
plan before provisioning. Budget notifications do not cap spend.

Create a mode-0700 directory outside the checkout and set
`OPENSIGHT_OPERATOR_DIR` to its absolute path. Create mode-0600 `operator.json`
with `region`, `deployment`, `alert_email`, `public_origin`, and `image_uri`.
Use us-east-1 and an ECR URI pinned to the locally built manifest digest.
No real values belong in this repository. Run commands from the repository root:

1. `node ops/serverless/operator.mjs prepare` reads account/AZ inventory and
   writes private backend/variable files. It creates no cloud resource.
2. `... bootstrap` creates/tag-checks protected encrypted state, enables S3
   versioning/native locking and KMS rotation, then imports into the remote
   bootstrap root. It never falls back to local state. It starts the 72-hour
   ledger. A partially created key is recorded before alias creation; ownership
   checks refuse foreign resources. If interrupted between bucket creation and
   tagging, inspect the private evidence and ownership before repairing tags.
3. `... repository` creates/tag-checks the immutable ECR repository and imports
   it into remote validation state. Authenticate Docker privately and push the
   reviewed image. Verify the pushed digest matches `image_uri`; no credentials
   are build arguments or image layers.
4. `... plan` writes private saved-plan/evidence files and prints a sanitized
   resource/cap summary and plan SHA-256. Inspect the full private plan and IAM
   policies. `... apply <reviewed-sha256>` applies only those exact bytes after
   the plan-policy checks. A new operator configuration first creates the
   dependencies with `enable_runtime=false`. After that apply completes, run
   `... enable-runtime`, then `... plan` and `... apply <new-reviewed-sha256>`
   again. Generated database/secret references are now known, so the checker can
   inspect every Lambda environment value before creating functions. Unknown
   maintenance gates still fail closed. Neither apply creates public ingress or
   consumer mappings. Failed OpenTofu output stays in private `*.failed.log` files.
5. `... secrets` populates absent operator/tenant versions with random material.
   Existing current versions are preserved. It never prints plaintext credentials
   or puts payloads in Terraform state. The same command creates the isolated SMTP key, derives the regional password
   in memory and stores it in Secrets Manager. An unexplained existing key fails
   closed; no key payload enters Terraform state.
6. `... invoke native`, `... invoke network`, `... invoke bootstrap`,
   `... invoke database`, and `... invoke startup` run explicit commands. Run
   `... invoke mail` only for the operator-approved synthetic message; configure
   and verify both SES sandbox sender/recipient first. No other command sends mail.
7. `... observe` records Aurora capacity metrics without a SQL ping. Capture
   idle-to-zero, bounded resume, concurrent/failure cleanup and teardown evidence
   in the private directory. A successful local check is not AWS proof.

The ledger reserves each Lambda attempt before dispatch, including failures,
with at most 1,000 invocations and twenty mail attempts within 72 hours. AWS CLI
automatic retries are disabled; ambiguous calls require a separately counted
explicit retry. Invoke transport allows 130 seconds for the bounded 120-second
function. The exclusive directory lock
rejects concurrent operator processes. If a process dies, inspect its outcome
before removing the stale lock; do not reset the ledger. Probe network calls
require fewer than 20 outstanding synthetic schedules. The module has three
functions with concurrency one, 2 GiB memory and 512 MiB temporary storage; one
0–2 ACU writer with five-minute auto-pause; no provisioned concurrency, NAT,
interface endpoint, replica, Data API or automatic SQL observer. Budgets warn at
$10/$20 of **account-wide monthly actual cost**; they are conservative alerts,
not isolated attribution, immediate notifications or a spending stop.

## Cleanup

Select one category explicitly with `... cleanup schedules|objects|compute|database|credentials`.
Ownership tags are checked before every selection. Credential cleanup revokes
all keys on the dedicated SMTP user; the user and its policy remain for audit. Objects are limited to the
synthetic `probe/` UUID namespace, including versions; unexpected keys fail
closed. Compute cleanup disables concurrency before deleting functions. Database
cleanup requires exactly the owned writer, disables deletion protection explicitly,
deletes that writer and keeps a final cluster snapshot. This is a deliberate
operator override of ordinary IaC destruction protection, not an automatic test.
The experiment becomes retired after compute/database cleanup; apply cannot
recreate it accidentally. Reconcile service deletion completion and remote state
before a separately reviewed new experiment.

State bucket/KMS key, secrets, final snapshot, image/object storage, logs and
private evidence are retained. They can still cost money after compute cleanup.
Networking/roles/empty queues are retained for inspection and have no fixed
hourly charge in this profile. Re-check storage and secret retention charges;
explicitly retire them after reviewing evidence. Never delete the state bucket
or KMS key as routine cleanup. No `tofu destroy`, `-lock=false`, public bucket,
secret-valued Terraform variable or wildcard cleanup target is supported.

## Checks

```sh
tofu -chdir=ops/serverless/validation init -backend=false
tofu -chdir=ops/serverless/validation validate
tofu -chdir=ops/serverless/validation test
node --test conformance/serverless-operator.test.mjs
```

Provider acquisition is a separate setup step. OpenTofu 1.13.1's automatic
predecessor-registry shim incorrectly makes `-lockfile=readonly` reject the
explicit `registry.terraform.io` source. The operator harness records the lockfile
hash before initialization and requires byte-identical contents afterward; the
installer still verifies the pinned provider hashes. A changed lock fails before
plan/import/apply. Both roots were checked with this unchanged-lock initialization. Mock-provider tests make no AWS
calls. The reviewed plan policy rejects unlisted resource types, destructive
plans, cap increases, public invocation/database/buckets, secret payloads and
paid network fallbacks. Failed probes return named safe codes. The application
migration remains frozen and refuses foreign schema/role ownership; the tenant
role receives only RLS metadata-table DML and control-state read access. The
operator role's required Aurora BYPASSRLS behavior remains a cloud acceptance
check, never a reason to weaken the tenant role or its policies.

SMTP derivation follows the [AWS SES credential algorithm](https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html).
The SMTP user cannot send to arbitrary recipients or use any other AWS service.

## Durable application composition (SR2d)

The image now contains the durable adapter, still separately gated from public
activation. `OPENSIGHT_SERVERLESS_DATA=durable` selects it; omitting the variable
retains SR1's closed storage gate. Other values are rejected. Startup requires
exact coordination, manifest, dispatch, object and operation migration markers.
Run the IAM-only migration with maintenance frozen and admissions drained before
activating routes; it leaves maintenance, epoch and existing limits unchanged.

The runtime additionally requires `OPENSIGHT_ARTIFACT_BUCKET`, work/recovery queue
URLs and ARNs, Scheduler group/role/DLQ ARN, and the existing deployment, budget and
entitlement configuration. `awsEnvironment` supplies the marked runtime role names
from the private connection secrets; these roles never own or migrate schemas.
The worker entrypoint handles only ingestion, recovery and object cleanup. Its
queues require the batch, visibility, retry and delivery contract in
[SR2d](../../docs/phase5-sr2d-operations.md). H7 recurring jobs remain unavailable.

The operator must separately configure exact-origin S3 PUT CORS, expose version and
checksum response headers, preserve signed length/type/checksum/conditional/SSE
constraints, and grant only the owned immutable prefixes. API requests never
return public or presigned result GETs. The validation root still creates no
consumer mappings or public ingress; setting an environment flag alone is not a
complete or verified deployment.
