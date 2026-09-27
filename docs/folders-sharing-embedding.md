# Folders, sharing and embedding

Phase 3c resources are OpenSight-local APIs. They require Phase 3b's configured
credential verifier and registered namespace principal; local unauthenticated
fixture behavior is unchanged. No AWS services or additional runtime dependencies
are used. State uses the security store's single-process atomic persistence.

## Folders

`GET /api/folders` lists accessible folders. `GET|PUT|DELETE /api/folders/{id}`
reads, creates/renames (`{ "name": "Reports" }`), or deletes an empty folder.
`GET /api/folders/{id}/assets` lists its accessible analyses and dashboards.
Folders are flat within a namespace, with one folder per asset; `null` denotes
an asset at the namespace root. Namespace-prefixed routes also work.

`POST /api/assets/{analysis|dashboard}/{id}/move` takes `{ "folderId": "reports" }`
(or null). `/copy` also requires `newId` and accepts an optional `name`.
Copies store independent definition snapshots, preserve dataset references and
unknown definition fields, and use fresh local IDs without source ARN/version
identity metadata. Duplicate IDs fail; moving to an absent folder fails atomically.
Copies persist across restarts when `security.storePath` is configured. Imported
source definitions still load at startup; missing or colliding persisted references
fail startup. Copying never changes dataset security.

`GET|PUT /api/folders/{id}/permissions` inspects/replaces folder grants. PUT takes
`{ "grants": [{ "principal": { "type": "group", "id": "team" }, "role": "viewer" }] }`.
Principals must resolve in the caller's namespace. `grants: null` restores namespace
inheritance; `[]` restricts the folder to namespace administrators. Unconfigured
grants inherit namespace access. Explicit grants narrow access to matching users
or current group members. Readers cannot inspect grants or mutate resources.

Phase 3b supplies `admin` and `reader` roles, not a separate asset privilege registry.
The effective ceiling is always the current namespace role: readers have at most
viewer access, including when a stored grant says `co-owner`. Administrators can
manage all resources in their namespace. A folder cannot promote a reader or grant
cross-namespace access. Membership changes and role demotion apply immediately.
Folder restrictions apply to both listings and direct definition reads.

## Sharing

`GET /analyses/{id}/shares` and `/dashboards/{id}/shares` return `access`
(`inherited` or `restricted`) and `grants`. `GET|PUT|DELETE .../shares/{user|group}/{id}`
reads, upserts (`{ "role": "viewer" }` or `co-owner`), or revokes one share.
These routes also accept the `/api` prefix. Share administration requires the
namespace's management privilege (admin); the namespace role ceiling above also
applies to co-owner grants. Sharing cannot give a reader administrative power.

Untouched assets retain their Phase 3b namespace access. Creating the first share
switches that asset to explicit access; revoking the last share keeps it private
(to admins). User/group shares are additive, so revoking a user share does not
remove a matching group share. The containing folder is an additional gate: an
asset share cannot bypass its folder. Moving applies the destination folder gate;
copies preserve explicit asset grants and use the destination folder's grants.
User/group deletion is blocked while referenced by a share or folder grant.

`POST /analyses/{id}/visuals/{visualId}/query` (also dashboards and `/api` prefixes)
takes `{}` and runs the **stored** visual through the existing sales query binding
with the authenticated viewer's security context. It returns columns and rows.
It does not accept an alternate definition, principal or policy. RLS and CLS are
applied by the engine before data execution. Neither admins nor co-owners bypass
data policies. Direct dataset queries retain their Phase 3b data access checks;
sharing a definition does not grant or revoke independent dataset access.
