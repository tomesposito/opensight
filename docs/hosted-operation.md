# H8: single-node hosted reference and pilot gate (#37)

This is a reference harness, not a deployed service. Actual deployment requires
separate authorization. Run one API/query process and its one scheduler. One host,
one PostgreSQL instance and one ingress share a host failure domain. This is not
HA, and no availability, RPO or RTO commitment is made. In-process Blaze remains
ephemeral: restart starts empty and cached reads return `BLAZE_NOT_READY` until an
explicit refresh. No distributed artifact store, replica coordination or failover
is enabled. H9–H12 remain outside this build.

The reference is [deploy/compose.yaml](../deploy/compose.yaml). A small Node HTTPS
ingress terminates TLS, serves the built web assets and proxies to the private
hosted API. Only ingress publishes a port (8443 by default). PostgreSQL and API
have no published ports. The internal network has no external egress; sources or
SMTP outside it require an explicitly reviewed operator network configuration.
The database volume and deployment-managed environment/TLS files outlive
replaceable containers. Never remove the metadata volume during a normal restart.

## Gate status and decisions

[H8 verification](h8-reference-verification.md) records measurements and gaps.
Native PostgreSQL checks are separate from the Docker integration gate. The gate
must pass on the selected reference VM and reviewed images before a pilot is
approved. A skipped Docker test is not evidence that the composed reference works.

**HQ-10 is OPEN for Tom:** availability/RPO/RTO, audit/artifact/backup retention,
deleted-tenant backup purge and permitted data locations. **HQ-14 is OPEN for
Tom:** usage units, accuracy/retention and entitlement meaning. This build adds
internal hooks, not prices, payment vendors or billing-driven suspension.
Engineering limits below are configurable bounds, not product entitlements.

## Dependencies and image gate

No new package version was introduced. API now declares the already-installed
`pg` 8.23.0 and `@types/pg` 8.23.1 directly; their checked package metadata and
LICENSE files identify MIT. Ingress uses Node's built-in HTTP/HTTPS/filesystem
modules. OpenSight config/code is Apache-2.0. Docker Compose tooling is
Apache-2.0; PostgreSQL server uses the PostgreSQL License under HQ-15's
operator-installed infrastructure exception. No commercial service or AWS call
is used.

Set `NODE_IMAGE` to an operator-reviewed Node 24 Linux image and `POSTGRES_IMAGE`
to an operator-reviewed PostgreSQL 16 image already present locally. Review the
exact image digest, distribution and transitive licenses; no image was downloaded
or certified by this build. Record approved digests in private deployment config.
Compose uses `pull_policy: never`. Build network access is limited to `npm ci`;
compilation uses `RUN --network=none`. Do not substitute source-available server
licenses. Docker Desktop is not required.

## Fresh install (only after deployment authorization)

Build from the repository root. Keep all real configuration, credentials,
certificates and backups outside the repo. Restrict directory/file permissions;
TLS key files must be readable only by the ingress runtime UID (normally 1000).
Do not enable shell tracing, print `docker compose config`, or log environment
values. Compose `config --quiet` validates without rendering injected secrets.

Supply Compose interpolation through the deployment environment:

| Variable | Purpose |
| --- | --- |
| `NODE_IMAGE`, `POSTGRES_IMAGE` | Reviewed local runtime/server images |
| `OPENSIGHT_APP_IMAGE` | Built application image; default `opensight-reference:local` |
| `OPENSIGHT_RUNTIME_ENV_FILE` | Absolute protected file supplying API environment |
| `OPENSIGHT_PUBLIC_ORIGIN` | Exact HTTPS origin, also set identically in the API file |
| `OPENSIGHT_TLS_DIRECTORY` | Protected directory containing `cert.pem` and `key.pem` |
| `OPENSIGHT_HTTPS_PORT` | Published ingress port, default 8443; origin must include it when nonstandard |
| `OPENSIGHT_POSTGRES_BOOTSTRAP_PASSWORD` | Separate PostgreSQL initialization credential |
| `OPENSIGHT_METADATA_PASSWORD`, `OPENSIGHT_TENANT_METADATA_PASSWORD` | Independent database role credentials |
| `OPENSIGHT_API_MEMORY_LIMIT` | Container bound, default 2 GiB; reconcile with H4 reservations |

