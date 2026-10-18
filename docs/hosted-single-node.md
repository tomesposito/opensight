# H8: single-node hosted reference and pilot gate (#39)

**Pilot, single-node, no HA claims. Blaze is ephemeral. Actual deployment
requires separate authorization.** This is a local evaluation/reference harness,
not a production deployment or a deployed demo. HQ-10 B supplies no SLA, RPO,
RTO, availability percentage, recovery deadline, multi-region behavior or
compliance certification. HQ-14 B enforces operator-configured entitlements;
pricing, payment providers and billing-driven suspension are outside this slice.

The implementation starts one API process, the H7 scheduler in that process,
H4 disposable execution workers, and an operator-installed PostgreSQL server.
The reference refuses a second process against the same database/schema via a
session advisory lock. Losing that connection exits with `REFERENCE_LOCK_LOST`.
This lock prevents accidental concurrent reference writers; it is not a
replication, failover or distributed scheduling implementation.

## Files and prerequisites

- `ops/single-node/compose.yaml`, `Dockerfile`, `init-tenant.sh` and
  `.dockerignore` define the optional container harness. PostgreSQL has no
  published port. The API binds a host loopback port. No TLS proxy is supplied.
- `packages/api/src/single-node-cli.ts` is also usable without Docker against
  locally installed PostgreSQL. `single-node.ts` supplies initialization and the
  lifetime lock; `single-node-maintenance.ts` supplies offline drills.
- `hosted-health.ts`, `hosted-usage.ts` and `single-node-config.ts` compose with
  the existing H1–H7 server. The ordinary fixture server remains separate.
- Node 24, the existing npm lockfile, and PostgreSQL 16 are the tested tools.
  `pg` 8.23.0 and `@types/pg` 8.23.1 were already present and are now explicit API
  dependencies; both installed manifests declare MIT. No new resolved package
  or bundled database server was introduced. PostgreSQL is operator-installed
  infrastructure under the PostgreSQL License.

Build the API from the repository root:

```sh
npm run build --workspace @opensight/api
```

The API build compiles the shared visual compiler and hosted embed shell. It does
not rebuild the static demo. Native execution dependencies must match the
container platform if using Compose; the Dockerfile installs from the lockfile
inside the operator-selected Node image. Image pulling/building and actual
hosting require the operator's separate authorization; none was performed for
this change.

## Environment and secret injection

All settings are environment variables. A private Node `--env-file`, Compose
`env_file`, or environment-selected mounted secret file can supply them. For any
`OPENSIGHT_*` variable, the reference accepts `OPENSIGHT_*_FILE` instead. It reads
that regular file once, removes one final newline, rejects symlinks, files larger
than 1 MiB, and simultaneous value/file definitions with
`SECRET_INJECTION_INVALID`. There is no secret-file reload; drain and restart.
Errors and command output contain named codes/counts, never credentials, paths,
connection diagnostics, headers, payloads or source rows.

Keep runtime configuration, backups and secrets outside the checkout or in the
ignored `.opensight/` directory. Backups refuse other paths inside the checkout.
Use private directories and files, exclude request bodies/Authorization from any
operator-installed proxy logging, and keep PostgreSQL statement logging disabled
for secret provisioning. Never print the resolved Compose configuration into a
public log if the private env file contains direct secret values.

