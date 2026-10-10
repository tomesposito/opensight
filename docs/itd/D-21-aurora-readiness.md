---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-10
labels: [itd]
---

## Purpose

Bound startup and retries while preserving auto-pause and H6 revocation.

## Scope

HTTP deadlines, startup abuse controls, mutation retries and idle browsers.

## Out of Scope

Latency promises, provisioned concurrency, RDS Proxy or a database heartbeat.

### 🚧 ITD D-21 — How should clients wait for Aurora without keeping it awake?

#### CONTEXT

HTTP API integrations have a 30-second ceiling. Aurora documents approximately
15-second typical resume and potentially 30 seconds or longer after a pause
exceeding 24 hours. H6 currently polls status every 20 seconds and has a
45-second local watchdog to meet HQ-7's 60-second revocation bound. Keeping that
polling while an idle embed remains visible conflicts with D-18's idle behavior.

#### THE PROBLEM

What bounded startup and browser lifecycle can preserve fail-closed authorization
without turning an idle page into a database keep-alive?

#### OPTIONS CONSIDERED

1. [WIP] Explicit startup with finite retries; expire protected display locally
   when no user activity refreshes its authority.
2. [WIP] Keep polling while content is displayed, accepting the resulting database
   awake cost as an active viewing session.
3. [WIP] Keep stale content visible without checking current authorization.

#### REASONING

Option 1 meets the no-idle-keep-alive constraint and preserves the revocation
bound, but changes passive embed viewing: content becomes hidden until the user
reconnects. Tom accepted that product behavior on 2026-10-10 in
[IDD D-26](../idd/D-26-idle-embed-reconnect.md). Option 2
preserves passive dashboards but needs an explicit change to the idle requirement
and estimate. Option 3 violates HQ-7 and is rejected; timer removal alone is not
a safe serverless adaptation. This technical record remains draft for the other
startup/abuse controls; the accepted idle-embed product choice does not approve
WAF costs, an IP allowlist or infrastructure creation.

#### IMPLICATIONS

**Deadline contract (all proposed limits are maxima, not latency claims):**

| Stage | Bound |
| --- | --- |
| End-to-end application deadline | `min(API request time + 25s, invocation remaining time - 3s)` |
| Stop starting business work | 3s before that deadline |
| HTTP Lambda configured timeout | 28s; HTTP API 30s; edge origin timeout at least API ceiling |
| Startup SQL connection attempt | One attempt, at most 18s and never beyond remaining work budget |
| Ordinary route connection attempt | At most 3s; return transient unavailable if not connected |
| Readiness statements | At most 2s total, bounded by work budget |
| Rollback/socket/worker cleanup | Reserved 3s, including a final force-destroy step |
| Browser startup session | 120s wall clock and at most 6 requests, whichever occurs first |

Use API Gateway's trusted request timestamp so authorizer/init overhead consumes
the same budget. Reject already-expired work before connecting. Cold platform
init may itself exceed the external deadline: no application code can guarantee
a response in that case. Clients treat that as unknown transport failure, not
permission to replay a mutation. Check remaining time before each awaited stage;
an unawaited timeout race is not cancellation.

Public `POST /api/api/startup` maps to `/api/startup`; empty JSON only (1 KiB cap),
no tenant/email/credentials. The same operation is available to an embed's
explicit Connect action. Apply D-20 trust checks first. Successful connection
performs read-only schema-version, maintenance-state and restricted-role/RLS
readiness checks and closes all connections. It does not run migrations, initialize
keys, recover jobs, enumerate tenants or return DB diagnostics.

| Response | Meaning and client action |
| --- | --- |
| 200 `{state:"ready"}` | Ready at this instant; explicit login/original user action may proceed |
| 503 `WORKSPACE_STARTING`, `Retry-After: 5` | Resume/connect timed out; startup alone may retry within its budget |
| 503 `WORKSPACE_UNAVAILABLE` | Unknown DB/config/TLS failure; stop automatic retries, expose safe retry action |
| 503 `WORKSPACE_MAINTENANCE` | Maintenance/schema mismatch; stop; no user-triggered DDL |
| 429 `WORKSPACE_START_RATE_LIMITED` | Respect Retry-After within the same overall budget |