The API environment file must supply these H2/H4 settings:

- `OPENSIGHT_METADATA_URL`: private PostgreSQL URL for `opensight_metadata`.
  This role is NOSUPERUSER with BYPASSRLS for authoritative membership/operator
  work and owns the metadata schema. Never supply the bootstrap login here.
- `OPENSIGHT_TENANT_METADATA_URL`: separate `opensight_tenant` login, NOSUPERUSER,
  NOINHERIT, NOBYPASSRLS, with only the H1 tenant-table grants. The runtime checks
  role safety and scopes/resets every transaction. H2–H8 private tables are denied.
- `OPENSIGHT_PUBLIC_ORIGIN`, `OPENSIGHT_AUTH_ISSUER`, `OPENSIGHT_AUTH_AUDIENCE`,
  `OPENSIGHT_AUTH_KEY_ID`, `OPENSIGHT_AUTH_SIGNING_KEY`,
  `OPENSIGHT_AUTH_ENCRYPTION_KEY`, `OPENSIGHT_OPERATOR_KEY`,
  `OPENSIGHT_SESSION_SECONDS`, `OPENSIGHT_INVITATION_SECONDS`.
  Keys are independently generated, canonical base64, 32 bytes. H2 rejects reuse
  between encryption, signing and operator credentials. No fallback verifier exists.
- `OPENSIGHT_NODE_LIMITS`, `OPENSIGHT_TENANT_LIMIT_DEFAULTS`, optionally
  `OPENSIGHT_TENANT_LIMIT_OVERRIDES`: complete validated JSON per
  [H4](h4-budgets-containment.md). There are no implicit query-budget defaults.
- Optionally `OPENSIGHT_AUDIT_OPERATOR_KEY`: another independent base64 32-byte
  key. Omit to disable operator audit/metrics HTTP access.
- Optionally `OPENSIGHT_SOURCE_ENDPOINTS`: operator-controlled source endpoints;
  default `[]`. Tenant credentials remain encrypted, owner-scoped references.
  No request supplies a deployment environment-variable name or secret endpoint.

Compose fixes `OPENSIGHT_MODE=hosted` and
`OPENSIGHT_WORKER_ROLE=api-query-scheduler`. Running another API/query/scheduler
against the same metadata database fails `REFERENCE_ALREADY_RUNNING`. Do not run
legacy CLIs concurrently against PostgreSQL or bypass the reference lock.

```sh
docker compose -f deploy/compose.yaml config --quiet
docker compose -f deploy/compose.yaml build --pull=false
docker compose -f deploy/compose.yaml up -d --wait --pull never metadata
docker compose -f deploy/compose.yaml run --rm --no-deps \
  -e OPENSIGHT_MAINTENANCE=frozen api \
  node packages/api/dist/reference-cli.js initialize
docker compose -f deploy/compose.yaml up -d --no-build --pull never api ingress
```

Initialization stages H1–H8 schemas and budgets in one PostgreSQL transaction,
registers the encryption-key fingerprint and grants the restricted tenant role.
Serving refuses absent, partial or incompatible H8 schema versions. PostgreSQL
bootstrap credentials are used only in its initialization container, not API.
Never expose the unauthenticated fixture CLI as this reference.

Provision and enroll with the authenticated H2 operator/API workflow in
[H2](h2-tenant-sessions.md). SMTP is not configured by this reference. Configure
an authorized transport before delivering real invitations/reports; no fake mail
success is shown. Tests use the existing stub transport only.

## Optional surfaces