| Variable | Meaning |
| --- | --- |
| `OPENSIGHT_REFERENCE=single-node` | Mandatory for the reference launcher; enables H8 usage gates |
| `OPENSIGHT_REFERENCE_LOCATION` | Mandatory operator label for the one permitted local/single-region location, 1–80 letters/digits/underscore/hyphen |
| `OPENSIGHT_POSTGRES_OPERATOR_URL` | Privileged H1/H2 operator connection; must bypass FORCE RLS for lifecycle/maintenance |
| `OPENSIGHT_POSTGRES_TENANT_URL` | Separate login, NOINHERIT, NOSUPERUSER, NOBYPASSRLS; no schema/table ownership or owner-role membership |
| `OPENSIGHT_PUBLIC_ORIGIN` | Exact HTTPS origin, preserved in Host by the trusted proxy |
| `OPENSIGHT_AUTH_ISSUER`, `OPENSIGHT_AUTH_AUDIENCE`, `OPENSIGHT_AUTH_KEY_ID` | Explicit H2 issuer/audience/signing-key identifier |
| `OPENSIGHT_AUTH_SIGNING_KEY`, `OPENSIGHT_AUTH_ENCRYPTION_KEY`, `OPENSIGHT_OPERATOR_KEY` | Three distinct random 32-byte canonical-base64 keys; use `_FILE` for mounted secrets |
| `OPENSIGHT_SESSION_SECONDS`, `OPENSIGHT_INVITATION_SECONDS` | Required explicit H2 lifetimes; see [H2](h2-tenant-sessions.md) |
| `OPENSIGHT_EMBED_SESSION_KEY_ID`, `OPENSIGHT_EMBED_SESSION_KEY` | H6 key pair when embedding is selected |
| `OPENSIGHT_EMBEDDING_POLICY` | Existing H5/H6 canonical-origin and per-tenant policy |
| `OPENSIGHT_SOURCE_ENDPOINTS` | Operator-authorized H3 endpoint JSON; `[]` permits uploads only |
| `OPENSIGHT_NODE_LIMITS`, `OPENSIGHT_TENANT_LIMIT_DEFAULTS`, `OPENSIGHT_TENANT_LIMIT_OVERRIDES` | H4 containment JSON; explicit node/default settings required for migration |
| `OPENSIGHT_ENTITLEMENTS` | Required JSON described below; independent of H4 concurrency/memory containment |
| `OPENSIGHT_AUDIT_RETENTION_DAYS` | Default `0`: retain lifecycle audit indefinitely; positive days applied by offline `retain` |
| `OPENSIGHT_USAGE_RETENTION_DAYS` | Default `30`, minimum `1`: event/counter retention applied by offline `retain` |
| `OPENSIGHT_BACKUP_DIRECTORY` | Private, dedicated managed backup directory |
| `OPENSIGHT_MAINTENANCE=frozen` | Explicit assertion that external/legacy writers are stopped; reference maintenance also acquires the lifetime lock |
| `HOST`, `PORT` | Defaults `127.0.0.1`, `3000`; Compose sets its container listener to `0.0.0.0:3000` and publishes only host loopback |

Operator and tenant connection URLs must select the same server, database and
URL options (including schema). Only credentials differ. `migrate` grants the
tenant login H1 access, with UPDATE/DELETE revoked on `h1_outbox`. It grants no
H2–H8 private-table access. The runtime rejects unsafe tenant roles. H1 remains
the RLS and issued-context boundary; usage configuration cannot grant access.

The existing SMTP environment settings are necessary for real invitations/report
delivery; unconfigured mail returns `SMTP_NOT_CONFIGURED`. Drills use the stub
transport and synthetic data. Tenant source credentials still enter through the
H3 API and are encrypted as tenant/namespace/owner-bound secret references.
Offline H3 migration takes `credentialsEnv` names, never inline credentials in a
manifest. The reference `_FILE` loader does not change H3's encrypted envelope.
See [sources](h3-durable-sources.md) and [embed sessions](embed-sessions.md).

Compose expects operator-selected image references in `OPENSIGHT_NODE_IMAGE`
(Node 24), `OPENSIGHT_POSTGRES_IMAGE` (PostgreSQL 16), and
`OPENSIGHT_API_IMAGE` (the locally built image). Set
`OPENSIGHT_RUNTIME_ENV`, `OPENSIGHT_SECRETS_DIRECTORY`,
`OPENSIGHT_BACKUP_DIRECTORY`, and optionally `OPENSIGHT_REFERENCE_PORT` in the
shell invoking Compose. The private runtime env file contains application
settings; mounted secret paths use `/run/opensight-secrets/…`. PostgreSQL init
reads `postgres-operator-password` and `postgres-tenant-password` from that
mount. Supply nonempty random passwords and matching URL secret files naming
`postgres:5432/opensight`, with users `opensight_operator` and
`opensight_tenant`. Provision files without echoing their contents. Ensure the
API's `node` UID can read its secrets and write the backup directory, and the
PostgreSQL UID can read its password files. Do not make them world-readable.

All metadata, backups, local ephemeral storage and configured source locations
must stay in the operator-declared location. The label documents placement; it
does not geolocate source endpoints or enforce infrastructure placement. Choose
and verify the location before any separately authorized deployment. No
cross-region backup replication or geographical commitment is implemented.

## Fresh install, migration and restart

With a private env file and existing local PostgreSQL roles, run:

