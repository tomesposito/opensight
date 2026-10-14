# Headless v1 — assets slice (issue #95)

Status: **✅ Implemented decided core**, 2026-10-14, on
`work/issue-95-assets-impl`. Local durable stores and hosted metadata support
asset discovery, transfers, shares, deletion and folder management. Nothing
is pushed or deployed. The two unanswered details below remain explicit
follow-ups; recommendations in the original proposal are not decisions.

## Contract

The confirmed DECISION lines in [D-55](idd/D-55-asset-list-search-shape.md),
[D-56](idd/D-56-asset-move-semantics.md), [D-57](idd/D-57-asset-copy-semantics.md),
[D-58](idd/D-58-asset-permission-verbs.md), [D-59](idd/D-59-asset-delete-semantics.md),
[D-60](idd/D-60-asset-v1-scope-rename.md), and
[D-61](idd/D-61-asset-idempotency-concurrency.md) govern this implementation.
D-37 supplies the common headless conventions; D-43 supplies write/read casing.
The completed local analyses and dashboards implementation branches were
merged as prerequisites, without repeating their checkpoint commits.

| Method and path under `/api/v1` | operationId | Behavior |
| --- | --- | --- |
| `GET /assets` | `list_assets` | Caller-readable analyses, dashboards and owner-scoped prepared datasets |
| `GET /assets/analyses` | `list_analyses_summary` | Analyses subset |
| `GET /assets/dashboards` | `list_dashboards_summary` | Dashboard subset, including imported definitions |
| `GET /assets/datasets` | `list_datasets_summary` | Prepared datasets belonging to the authenticated owner |
| `POST /assets/search` | `search_assets` | `{ query, kinds? }`, case-insensitive name substring, updatedAt descending |
| `POST /assets/{kind}/{id}/move` | `move_asset` | `{ folderId }`, null moves to root; analyses/dashboards only |
| `POST /assets/{kind}/{id}/copy` | `copy_asset` | `{ newId, name?, folderId? }`, omitted name uses source name; omitted placement uses root |
| `GET/PUT/DELETE /analyses/{id}/shares/{principalType}/{principalId}` | `get/set/delete_asset_share` | User/group definition grants |
| `GET/PUT/DELETE /dashboards/{id}/shares/{principalType}/{principalId}` | `get/set/delete_dashboard_share` | Same grant contract; existing operationIds retained |
| `DELETE /analyses/{id}`, `/dashboards/{id}`, `/datasets/{id}` | `delete_analysis/dashboard/dataset` | Build + co-owner and current If-Match |
| `GET /folders`, `/folders/{id}`, `/folders/{id}/assets` | `list_folders`, `describe_folder`, `list_folder_assets` | Readable folders and readable contained assets |
| `PUT /folders/{id}` | `rename_folder` | Rename existing folder with `{ name }` and If-Match |
| `DELETE /folders/{id}` | `delete_folder` | Empty folder only |
| `GET/PUT /folders/{id}/permissions` | `get/set_folder_permissions` | Build + co-owner; PUT takes `{ grants }` and If-Match; null clears inheritance |

The exact D-55 summary is `{ kind, id, name, folderId }`, with plural kinds.
Lists retain `{ items, nextCursor }` and **Limit/Cursor request headers**.
Search paginates after access filtering and sorting; unknown historical
updatedAt values sort last, with ID as the stable tie break. There are no
query-string pagination parameters. New transfer, share and folder read
schemas use PascalCase; the existing delete result `{ id, removed }` remains
compatible. Every route uses the shared tenant rate limiter and named errors.

## Access, persistence and concurrency

Definition access preserves the existing namespace membership, build
requirement for analyses, inherited grants, administrator override and
both-must-allow folder/asset rules. Missing folders deny access even for an
administrator. Prepared datasets remain owner scoped (HQ-4).

Moves require build and co-owner through the current asset and its folder;
the destination must exist and be readable. They change placement only.
Copies require read access and create exactly one co-owner grant for the
caller. Raw definition content and server-owned dataset identity pins are
preserved. Copy strips source identity/version envelope fields. A published
copy contains its latest frozen definition in an independent one-version
history with no active republish link; copying does not consult the live draft
or copy prior publication history. It never grants access to the source
owner's prepared data.