Unset embedding keys/policy leave embedding unavailable or disabled; see H5/H6
for deliberate configuration. Do not substitute fixture embed credentials.
Custom domains, distributed artifacts, anonymous pilot access, prepared-dataset
sharing and generative AI execution are not enabled by this reference. Reports
and alerts require configured SMTP and current recipient authorization. Static
web pages retain their honest hosted-capability messages. A static build is not
a deployed backend. The reference does not alter existing H7 UI or README media.

## Health, restart and shutdown

`GET /health/live` reports process liveness independently of metadata.
`GET /health/ready` checks authoritative membership/schema/key access, the
restricted tenant database role, Linux procfs worker support, scheduler health,
audit-store health and the reference ownership connection. Probes have a
2-second caller bound and only one outstanding authoritative probe. Responses
contain only `ok`/`unavailable`, with no dependency addresses.

`OPENSIGHT_HTTP_MAX_INFLIGHT` defaults to 64 (1–4096). Excess requests receive
`NODE_ADMISSION_REFUSED`. Existing H4 budgets separately bound queued and running
compute, memory, rows and time. `OPENSIGHT_DRAIN_MS` defaults to 20000 (1–60000).
The reference process imposes a 30-second final shutdown bound and Compose allows
35 seconds; keep the configured drain below that final bound.

SIGTERM closes admission/readiness first, stops scheduler admission, cancels
queued/running budget work and waits for requests/worker cleanup. A stopped job
cannot publish a successful occurrence. The process exits on its final deadline
before relinquishing ownership to a replacement. H7 recovers abandoned execution
claims and retries interrupted deliveries with their original dedupe keys. This
is single-node restart recovery, not distributed lease/fencing or exactly-once
SMTP. Ambiguous SMTP acceptance can still duplicate delivery.

Restart with `docker compose -f deploy/compose.yaml restart api`; do not scale it.
After restart verify readiness, session authorization, tenant isolation and
`BLAZE_NOT_READY` before explicit refresh. Lost PostgreSQL ownership triggers
shutdown. A metadata outage fails authorization and readiness even if cached rows
remain in process. A successful readiness probe does not promise a latency SLO.

## Audit, metrics and usage hooks

Events allowlist operation, generated request/job IDs, opaque tenant/namespace,
revision, outcome/error code, latency and numeric accounted usage. They never
serialize request headers, URLs/bootstrap links, connection strings, SQL values,
rows, prompts or raw exceptions. Client request IDs are not trusted. Source
secrets are resolved after current owner/tenant authorization, and access/rotation
is audited without values. PostgreSQL reference logging suppresses statements,
parameters and detailed row errors. Do not add an upstream access logger that
records embed URLs or authorization headers.

`GET /api/audit` returns the last 100 events in the authenticated administrator's
tenant. Foreign namespace paths and copied contexts fail. `GET /api/host/audit`
and `/api/host/metrics` require `Authorization: AuditOperator <credential>` under
the independent audit key and forbid browser-origin requests. An ordinary
`Operator` or tenant-admin token cannot cross this boundary. Audit reads are
recorded. Responses are bounded and have no tenant-ID metric labels.

Metrics include request/job counts, failures, latency totals, H4 queue/execution/
source-row/cancellation/worker-memory counters, cache bytes/hits/misses/refresh
outcomes/age, scheduler delay, node RSS and temporary-disk availability. Execution
time is an admitted-work duration, not PostgreSQL rows scanned or physical query
cost. Shared hydration, distributed lease loss and manifest lag are inapplicable
and not fabricated. Metrics reset on restart; durable audit and hooks do not.

`HostedObservability.hook` is an internal capability for `usage.recorded` and
`entitlement.changed`: event ID, tenant/namespace, interval/resource, numeric units,
and schema revision 1. Repeating an identical ID/payload is idempotent; conflicting
reuse fails. Accounted work emits execution milliseconds, observed source rows and
working bytes. The internal pending/acknowledgment methods allow at-least-once
export with consumer deduplication; no vendor exporter runs. Entitlement hooks
neither change limits nor suspend tenants. Final units/accuracy remain HQ-14.