```sh
OPENSIGHT_MAINTENANCE=frozen node --env-file="$OPENSIGHT_RUNTIME_ENV" packages/api/dist/single-node-cli.js migrate
node --env-file="$OPENSIGHT_RUNTIME_ENV" packages/api/dist/single-node-cli.js serve
```

After separate authorization to run the local container harness, the equivalent
Compose commands, from the repo root, are:

```sh
docker compose -f ops/single-node/compose.yaml build api
docker compose -f ops/single-node/compose.yaml up -d postgres
docker compose -f ops/single-node/compose.yaml run --rm -e OPENSIGHT_MAINTENANCE=frozen api migrate
docker compose -f ops/single-node/compose.yaml up -d api
```

Do not scale the API service. Do not run the SQLite/legacy CLI against the same
stores. The reference lock rejects overlap as `REFERENCE_ALREADY_RUNNING`.
For an existing H1–H7 PostgreSQL store: drain/stop all writers, take an
operator-controlled pre-maintenance backup, and run `migrate`. The command
initializes missing schemas, applies explicit H4 configuration and initializes
H8 tables. Repeating it is safe. Startup/readiness refuses unsealed H1/H3
migrations, unmigrated H7 legacy jobs and unresolved budget policies. This is an
offline migration; it does not reinterpret legacy files. Use the documented
H1/H3/H7 migration libraries first when converting legacy stores.

To restart, drain and wait for process exit, then run `serve` with the same
configuration. Metadata, sessions, job histories, audit and usage counters
survive. Blaze snapshots are empty and require authorized refresh; there is no
stale fallback or shared Parquet hydration. Interrupted H7 work uses its existing
recovery/reauthorization path and consumes another compute attempt if executed.

## Operator health, metrics and drain

Every endpoint below requires `Authorization: Operator <base64url operator-key
bytes>`, the configured Host, no browser Origin, and no forged principal/forwarded
host headers. Tenant administrators, bearer sessions and embed credentials
cannot use these endpoints. Store the header in a private client configuration;
do not put its value in command history or URLs.

| Endpoint | Behavior |
| --- | --- |
| `GET /healthz` | Process liveness, even while draining or the DB is unavailable |
| `GET /readyz` | Proves operator DB connectivity, required schema/migration state, budgets/sources and the restricted tenant store |
| `GET /metrics` | Prometheus text: process request/error counters and durable per-tenant daily usage/admission/denial and current storage gauges |
| `GET /api/host/reference` | Pilot disclosure, configured location, whether H8 reference mode is active |
| `POST /api/host/drain` with `{}` | Returns 202, refuses new work, stops scheduler claims, finishes in-flight HTTP/execution/cleanup, closes the listener and exits the CLI |

Readiness names `DATABASE_UNAVAILABLE`, `MIGRATIONS_REQUIRED`,
`TENANT_STORE_UNAVAILABLE` and `SERVER_DRAINING`. SIGTERM/SIGINT use the same
graceful drain. Work already executing finishes; durable jobs not yet executing
stay queued for the next authorized restart. No forced-close timer kills an
in-flight request. An external supervisor's forced kill can interrupt it; drain
and await exit before container removal or maintenance. Drain errors report
`DRAIN_FAILED` and require operator inspection; no recovery-time target is made.

## Entitlements, events and audit

`OPENSIGHT_ENTITLEMENTS` has exactly this shape; these small numbers illustrate
validation, **not** recommended capacity or a product tier:

```json
{
  "defaults": { "apiCalls": 100, "storageBytes": 1048576, "computeAttempts": 10 },
  "tenants": {}
}
```

Each tenant override is a complete replacement with those three nonnegative,
safe-integer limits. Set `defaults` to `null` to require an explicit tenant entry.
Missing/malformed configuration or missing tenant entitlement is
`ENTITLEMENT_UNRESOLVED` (503). Zero disables the selected unit. Config is read at
startup; drain, update the environment, and restart to change it. It cannot be
supplied by tenant request fields, headers or SQL roles.

