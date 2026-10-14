# Headless v1 — assets slice (issue #95)

Status: **🚧 Contract proposal; implementation blocked on product review.**
Prepared on `work/issue-95-assets`, 2026-10-13. No asset endpoints have
been added to v1. Existing routes and the shipped machine-readable
contract in `docs/api/openapi-v1.yaml` remain unchanged.

The [frozen contract](api-contract-v1-draft.md#freeze-decisions-product-owner-2026-10-13)
answers all seven freeze questions, and IDDs
[D-37](idd/D-37-headless-first-api.md) and
[D-38](idd/D-38-dashboard-publish-semantics.md) are confirmed on the
branch's master base. The datasets and querying slices are implemented;
the analyses slice ([slice doc](headless-v1-analyses.md), draft
[D-39](idd/D-39-headless-analysis-authoring.md)) and the dashboards slice
([slice doc](headless-v1-dashboards.md), draft
[D-40](idd/D-40-headless-dashboard-publishing.md)) are proposals awaiting
Tom's answers. [Draft IDD D-41](idd/D-41-headless-asset-management.md)
records this slice's gate plus the further product questions below.
Nothing below is a frozen API commitment.

## Existing behavior and implementation seams

- Local `GET /api/assets` lives in `packages/api/src/index.ts`. It returns
  the caller's readable assets as `{ kind, id, name }` plus the
  `sales` dataset for build-capable callers, filtered by
  `OrganizationService.canRead` — no pagination, no kind filter, no
  search, no `folderId`, no timestamps, no owner. The per-kind lists
  (`/analyses`, `/dashboards`, `/api/datasets`) share the same handler
  and the same shape.
- Read access (`packages/api/src/organization.ts`, `canRead` /
  `grantsAllow`) is the rule every list/search proposal must preserve:
  analyses require the `build` capability; the caller must be a user of
  the asset's namespace; folder grants **and** asset grants must both
  allow. `grants === undefined` means *inherited* — any namespace user
  passes that level. Administrators always pass. A missing folder denies.
  `OrganizationService.list` returns only assets with a definition,
  plus hosted sources.
- Move and copy **exist** locally at
  `POST /api/assets/(analysis|dashboard)/{id}/(move|copy)`
  (`packages/api/src/organization.ts`). They are **admin-only**
  (`service.admin(identity)`), reject query strings, and cover only
  analyses and dashboards — not datasets, sources, or folders. Move
  takes `{ folderId }` (`null` = root) and requires the destination
  folder to exist and be readable by the caller. Copy takes
  `{ folderId, newId, name }`, rejects a colliding `newId` (409),
  **clones the source's grants**, and strips `Arn` / `AnalysisId` /
  `DashboardId` / `Version` from the copied definition. The contract
  draft's "no move verb" gap is therefore stale for local routes: the
  real gap is that move/copy are unversioned, admin-only, and
  kind-limited. There is **no rename verb** — rename is reachable only
  by copying with a new `name`.
- Folders exist locally at `/api/folders`
  (`packages/api/src/organization.ts`): `GET /api/folders` (caller-visible
  folders, grants stripped), `GET /api/folders/{id}`,
  `GET /api/folders/{id}/assets` (caller's readable assets in the
  folder), `GET|PUT /api/folders/{id}/permissions` (admin-only; `PUT`
  takes `{ grants }`, `null` clears to inherited), and
  `GET|PUT|DELETE /api/folders/{id}` (admin-only mutations; `PUT` takes
  `{ name }`; `DELETE` requires the folder to be empty, else 409).
  Folder bodies validate through `validateOrganization`
  (`folderId` must resolve within the namespace). Folders are
  namespace-scoped; there is no cross-namespace move.
- Share grants live in `packages/api/src/sharing.ts`:
  `GET|PUT|DELETE /analyses|dashboards/{id}/shares(/user|group/{id})`.
  They are **entirely admin-only** (`service.admin(identity)` runs
  before verb dispatch) and grant access to the *definition*, never to
  the sharer's data-policy context (the file's own doc comment). `GET`
  on the collection returns
  `{ access: 'inherited' | 'restricted', grants }`. Grant roles are
  exactly `viewer` | `co-owner` (`validateGrants` in
  `organization.ts`); principals must resolve to a user or group in the
  same namespace; duplicate principals are rejected. There is no reader
  role, no data-access widening through shares, and no share verb for
  datasets, sources, or folders (folders have their own permissions
  route above).
