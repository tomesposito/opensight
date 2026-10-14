---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Resolve idempotency and optimistic-concurrency rules for asset
mutations.

## Scope

`Idempotency-Key` coverage, `If-Match` requirements, ETag sources.

## Out of Scope

Rate limiting (frozen contract — every route), the verbs' access
rules (D-56–D-59).

### 🚧 IDD D-61 — How do idempotency and concurrency work for asset verbs?

#### CONTEXT

D-41 ✅ approved proposal-first; this is its Q7. The frozen contract
honors `Idempotency-Key` on every v1 mutation (10-minute dedupe
window, single node). Datasets already expose an ETag on describe;
analyses and dashboards get one from D-39/D-40. Local folder
`PUT /permissions` takes `{ grants }` — `null` clears to inherited.

#### THE PROBLEM

Retried moves/copies/shares must not duplicate; concurrent grant
edits must not lose updates.

#### OPTIONS CONSIDERED

1. **`Idempotency-Key` honored on move, copy, share PUT/DELETE,
   folder PUT/DELETE, and asset DELETE** (frozen contract).
   **`If-Match` required on asset DELETE and on share PUT** (ETag
   from the asset describe — datasets already expose one;
   analyses/dashboards get one from D-39/D-40). **Folder
   `PUT /permissions` requires `If-Match`** on the folder's current
   grants version.
2. **Optional `If-Match`.** Risks lost-update races on grants — two
   writers, one grant survives silently.
3. **No idempotency keys.** Risks duplicate copies/moves on retry —
   a retried copy creates a second asset.

#### RECOMMENDATION

Option 1. It is the frozen contract applied uniformly: retries are
safe everywhere, and the grant-edit race is closed with a required
precondition instead of a convention. The ETag dependency on
D-39/D-40 is explicit, not silent — those slices know the asset
verbs need it.

#### IMPLICATIONS

- All asset mutations honor `Idempotency-Key`; delete, share PUT,
  and folder-permissions PUT require `If-Match`.
- Contract tests assert replay-same-result-no-duplicate on
  move/copy/share/delete and `If-Match` enforcement (428 without).

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-41](D-41-headless-asset-management.md), [D-37](D-37-headless-first-api.md)
