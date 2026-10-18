# Issue #114: per-tenant AI spend caps

`HostedUsage` records `aiCalls` and `aiTokens` alongside existing usage in
`h8_usage` and `h8_usage_events`. Counters, denials and warning deduplication survive
new service instances and invocations. No new schema, dependency or provider SDK
is required. [D-82](itd/D-82-ai-spend-caps.md) records the engineering choices.

## Configuration and admission

Use the optional AI fields in [OPENSIGHT_ENTITLEMENTS](hosted-single-node.md#entitlements-events-and-audit):

```json
{
  "defaults": {
    "apiCalls": 1000,
    "storageBytes": 1048576,
    "computeAttempts": 100,
    "aiSpendCapCents": 500,
    "aiWarnPct": 80,
    "aiCostCentsPerMillionTokens": 200
  },
  "tenants": {
    "example-tenant": {
      "apiCalls": 1000,
      "storageBytes": 1048576,
      "computeAttempts": 100,
      "aiSpendCapCents": 100,
      "aiCostCentsPerMillionTokens": 200
    }
  }
}
```

Overrides replace the complete entitlement. Cap/rate must be nonnegative safe
integers; warning percentage must be an integer in 0–100. Invalid values fail
with `ENTITLEMENT_UNRESOLVED` (503). Absent cap is uncapped; absent warning is 80;
absent/zero rate disables spend checks and warnings but keeps metering. With a
positive rate, zero cap blocks immediately. These example rates are synthetic,
not provider prices. Operators choose the blended total-token rate.

Spend in cents is `aiTokens × aiCostCentsPerMillionTokens / 1_000_000`. Before
transport, recorded spend at/above the cap returns `AI_SPEND_CAP_EXCEEDED` (429).
The response message names the tenant, UTC day, recorded cents and cap, and tells
the caller to contact the operator to raise `aiSpendCapCents` or wait for the next
day. A denied `aiCalls` event commits even though no provider request occurs.
Unknown namespaces, missing entitlements and unavailable/corrupt counters fail
closed before transport, including uncapped tenants.

## Composition and accounting

The two current spend callers are `/api/admin/ai/test` and the generative O routes
(`/api/o/generate`, `/api/o/calculation`) in `createApiServer`. Supply its trusted
`hostedUsage` option to attach `HostedUsage.aiMeter()` to `AISettings.load`;
hosted accounting overrides any optional caller-provided meter. Resolution uses
the authenticated namespace and H1's immutable, unique tenant/namespace mapping.
Neither tenant IDs nor price settings come from request fields or headers.
Existing role, namespace and dataset checks still run before completion.

`createHostedApiServer` currently does **not** expose either AI route. It passes
the durable meter as the fourth argument of `invocation.compose` for explicitly
composed adapters. Existing hosted/serverless capability gates remain closed;
this issue does not introduce hosted AI configuration storage or dataset binding.
An AI-enabled adapter must pass the supplied meter to `AISettings.load`. Plain
self-hosted use without a meter retains its previous behavior.

OpenAI Responses and Anthropic use `usage.input_tokens + usage.output_tokens`;
compatible Chat Completions use `usage.prompt_tokens + usage.completion_tokens`.
Both fields and their sum must be nonnegative safe integers. Missing, incomplete
or malformed usage falls back to
`ceil((system.length + prompt.length + response.length) / 4)` using JavaScript
string lengths. Reported zero is valid. The token event unit is `token` for
reported usage and `estimated-token` for the fallback; both contribute to
`aiTokens`. The call event unit is `call`. No prompts, answers or provider keys
are persisted. Provider-key redaction of returned answers remains intact.

Successful provider completions are recorded before O grammar validation or its
post-I/O authorization checks. Those later failures still consume usage. Provider
transport/invalid-response failures without usable completion text are unmetered.
Post-call accounting failures withhold the answer. The UTC day is the completion
day; a call crossing midnight is recorded in the new day. Rate changes reprice
recorded tokens on restart (serverless uses its existing stored entitlement
snapshot configuration lifecycle).

Transactions lock the tenant row for counter updates and warning deduplication;
they do not hold locks during provider I/O or reserve maximum output tokens.
An admitted call and concurrent in-flight calls can overshoot the cap. A process
crash between provider completion and the accounting commit can lose that charge.
This is the brief's recorded-spend circuit breaker, not a hard invoice ceiling.

## Alerts and observability

At or above the warning threshold, `ai.spend.warning` is appended to the existing
operator audit in the same transaction as the counters. Durable tenant/day
deduplication gives one alert per UTC day across instances and restarts. Zero
percent alerts on the first successful completion; 100 percent alerts at the
cap. A single call may cross both warning and cap. Audit detail contains period,
spend, cap, warning percentage and whether the triggering call used an estimate.
No email or external billing integration is added. Operators inspect the existing
`/api/host/audit` path; retention follows existing audit retention.

`HostedUsage.metrics()` emits `opensight_ai_calls`, `opensight_ai_tokens` and
`opensight_ai_spend_cents` gauges with tenant, namespace and UTC-period labels.
The common `opensight_usage_admitted`/`opensight_usage_denied` series also expose
the AI metrics and denials. Metrics retain the existing operator access boundary.

Tests live in `packages/api/test/ai-spend-{caps,routes}.test.mjs` and are included
by the root `npm test` workspace glob. They use fake transports and local metadata
databases; no paid provider or AWS calls run.
