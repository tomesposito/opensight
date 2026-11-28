# H6: scoped embedded sessions (#26)

H6 implements the recorded HQ-5/HQ-6/HQ-7/HQ-12 decisions. Registered dashboard,
visual, Q search and authoring experiences, and anonymous dashboard/visual sessions
use the hosted tenant stack. The H5 configuration API and Phase 3c v1 signed URL
API remain available with their existing semantics. No AWS adapter, infrastructure
or deployment is supplied. The static demo is still an offline fixture.

## Configuration and keys

Configure H2–H5 first. H5 `enabled`, exact parent allowlists, canonical
`embedOriginId`, appearance and lifetime ceilings apply. H6 sessions require a
ceiling of at least 900 seconds; 36,000 permits the default ten-hour session.
Existing lower H5 ceilings remain valid configuration but cannot authorize an H6
session. Set `features.anonymous` and/or `features.authoring` explicitly to enable
those experiences; both default to false. Registered consumption flags retain
their meaning. Filtering and parameter controls are opt-in. Export, download and persistent
reader state remain unsupported.

Two additional environment variables configure the shared embed signing key:

- `OPENSIGHT_EMBED_SESSION_KEY_ID`: a unique immutable version identifier.
- `OPENSIGHT_EMBED_SESSION_KEY`: a base64-encoded random 32-byte key.

There is no default key, body-supplied key, tenant-specific signer or client signer.
Missing keys leave issuance unavailable. Malformed keys fail startup. Initial
startup registers the key fingerprint in the operator-owned `h6_keys` table.
Explicit operator rotation uses `activateEmbedKey(database, embedSessionKey(env))`
from `@opensight/api/metadata` after validating that a key is configured. Rotation
retires the previous version immediately, invalidating its bootstraps and sessions.
Start serving nodes with the new environment; stale nodes cannot issue or validate
retired keys, and retired IDs cannot be reused. No key material is stored in SQL.
Do not grant tenant SQL roles access to `h6_keys` or `h6_sessions`.

## Issuance contracts

These are native OpenSight endpoints with the selected compatible request shapes,
not an AWS protocol or ARN adapter. Resource references use
`urn:opensight:{namespaceId}:{kind}/{id}`; namespaces continue to scope assets.
Issuance, renewal and revocation are product-backend operations authenticated by
H2. Requests carrying a browser `Origin` are rejected; broad API credentials stay
on the product backend. An active user can issue for themself; only a tenant
administrator can delegate to another active registered membership or issue an
anonymous session. No external subject mapping, JIT user or service identity is
inferred from browser input.

`POST /api/embedding/GenerateEmbedUrlForRegisteredUser` (also
`POST /api/embedding/sessions`) accepts:

```json
{
  "UserArn": "urn:opensight:namespace:user/reader",
  "SessionTags": [{ "Key": "account", "Value": "north" }],
  "SessionLifetimeInMinutes": 600,
  "AllowedDomains": ["https://product.example"],
  "ExperienceConfiguration": {
    "Dashboard": { "InitialDashboardId": "dashboard" }
  }
}
```

`UserArn` defaults to the verified caller. Choose exactly one experience:

| Experience | Configuration | Authority |
| --- | --- | --- |
| Dashboard | `Dashboard: {InitialDashboardId}` | Current viewer and folder/asset grants |
| Visual | `DashboardVisual: {InitialDashboardVisualId: {DashboardId, SheetId, VisualId}}` | Same, restricted to the named sheet/visual |
| Q search | `QSearchBar: {InitialTopicId}` | Topic ID resolves to a tenant dataset with current RLS/CLS |
| Console | `QuickSightConsole: {InitialPath?}` | Administrator/author/author_ai; `/start` or `/start/analyses/{id}` |
| Full app | `FullApp: {InitialPath}` | Registered member's current app capabilities and resource grants; allowed landings below |

