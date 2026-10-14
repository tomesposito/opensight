---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-14
confirmed: 2026-10-14
labels: [idd]
---

## Purpose

Draw the v1 boundary for asset verbs and place rename.

## Scope

Which route families version under v1; folder rename; asset rename
ownership.

## Out of Scope

The verbs themselves (D-55–D-59, D-61), identity/admin design (a
later slice), analysis rename semantics (D-39 owns them).

### ✅ IDD D-60 — What versions under v1, and where does rename live?

#### DECISION (product owner, Tom, 2026-10-14)

v1 covers tenant-plane asset verbs only; namespaces/users/groups/invitations, embedding, and AI-provider admin stay unversioned until a dedicated identity/admin slice; folder rename is PUT /folders/{id}; asset rename is decided in D-39, not here.


#### CONTEXT

D-41 ✅ approved proposal-first; this is its Q6. Admin-shaped routes
exist unversioned today: namespaces/users/groups (admin-only except
namespace `GET`), invitations, embedding (HQ-6/HQ-12 shapes),
AI-provider admin. Local folder `PUT /folders/{id}` takes `{ name }`
— rename exists for folders. There is **no standalone asset rename
verb**; rename is reachable only by copying with a new name. D-39's
authoring verbs will cover rename for analyses.

#### THE PROBLEM

Versioning the admin surface widens the security review to identity
management; deciding asset rename here would double-decide D-39.

#### OPTIONS CONSIDERED

1. **v1 covers tenant-plane asset verbs only**: assets, search,
   folders, shares. Namespaces/users/groups/invitations, embedding,
   and AI-provider admin stay unversioned until a dedicated
   identity/admin slice — they are operator-adjacent, not
   builder-shaped. Folder rename is `PUT /folders/{id}` (this
   slice). Asset rename is NOT decided here: it belongs to D-39's
   authoring verbs for analyses, and dashboards/datasets get a
   rename rule from their own slices; until then rename stays
   copy-only.
2. **Version the admin surface now.** Widens the security review to
   identity management inside a builder-shaped slice.
3. **Decide asset rename here.** Double-decides D-39's authoring
   verbs.

#### RECOMMENDATION

Option 1. The tenant-plane / operator-plane split is the cleanest
v1 boundary: everything an agent needs to build and organize is
versioned; everything operator-adjacent waits for its own review.
Folder rename ships where folders ship; asset rename stays with
authoring, where the validation rules for renames already live.

#### IMPLICATIONS

- v1 gains folder CRUD including rename; namespaces/users/groups/
  invitations/embedding/AI-admin stay unversioned.
- Asset rename stays copy-only until D-39 (and the dashboard/dataset
  slices) decide it — no rename verb is smuggled in through assets.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-41](D-41-headless-asset-management.md), [D-37](D-37-headless-first-api.md)
