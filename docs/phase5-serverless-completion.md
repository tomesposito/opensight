# Phase 5 — SR3/SR4 completion

D-79 isolates event replay and defines bounded cloud delivery acceptance. D-80
turns plan/apply and maintenance contracts into executable operations.

## Delivery

`replay-lambda.handler` accepts only `{version:1,event,acceptAmbiguous}` and validates
before fetching credentials. The dedicated Terraform replay module publishes a
numeric version and grants a separate operator caller role only that invocation.
Its execution role explicitly denies bootstrap and SMTP secret reads. Existing
current-authority, retry, expiry and SMTP ambiguity rules still apply.

The request process may expose the operator-verified
`OPENSIGHT_WORKER_SMTP_CAPABILITY=configured` declaration in automation status.
It cannot send mail on that basis. Before activation, verify the worker's real
host/from/secret and permission; bind the environment change into the reviewed
release configuration. Invalid declarations fail closed.

`ops/serverless/cloud-delivery-check.mjs` is a temporary private acceptance harness,
not an HTTP route or ordinary worker. Its expiring plan fixes a nonce, synthetic
database/deployment/queues and the privately approved recipient. Fault hooks live
only in that harness. It exercises real durable dispatch, recipient rendering,
SMTP and post-DATA authority. One recorded command cannot be implicitly retried.
Operator teardown removes its temporary database, roles, secrets, queues,
schedules, function and image; it never redrives or purges production DLQs.

## Saved plans and maintenance

The [private templates](../ops/serverless/workflow-templates/README.md) call real
commands. `saved-plan.mjs` binds source/configuration/tool/provider/state and binary
plan bytes. Independent approval, live refresh-only drift checks, native state
locking, shared operation CAS and immutable consumption receipts guard apply.
An interrupted apply stays recorded; recovery reconciles actual resources/state.

`serverless-backup` creates bounded, consistent metadata snapshots under the
maintenance lock. Every retained object version is inventoried and pinned. The
fixed-plan Lambda verifies actual S3 versions/checksums and available key versions,
writes KMS-encrypted snapshots and conditionally links them into the independently
held registry. A bare snapshot is not restore authority.

Registered migration checks the exact retained metadata before and after the
transaction and stores a replayable receipt. It does not require an empty object
inventory. The external operation controller remains responsible for complete
invocation drain, advancing the external epoch before SQL freeze, watchdog and
reviewed artifact promotion. The initial D-71 bridge remains available for its
narrow initial-schema transition; its empty-inventory restriction is unchanged.

Restore accepts only a distinct initialized `os_restore_*` database. It checks
the newest independent registry, later tenant deletions, retired/missing keys,
object availability and epoch/fence high-water marks. It suspends surviving
tenants, removes memberships, revokes sessions/invitations, cancels work and holds
usage. It has **no reopen operation**. An old backup cannot reissue prior authority
or replay queue contents. A separate security/membership review must precede any
future production cutover.

The independent lifecycle registry is required operator evidence. A snapshot does
not establish that no later deletion/revocation happened. If complete external
history is unavailable, recovery must fail closed; do not manufacture an empty
registry or reduce its revision, epoch, fences or tombstone retention.

Validation and live activation receipts are recorded separately. Local tests and
workflow template availability alone do not establish completed cloud acceptance.

## Cloud acceptance (2026-10-15)

The isolated runner used the deployed `8b2481b` image plus the bounded acceptance
harness. A separate synthetic database, runtime roles, queues and schedule group
kept its faults out of production state. Real SQS and SES checks established:

- Report and refresh-triggered alert rendering used the recipient's RLS total
  (40), not the owner's total (60); protected-column rendering was denied.
- A duplicate delivery event produced no second send. Pre-commit failure rolled
  back after recovery was armed; lost commit/dispatch acknowledgements recovered
  the original durable outbox; child dispatch failure did not duplicate children.
- Recipient, owner and tenant revocation before SMTP DATA prevented sending.
- An accepted SMTP message with a lost database receipt remained ambiguous.
  Ordinary retry and replay without explicit acceptance were refused; explicit
  ambiguous replay reused the same Message-ID and can deliver a duplicate.

SES accepted five explicitly authorized synthetic messages in total. That is SMTP
acceptance evidence, not a claim of inbox delivery. The temporary runner's SMTP
secret access was explicitly denied before maintenance acceptance. Production
DLQ evidence was neither redriven nor deleted.

A real frozen PostgreSQL snapshot registered one retained S3 object with its exact
version, size and SHA-256. Registered migration preserved it and committed a
receipt. Restore into a separate initialized database held 12 synthetic tenants
at epoch 3, removed memberships, revoked session authority and cancelled queued
work. The restore role explicitly denied source database/bootstrap and SMTP
secret reads, and had no event mapping or function URL. Missing object bytes, a
later tenant deletion and a retired source key each prevented another restore.
The independent registry advanced monotonically throughout the drill.

Separate locally assumed plan/apply roles executed the real monitoring root. The
reviewed saved plan made zero AWS resource changes. Input mutation was refused;
apply succeeded after independent approval; trying it again failed the changed
state-version check. Provider normalization already shown in the review was
compared exactly, while new drift remains a refusal. The immutable consumption
record and final receipt remain in encrypted operator storage. These local role
checks do not by themselves establish GitHub OIDC workflow acceptance.

## Activation gates

The replay-only handler, truthful request-side SMTP capability and new private
maintenance workflows still require owner merge and operator activation. Keep
#85/#86 open until the exact merged release is promoted, replay IAM is verified,
and the independently approved private workflow path is exercised. Do not rewrite
the current compatibility baseline to admit a changed runtime.

The temporary drill is not production backup coverage: production restore must
provide complete independently maintained lifecycle evidence. Missing evidence
keeps recovery closed. The restore executor offers no production cutover.

The demo was rebuilt and compared with the exact published `a27a5bd` demo;
1280 × 800 Home screenshots were byte-identical. See
[gap notes](issue-85-gap-notes.md). No demo UI or README media changed.