Only recognized transient connection/resume failures map to STARTING. Preserve
safe error envelopes without exposing accounts or addresses. API Gateway/WAF
may produce a platform 429 without the application envelope; clients must handle
both. Ordinary APIs do not silently invoke an unbounded startup flow.

Start only on Connect/sign-in or a deliberate protected interaction. Use one
in-flight startup request per page; waits after responses use jittered 5, 10,
20, 30, 30-second ceilings, bounded by the remaining 120 seconds and Retry-After.
Abort when hidden, navigated away, cancelled or expired. Do not store/replay
passwords, enrollment, invitation acceptance, TOTP, bootstrap redemption, save,
delete or mail submission. After transport ambiguity, retrieve authorized
operation/idempotency status if that route supports it; otherwise ask the user
to inspect current state and perform a new action. GET/startup retries do not
imply general POST retry support.

**Abuse controls before any SQL:** propose one CloudFront WAF ACL with three
rules: (1) 30 startup/auth requests per viewer IP per 5 minutes, (2) 300 total
startup/auth requests per 5 minutes, (3) deny non-allowlisted peers in the private
tester profile. Apply the same controls to direct embed startup/redemption paths
that can initiate SQL. HTTP API startup throttle is 1 request/s, burst 2; the
remaining public API has a 5 request/s, burst 10 ceiling. Unknown/invalid requests
are rejected before DB construction. Once connected, retain H2's exact durable
auth limits from D-20; scrypt happens only after admission.

WAF rate limits and API throttles are approximate, not exact counters or spend
caps; distributed abuse can still keep Aurora awake. The peer allowlist narrows
the pilot audience and therefore needs Tom's approval. A public pilot needs a
new reviewed abuse/cost profile, not silently disabling that rule. Rule changes
cannot grant identity. Dedicated startup concurrency 2 contains connection
pressure, not durable work correctness. At example WAF rates the ACL + 3 rules
add **$8/month**, plus $0.60/million inspected requests and other services.

**Idle client and embed contract:** no periodic startup, session, health,
refresh-status or job-status polling when there is no outstanding user action.
A submitted operation may be polled only while visible for at most 120 seconds
with backoff (2–15s); after that show an explicit Check status control. No service
worker, visibility timer or keep-alive refreshes a database session while idle.

For embeds, retain a maximum 45-second authorization display lease from the last
successful current-authority check, capped by session expiry. Real interactions
may reauthorize; pointer motion/timers do not count. At lease expiry, cover/remove
protected data locally and offer Connect, without a request. Hide immediately
on visibility loss; on resume keep it hidden until an explicit Connect action and
successful current-authority check. Check elapsed wall time before painting or
handling input after frozen/background timers. Retain 15–600 minute session
lifetime, single-use bootstrap, memory-only credentials and HQ-7's 60-second
revocation ceiling. Never replay redeem after an ambiguous response. The idle UX
is confirmed by D-26 for the initial test deployment. Specify any new SDK state/
event and client acceptance tests before SR3 UI work; no further product approval
is required for the accepted hide-and-Connect behavior.

**Acceptance:** fake time for 15s, 35s and never-resolving connections; no SQL
socket left by abandoned connects; deadline exhaustion during init/query/cleanup;
retry count/jitter/Retry-After/hidden-page bounds; no MFA/write replay; idle open
author and embed have zero network requests after their action completes;
revocation during idle/freeze never redisplays expired authority. SR5 measures
short and >24-hour resume plus multi-day zero-ACU behavior without DB probes.

Evidence: [HTTP API quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html),
[Aurora pause/resume](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html),
[WAF pricing](https://aws.amazon.com/waf/pricing/).