No automatic audit, hook, backup or tombstone purge is enabled while HQ-10/HQ-14
are open. Schedule backups and choose private storage capacity/retention only
under an approved operator policy. No indefinite-retention service promise is
implied. Query/HTTP bounds and operator-selected backup paths remain configurable.

## Backup and recovery keys

Stop API, keep metadata private, and run `reference-cli.js backup` under
`OPENSIGHT_MAINTENANCE=frozen`. The same exclusive ownership lock excludes serving
and other maintenance. Set `OPENSIGHT_BACKUP_PATH` in a private mounted directory
and `OPENSIGHT_BACKUP_KEY` to a separately retained 32-byte base64 key distinct
from the data-encryption key. Supply it through the secret channel, not arguments.

For example, with an authorized private directory in
`OPENSIGHT_BACKUP_DIRECTORY` and `OPENSIGHT_BACKUP_PATH=/recovery/snapshot.sealed`:

```sh
docker compose -f deploy/compose.yaml stop api
docker compose -f deploy/compose.yaml run --rm --no-deps \
  -v "$OPENSIGHT_BACKUP_DIRECTORY:/recovery" -e OPENSIGHT_MAINTENANCE=frozen api \
  node packages/api/dist/reference-cli.js backup
```

The authenticated encrypted snapshot contains versioned H1–H8 metadata, source
secrets and inline encrypted uploaded artifacts, MFA/invitation ciphertext,
revocations/tombstones, histories and outboxes. It records encryption fingerprints
and version metadata, never master keys. Files are exclusive-created mode 0600
and fsynced. A partial file fails authenticated reading; choose a new backup path
when retrying. The offline library bounds each table at 100000 rows and total
serialized content at 256 MiB by default; the library permits a smaller/larger
explicit byte budget. Exceeding a bound aborts, never truncates. Measure larger
inventories before expanding the envelope.

Retain recoverable versions of the encryption key and the independent backup key
outside containers, with the backup inventory and reviewed image/schema version.
Retain signing-key configuration for controlled recovery/rotation. PostgreSQL
source databases are external systems of record and need their own consistent
backups; this archive contains their references/credentials, not their table data.
There are no H9 external artifact objects to claim as backed up.

## Restore and deletion drills

Use a private stopped target. `restore` accepts `OPENSIGHT_BACKUP_PATH` and
`OPENSIGHT_BACKUP_KEY`; unset `OPENSIGHT_RESTORE_TENANT_ID` for total loss or set
it for one opaque tenant. A total-loss target must have no tenants. Initialize
its H8 schema/roles first. Match the snapshot's encryption key; if the live store
has since rotated, restore into an isolated staging store, re-encrypt there to
the current key, and take a new snapshot before tenant restoration. Never replace
the whole live deployment key to recover one older tenant.

Run the same offline Compose command above with `restore`. The restore is one
transaction and fails closed on malformed or incompatible records:

1. Tenant restore leaves other tenants untouched. Newer member removals and
   authorization revisions are retained. Newer deleting/deleted tenants keep
   their tombstones and receive no restored payloads.
2. All restored live tenants become suspended with durable reconciliation holds.
   Every restored session/embed is revoked, old invitation tokens are disabled,
   and pending execution/delivery is cancelled. Total loss lacks a trusted newer
   revocation ledger, so it never makes tenants active automatically.
3. Review the latest independent revocation/deletion evidence. If deletion is
   known, continue the existing delete workflow; never resume that tenant. If
   the evidence is unavailable, keep it suspended.
4. For a reviewed surviving tenant, supply `OPENSIGHT_RECONCILIATION_CONFIG` as a
   private JSON file containing `tenantId`, current `expectedVersion`, and the
   complete reviewed `removedUsers` list. Run `reconcile-restore` offline. This
   retains existing removals, revokes sessions again and releases only the hold.
   Resume later through the existing versioned operator API. Reconciliation does
   not resume tenants or issue credentials.
5. Verify old sessions remain denied after resume, removed members stay removed,
   other tenants remain isolated and Blaze starts empty. Re-enroll/invite only
   through authorized H2 operations. Retain the failed/drill target until its
   evidence is reviewed; never count a unit test as a recovery-time commitment.

