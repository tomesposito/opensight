---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-13
labels: [idd]
---

## Purpose

Resolve the product choices required to make headless asset management
an implementable v1 contract under D-37 and the frozen contract.

## Scope

Asset list/search, move/copy, share grants, folder verbs, and delete
semantics for the v1 API. How the assets slice relates to D-39
(analysis authoring) and D-40 (dashboard publishing) where the
contracts touch.

## Out of Scope

Analysis authoring verbs (D-39), dashboard publish semantics (D-38,
D-40), prepared-dataset sharing (HQ-4), namespaces/users/groups/
invitations/embedding/AI-admin versioning (a later identity/admin
slice), MCP tool mapping (mechanical 1:1 per freeze Q7), new SQL
execution capabilities, deployment and publishing this branch.

### 🚧 IDD D-41 — What asset-management contract should headless v1 expose?

#### CONTEXT

D-37 ✅ settled the shape: builder-shaped REST+OpenAPI first, MCP
second, SDK/CLI generated; no raw SQL through the API; user-level
tenant-scoped credentials via the operator invitation path; rate
limiting on every route. The frozen contract settled the conventions
(`/api/v1/...`, secure refresh tokens, `limit`/`cursor`/`nextCursor`
pagination, composed dataset describe, MCP as a mechanical mapping).
The datasets and querying slices are implemented. Analyses (D-39) and
dashboards (D-40) are proposals awaiting answers.

What exists today: `GET /api/assets` (unified list, `{ kind, id, name }`,
no pagination/search/folder/timestamps/owner) in
`packages/api/src/index.ts`; admin-only move/copy for analyses and
dashboards (`POST /api/assets/(analysis|dashboard)/{id}/(move|copy)`,
copy clones grants); admin-only folder CRUD, folder permissions, and
folder asset listings (`/api/folders`); entirely admin-only share grants
for analyses/dashboards (`/analyses|dashboards/{id}/shares...`,
definition-only, roles `viewer | co-owner`); no delete endpoint for
analyses or dashboards; a client-side-only global search in the web app
(local drafts, analyses only). Read access is governed by
`canRead`/`grantsAllow` (`organization.ts`): analyses need the `build`
capability, folder grants and asset grants must both allow, undefined
grants mean inherited access, administrators pass through. HQ-4
(owner-only prepared datasets for the pilot) is decided; HQ-17
(new-asset default visibility) is undecided — Phase 3c semantics are
preserved until an explicit decision.

#### THE PROBLEM

Which list/search, move/copy, permission, folder, and delete semantics
should agents receive as stable v1 behavior, without weakening the
tenant boundary, without leaking the names of assets the caller cannot
read, and without inventing a permission or delete model the product
owner has not approved?

#### OPTIONS CONSIDERED

1. **Proposal-first, then implement (recommended).** This slice
   publishes a verb table and seven questions (Q1–Q7 in
   `docs/headless-v1-assets.md`) and waits for answers before any
   implementation — the same path D-39 and D-40 took. Cost: one more
   review round before agents can organize assets. Benefit: the
   permission and delete models, the two places where a wrong default
   leaks access or destroys work, get an explicit product call.
2. **Implement directly from the local routes.** Version the existing
   move/copy, folder, and share routes as-is, preserving admin-only
   writes, clone-grants copy, and the missing analysis/dashboard delete.
   Cost: agents still cannot organize assets (admin-only move/copy),
   copy silently re-grants the source's viewers, and there is still no
   delete — the three most agent-relevant behaviors stay broken.
   Benefit: no review round.
3. **Defer assets until D-39/D-40 are answered.** The assets contract
   touches both (who-can-grant mirrors D-39 Q2 / D-40 Q1; delete
   cascades restate D-40 Q5). Cost: search — the verb agents need most
   to find hosted assets at all — waits on two unrelated review gates,
   and the assets questions themselves still need a round after that.
   Benefit: one combined review instead of three.

#### REASONING

Option 1. The assets slice is where the API either keeps its security
promises or breaks them: search must not leak unreadable names, copy
must not silently re-grant viewers, delete must not destroy published
work. Those are product calls, not implementation details, and the
D-39/D-40 precedent shows the review round is cheap — Tom answers
batched questions in one pass. Option 2 ships an API that agents
cannot use for the job (admin-only organizing) while quietly keeping
the clone-grants leak. Option 3 stalls the highest-leverage verb
(search) behind gates it does not depend on: the assets questions are
answerable now, and the D-39/D-40 touchpoints are restated, not
re-decided, so no combined review is needed.

The proposal itself takes positions where the existing code already
supplies the rule (preserve `canRead`/`grantsAllow` exactly; keep the
both-must-allow folder+asset rule; keep shares definition-only per
HQ-4; keep the must-be-empty folder-delete 409; fail-closed dataset
delete mirroring the source-delete pin) and asks where it does not
(who can move/copy/grant/delete; copy grant handling; search shape and
transport; what versions under v1; idempotency/concurrency). Where a
question belongs to another slice — asset rename to D-39, published
dashboard preservation to D-40 Q5 — the proposal says so instead of
answering it twice.

#### IMPLICATIONS

- Approval must answer Q1–Q7 in the slice proposal. The loop then
  records the approved contract and implements the routes, shared
  validation, persistence, and contract tests.
- The admin surface (namespaces/users/groups/invitations, embedding,
  AI admin) stays unversioned until a dedicated identity/admin slice;
  nothing in this slice widens it.
- The MCP mapping stays a mechanical 1:1 from the approved REST
  operations (freeze Q7) and is a later slice on top of the REST
  foundation.
- No implementation, no OpenAPI changes, and no UI changes ship from
  this slice. Issue #95 stays open.
