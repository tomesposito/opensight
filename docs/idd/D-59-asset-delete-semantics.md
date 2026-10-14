---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-14
confirmed: 2026-10-14
labels: [idd]
---

## Purpose

Resolve who can delete assets and what happens to shares, published
dashboards, and referenced datasets.

## Scope

The delete verb, who can delete, `If-Match`, shares on delete,
published-dashboard preservation, dataset-referenced-by-analysis,
folder delete.

## Out of Scope

Published-dashboard lifecycle ownership (D-40 Q5 owns it — restated
here, not re-decided). Namespace/user/group delete (stay unversioned,
D-60).

### ✅ IDD D-59 — What delete semantics should assets have?

#### DECISION (product owner, Tom, 2026-10-14)

Delete requires build + co-owner plus If-Match on the current version; shares die with the asset; published dashboards are preserved and the republish link is severed on source-analysis delete; deleting a dataset an analysis references is refused fail-closed (409); folder delete keeps the must-be-empty 409.


#### CONTEXT

D-41 ✅ approved proposal-first; this is its Q5. There is **no delete
endpoint for analyses or dashboards** in the local routes today.
Delete exists for datasets on the hosted plane (needs `If-Match`),
for sources with the fail-closed pin
(`SOURCE_DELETE_BLOCKED_BY_DATASET`), and for folders with the
must-be-empty 409. D-40 Q5 owns published-dashboard lifecycle. The
frozen contract honors `Idempotency-Key` on every v1 mutation.

#### THE PROBLEM

Agents need to clean up their own assets — but delete must not
destroy published work or silently break analyses.

#### OPTIONS CONSIDERED

1. **Who can delete: build capability + co-owner access** (same rule
   as D-58), **plus `If-Match` on the current version.** Shares die
   with the asset. Published dashboards are preserved and the
   republish link is severed when the source analysis is deleted —
   owned by D-40 Q5, restated here, not re-decided. Deleting a
   dataset that an analysis references is refused fail-closed (409,
   mirroring the datasets slice's source-delete pin) until a
   sever-or-cascade rule is decided. Folder delete keeps the
   must-be-empty 409.
2. **Cascade delete of published dashboards.** Would destroy
   published work that readers rely on.
3. **Silent severing of dataset references.** Would break analyses
   without a named error.
4. **Admin-only delete.** Keeps agents from cleaning up their own
   assets.

#### RECOMMENDATION

Option 1. Fail-closed is the consistent pattern across the API
(source-delete pin, must-be-empty folders); preserving published
dashboards honors D-38's immutability; the `If-Match` requirement
prevents lost-update deletes. The 409 on referenced datasets buys
time for a proper sever-or-cascade decision instead of guessing.

#### IMPLICATIONS

- `DELETE /assets/{kind}/{id}` ships; the OpenAPI spec gains it and
  nothing else.
- Contract tests cover the per-kind matrix, `If-Match`
  enforcement, shares-die-with-asset, and the
  dataset-referenced-by-analysis 409.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-41](D-41-headless-asset-management.md), [D-37](D-37-headless-first-api.md)