- There is **no delete endpoint for analyses or dashboards** in the local
  routes. Delete exists for datasets on the hosted plane
  (`PUT`/`DELETE /datasets/{id}` in
  `packages/api/src/hosted-data-routes.ts`, shipped by the datasets
  slice), for sources with the fail-closed pin
  (`SOURCE_DELETE_BLOCKED_BY_DATASET`), and for namespaces/users/groups/
  folders with 409 guards (namespace delete requires no assets, folders,
  groups, datasets, or other users; user delete requires no group/policy
  reference; group delete requires no policy reference; folder delete
  requires the folder to be empty).
- The UI's global find-anything search
  (`packages/web/src/GlobalSearch.tsx`) is **client-side**: it searches
  the browser-local draft store (`browserDraftStorage`), analyses only,
  by case-insensitive substring on `name`, sorted by `updatedAt` desc,
  with `all | favorites | analysis` filters. It is not a server search
  endpoint and does not see hosted assets. A v1 search must be a server
  endpoint or agents cannot find hosted assets at all.
- Definition writes cannot smuggle grants or placement:
  `packages/api/src/metadata.ts` — "Author-only definition edits.
  Callers cannot replace grants or folder placement." Grants and
  `folderId` change only through the share/folder/move routes above.
- Admin-shaped routes that this slice must place in or out of v1 (see
  Q6): namespaces/users/groups (`namespace-routes.ts`, admin-only except
  namespace `GET`), invitations (`invitations.ts`), embedding
  (`embedding.ts`, HQ-6/HQ-12 shapes), AI-provider admin
  (`ai-providers.ts`, `ai-settings.ts`). None is versioned today.
- Tenant-boundary decisions that constrain every proposal below: HQ-4
  (owner-only prepared datasets for the pilot, decided 2026-09-30),
  HQ-12's carve-out (namespaces keep scoping assets and metadata — never
  adopt QuickSight's account-scoped assets), HQ-17 (newly created assets:
  preserve existing Phase 3c semantics until an explicit product
  decision — **undecided**, so this slice proposes nothing that changes
  default visibility).

## Proposed endpoints (`/api/v1/...`) — review required

All names and paths below are proposals, including the `operationId`
values that would map mechanically to MCP tools (freeze Q7). No endpoint
below exists yet.

| Method and path | Proposed operationId | Proposed body / result |
| --- | --- | --- |
| `GET /assets` | `list_assets` | Paginated unified list; per-asset `{ kind, id, name, folderId }` at minimum (Q1 decides the full shape and the kind filter) |
| `POST /assets/search` | `search_assets` | Body `{ query, kinds?, scope? }`; POST (not GET) because the hosted plane rejects `?...` query strings and search needs structured filters (Q1 decides the match rules) |
| `POST /assets/{kind}/{id}/move` | `move_asset` | Body `{ folderId }` (`null` = root); 200 with `{ kind, id, folderId }`, mirroring the local move result (Q2 decides who can move and which kinds) |
| `POST /assets/{kind}/{id}/copy` | `copy_asset` | Body `{ folderId, newId, name? }`; 201 with the new asset (Q3 decides grant handling and copy-of-published rules) |
| `GET /assets/{kind}/{id}/shares` | `list_asset_shares` | `{ access: 'inherited' \| 'restricted', grants }`, mirroring the local share GET (Q4 decides who can read grants) |
| `PUT /assets/{kind}/{id}/shares/{principalType}/{principalId}` | `set_asset_share` | Body `{ role }`, role `viewer \| co-owner` (Q4 decides who can grant and whether the roles suffice) |
| `DELETE /assets/{kind}/{id}/shares/{principalType}/{principalId}` | `delete_asset_share` | Removes one grant; clearing the last grant returns the asset to inherited access (Q4) |
| `GET /folders` | `list_folders` | Paginated folders, grants stripped for non-admins (Q6 decides whether folders version under v1 at all) |
| `GET /folders/{id}` | `describe_folder` | One folder, grants stripped for non-admins |
| `GET /folders/{id}/assets` | `list_folder_assets` | Paginated readable assets in the folder |
| `GET /folders/{id}/permissions` | `get_folder_permissions` | `{ inheritedFrom, grants }` (admin-only today; Q4/Q6 decide v1 access) |
| `PUT /folders/{id}/permissions` | `set_folder_permissions` | Body `{ grants }`, `null` clears to inherited |
| `PUT /folders/{id}` | `rename_folder` | Body `{ name }` — rename is proposed here, not as an asset verb (Q6) |
| `DELETE /folders/{id}` | `delete_folder` | Requires the folder to be empty, else 409 (Q5 decides whether the 409 stays) |
| `DELETE /assets/{kind}/{id}` | `delete_asset` | Removes the asset; requires `If-Match` (Q5 decides who can delete and the cascade rules) |