| Hook | Unit and accuracy | Enforcement and emission |
| --- | --- | --- |
| API | One authenticated, correctly namespace-scoped tenant or verified embed API request admitted past the identity boundary | Exact durable admissions per UTC calendar day; later validation/operation errors still consume a call. Over-limit calls return `USAGE_LIMIT_EXCEEDED` (429). Authentication attempts, embed shell/bootstrap redemption and operator calls are excluded; H2 authentication throttles still apply. |
| Storage | Exact sum of UTF-8 bytes of serialized `h1_resources.body` within a tenant | Logical current occupancy, including encrypted source/upload payload envelopes and base64 overhead. Growing writes above the ceiling roll back metadata, links, secrets and revisions together. Shrinking/deleting data remains possible after a limit reduction. Every committed tenant resource write emits the resulting byte gauge. |
| Compute | One admitted execution attempt of a manual source/prepared refresh, an H7 refresh/report/alert occurrence, or a recipient rendering attempt | Exact count of admissions per UTC day, **not** CPU time, row count or cost. A report may use one execution attempt plus one per rendered recipient. Retries/restarts doing new work count again; reuse of a saved delivery message does not render or consume another attempt. A scheduled refresh is not double-counted by the underlying refresh path. |

API/compute use atomic per-tenant locked counters and `h8_usage_events`, with
UUID, tenant/namespace, UTC timestamp, metric, `call`/`attempt` unit, amount `1`
and `admitted`/`denied` outcome. Denial events commit even though the operation is
refused. They reserve usage before work, so an admitted operation interrupted by
a crash can remain charged. Counter-store failure fails closed.

Storage changes are emitted in the transactional `h1_outbox` as
`usage.storage.bytes:<integer>`; no plaintext body is emitted. Rejected writes
leave both storage and their transactional event unchanged. Operator provisioning
and cleanup are outside tenant storage admission; their resource bytes are still
included in the next measurement and `/metrics`. The selected storage unit
excludes SQL pages/indexes/WAL, audit/session/job history, H5 appearance, cached
Blaze, external source databases and backup files. It is not a disk quota. H4
continues to enforce memory/concurrency/cache/row limits for those execution
paths, including interactive queries; interactive query CPU is not an H8
compute-attempt unit.

`opensight_requests_total` and `opensight_request_errors_total` count process
HTTP requests and failures and reset on restart. `opensight_usage_admitted` and
`opensight_usage_denied` are gauges labeled with the current UTC period, tenant
and metric. They read the same durable counters used for enforcement;
`opensight_storage_bytes` reads current resource bodies. Tenant IDs are opaque
operator-only labels; no email, source contents or credentials appear. Collect
metrics with an operator credential and protect collected data.

H1's append-only outbox records lifecycle/checkpoints, membership invitations,
acceptance/removal, metadata/embedding edits and job creation/update/stop/queue.
H8's private append-only audit records reference start/drain/migration,
backup/restore/review/deletion and retention actions. Appending occurs in the
same transaction as the corresponding durable mutation where both are SQL.
File backup/deletion operations append their completion after durable file work;
a crash can leave a safe intermediate state requiring a retry. This is not a
cryptographic tamper-proof audit against the database owner.

Audit is retained indefinitely by default. Positive audit retention and usage
retention are applied only when the operator runs offline `retain`; there is no
automatic deletion deadline. Ordinary tenant code cannot update/delete audit or
private counters. Retention deletes old rows; it does not rewrite existing audit
records. Existing encrypted backups can retain older rows until those backups
are purged. Immutable tenant/namespace reservation tombstones are retained
indefinitely to prevent ID reuse/resurrection.

## Backup, restore and tenant-deletion drills

Stop all writers and hold `OPENSIGHT_MAINTENANCE=frozen`. These commands acquire
the same exclusive database/schema lock as serving. Backups include H1 lifecycle
records and the H2–H8 tables needed to restore consistent references. They omit
environment values, database roles, external source databases and ephemeral
Blaze. The logical snapshot guard is 100,000 total rows and 64 MiB of serialized
rows; excess returns `BACKUP_LIMIT_EXCEEDED`. The snapshot is assembled in memory;
this is a bounded pilot harness, not a streaming large-database backup service.

Backups use AES-256-GCM with the operator encryption key, private 0600 atomic
files, fsync, a random backup ID, and an independently encrypted registry. Output
contains only ID/row/byte counts. Protect and retain the encryption key separately.
The registry must remain authoritative and newer than any restored database:
**never restore an old registry over it.** A missing, corrupted or wrong-key
registry fails closed. Lost registry/key recovery is an operator incident, not
a promised recovery procedure. Do not copy snapshots to unmanaged locations.