Q uses a bounded local grammar: `sum|total|average|avg|min|max|count FIELD [by FIELD]`.
It queries real authorized data and rejects unsupported questions. It does not
call a remote model or promise QuickSight language coverage. The console lists
accessible analyses and datasets, renders supported stored visuals, creates
bar/table/KPI visuals, edits names and saves versioned analysis definitions.
Existing folder and co-owner permissions govern edits. Saving invalidates the
current revision-bound session; the frame confirms the save, clears its content,
and emits `saved`. A fresh backend-authenticated session is needed to continue.
This is an embedded editor, not full QuickSight console parity.

`POST /api/embedding/GenerateEmbedUrlForAnonymousUser` accepts:

```json
{
  "Namespace": "virtual-readers",
  "AuthorizedResourceArns": ["urn:opensight:namespace:dashboard/dashboard"],
  "SessionTags": [{ "Key": "region", "Value": "east" }],
  "SessionLifetimeInMinutes": 600,
  "ExperienceConfiguration": {
    "Dashboard": { "InitialDashboardId": "dashboard" }
  }
}
```

The virtual namespace is a session label, never a tenant switch or durable user.
Anonymous dashboard/visual scope must be in `AuthorizedResourceArns` (1–25).
Anonymous authoring is rejected. Registered authoring is supported.

Both contracts issue a **five-minute, single-use bootstrap** and a session lasting
**15–600 whole minutes**, default 600, subject to H5/operator ceilings. Session time
starts on redemption. An explicit runtime `AllowedDomains` list contains 1–3
unique exact origins and replaces the static list for this grant, within the
operator's tenant allowlist. Omitting it uses the static list. Wildcards,
normalization tricks and same-origin parent/embed deployments are refused. A
separate iframe origin is required to preserve the credential boundary.

The response includes `sessionId`, `EmbedUrl`, `bootstrapExpiresAt`,
`SessionLifetimeInMinutes` and `configRevision`. If the request includes
`Surface`, the response also echoes the accepted declaration. `EmbedUrl` is
`https://embed.example/embed/sessions/{id}#bootstrap=...`; the fragment never enters
the HTTP URL or Referer. Unknown fields and unresolved subjects fail closed.

`DELETE /api/embedding/sessions/{id}` revokes the grant for its issuer or a current
administrator in the same tenant. `POST /api/embedding/sessions/{id}/renew` requires
fresh authentication of the original issuer and reauthorizes the current subject,
config and asset. It returns a new bootstrap and revokes the old session. Expired
sessions may be renewed this way; explicitly revoked sessions cannot. Concurrent
renewals have one winner; losing new grants are revoked. A frame credential can
perform neither operation and cannot authenticate the general API.

## Data and authoring authorization

A dashboard/analysis binds one supported dataset through its durable `datasets`
reference. That dataset's `sources` reference explicitly identifies one H3 source
and its owner: `{kind: "source", id, ownerId}`. This relationship is validated by
H1 tenant-scoped foreign keys. The embed-only source adapter follows that link to
encrypted source storage **after** asset authorization; it applies the viewer's
security, never the owner's. General H3 source routes stay owner-only. No prepared
dataset, protected pipeline, arbitrary secret or foreign-tenant traversal is added.
Multi-source execution is refused until supported by an authorized dataset path.

Registered reads intersect source and dataset RLS, and union their CLS denials.
Protected imported dataset metadata without a corresponding policy fails closed.
Every visual is planned with security before source I/O or aggregation. Queries
use the existing H4 budgets and contained workers; refresh retains fail-closed
semantics. Requests recheck current revisions and session authority before
publication. Inaccessible analysis names are omitted from the console list.

Anonymous reads use the dataset's enabled
`RowLevelPermissionTagConfiguration` (`TagRules`, optional
`TagRuleConfigurations`, `TagMultiValueDelimiter`, `MatchAllValue`). A group of tag
rules is ANDed; configured groups are ORed. Missing required tags, unknown tags,
invalid rules and protected sources without usable tag rules deny access.
Anonymous users inherit neither the issuer's row rules nor column grants; all
protected columns are denied. Virtual namespace values never select assets.

Author saves validate source access and every visual before committing. Version
and revision checks are atomic; clients cannot change grants or folder placement
through a save. Existing assets need co-owner access where grants are explicit.

### Session attribute claims (#338)

