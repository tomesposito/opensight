# Phase 5 SR4a — frozen validation-package contract

Issue #83; implementation authorized by the operator on 2026-10-10. This slice
packages SR1 and a separate IAM-only platform probe. It does not implement SR2,
SR3, public ingress, or open the application's maintenance/storage gates.
The [resource/cost plan](phase5-aws-validation-plan.md) remains the execution
review boundary. Tool and dependency pins follow [D-27](itd/D-27-serverless-build-tooling.md).

## Image and configuration

Use the pinned ARM64 Node 24 Lambda base from D-27. A multi-stage Dockerfile has
dependency acquisition, offline build/test and runtime stages. Install from the
root lockfile, compile the existing workspaces and preserve the native DuckDB
package for the target architecture. Runtime contains compiled application,
embed assets, required workspace package manifests and production dependencies;
exclude tests, fixtures, private files, Git, node caches, infrastructure plans
and build credentials. Pin the produced digest; test read-only root and bounded
`/tmp`. Separate manifests describe the runtime image and hosted frontend.

Add Lambda entrypoint wrappers that load referenced secrets into invocation-local
typed configuration, never into shared `process.env`, logs or responses. Read
current secret versions each invocation; no warm cache revives retired values.
Requests still pass SR1 ingress validation and lifecycle cleanup. Migration
still requires its private operator authorization and frozen maintenance state.
The original SR1 entrypoints remain available for injected/local tests.

Configuration references come exclusively from environment variables:

- `OPENSIGHT_DEPLOYMENT`, `AWS_REGION`, `OPENSIGHT_PUBLIC_ORIGIN` and SR1 ingress/
  auth/budget settings retain their existing meanings.
- `OPENSIGHT_DB_HOST`, `OPENSIGHT_DB_PORT`, `OPENSIGHT_DB_NAME` and a verified RDS
  CA bundle identify the private database. No query-string TLS override is allowed.
- `OPENSIGHT_OPERATOR_SECRET_ARN` supplies operator login and application key
  material; `OPENSIGHT_TENANT_SECRET_ARN` supplies restricted tenant login.
  `OPENSIGHT_BOOTSTRAP_SECRET_ARN` is accessible only to private bootstrap/
  migration, never to the request role. Credentials never enter Terraform state.
- `OPENSIGHT_ARTIFACT_BUCKET`, `OPENSIGHT_PROBE_QUEUE_URL`,
  `OPENSIGHT_PROBE_SCHEDULE_GROUP`, `OPENSIGHT_PROBE_SCHEDULE_ROLE_ARN`,
  `OPENSIGHT_SMTP_SECRET_ARN` and approved SMTP sender/recipient identify probe
  resources; these are not request-controlled destinations.

Use bounded per-invocation AWS clients: explicit region/endpoints, no implicit
IPv4/public fallback, short connection/request timeouts, at most one SDK attempt
for the probe, abort signals and destroyed agents/clients before return. Secrets,
SQS and Scheduler use D-19 IPv6 endpoints with TLS verification; S3 uses regional
IPv4 gateway routing. Secret payloads have a 64 KiB cap and strict known fields.
AWS errors return named safe errors without raw requests, responses or tokens.

## Private platform probe

Enable only with `OPENSIGHT_VALIDATION=isolated`; refuse ordinary deployment
configuration. Accept a strict version-1 command envelope, never arbitrary SQL,
URLs, bucket keys or recipients. All commands run inside `InvocationScope`, with
bounded work and cleanup; output consists of sanitized checks and measurements.