```sh
# Print a safe backup ID/count report; save the ID in private operator records.
OPENSIGHT_MAINTENANCE=frozen node --env-file="$OPENSIGHT_RUNTIME_ENV" packages/api/dist/single-node-cli.js backup

# Point the env file at a NEW, empty database/schema with restricted tenant role.
OPENSIGHT_MAINTENANCE=frozen node --env-file="$OPENSIGHT_RUNTIME_ENV" packages/api/dist/single-node-cli.js migrate
# Set OPENSIGHT_BACKUP_ID to the registered ID; retain the authoritative registry.
OPENSIGHT_MAINTENANCE=frozen node --env-file="$OPENSIGHT_RUNTIME_ENV" packages/api/dist/single-node-cli.js restore
```

Restore refuses a nonempty target, unregistered/tampered files, or snapshots
containing a subsequently deleted live tenant. It restores metadata, then holds
surviving tenants suspended, marks every membership removed, revokes all H2/H6
sessions, discards invitations, stops schedules and cancels pending occurrences
and deliveries. It conservatively exhausts API/compute admission for the restore
UTC day, preventing older counters from reopening consumed capacity. These held
states commit atomically with restore, not after startup. This trades recovery
convenience for fail-closed authority. It does not automatically revive users,
notifications or previously removed memberships.

Reconcile membership/policy/source changes since backup using operator records.
Rotate/rebind source secrets where needed. Set `OPENSIGHT_RESTORE_TENANT` and
`OPENSIGHT_RESTORE_USERS` to the explicitly reviewed tenant ID and JSON list of
active identity user IDs (including an administrator), then run:

```sh
OPENSIGHT_MAINTENANCE=frozen node --env-file="$OPENSIGHT_RUNTIME_ENV" packages/api/dist/single-node-cli.js restore-review
```

Unreviewed memberships stay removed. Operator resume via HTTP is denied with
`RESTORE_REVIEW_REQUIRED` until review completes. Review does not resume the
tenant or schedules; use the existing versioned operator resume and job APIs
after review. Re-enable only checked jobs and refresh Blaze under the new
admission state. Allow the next UTC period for API/compute admission. An old
namespace alone is never evidence of authority.

For the deletion drill:

1. Admit deletion through the existing operator `DELETE /api/host/tenants/:id`
   with expected version and idempotency key. It immediately enters `deleting`
   and denies tenant admission. Record the returned operation ID.
2. Drain/stop the reference and every external/legacy writer. Enumerate and purge
   any external snapshots, filesystem/volume backups or exports first. They are
   outside the managed registry. Do not assert their absence unless verified.
3. Set `OPENSIGHT_DELETE_OPERATION` to the operation ID and
   `OPENSIGHT_BACKUP_COPIES=none` to assert that no external retained copies
   remain. Run the offline finalizer:

```sh
OPENSIGHT_MAINTENANCE=frozen node --env-file="$OPENSIGHT_RUNTIME_ENV" packages/api/dist/single-node-cli.js delete-tenant
```

The finalizer first records a registry deletion fence, invalidates **all** managed
backup registrations, then unlinks all managed backup/temporary files and fsyncs
the directory. Purging whole snapshots also removes copies of other tenants;
take a new backup after completion. It removes the tenant's H2–H8 private state,
orphans' identity records, sources/payloads/metadata and labels, then completes
H1's `artifacts-removed` and deletion tombstone. Other tenants' live records
remain. Retrying after interruption is safe; failed purge never completes the
lifecycle. A copied old backup file is not registered and cannot be restored.

Opaque lifecycle/audit reservations remain by design. Shared identities and
operator keys remain for other tenants. Global hashed H2 throttle buckets follow
the existing 15-minute window and are swept on the next authentication attempt.
SQL row deletion and file
unlink are logical deletion, not physical-media erasure guarantees; PostgreSQL
pages/WAL, storage snapshots and operator copies require the operator's separate
storage purge procedure. No completion deadline is promised. The drill proves
logical deletion including the reference-managed backups, and explicit refusal
when external-copy state is unresolved.

To apply retention while stopped:

```sh
OPENSIGHT_MAINTENANCE=frozen node --env-file="$OPENSIGHT_RUNTIME_ENV" packages/api/dist/single-node-cli.js retain
```

Backup files themselves have no automatic time expiry; they persist until the
operator purges them, or the deletion drill purges all of them. H3 uploads become
unreadable at their explicit expiry and the existing minute sweep removes their
encrypted rows. H7 saved delivery messages are removed on send/cancellation;
remaining history follows metadata backup/deletion behavior. None is a retention
or availability commitment.

## Unsupported surfaces