The authenticated product backend can include `SessionTags` on self-issued
registered, delegated and anonymous sessions. Derive the values from the
backend's authenticated account or entitlement records. Each request accepts up
to 50 unique keys. Keys and values must be nonempty strings of at most 128 and
256 UTF-16 code units respectively. Both reject control characters U+0000–U+001F.
Omitting the array or sending `[]` issues a registered session with the viewer's
ordinary membership permissions.

For the registered example above, configure a dataset tag rule such as
`{"TagKey":"account","ColumnName":"account_id"}`. A viewer who can read the
north and south accounts through membership can now read only north. A viewer
whose membership permits only south receives no rows. Column grants and
denials still apply to the viewer. Each dataset must have enabled tag rules for
the supplied keys. An unknown or unusable key returns
`EMBED_TAG_CONFIGURATION_REQUIRED`. If no complete rule group matches, access
fails with `ROW_ACCESS_DENIED`.

The server signs the claims into the grant and rechecks its integrity on use
and renewal. Renewal carries the original tags forward. To change accounts,
the backend issues a new session. Frame redemption, reader controls and SDK
mount options cannot override the claims.

Full-app dashboard and Ask O queries use the same dataset tag rules. Direct
source reads and prepared pipelines lack a dataset tag-rule binding and deny
access for sessions carrying claims. Cached query and AI retries are scoped
to the claimed session.

## Filtering and parameter controls (#335)

D-102 Q3 enables frame-local reader state for dashboard and visual sessions,
including authorized anonymous sessions. The tenant must independently enable
`features.filtering` and/or `features.parameterControls`; both default to false.
Q and console experiences do not accept this reader-state contract.

`GET /api/embed/sessions/{id}/content` loads the asset's saved defaults.
`POST` to the same endpoint refreshes the same content with state:

```json
{
  "filters": { "region-filter": ["east"] },
  "parameters": { "Minimum": [25] }
}
```

Both methods require the existing `Authorization: Embed ...` credential and
return `no-store` content. The response includes `controls: {filters, parameters}`
with each editable binding's `id`, `name`, plain-text `label`, `type`, `multiple`,
optional `integer`, and current `values`. Disabled features return empty control
arrays. Controls derive only from filters and calculations reached by the
authorized visuals; disabled filters, filters outside a visual-only session's
scope and unused parameters are not editable. Stored control titles supply labels
where available; otherwise the column or parameter name is used.

The frame renders an input for each selected value, with Add/Remove, Apply and
Reset all. Apply sends the complete current selection and hides old results while
the server re-plans. Reset all submits `{}` to restore saved defaults. The frame
keeps state only in memory and resubmits it after an on-demand reconnect; it never
writes the dashboard, browser storage or parent messages. Terminal session failure
clears the state. The v2 parent SDK and v1 snapshot transport are unchanged.

`filters` maps existing static `CategoryFilter` IDs to string arrays. The stored
filter must use `FilterListConfiguration`, `EQUALS` and `NON_NULLS_ONLY`, as required
by the existing planner. Parameter-bound category, numeric equality, numeric range
and time range filters are controlled through their declared parameters, under
the separate `parameterControls` flag. Parameters also bind to reachable calculated
fields. This does not add unsupported filter operators or a source-value discovery
query. Values need not be among the saved defaults; defaults are not access grants.

Every supplied key must resolve to an editable binding in the asset's own
definition. Unknown fields, IDs, unused parameters, wrong scalar types,
multiplicity violations, duplicate values, invalid UTC dates or out-of-range
integers return 422 `EMBED_STATE_INVALID`. Arrays contain at most 1,000 values;
single-value parameters contain at most one. Strings are at most 10,000 characters
and cannot contain NUL. Numbers must be finite; integer parameters require safe
integers. Empty filter/parameter selections match no rows; scalar calculations
that require a value instead reject an empty parameter through the planner.
An aggregate over no matching rows retains normal query semantics (for example,
a KPI sum returns `null`). Omitted keys use saved defaults, never prior requests.

