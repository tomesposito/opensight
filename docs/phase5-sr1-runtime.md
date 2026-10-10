# Phase 5 SR1 — invocation runtime (issue #82)

SR1 implements local runtime composition from `aws-serverless-plan.md` §8 and
D-19/D-20/D-21/D-23. It creates no AWS resources and uses no AWS SDK. There are no
new dependencies. The existing `pg` driver (MIT) and native DuckDB worker remain
the SQL implementations. `SOLUTION_DESIGN.md` is unchanged.

## Entrypoints

| Entrypoint | Behavior |
| --- | --- |
| `dist/runtime-cli.js` / `npm run start:runtime --workspace @opensight/api` | Plain HTTP local hosted adapter; `OPENSIGHT_RUNTIME=http` (default). Canonical Host is supplied directly, without trusted forwarding headers. |
| `dist/lambda.js` → `handler` | HTTP API v2 adapter; requires `OPENSIGHT_RUNTIME=lambda` and `OPENSIGHT_MODE=hosted`. |
| `dist/lambda.js` → `authorizer` | Database-free origin authorizer; reads current ingress configuration on each call. |
| `dist/scheduler-lambda.js` → `handler` | Private single-record SQS invocation with partial-batch failure reporting; no poller or interval scheduler. |
| `dist/migration-lambda.js` → `handler` | Private operator-authenticated bootstrap migration, with bounded invocation cleanup. |

The HTTP and Lambda adapters compose the existing hosted handler. Lambda does
not listen on a port or issue an HTTP request to itself. The in-memory Node HTTP
bridge preserves hosted authentication, trusted peer buckets, response status,
headers, binary bytes, and embed CSP/nonces. Responses always use `no-store`.
The existing fixture and H8 launchers remain available through their original
commands. Invocation mode rejects H8 configuration.

`createRuntime` and `createPrivateRuntime` expose typed dependency seams for local
tests and subsequent slices. Only configuration/factories may be reused between
invocations. Importing handlers does not open SQL, start jobs, or bind listeners.

## Configuration and ingress

Configuration comes from the supplied environment on every invocation:

- Existing `OPENSIGHT_PUBLIC_ORIGIN` and hosted authentication/embedding settings.
- `OPENSIGHT_DEPLOYMENT`: opaque deployment identifier.
- `OPENSIGHT_POSTGRES_OPERATOR_URL`, `OPENSIGHT_POSTGRES_TENANT_URL`: distinct
  credentials on the same database/host. Query-string driver overrides are
  refused. `OPENSIGHT_POSTGRES_CA` supplies the trust bundle; TLS certificate
  verification is mandatory. No public/unencrypted fallback exists.
- `OPENSIGHT_INGRESS_DOMAIN`, `OPENSIGHT_INGRESS_API_ID`,
  `OPENSIGHT_INGRESS_STAGE`: expected HTTP API custom origin, API and stage.
  `OPENSIGHT_INGRESS_ROUTE` is `$default`. Origin and public host must differ.
- `OPENSIGHT_INGRESS_KEYS`: JSON array of one or two `{id,secret}` entries for
  active/overlap versions. Secrets are 43–128 base64url characters. These are
  deployment-injected values, never repository or browser configuration.
- `OPENSIGHT_WORK_QUEUE_ARN`: exact permitted scheduler event source.

CloudFront must overwrite `X-OpenSight-Ingress-Key-Id`,
`X-OpenSight-Ingress-Secret`, and `X-OpenSight-Ingress-Origin`, and generate
`CloudFront-Viewer-Address`. The adapter requires matching API/stage/domain/route,
authorizer context `{version:"1",canonicalOrigin}`, the current secret, and a
valid IP:port viewer address. It normalizes IPv6 and IPv4-mapped IPv6. Forwarded
transport fields are discarded after trust checks; none confer identity.

Authoring strips exactly one `/api` from `/api/api/<route>`. Embed API and shell
paths remain literal. Operator, migration, drain and probe routes are not public.
Unknown routes, unsupported methods, encoded paths, dot segments, duplicate or
comma-joined singleton headers, framing conflicts, forged principals, bad Origin,
invalid base64 and oversized payloads fail before SQL construction. Origin is
preserved unchanged and, when present, must exactly match the configured origin.
Inline decoded request/response limits are 4 MiB, below the Lambda envelope cap;
larger transfers require SR2's object protocol.

`validateViewerRequest` is a pure local contract using a normalized HTTPS viewer
request and CloudFront multi-value header objects. SR4 must package the actual
viewer policy, HTTPS enforcement, header forwarding, authorizer TTL zero, disabled
execute-api endpoint, cache/error TTL zero, resource policies and WAF/throttles.
Local fixtures do not prove deployed header provenance or pre-SQL abuse controls.

