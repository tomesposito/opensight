---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Resolve who can move assets and which kinds move in headless v1.

## Scope

The move verb shape, who can move, destination rules, which kinds are
movable.

## Out of Scope

Rename (D-39/D-60 — move is folder-change only), copy (D-57), delete
(D-59). Cross-namespace move is forbidden by the namespace asset
boundary — no question asked.

### 🚧 IDD D-56 — What move semantics should assets have?

#### CONTEXT

D-41 ✅ approved proposal-first; this is its Q2. Move exists locally
at `POST /api/assets/(analysis|dashboard)/{id}/move`: **admin-only**,
analyses and dashboards only, takes `{ folderId }` (`null` = root),
and requires the destination folder to exist and be readable by the
caller. The real gap is that move is unversioned, admin-only, and
kind-limited — not that no move verb exists. D-39 Q2 proposes
build-capability + co-owner access for edit/delete; the move rule
below mirrors it so authoring verbs share one access rule.

#### THE PROBLEM

Which move semantics should agents get — admin-only organizing, or a
builder-shaped move with the same access rule as the other authoring
verbs?

#### OPTIONS CONSIDERED

1. **Move is a folder change only (no rename).** Who can move: build
   capability + co-owner access through both asset and folder grants,
   preserving existing administrator behavior — the same rule D-39 Q2
   proposes for edit/delete. Move stays within the namespace; the
   destination folder must exist and be readable by the caller;
   `folderId: null` moves to root. Datasets, sources, and folders
   themselves are NOT movable in v1 (no folder placement for them in
   the hosted plane).
2. **Admin-only move** (today's rule). Keeps agents out of organizing
   — one of the three most agent-relevant behaviors stays broken.
3. **Rename-in-move.** Merges two verbs; rename belongs to D-39's
   authoring verbs (D-60), not to placement.
4. **Movable datasets/sources.** Needs a placement model that does
   not exist in the hosted plane.

#### RECOMMENDATION

Option 1. It gives agents the organizing verb they need while reusing
the exact access rule D-39 proposes for edit/delete — one consistent
rule across authoring verbs instead of a per-verb matrix. Keeping
move folder-change-only leaves rename orthogonal (D-60).

#### IMPLICATIONS

- `POST /assets/{kind}/{id}/move` ships with `{ folderId }`
  (`null` = root); the OpenAPI spec gains it and nothing else.
- Contract tests cover the admin / co-owner / viewer / stranger
  matrix, root move, missing folder, and cross-namespace rejection.
- Datasets, sources, and folders stay unmovable until a placement
  model is proposed.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-41](D-41-headless-asset-management.md), [D-37](D-37-headless-first-api.md)