| Command | Behavior |
| --- | --- |
| `network` | IPv6 DNS/socket/TLS checks for exact configured AWS service hosts; Secrets read, bounded S3 synthetic put/get/delete, SQS send/receive/delete, Scheduler create/delete one-shot test; no SQL |
| `mail` | Explicitly invoked synthetic SMTP delivery to the configured approved recipient, with IPv6/TLS and bounded cancellation; no automatic test mail during other commands |
| `bootstrap` | Private bootstrap credential creates/validates only the named operator and restricted tenant roles, then invokes existing migration under frozen maintenance; grants required schema/table permissions; never opens admission |
| `database` | Verify private TLS, restricted non-owner/NOBYPASSRLS role and transaction scoping using isolated synthetic rows/rollback; report connection/resume duration; fail on policy bypass; do not open admission |
| `native` | Execute a small synthetic DuckDB task through the existing contained worker; verify child teardown and invocation temporary-file cleanup |
| `startup` | Exercise SR1 with a synthetic trusted event on this IAM-only path; expect maintenance or an explicit startup transient, never claim the incomplete application is ready |

Bootstrap is idempotent only for the exact deployment roles and maintenance
schema. Refuse foreign/unsafe existing role configuration. Password values are
bound/escaped safely and never logged; no untrusted SQL identifiers are accepted.
Migration keeps its advisory transaction lock and existing safety checks. The
probe does not weaken RLS to make a test pass or mutate `sr_control` to open.

No event-source mapping or recurring schedule is attached to the validation
functions. The transport test uses only a synthetic queue/group, so it cannot
acknowledge application jobs as executed. HTTP-facing probe routes and function
URLs are forbidden. A failed required check fails the probe; missing credentials
are not a successful skip. Mail remains separately callable to avoid unsolicited
deliveries.

## Infrastructure and operator harness

Implement generic OpenTofu roots for protected bootstrap state and the isolated
validation inventory, with exact provider lockfiles. Account/region/AZs/names/
identity addresses and references are environment inputs. Runtime resources
include the planned dual-stack VPC/S3 gateway, private 0–2 ACU Aurora writer,
three IAM-only functions, secret containers, ECR, versioned synthetic bucket,
test queues/group, scoped roles and bounded logs. No NAT/interface endpoints,
public IP database, provisioned concurrency, reader or public ingress resource.

Use RDS-managed master credentials; secret resources contain no secret payloads.
Populate application/SMTP secret versions through an explicit private operator
step outside Terraform. Request-role policies cannot read the bootstrap secret;
each execution role and Scheduler target role has its own scoped policy. Protect
data/state/KMS resources from routine destruction and test the intended cleanup
procedure separately. Budget notifications use operator-supplied addresses.

Bootstrap creates the encrypted/versioned state bucket and key through an
explicit idempotent operator action, then imports them into the protected remote
root; no bootstrap state or saved plan is committed or silently left local.
Backend configuration and plan bytes are private mode-0600 files outside Git.
Use S3 native locking and TLS; no `-lock=false` or fallback local state.

The CLI harness has separate prepare/plan/invoke/observe/cleanup operations.
It does not assume that a budget alert stops spend. Keep a durable private ledger
of at most 1,000 function invocations and a 72-hour experiment window. Observe
Aurora through service metrics only; no periodic SQL pings. Cleanup requires an
explicit synthetic-resource selection, preserves state/evidence by default and
prints a sanitized retained-resource/cost summary. Never touch pre-existing
resources without verifying ownership.

## Acceptance

- Root `npm test` in Linux/Node 24, exact counts, only documented unavailable
  live-Postgres integration skips; rebuild demo and compare reference captures.
- Exact runtime image: native worker success/failure/cancellation, read-only
  root and `/tmp` constraints, required modules/assets and no development secrets.
- Unit/fault tests for secret schema, host/region mismatch, IPv6 client settings,
  cancellation, resource disposal, probe command validation and safe errors.
- Mocked-provider IaC plan tests prove caps, isolation, allowed resource types,
  absence of paid network fallbacks, least-privilege secret access, private DB,
  no public invocation and destruction protections. Format and validate offline.
- Harness tests reject unsafe plan paths, expired/excess invocation budgets,
  unowned cleanup targets and output containing secrets. Include dependency and
  staged-secret/path checks in verification evidence.
- Real AWS socket routing, Aurora RLS/resume and Lambda cleanup remain measured
  cloud acceptance. Local image/mocked-provider tests do not establish them.