Deliberately **not** proposed: a standalone rename verb for assets
(rename is reachable via copy today; whether assets get a rename verb
is part of Q6, so as not to double-decide with D-39's authoring verbs);
dataset/source move (datasets and sources have no folder placement in
the hosted plane — Q2); cross-namespace move (forbidden by the
namespace asset boundary — no question asked); versioned
namespaces/users/groups/invitations/embedding/AI-admin routes (Q6
places them in or out of v1 as a group).

## Product questions requiring answers

| Question | Proposed answer | What the decision changes |
| --- | --- | --- |
| Q1 — List/search shape, filtering, and match rules | Unified `GET /assets` returns `{ kind, id, name, folderId }` plus the caller's readable set only (never leaks names of unreadable assets — search is filtered by `canRead` exactly like `list`). Kind filter via a per-kind list path (`/analyses`, `/dashboards`, `/datasets`) rather than a header or query string. Search is `POST /assets/search` with `{ query, kinds?, scope? }`; match is case-insensitive substring on `name` (the client-side rule), sorted by `updatedAt` desc where available. `folderId` in the list lets agents scope by folder client-side. | A different shape (owner, timestamps, tags, favorites, relevance ranking, fuzzy/prefix matching, folder-scoped search) changes the response schema and the search implementation; tags/favorites do not exist server-side today and would be new state. |
| Q2 — Move semantics | Move is a folder change only (no rename). Who can move: build capability + co-owner access through both asset and folder grants, preserving existing administrator behavior — the same rule D-39 Q2 proposes for edit/delete. Move stays within the namespace; destination folder must exist and be readable by the caller; `folderId: null` moves to root. Datasets, sources, and folders themselves are NOT movable in v1 (no folder placement for them in the hosted plane). | Admin-only move (today's rule) keeps agents out of organizing; a rename-in-move option merges two verbs; movable datasets/sources need a placement model that does not exist. |
| Q3 — Copy semantics | Who can copy: any caller who can read the asset (copy reads the definition). Grants are NOT cloned: the copy starts with the creator as co-owner and no other grants (the local clone-grants behavior is a leak vector for an agent API — a copy must not silently re-grant the source's viewers). Copy of a published dashboard copies the dashboard's latest published definition, not the live draft. `newId` must be unused (409), `name` defaults to the source name. | Cloning grants (today's local behavior) preserves sharing silently; copy-requires-co-owner restricts agents to assets they co-own; copy-of-draft vs copy-of-published changes what a dashboard copy contains. |
| Q4 — Permission verbs | Who can grant: build capability + co-owner access (mirrors D-39 Q2 / D-40 Q1 proposals), replacing today's admin-only rule. Roles stay `viewer \| co-owner` — no new role. Grants stay definition-only: a share never authorizes another owner's prepared data (HQ-4; D-40 Q6). Reading grants requires the same access as granting (no grant enumeration by viewers). Folder permissions keep the both-must-allow rule with asset permissions (`canRead`); clearing the last grant returns the asset to inherited access. | Admin-only grants (today) block agent collaboration; a data-access role would contradict HQ-4; viewer-visible grants would leak the share graph. |
| Q5 — Delete semantics | Who can delete: build capability + co-owner access (same rule as Q4), plus `If-Match` on the current version. Shares die with the asset. Published dashboards are preserved and the republish link is severed when the source analysis is deleted — owned by D-40 Q5, restated here, not re-decided. Deleting a dataset that an analysis references is refused fail-closed (409, mirroring the datasets slice's source-delete pin) until a sever-or-cascade rule is decided. Folder delete keeps the must-be-empty 409. Namespace/user/group delete guards stay as-is and stay unversioned (Q6). | Cascade delete of published dashboards would destroy published work; severing dataset references silently would break analyses; admin-only delete keeps agents from cleaning up their own assets. |
| Q6 — What versions under v1, and where rename lives | v1 covers tenant-plane asset verbs only: assets, search, folders, shares. Namespaces/users/groups/invitations, embedding, and AI-provider admin stay unversioned until a dedicated identity/admin slice — they are operator-adjacent, not builder-shaped. Folder rename is `PUT /folders/{id}` (this slice). Asset rename is NOT decided here: it belongs to D-39's authoring verbs for analyses, and dashboards/datasets get a rename rule from their own slices; until then rename stays copy-only. | Versioning the admin surface in this slice widens the security review to identity management; deciding asset rename here would double-decide D-39. |
| Q7 — Idempotency and concurrency | `Idempotency-Key` honored on move, copy, share PUT/DELETE, folder PUT/DELETE, and asset DELETE (frozen contract). `If-Match` required on asset DELETE and on share PUT (ETag from the asset describe — datasets already expose one; analyses/dashboards get one from D-39/D-40). Folder `PUT /permissions` requires `If-Match` on the folder's current grants version. | Optional `If-Match` risks lost-update races on grants; no idempotency keys risk duplicate copies/moves on retry. |

## Conventions and validation to preserve after review

- Frozen contract on every v1 route: named `errorCode` in all error
  bodies; pagination via `Limit`/`Cursor` request headers (headers, not
  query strings — the hosted plane rejects `?...`); `Idempotency-Key`
  on mutations; per-tenant rate limiting (429 `RATE_LIMIT_EXCEEDED` +
  `Retry-After`); `If-Match` where concurrency applies (Q7).
- `canRead` / `grantsAllow` semantics are preserved exactly: search and
  list never reveal unreadable assets (no name leakage through search
  hits or folder listings); folder grants and asset grants must both
  allow; `grants === undefined` stays *inherited*; administrators keep
  their current pass-through; analyses keep the `build` capability
  requirement.
- `validateOrganization` / `validateGrants` stay the single validators:
  `folderId` must resolve within the namespace; principals must resolve
  to a same-namespace user or group; roles are `viewer | co-owner`;
  duplicate principals rejected; no cross-namespace grants, no live
  cross-tenant grants (HQ-17's copy-into-destination rule for templates
  is out of scope here).
- Definition bodies still cannot smuggle grants or placement
  (`metadata.ts` rule): grants change only through share/folder routes,
  placement only through move/copy.
- Fail-closed deletes: the datasets slice's `SOURCE_DELETE_BLOCKED_BY_DATASET`
  pin and the proposed dataset-referenced-by-analysis 409 (Q5) follow the
  same pattern — refuse with a named code rather than silently severing
  a reference.
- Existing unversioned routes stay untouched. The local move/copy,
  folder, and share routes keep working while v1 is built alongside
  them; the UI keeps consuming the local routes until the UI itself
  moves to v1 (D-37's "UI consumes the same API" is the end state, not
  this slice's work).

## Tests required after contract approval

- Contract tests per verb: list/search pagination (`Limit`/`Cursor`
  headers, `nextCursor`), search match rules and `canRead` filtering
  (an asset the caller cannot read never appears in list, search, or
  folder listings — explicit bypass attempts), move (folder change,
  root move, missing folder, cross-namespace rejection, admin vs
  co-owner vs viewer vs stranger matrix), copy (grant reset, published
  vs draft source, `newId` collision 409, stripped identity fields),
  shares (grant/deny matrix, role validation, duplicate principal,
  inherited-after-clear, definition-only — no data-access widening),
  folders (CRUD, permissions PUT/clear, delete-must-be-empty 409,
  both-must-allow read rule), delete (per-kind matrix, `If-Match`,
  shares die with asset, dataset-referenced-by-analysis 409).
- Conventions tests: named `errorCode` on every error path (including
  409s), `Idempotency-Key` replay on move/copy/share/delete (same key =
  same result, no duplicate), 429 `RATE_LIMIT_EXCEEDED` +
  `Retry-After` on the new routes, query-string rejection on the hosted
  plane.
- Regression: the existing local move/copy/folder/share routes keep
  their behavior; `npm test` stays green; OpenAPI
  `docs/api/openapi-v1.yaml` gains the approved verbs only.

## Resume boundary

Approval must answer Q1–Q7 in the slice proposal, then the loop records
the approved contract, then implements and checkpoints the routes,
shared validation, persistence, and contract tests. The proposal does
not silently resolve D-39 Q2/Q5 or D-40 Q5/Q6 — those stay owned by
their slices; this slice restates them where the contracts touch.
The MCP mapping stays mechanical 1:1 from the approved REST operations
(freeze Q7) and is a later slice on top of the REST foundation.

## Baseline verification

Full root `npm test` results are recorded in the
[gap notes](issue-95-assets-gap-notes.md) once the verification run
completes. These are the existing tests; this documents the baseline at
the review gate, not implemented assets API coverage.
