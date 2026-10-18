---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-18
labels: [itd]
---

## Purpose

Choose the accounting boundary for issue #114's per-tenant AI circuit breaker.

## Scope

Daily durable AI usage, operator pricing, cap admission and warning audit events.

## Out of Scope

Billing/payment integration, model-specific price catalogs, email alerts, new
hosted AI endpoints and hard reservations for future provider spend.

### ✅ ITD D-82 — Where should AI spend admission and accounting live?

#### CONTEXT

HQ-14 B already requires usage to gate features or limits. `HostedUsage` owns
durable daily counters, events and tenant transaction serialization. The admin
connection test and generative O routes share `AISettings.complete`, but currently
live in `createApiServer`; `createHostedApiServer` does not expose either route.
H1 enforces one namespace per tenant and immutable namespace ownership. The
resume brief authorizes engineering defaults without a new product decision.

#### THE PROBLEM

How should both completion callers share a durable tenant cap without changing
self-hosted behavior or enabling unsupported hosted capabilities?

#### OPTIONS CONSIDERED

1. Track usage in each provider adapter or API process.
2. ✅ **Meter the completion boundary through the existing HostedUsage database.**
3. Add provider-specific billing and reserve maximum spend before every call.

#### REASONING

Option 1 duplicates admission rules and process-local state disappears between
invocations. Option 2 covers both callers once and keeps counters, denial events
and warnings in the existing SQL transaction model. A trusted `hostedUsage` option
wires the existing API to the H1 namespace mapping; hosted invocation composition
receives the same meter for any explicitly supplied AI adapter. Unknown namespace
or unavailable accounting fails closed. No meter preserves plain self-hosted use.
The hosted server's current unsupported AI routes remain unavailable.

Option 3 would require pricing and reservation policy outside the brief. Instead,
use an operator-supplied cents-per-million total-token rate. Prefer valid reported
input plus output usage; otherwise estimate `ceil((system.length + prompt.length
+ answer.length) / 4)` using JavaScript string lengths. Mark estimated token events
explicitly. This is operational spend tracking, not a provider invoice.

#### IMPLICATIONS

- `aiCalls` counts successful provider completions and `aiTokens` records their
  total tokens in `h8_usage`/`h8_usage_events`, including completions subsequently
  rejected by O grammar or authorization checks. No prompt, answer or key is stored.
- Optional cap and rate are nonnegative safe integers. Warning percentage is an
  integer from 0 to 100, default 80. Absent cap means no cap; zero/absent rate
  disables spend admission and warnings while retaining usage counts.
- With a positive rate, recorded spend at or above the cap denies before transport
  with `AI_SPEND_CAP_EXCEEDED` (429), tenant/day/cap/spend and operator guidance.
  Zero cap denies immediately. Daily periods reset at UTC midnight; completions
  belong to the day they finish. Operator configuration changes reprice that day's
  recorded tokens and take effect on restart.
- Transactions serialize counter updates and warning deduplication per tenant.
  They do not hold database locks during provider I/O. An admitted completion or
  concurrent in-flight calls may cross the cap; subsequent checks deny. A crash
  after provider I/O and before recording can lose that charge. Provider transport
  failures with no usable completion are not metered. These are explicit limits
  of the requested pre-check/post-record design, not hard billing guarantees.
- Append one `ai.spend.warning` operator-audit alert per tenant/day at or above the
  threshold, in the counter transaction. Zero percent warns on the first recorded
  completion. Deduplicate from durable audit history across instances and restarts;
  a lowered threshold can alert on the next completion. No email is sent.
- Keep strict response/key redaction, existing authorization and hosted capability
  gates. Add no dependencies, AWS calls, schema migrations or new hosted AI surface.
  Test both existing HTTP spend sites, durable restart, isolation and failure paths.