H9 shared Parquet, H10 distributed refresh/replicas, H11 verified customer embed
domains and H12 supporting-service HA remain unsupported. Setting any of
`OPENSIGHT_SHARED_PARQUET`, `OPENSIGHT_DISTRIBUTED_REFRESH`,
`OPENSIGHT_CUSTOM_EMBED_DOMAINS`, `OPENSIGHT_SUPPORTING_SERVICE_HA` to anything
other than `false`, or `OPENSIGHT_REPLICAS` to anything other than `1`, fails
startup with `UNSUPPORTED`. `OPENSIGHT_OPTIONAL_SURFACES` accepts only false
values for `sharedParquet`, `distributedRefresh`, `customerEmbedDomains` and
`supportingServiceHA`; unknown/true fields return `UNSUPPORTED`.

Operator `PUT /api/host/reference/surfaces` applies the same unsupported-field
validation. Tenant `/api/embedding/domains` returns `UNSUPPORTED` in reference
mode after authentication/admission. Existing allowed parent origins and H6
canonical-origin sessions do not verify or provision customer domains. No HA
feature is hidden behind a successful no-op switch.

## Verification and measured limits

Run from the repo root against the repo's local PostgreSQL test setup:

```sh
npm run build --workspace @opensight/api
TZ=UTC DATABASE_URL=postgresql://postgres@localhost:5433/opensight \
  node --test --test-isolation=none packages/api/test/hosted-health.test.mjs packages/api/test/hosted-usage.test.mjs packages/api/test/single-node-*.test.mjs
TZ=UTC DATABASE_URL=postgresql://postgres@localhost:5433/opensight npm test
```

Tests create disposable schemas and login roles; the local test connection needs
CREATE SCHEMA/ROLE and cleanup privileges. The URI above is the synthetic local
test setup, not a deployment credential. Without `DATABASE_URL`, the live
PostgreSQL drill is explicitly skipped; SQLite drills still run. All files match
the API package's existing `test/*.test.mjs` root-suite wiring.

The H8 acceptance tests cover repeatable fresh initialization and H8 migration,
actual CLI start/readiness/SIGTERM, real-pool restart, restricted SQL role bypass
attempts, the lifetime lock, encrypted backup/held restore, replay/tamper refusal,
audit retention, tenant deletion including backups, concurrent quotas, named
API/storage/compute denials, forged contexts/headers, unsupported flags, and
scheduler drain with fake timers. Existing full-suite H1/H3/H7 tests cover the
legacy conversion migrations; this drill does not claim to migrate arbitrary
operator exports.

Measurements from the focused run on 2026-10-03, Node 24.20.0, local PostgreSQL
16.4, synthetic data (not a capacity, latency or recovery promise):

| Scenario | Observed result |
| --- | --- |
| PostgreSQL, two tenants, 64 concurrent API admissions, limit 8 each | 16 admitted, 48 named denials; 2,990 ms for the admission batch |
| PostgreSQL fresh/migrate/CLI/restart/restore/delete drill | 9,035 ms; 89 snapshot rows; 22,910 encrypted file bytes |
| SQLite, two tenants, 40 concurrent admissions, limit 5 each | 10 admitted, 30 named denials; 15 ms in the focused usage run |
| SQLite held restore drill | 19 snapshot rows; 4,146 encrypted bytes; 39 ms in the focused maintenance run |
| Storage ceiling of 500 logical bytes | Oversize encrypted source rejected; zero committed secret rows; smaller resource write committed with exact byte event |
| Compute ceiling of zero | Both queued refresh and report fail with `USAGE_LIMIT_EXCEEDED`; manual refresh denied before source I/O; zero executor calls |
| Reference backup guard | 100,000 rows / 64 MiB serialized rows; implementation guard, not a measured sustainable database size |

These small control-plane drills establish correctness for the tested scenarios;
they do not establish maximum tenants, throughput or production sizing. H4's
[containment measurements](h4-budgets-containment.md) remain the execution
memory/queue/source-pressure evidence. H8 supplies no new product tier or
performance commitment. The full-suite result is recorded in
[Issue #39 verification notes](issue-39-gap-notes.md).

Docker/Compose was unavailable in the build environment, so container image
build/start was not exercised. The native reference CLI and the real PostgreSQL
wiring were exercised. No AWS calls, image pulls, deployment, push, merge, issue
closure, static-demo rebuild or screenshot capture was performed.