Submitting a `filters` or `parameters` map while its flag is off returns 403
`EMBED_FEATURE_DISABLED`, even for `{}` or malformed map values. A config change
revokes old sessions before accepting more queries. No request can supply columns,
operators, scopes, dataset IDs, security policy or anonymous tags. The server
validates the saved definition, applies values to a request-local copy, and plans
again with the same viewer security before source I/O. Both source and dataset RLS
still intersect; CLS denials include calculated-field dependencies. Denied columns
retain the planner's concealed `UNRESOLVED_BINDING` diagnostic. A selection for an
RLS-denied region yields no authorized matching rows and cannot widen access.
H4 budgets, contained workers, and revision checks before publication still apply.

## Per-embed surface control (#337)

Both issuance endpoints accept an optional `Surface` object. A v2 SDK client
can mount multiple frames for the same tenant and principal with different
settings. Pass the declaration through the host's authenticated backend to the
issuance endpoint, alongside the backend-selected subject and experience.

```ts
const client = createSessionEmbeddingClient({
  allowedEmbedOrigins: ['https://embed.example'],
  async getEmbedUrl(signal, surface) {
    const response = await fetch('/product/embed-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surface }),
      signal,
    });
    if (!response.ok) throw new Error('Session issuance failed');
    return response.json();
  },
});
await client.mount(portal, { surface: { actions: { authoring: 'hidden' } } });
await client.mount(internalTool, { surface: { actions: { authoring: 'visible' } } });
```

For these two mounts, use the same registered author and enable both
`features.registeredDashboards` and `features.authoring`. The tenant ceiling
must allow `full-app` and the `authoring` action. The product backend sends each
mount's declaration with its own H2 credential and returns the issuance response
to the SDK. This example requests 15 minutes and also sets the account menu and
header states. It requires `maxSessionSeconds` of at least 900 and a ceiling
that includes `menus.account` and `chrome.header`.

```json
{
  "ExperienceConfiguration": { "FullApp": { "InitialPath": "/dashboards" } },
  "SessionLifetimeInMinutes": 15,
  "Surface": {
    "actions": { "authoring": "hidden" },
    "menus": { "account": "disabled" },
    "chrome": { "header": "visible" }
  }
}
```

| Member | Presentation |
| --- | --- |
| `menus.navigation` | Full-app product navigation, section navigation, and navigation search/shortcuts. |
| `menus.account` | Account disclosure in the full-app header. |
| `actions.authoring` | Full-app analysis editing, preparation and creation entry points, or the fixed console's author controls. Requires the tenant authoring flag and a registered builder. |
| `actions.filtering` | Category filter controls on fixed dashboard and visual sessions with filtering enabled. |
| `actions.parameterControls` | Parameter controls on fixed dashboard and visual sessions and published dashboards in full-app sessions. Requires the parameter-controls flag. |
| `actions.question` | Fixed Q search, or full-app Ask O and its Q panel for AI-capable members. Explicitly showing or disabling full-app questions also requires a configured provider. |
| `chrome.header` | The product header or the fixed frame's brand band. Required notices, revocation and expiry feedback stay available. |

Each member accepts `visible`, `disabled` or `hidden`. Omitted members inherit
the intersection of the experience, tenant ceiling, feature flags and subject
capabilities. A disabled control can appear but cannot be used. A hidden
container also hides its children. Unknown groups, names and states return
422 `EMBED_SURFACE_INVALID`. Both visible and disabled requests outside the
intersection return 403 `EMBED_SURFACE_DENIED`. An explicit hidden state is
valid even when the principal lacks the underlying permission.

The server binds the request and resolved settings to the session before issuing
the bootstrap. It rechecks them on shell load, redemption, status, operations
and protected writes. Renewal reissues the original declaration against current
authority. Pre-337 grants acquire the applicable defaults on their next check.
The SDK snapshots each mount's declaration for refresh and rejects an
unacknowledged declaration with `EMBED_SURFACE_MISMATCH`. The frame reads its
profile from the API-served shell. Parent messages carry handshake metadata only.

