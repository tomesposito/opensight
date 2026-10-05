---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-05
labels: [itd]
---

## Purpose

Reconcile the three individually-decided hosting design decisions (D11,
D12, D13) into one coherent hosted analytical executor before the
shared Parquet artifact adapter (H9) is specified.

## Scope

What executes analytical queries in the hosted product, and how long
those processes live. The cached execution backend and API/worker
deployment lifetimes.

## Out of Scope

Pricing, billing-driven suspension, and payment providers (out of scope
per HQ-14 B). Availability/recovery commitments (decided in HQ-10 B:
best-effort, no SLA/RPO/RTO). Custom embed domains (HQ-9, separate
decision).

### ✅ ITD HQ-11 — How should D11 serverless hosting, D12 production Postgres/local-only DuckDB and D13 local Parquet readers be reconciled?

#### CONTEXT

D11 (decided 2026-09-26) set AWS serverless-first as the deployment
target: short-lived Lambda containers, with no infrastructure code
until a later phase. D12 (decided 2026-09-26) set Postgres as the
production data plane (RDS free tier, then Aurora Serverless v2),
rejected DynamoDB for the analytical path, and kept DuckDB as the
local dev/test engine. D13 (decided 2026-09-29) set the multi-node
Blaze architecture: Parquet artifacts on shared object storage with
per-node local memory, Redis only for refresh coordination — and
already names DuckDB as a per-node artifact reader. H8 (shipped
2026-10-03, #39) delivered a single-node Compose reference that is
explicitly a reference harness, not a reversal of the cloud decision.
No measured multi-node load exists; the §5 scale-out trigger has not
fired.

#### THE PROBLEM

How should D11 serverless hosting, D12 production Postgres/local-only DuckDB and D13 local Parquet readers be reconciled?

#### OPTIONS CONSIDERED

1. ✅ **Serverless-first stands: short-lived API containers; DuckDB in-process is the analytical executor, reading shared Parquet artifacts on cache miss; Postgres remains the metadata plane; cold-start and artifact-loading behavior is measured before deployment lifetimes are locked in.**
2. Long-lived workers: the hosted executor runs in always-on containers with a warm in-process Blaze cache; Parquet artifacts remain the shared source of truth for multi-node; the always-on cost is accepted.
3. Defer: make no executor decision now; the H8 Compose reference remains the only deployment story until the §5 scale-out trigger fires on measured load.

#### REASONING

Option 3 is the honest default if there is no near-term multi-node
need: it avoids inventing an architecture without evidence, and the
§5 trigger exists precisely to force the decision when load demands
it. It is rejected as the standing answer only because H9's
specification needs a declared executor direction, and deferring
leaves H9 parked indefinitely.

Option 2 is disqualified for now because nothing has demonstrated
that warm-cache hit rates justify always-on cost: there is no
production workload, no measured p95/p99 latency, and no evidence
that cold starts are a binding constraint. Accepting the cost without
that evidence would be a commitment without a reason.

Option 1 is selected because it keeps all three prior decisions intact
— D11's serverless target, D12's Postgres metadata plane, D13's
Parquet-artifact sharing — and resolves the apparent D12/D13 tension
by scoping "local-only" to mean DuckDB is not the production
*metadata* store, while it is the per-node *analytical* reader D13
already names. The evidence for it is continuity: no prior decision is
overturned, and H9 gets the declared executor direction its
specification needs. The trade-off knowingly accepted: cache behavior
on cold starts is unproven, so deployment lifetimes stay provisional
until loading/mapping measurements exist — the measurements in §5
(query/refresh p95/p99, artifact load time, memory working set) are
now required work before lifetimes are locked, not an open decision
element.

#### IMPLICATIONS

- Deciding HQ-11 unblocks the HQ-11 gate on H9 (H9 still additionally
  requires the §5 scale-out trigger and HQ-15 dependency review before
  any build).
- If Option 1 is confirmed: H9 specifies the Parquet artifact
  adapter against the D13 seam, tested with one serving node first;
  cold-start and artifact-load measurements become required work
  before any lifetime commitment.
- If Option 2 is confirmed: the cost model changes and the H8
  Compose reference remains valid only as the local/self-host story.
- If Option 3 is confirmed: H9 stays parked; no executor work
  proceeds until the §5 trigger fires.
- Related decisions: D11, D12, D13 (reconciled here); HQ-8
  (workload ceilings and triggers — the measurements this decision
  depends on); HQ-10 B (no HA claims — constrains any
  availability-adjacent promise); HQ-15 (any newly bundled
  executor/coordination package needs license review).
