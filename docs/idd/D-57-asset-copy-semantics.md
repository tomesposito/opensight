---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Resolve who can copy assets and how grants and published definitions
carry over.

## Scope

The copy verb, who can copy, grant handling, copy-of-published vs
copy-of-draft, `newId`/`name` rules.

## Out of Scope

Move (D-56), delete (D-59). Published-dashboard lifecycle ownership
(D-40 Q5) — restated here, not re-decided.

### 🚧 IDD D-57 — What copy semantics should assets have?

#### CONTEXT

D-41 ✅ approved proposal-first; this is its Q3. Copy exists locally
at `POST /api/assets/(analysis|dashboard)/{id}/copy`: admin-only,
takes `{ folderId, newId, name }`, rejects a colliding `newId` (409),
**clones the source's grants**, and strips identity fields (`Arn`,
`AnalysisId`, `DashboardId`, `Version`) from the copied definition.
The clone-grants behavior is a leak vector for an agent API — a copy
must not silently re-grant the source's viewers. D-38 ✅: published
dashboards are immutable versioned definitions, separate from the
working analysis.

#### THE PROBLEM

Copy reads a definition — who may do it, and must the copy inherit
the source's sharing?

#### OPTIONS CONSIDERED

1. **Who can copy: any caller who can read the asset** (copy reads
   the definition). **Grants are NOT cloned**: the copy starts with
   the creator as co-owner and no other grants. Copy of a published
   dashboard copies the dashboard's latest published definition, not
   the live draft. `newId` must be unused (409); `name` defaults to
   the source name.
2. **Clone grants** (today's local behavior). Preserves sharing
   silently — the leak vector this option exists to close.
3. **Copy-requires-co-owner.** Restricts agents to assets they
   co-own; read access is the natural copy boundary since copy only
   reads the definition.
4. **Copy-of-draft for dashboards.** Copies the live draft instead
   of the published definition — changes what a dashboard copy
   contains and breaks the D-38 draft/published separation.

#### RECOMMENDATION

Option 1. Read-access as the copy boundary is the least privilege
that works; not cloning grants closes the silent re-grant leak; and
copying the latest published definition keeps the D-38
draft/published separation intact for the asset agents actually
duplicate.

#### IMPLICATIONS

- `POST /assets/{kind}/{id}/copy` ships with
  `{ folderId, newId, name? }`; the OpenAPI spec gains it and
  nothing else.
- Contract tests assert the grant reset, published-vs-draft source
  behavior, `newId` collision 409, and stripped identity fields.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-41](D-41-headless-asset-management.md), [D-37](D-37-headless-first-api.md)
