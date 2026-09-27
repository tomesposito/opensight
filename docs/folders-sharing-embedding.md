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

## Hosted embedding and signing

Configure `createApiServer({ dataRoot, security, embedding: { origin,
allowedParentOrigins } })`. Both origins must be exact HTTPS origins (HTTP is
permitted only for localhost/loopback development). The API origin is trusted
startup configuration, never an incoming Host header. There are no wildcard parent
origins. Supply `OPENSIGHT_EMBED_SECRET` through the host environment: at least 32
bytes, generated using a cryptographically random source. No key is accepted in
an API option, request, checked-in file, SDK or static build. The key is captured
at server startup; restarting with a new key invalidates previous URLs.

`POST /dashboards/{id}/embed-url` takes `parentOrigin`, optional `visualId` and
optional `expiresInSeconds` (integer 60–900; default 300). It returns `url` and
`expiresAt`. `/api/dashboards/...` and the authenticated namespace prefix are also
supported. The issuer is always the authenticated caller; issuing for an arbitrary
user is unsupported. The URL contains HMAC-SHA256 authenticated, versioned claims
for the caller's namespace/user, dashboard, optional visual, parent origin, issue
and expiry times, and a random nonce. Claims are signed, not encrypted. Comparison
is constant-time. Tokens never authorize ordinary API or dataset routes.

`GET /embed/dashboards/{id}?token=...` verifies the signature, expiry and exact
resource before resolving the current user, group membership, folder permissions,
and asset grants. It executes only the selected stored visual (or all dashboard
visuals) through the existing query binding and the viewer's RLS/CLS context. It
fails closed if a source, policy or visual is unsupported. The iframe uses the
existing OpenSight chart renderer with the actual authorized rows; no fixture data
is bundled or substituted. Layout uses full-width visual cards in sheet order.
Current query source support remains the sales binding; this slice adds no source
connector or query dialect. Existing engine tests cover both security dialects.

The API build creates `packages/web/dist/opensight-embed.html`; include this file
with the API deployment at the same relative package path. Missing renderer builds
return `EMBED_RENDERER_NOT_BUILT`. The response has `no-store`, `no-referrer`, a
nonce-based script CSP and an exact `frame-ancestors` restriction. Data is escaped
before inline serialization. The frame removes its token from history after load,
then displays an expiry notice at expiration. URLs are short-lived bearer
credentials: anyone holding one can replay it as that viewer until expiration or
access revocation, so hosts must not log or publish them. Revocation is checked on
each load; previously delivered data cannot be recalled. There is no anonymous or
cross-namespace sharing and no silent session renewal.

Only URL issuance supports credentialed CORS, limited to the configured exact
parent origins. The SDK can call it from those hosts; preflight permits only POST,
Content-Type and Authorization. Ordinary API routes retain their prior behavior.

## Browser SDK and SSO hooks

`@opensight/embedding-sdk` is a separate browser-safe workspace with no runtime
dependencies and no Node crypto or signing code. Example host integration:

```ts
import { createEmbeddingClient } from '@opensight/embedding-sdk';

const client = createEmbeddingClient({
  apiOrigin: 'https://api.example.com',
  getAuthorization: async () => hostSession.authorizationHeader(),
  onAuthenticationRequired: async () => hostSession.signIn(),
});
const handle = await client.embedDashboard(document.getElementById('dashboard')!, {
  dashboardId: 'sales-dashboard',
  parentOrigin: window.location.origin,
}, {
  onReady: () => console.info('Dashboard ready'),
  onExpired: () => console.info('Request a fresh embed URL'),
  onError: error => console.error(error.message),
});
// A single visual: client.embedVisual(container, { ...request, visualId: 'total-revenue' }).
// Explicitly reauthorize and reload: await handle.refresh().
// On unmount: handle.destroy().
```

The host supplies `hostSession`; it is not an SDK service. `generateEmbedUrl` is also
available independently. SDK messages require the exact frame window, API origin,
dashboard and visual IDs. Destroy removes the iframe, listener and timer and
aborts pending refresh requests. No private dashboard data is posted to the host.

**SSO is a documented integration stub**, not an OIDC/SAML implementation.
`onAuthenticationRequired` lets the host sign in, then the SDK retries issuance
once with `getAuthorization`. The exported `ssoNotConfigured()` stub explicitly
throws `SSO_NOT_CONFIGURED`; no mock login succeeds. On the server, configure the
Phase 3b `security.authenticate(request)` to verify that credential and return
`{ namespaceId, userId }`. Resolve groups and roles from the registry. Never accept
those values as browser assertions. Provider configuration, credential exchange
and session lifecycle belong to the hosted application.

No third-party dependencies were added. The SDK reuses the installed TypeScript
compiler (Apache-2.0, verified from its installed package metadata/license); the
workspace itself is Apache-2.0. HMAC uses Node's built-in crypto. The lockfile adds
only the local SDK workspace link and metadata.

## Static demo

The Mode picker includes **Folders, sharing & embedding**, following the Security
& namespaces and Schedules & alerts notices. Every action is disabled and marked
**Needs hosted API**. The view states that sample data is public and does not
simulate folder writes, shares, signing or SSO. The hosted iframe build is separate
from the offline demo and contains no sample dataset fallback.