Hiding authoring leaves a direct analysis write available to an authorized
author. A reader making the same call receives `EMBED_AUTHOR_REQUIRED`.
Asset grants, row policies, denied columns and revision checks apply through
the existing hosted handlers for every presentation.

## Browser and SDK transport

`createSessionEmbeddingClient({allowedEmbedOrigins, getEmbedUrl, title?})` is the
v2 SDK entry point. The trusted application supplies exact embed origins and a
callback to its own authenticated backend; the SDK does not receive the backend's
API credential. `mount(container, options)` accepts lifecycle callbacks and an
optional surface declaration and returns `{iframe, refresh, destroy}`.
The v1 `createEmbeddingClient` exports and TTL validation are unchanged.

The iframe removes its fragment immediately, accepts one versioned initialization
message from its actual parent at an allowed origin, and redeems through
`POST /api/embed/sessions/{id}/redeem`. Redemption atomically consumes a durable
record and returns a random embed-only credential. Only its hash is stored in SQL.
The credential stays in a private closure, never DOM, parent messages, browser
storage or cookies. Subsequent frame requests use `Authorization: Embed ...` and
`credentials: omit`. All responses are `no-store`; shell CSP restricts ancestors,
connections, scripts and images, and uses a nonce and `no-referrer`.

Messages have version 2, type `opensight:session`, session ID, per-mount random
channel ID, and one event: `ready`, `sessionExpired`, `authorizationRevoked`,
`error`, or `saved`. Both sides check the source window, exact origin, version,
session and schema; the SDK additionally rejects stale refresh generations.
Messages contain no credentials, rows, query text or exception details.

Status checks run every 20 seconds with an eight-second request timeout and a
45-second authorization deadline. Revocation, suspension, membership/policy/config
changes, key retirement, expiry or status failure clear protected content and
credentials. Backgrounding hides content; visibility restoration rechecks status.
Server authorization is read on every operation. A browser that has already
received data cannot have a saved screenshot recalled.

Application code does not log bodies, Authorization headers or credentials. Any
operator-installed proxy/telemetry must also exclude them; do not enable request
body capture on redemption. V1 still uses its existing bearer query URL and needs
its documented proxy query redaction.

## Verification

Tests are included in root `npm test`: session replay/races/restart, renewal,
expiry, revisions, suspension, key rotation, viewer RLS/CLS, anonymous tag rules,
author permissions, HTTP credential separation and SDK/iframe forgery attempts.
Issue #335 extends the embed suites with typed state, independent feature flags,
filter scope, reset/default isolation, frame refresh behavior, RLS intersection,
anonymous-tag bypass attempts and direct/calculated CLS-denied bindings rejected
before source I/O. The browser harness also changes live dashboard/visual controls,
checks resulting totals and flags-off behavior, and captures narrow-screen layouts.
The live Postgres test uses independent pools to prove atomic consumption and
revocation across service instances.

The separate real-browser harness uses only local HTTPS servers, synthetic data,
the real hosted API and live Postgres, and an existing Chromium/Playwright install:

```sh
TZ=UTC DATABASE_URL=postgresql://postgres@localhost:5433/opensight \
OPENSIGHT_SCREENSHOT_TOOLS="$HOME/workspace/tools/screenshots" \
node packages/api/scripts/verify-embed-browser.mjs
```

It proves blocked third-party cookies using a cookie-write/read probe, checks
rendering and author saves, races/replays bootstraps, sends forged messages, and
checks revocation/expiry/suspension. Screenshots and non-secret evidence go to
`/tmp/h6-embed-browser` (override `OPENSIGHT_SCREENSHOT_OUTPUT`). A temporary test
certificate, browser profile and isolated Postgres schema are removed on exit.
No new runtime dependency, browser download, AWS call or deployment is involved.
See [verification and visual review](issue-26-gap-notes.md) for measured results.
## Full-app experience (#336, D-102 Q1)

