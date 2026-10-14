---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-14
confirmed: 2026-10-14
labels: [idd]
---

## Purpose

Resolve who can grant and revoke asset access, and what roles and
visibility rules apply.

## Scope

Share grant/deny verbs, roles, the definition-only rule, grant
enumeration, folder-permission interplay.

## Out of Scope

Prepared-dataset sharing (HQ-4 — unchanged by this slice), new roles,
a reader-role model (D-40 Q6 owns the reader question for
dashboards), namespaces/users/groups (unversioned, D-60).

### ✅ IDD D-58 — What permission verbs should assets expose?

#### DECISION (product owner, Tom, 2026-10-14)

Granting requires build + co-owner (replaces admin-only); roles stay viewer|co-owner; grants stay definition-only (never authorize another owner's prepared data, HQ-4); reading grants requires the same access as granting; folder permissions keep the both-must-allow rule; clearing the last grant returns the asset to inherited access.


#### CONTEXT

D-41 ✅ approved proposal-first; this is its Q4. Share grants live
in `packages/api/src/sharing.ts`: today they are **entirely
admin-only** (`service.admin` runs before verb dispatch) and grant
access to the *definition*, never to the sharer's data-policy
context. Grant roles are exactly `viewer | co-owner`; principals must
resolve to a same-namespace user or group; duplicate principals are
rejected. Read access is governed by `canRead`/`grantsAllow`: folder
grants **and** asset grants must both allow; undefined grants mean
inherited access. HQ-4 (owner-only prepared datasets for the pilot)
is decided and constrains everything below.

#### THE PROBLEM

Admin-only grants block agent collaboration — but widening them must
not widen data access or leak the share graph.

#### OPTIONS CONSIDERED

1. **Who can grant: build capability + co-owner access** (mirrors
   D-39 Q2 / D-40 Q1 proposals), replacing today's admin-only rule.
   **Roles stay `viewer | co-owner`** — no new role. **Grants stay
   definition-only**: a share never authorizes another owner's
   prepared data (HQ-4; D-40 Q6). Reading grants requires the same
   access as granting (no grant enumeration by viewers). Folder
   permissions keep the both-must-allow rule with asset permissions
   (`canRead`); clearing the last grant returns the asset to
   inherited access.
2. **Admin-only grants** (today). Blocks agent collaboration —
   agents cannot share what they build.
3. **A data-access role.** A share that authorizes data would
   contradict HQ-4's owner-only pilot.
4. **Viewer-visible grants.** Would leak the share graph to viewers.

#### RECOMMENDATION

Option 1. It unlocks agent collaboration with the same access rule
proposed for authoring (D-39 Q2) and publishing (D-40 Q1) — one
rule, three slices — while the definition-only constraint keeps HQ-4
intact. No grant enumeration by viewers avoids leaking the share
graph.

#### IMPLICATIONS

- `GET|PUT|DELETE` share verbs ship under v1; the OpenAPI spec gains
  them and nothing else.
- Contract tests cover the grant/deny matrix, role validation,
  duplicate principals, inherited-after-clear, and the
  definition-only rule — no data-access widening through any grant.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-41](D-41-headless-asset-management.md), [D-37](D-37-headless-first-api.md)
