---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-13
confirmed: 2026-10-13
labels: [idd]
---

## Purpose

Decide what "headless-first" commits OpenSight to: who the API serves, what
builder-shaped means, which delivery shapes v1 ships, and the stability and
auth commitments behind them. Captures the vision from issue #95 so the
frozen API contract and the build slices have a decision to stand on.

## Scope

API surface areas for v1, delivery shapes, and principles (from #95).

## Out of Scope

Billing/metering on API usage (gated behind HQ-14 entitlement work),
multi-region, SLAs. The pilot API is single-tenant-scoped like everything
else (all per #95).

### 🚧 IDD D-37 — What should the headless-first API commit to?

#### CONTEXT

OpenSight should be the BI tool agents can actually *use* — not just a
dashboard humans click through. Every action the UI can do must have a
stable, documented API equivalent: create datasets, query datasets, build
analyses and dashboards, manage assets. If an agent can't do it headless,
it's not done.

This is explicitly **beyond QuickSight**: QS has APIs, but they're
admin-shaped (describe/list, import/export jobs), not builder-shaped. Nobody
is offering a full headless authoring API for BI. That's the gap.

Surface areas (v1), from #95:

- **Datasets**: create/update/delete, schema inspection, refresh, lineage.
- **Querying**: run ad-hoc queries against datasets (SQL and/or the visual
  query model), parameterized, with stable result shapes.
- **Analyses**: create, add/modify visuals, layouts, filters, calculated
  fields — the full authoring surface as API calls.
- **Dashboards**: publish, share, snapshot/export.
- **Assets/admin**: list, search, move, permissions, delete.

#### THE PROBLEM

Which delivery shapes v1 commits to, what "builder-shaped" concretely means
for each surface area, and which stability/auth commitments OpenSight makes —
so that the frozen API contract and the build slices follow from decisions,
not guesses.

#### OPTIONS CONSIDERED

1. **REST + OpenAPI as the foundation; MCP server as the second shape;
   SDK(s) and CLI generated from the spec.** REST gives versioned, typed
   schemas with every UI action mapped 1:1; MCP (`create_dataset`,
   `run_query`, `add_visual`, …) is the agent-native front door; typed
   clients (TypeScript first, Python second) and an `opensight` CLI fall out
   of the same spec. This is the baseline the issue proposes.
2. **REST + OpenAPI only for v1; MCP deferred.** Smaller surface, but the
   agent-native shape — the point of the vision — ships later.
3. **MCP-first, REST derived.** Agent tools lead; the REST surface is a
   mechanical projection. Novel, but it inverts the mature contract-testing
   story REST tooling already gives us.

#### REASONING (confirmed by product owner, 2026-10-13)

REST+OpenAPI is the foundation because a single versioned spec gives
SDK/CLI generation and contract tests one source of truth; MCP is the
second shape because coding agents call tools directly. UI consuming the
same API (no privileged internal paths — the web app is just another API
client) is what keeps the API honest; that principle is load-bearing.

Product-owner decisions (Tom, 2026-10-13, via #95):

1. **Delivery sequencing: confirmed.** REST+OpenAPI first, MCP server
   second, SDK/CLI generated from the spec (TypeScript first, Python
   second).
2. **Querying: no raw SQL through the API.** Agents run the SQL already
   defined in a dataset, with basic parameterized filters only. This
   closes the injection surface by construction: the API never accepts
   arbitrary SQL text.
3. **Scope: no fixed exclusion list.** The bar is maintaining the correct
   security level and end-user value — builder-shaped everywhere it is
   safe, admin-shaped QS behaviors stay out only where they would weaken
   either.
4. **Auth: user-level API credentials, scoped to user-tenant.** A
   credential belongs to a user and can only act within that user's
   tenant. This coordinates with the hosted identity model (operator-minted
   invitations today); service-principal provisioning follows the same
   invitation/minting path rather than inventing a parallel one.
5. **Rate limiting: yes, from the start.** Every API route is rate-limited
   to prevent abuse. This also lays the metering foundation for future
   usage-based monetization to cover service cost — and it composes with
   HQ-14 (usage events actively gate features/limits; Tom chose option B).

#### IMPLICATIONS

- Slicing: one slice per resource area (datasets, querying, analyses,
  dashboards, assets), each with contract tests; the MCP server as its own
  slice on top of the REST foundation.
- **UI consumes the same API.** No privileged internal paths.
- **Versioned and stable.** Agents build on this; breaking changes need a
  version bump and migration notes.
- **Machine-readable first.** Schemas, error codes, and pagination designed
  for programmatic use, not adapted from UI needs.
- **Auth: user-level API credentials scoped to user-tenant**, provisioned
  through the existing operator invitation/minting path.
- **Rate limiting on every API route** — abuse prevention now, metering
  foundation for future usage-based monetization (composes with HQ-14).
- A **frozen API contract** is required before any slice builds. Confirming
  this IDD removes the product gate; it does not claim any API is shipped.

#### OPEN QUESTIONS — resolved 2026-10-13

All four questions were answered by the product owner (see REASONING).
A **frozen API contract** is still required before any slice builds —
confirming this IDD removes the product gate; it does not claim any API
is shipped. The contract freeze is the next step; the loop may draft it
for review but must not invent endpoints.

Related: [#95](https://github.com/tomesposito/opensight/issues/95)