Registered issuance accepts `ExperienceConfiguration: { "FullApp": { "InitialPath": "/data" } }`.
`InitialPath` is required and is exactly one of `/dashboards`, `/dashboards/<id>`,
`/data`, `/analyses/author`, `/analyses/author/<id>`, `/data/preparation`, or `/ask-o`.
IDs use letters, digits, underscores and hyphens (1–512 characters). URLs, query
strings, fragments, escaped paths and unknown routes fail issuance. Anonymous
full-app requests fail with `EMBED_FEATURE_UNSUPPORTED`. Editor and prep landings
require `build` (`EMBED_AUTHOR_REQUIRED`) and `features.authoring`; dashboard
landings require `features.registeredDashboards`. The landing route is part of
the grant and is revalidated on every operation. Ask O requires the `ai`
capability and a configured provider (`SECURITY_AI_REQUIRED` or
`AI_NOT_CONFIGURED` otherwise). AI readers ask against permitted published
dashboards; authors can also select their prepared datasets.

For example, the product backend issues:

```json
{
  "SessionLifetimeInMinutes": 60,
  "AllowedDomains": ["https://product.example"],
  "ExperienceConfiguration": {
    "FullApp": { "InitialPath": "/analyses/author/quarterly" }
  }
}
```

The frame mounts the real web `App`, analysis editor and data-preparation UI.
The initial route selects the starting page; it does not give access to its
resources or restrict the session to that single asset. In-frame navigation can
visit the supported dashboard, catalog, analysis, preparation and Ask O routes,
including their detail and draft pages, under the same registered user and
namespace. Each destination is authorized before mounting. Unsupported paths
fail with `EMBED_SCOPE_DENIED`; inaccessible assets retain `RESOURCE_NOT_FOUND`.
Authoring destinations and operations always recheck `features.authoring` and
the current `build` capability. Dashboard destinations and operations recheck
`features.registeredDashboards`. No new full-app feature flag is introduced.

An embed-only bridge at `/api/embed/sessions/{id}/app/...` accepts the redeemed
credential and a closed list of app operations. It calls the existing hosted
data, AI and v1 handlers for permitted reads, queries, prep and analysis writes.
It does not accept hosted bearer tokens, change the hosted authentication path,
or expose account, billing, user administration or sharing endpoints. A fixed
experience credential cannot enter this bridge. Owner/resource checks, source
and dataset RLS intersection, CLS, query admission and result-publication checks
remain in the existing handlers and planners. Runtime result chunks use the
same embed-session credential and revocation checks.

Full-app saves use the standalone analysis create/update path with versioned
`If-Match` concurrency. That path changes analysis content without changing the
authorization revision, so two saves and subsequent navigation work under one
redeem. A stale save returns `METADATA_CONFLICT` and leaves the editor open.
There is no global relaxation of session validation or rebinding to a new
authorization revision. The bridge additionally checks session validity inside
metadata write transactions. Revocation, tenant suspension, config replacement,
policy changes and authorization changes by other actors still deny writes,
including a revocation between initial admission and commit.

The full-app frame keeps drafts and hosted analysis links in frame-local memory;
it does not write them or its credential to browser storage. Visibility/status
checks preserve the mounted editor when authority remains valid. Terminal expiry
or revocation clears its drafts and protected content. A reload requires a new
single-use bootstrap. Fixed dashboard, visual, Q search and console experiences
retain their existing renderer, scope and save/renewal behavior. In particular,
the fixed console still requires renewal after saving.

The v2 SDK accepts typed landing paths for registered full-app sessions and a
per-mount surface declaration. Anonymous sessions support dashboard and visual
experiences. The fixed console emits its terminal `saved` event. Full-app saves
keep the editor open in the same session.

The separate full-app HTML bundle is served with the same nonce CSP and
no-store protections. Runtime ingress forwards `Accept-Encoding`; gzip keeps
the bundle within the gateway response envelope. This is an API-served frame,
not a deployed static demo.

Root tests cover issuance/landing validation, single-redeem transport, real App
editing and repeated saves, reader Ask O, stale writes, transaction-time
revocation, tenant/config/policy changes, route and asset bypasses, forged or
foreign credentials, RLS/CLS and compressed runtime delivery. Existing fixed
experience tests remain unchanged.
See [issue #336 verification and visual review](issue-336-gap-notes.md) for the
local browser harness, implementation choices and screenshot comparison.
