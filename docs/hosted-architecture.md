# Hosted multi-tenant architecture — draft

Status: proposal for review, not an implementation or deployment authorization.
The hosted and embeddable/white-label direction is accepted; the recommendations,
API additions, operating targets and rollout below still need design approval.
Single-node self-hosting remains the default product.

This draft reads [SOLUTION_DESIGN.md](../SOLUTION_DESIGN.md) as the contract,
especially D13, Phase 5, Phases 3b/3c and §§12–14. It does not amend that document.
Its older §2 hosted non-goal and D11/D12 deployment assumptions need reconciliation
with the later hosted direction when this draft is reviewed. Phase 5's business
trigger has been met by that direction; scale-out implementation is not thereby
scheduled. Statements labeled **Current** describe surveyed code. **Proposed** and
**Recommendation** describe future work. `HQ-*` references identify open questions
collected in §7; proposed error codes and environment variables are not shipped.

## 1. Goal & non-goals

Provide an optional hosted service in which independent tenants can author and
consume analyses, dashboards and prepared datasets, with authenticated embedding
inside another product. Preserve QuickSight-compatible asset semantics, namespace
principals, sharing, RLS/CLS and portable definitions while adding an operational
tenant boundary. Make branding configurable without presenting security or
unsupported functionality as cosmetic choices.

The hosted option must support a safe first deployment on one node and a measured
path to multiple instances. Scaling must preserve D13's execution modes, refresh
lifecycle, named errors and provenance through the `refresh(key, load)` / `read(key)`
boundary. No customer should receive another tenant's definitions, query results,
cached rows, credentials, report contents or job history. Resource limits must
bound interference; shared infrastructure does not promise physical isolation.

**Non-goals for this draft's first rollout:** billing vendor integration, pricing
or subscription tiers (usage/entitlement hooks only); multi-region operation;
distributed analytical execution; guaranteed service levels without measurements;
anonymous embedding, embedded authoring or cross-tenant sharing by implication;
an organization hierarchy or dedicated tenant deployments without a demonstrated
need. Those product choices remain explicit questions.

The work here is documentation only. It introduces no dependency, implementation,
infrastructure, credentials or external-service operation. A future reference
deployment starts with Docker Compose; Helm is a later packaging option. Neither
is a claim that a service has been deployed. The static demo continues to say
“Needs hosted API” for unavailable functionality and “visual fidelity not measured.”

Success for a future hosted build requires tenant isolation and bypass tests on
every data path, restart and recovery tests, measured fairness under concurrent
tenants, and embed authorization/browser tests. DuckDB, Postgres and fixture/shared
post-processing paths must agree on enabled semantics. Passing local regression
tests is not proof of QuickSight API, rendering or service-level parity.