Grant reads and writes now require build plus co-owner, replacing the prior
admin-only dashboard rule. Principal IDs resolve in the current namespace;
duplicate folder grant principals fail. Removing the last grant removes the
restriction and restores inherited access. Grant changes do not rewrite any
published definition.

Shares and placement live with the durable definitions. Hosted operations
execute under the existing tenant transaction lock, foreign-key links and
storage accounting. Local authenticated operations use the configured atomic
security store; unauthenticated local operations use the existing durable
analysis/dashboard overlay. Both retain the legacy maintenance fence.
Unconfigured ephemeral stores fail closed for mutations requiring persistence.
Local prep describe/save also return their current version ETag. Local prepared deletion checks analysis references under the same root fence,
then writes its durable prep store. Deletes leave no surviving grants.

Analysis deletion preserves frozen dashboards and atomically severs republish.
Dataset deletion scans every analysis reference, including unreadable analyses,
and fails closed with `DATASET_DELETE_BLOCKED_BY_ANALYSIS` (409). Other durable
references, including retained dashboard versions, also prevent deletion.
Folder deletion requires emptiness (`FOLDER_NOT_EMPTY`, 409).

If-Match uses quoted integers. Missing is `V1_IF_MATCH_REQUIRED` (428), malformed
is `V1_IF_MATCH_INVALID` (400), and stale asset/folder/share versions are
`ASSET_PRECONDITION_FAILED` (412). A dashboard's latest describe ETag now
identifies its **asset revision**, including grant/placement changes. Its
PascalCase `Version` and pinned version ETag continue to identify the immutable
published version. Version pruning retains its existing published-version
precondition. Analysis updates and shares share the analysis revision.

Idempotency-Key covers move/copy, share PUT/DELETE, folder PUT/DELETE (including
permissions), and asset DELETE. Receipts bind verified tenant/namespace/user,
method/path, canonical body and precondition. Concurrent mutations serialize;
replays check current access and destination permissions, and reject changed
payloads or recreated deleted IDs. Receipts are recorded after durable commit,
before HTTP delivery. Like the prior slices, the receipt store is process-local,
limited to 1,000 successful keys and ten minutes; it is not restart-durable or
distributed. Configuration revision changes on prepared deletion require the
normal credential refresh before a subsequent call or retry.

## SDK and verification

The headless SDK adds typed discovery, search, move, copy, shares, delete and
folder methods, plus Limit/Cursor, If-Match, Idempotency-Key and ETag handling.
Existing dashboard share methods adopt required PUT preconditions and PascalCase
read results. `OpenSightApiError` retains named errorCode, status and 429
retryAfter. The OpenAPI coverage guard maps every published route.

`packages/api/test/v1-assets.test.mjs` covers the implemented success and failure
paths on both planes, including restart persistence, reader copies, owner pins,
co-owner/folder restrictions, duplicate/unresolved grants, reference-safe deletes,
immutable publications, pagination, concurrent CAS, replay conflict/revocation
and rate limiting. Existing analyses/dashboard tests are updated only where
D-58–D-61 deliberately replace their earlier contracts. Full root `npm test`
passed **2,767 / 0 failed / 0 skipped**, with live Postgres enabled. Full-suite
and demo verification are recorded in [gap notes](issue-95-assets-gap-notes.md).

## Unanswered details and deferred work

- **Search scope JSON:** D-55 names optional `scope` but does not define its
  value shape or accepted scopes. No answer is inferred from the proposal.
  Omission searches the namespace; explicit scope currently returns 422
  `ASSET_SCOPE_UNSPECIFIED`. Folder-scoped search awaits confirmation; the
  existing readable `/folders/{id}/assets` list is implemented.
- **Dataset copy:** D-57 does not identify supported copy kinds. The existing
  analysis/dashboard seam is implemented; dataset copy requires confirmation
  of its owner-scoped binding semantics. D-56 explicitly excludes dataset,
  source and folder move. Both unsupported transfers return named 409 errors.
- Serverless `/api/v1`, durable distributed retry/rate adapters and Lambda
  composition remain the remote handoff. Asset MCP tools remain a later slice.
- Identity/admin routes stay unversioned. This slice adds no asset rename,
  hosted deployment, AWS calls, new dependencies or workflow files.

The first two follow-ups are the only product clarifications for Tom. They do
not block the decided namespace-search and analysis/dashboard-copy core.