Deletion drill: create a synthetic tenant, take a backup, suspend/delete and
complete artifact removal, then attempt to restore the older tenant snapshot.
The newer tombstone must survive and no source payload may reappear. For a
separate empty target, the restored tenant must remain suspended until current
revocations are reconciled. Automated tests cover both cases.

## Frozen migration and key rotation

Keep legacy stores offline and preserve H1's versioned private backup until the
migration is validated. Do not run dual writers. Read [H1](h1-tenant-metadata.md),
[H3](h3-durable-sources.md) and [H7](tenant-automation.md) for exact inventories,
source bindings, current memberships and owner mappings; unresolved rows need
repair, not silent omission. H1 does not migrate passwords or invent verified
identities. Establish the reviewed H2 memberships before H7 owner conversion.

The PostgreSQL reference CLI exposes `metadata-migrate`, `metadata-seal`,
`metadata-rollback`, `sources-migrate`, `sources-seal`, `sources-rollback`,
`budgets-migrate` and `jobs-migrate`. They use the prior slices' environment
manifest names and libraries under the serving lock. Mount the frozen inputs,
private manifests and backup directory into the maintenance container. For legacy
AI ciphertext, its encryption key must match the reference encryption key at
migration; mismatches require repair. Do not seal before validating mappings,
counts/checksums, sources and permissions. A transaction interrupted before commit
leaves the previous schema/data intact; retry identical inputs. H1/H3 sealing is
the existing rollback boundary. Never start an old writer on an H8 database.

`rotate-encryption` requires `OPENSIGHT_NEXT_ENCRYPTION_KEY`, stopped serving and
`OPENSIGHT_MAINTENANCE=frozen`. Source/AI/upload secrets, TOTP and invitation
copies are re-encrypted atomically; configuration revisions advance, sessions
are revoked and a value-free audit records the new encryption version. A corrupt
record rolls the operation back. Update the injected active key before restarting;
a stale key fails startup. Retain old versions as long as authorized backups need
them. Take and validate a fresh backup after rotation.

`rotate-auth-key` uses the new `OPENSIGHT_AUTH_KEY_ID` and signing key through
H2's existing mechanism. Retired IDs never reactivate. Current H2 rotation retires
previous verification keys immediately; use a controlled stop/restart and expect
reauthentication. Emergency revocation follows this mechanism and authoritative
session/embed revocation, not a TTL cache. Embedding has its existing separate
H6 key rotation mechanism; never reuse encryption keys for embed signing.

Overlapping verification is a future keyring plan, not a shipped feature: issue
only with the new active key, retain explicitly listed old verification keys for
at most the maximum remaining session lifetime, check their authoritative revoked
state on every use, and retire them after that bound. An emergency retires them
immediately. Test old/new issuer behavior and restored revocations before enabling
that plan or multi-node secrets. No H10 guarantee is inferred from key rotation.

## Reproducible verification

Run root `TZ=UTC npm test`; supply a private `DATABASE_URL` to include live
PostgreSQL tests. No test sends external mail or contacts AWS. H8's native
reference test uses the actual PostgreSQL roles, built-in auth, source execution,
scheduler, HTTP routes, restart and restore. H1–H7 isolation/containment suites
remain wired into the same root command.

The Docker-marked test skips cleanly when Docker tooling/daemon is absent. When
available, prebuild the app and set `OPENSIGHT_COMPOSE_TEST_NODE_IMAGE`,
`OPENSIGHT_COMPOSE_TEST_POSTGRES_IMAGE` and optionally
`OPENSIGHT_COMPOSE_TEST_APP_IMAGE` to reviewed local images. It never pulls them.
It creates only its own uniquely named project/volumes and synthetic TLS keys,
then tests HTTPS, isolation/load, container restart, encrypted backup and total
metadata-volume loss. It removes its own test volumes afterward. Missing images
on a Docker-enabled runner fail the gate; do not label that a passing deployment.