## SQL, deadlines and cleanup

Each invocation owns separate control and restricted tenant pools, each `max:1`.
Clients are discarded after each short transaction, rather than retained across
compute or network waits. Startup makes one connection attempt per role, in
parallel, and immediately uses those connections for readiness. There is no
retry loop, idle SQL pool, TCP keep-alive or database heartbeat.

The deadline is `min(trusted request timestamp + 25s, remaining Lambda time - 3s)`.
Business work stops three seconds before that deadline. Startup connect attempts
are at most 18s; ordinary connects are at most 3s. Readiness statements have a 2s
total budget after connecting. Statements are limited to 2s, locks to 500ms,
idle transactions to 3s, and idle sessions to 5s. Private invocations have an
additional 110s maximum application budget, bounded by platform remaining time.

`POST /api/api/startup` accepts only an empty JSON object, without authentication
credentials, at most 1 KiB. It checks schema/protocol compatibility, maintenance,
restricted-role safety and RLS without DDL, key activation, tenant enumeration or
job recovery. It returns `ready`, `WORKSPACE_STARTING` (`Retry-After: 5`),
`WORKSPACE_UNAVAILABLE`, or `WORKSPACE_MAINTENANCE`. Only recognized transient
connection failures produce STARTING. Diagnostics are never returned.

Every invocation scope tracks SQL sockets from construction (including pending
connects), late promises, workers, timers and private temporary files. Cancellation
destroys sockets and aborts workers. Teardown waits for client release, pool end,
worker close, late disposal and removal of temporary bytes before returning.
Interrupted temporary directories are cleared at entry without deleting live
local scopes. Cleanup has a three-second maximum, with a force phase halfway
through the remaining budget. Failed/unprovable cleanup returns
`INVOCATION_CLEANUP_FAILED` and quarantines the process; subsequent invocations
return `RUNTIME_QUARANTINED`. It is never treated as a healthy warm runtime.
Platform hard kill cannot execute `finally`; server timeouts and SR2 durable
claims/quarantine remain necessary.

## Private work and phase boundaries

The migration event is `{command:"migrate",authorization:"Operator <value>"}`;
the value is checked against the existing environment operator key. IAM-only
invocation is an additional deployment requirement. `OPENSIGHT_MAINTENANCE=frozen`
is required. Bootstrap creates/locks the D-23 `sr_control` deployment row,
initializes the existing schemas/budgets and appends an operator audit event in
one transaction. It preserves epoch and leaves the state `maintenance`; it never
activates keys or opens admission. A transaction advisory lock excludes a live
H8 node and concurrent migrations. Existing `sr_admission` requires the later
durable drain/migration coordinator and is refused by this bootstrap entrypoint.

Scheduler envelopes contain exactly one record from the configured queue, with
at most 4 KiB of body: `{version:1,deploymentEpoch,eventId,kind}`, where kind is
`due`, `execute`, `recover`, or `deliver`. The event reference is not authorization.
The SR3 executor must load current SQL authority and claim/fence the event. There
is no fallback to H7 `JobRunner.tick()`. The default handler returns the message
as failed until that executor is supplied; local tests cover successful execution,
rejection, exceptions and cleanup through the typed seam.

SR1 is not a deployable tenant compute service. Data, job and embed routes return
`SERVERLESS_STORAGE_REQUIRED` in invocation mode until SR2/SR3 implement their
durable safety contracts. Authentication/session and basic metadata routes use
the existing hosted boundary after readiness. The startup control row is never
opened by SR1. This prevents a configuration flag or reserved concurrency from
silently replacing H8's safety lock with unsafe per-process budgets/Blaze.

No browser UX changed. In particular, this slice does not claim the later
Connect/retry/display-lease UI, deployed WAF limits, real Aurora resume, native
container-image compatibility, or multi-day zero-ACU behavior. Those require the
specified subsequent slices and authorized SR5 validation. The static demo is
an offline rendering preview.

## Local verification

`packages/api/test/runtime-*.test.mjs` is picked up by the existing API test glob
and root `npm test`. It covers both transports, private entrypoints, ingress and
method bypasses, retired keys, response CSP/nonce preservation, fake-time startup,
transaction faults, late connection settlement, real stalled pg TCP connections,
maintenance migrations, temporary files, process quarantine and real Linux native
DuckDB worker/watchdog teardown. The complete suite and visual comparison results
are recorded in `issue-82-gap-notes.md`.
