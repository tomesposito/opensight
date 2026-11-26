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
their meaning. Export, download, persistent reader state, filtering and parameter
controls remain unsupported and true flags are rejected.

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
Tags have unique keys (at most 50), bounded strings, and cannot be supplied by an
interaction. Anonymous authoring is rejected. Registered authoring is supported.

Both contracts issue a **five-minute, single-use bootstrap** and a session lasting
**15–600 whole minutes**, default 600, subject to H5/operator ceilings. Session time
starts on redemption. An explicit runtime `AllowedDomains` list contains 1–3
unique exact origins and replaces the static list for this grant, within the
operator's tenant allowlist. Omitting it uses the static list. Wildcards,
normalization tricks and same-origin parent/embed deployments are refused. A
separate iframe origin is required to preserve the credential boundary.

The response is `{sessionId, EmbedUrl, bootstrapExpiresAt,
SessionLifetimeInMinutes, configRevision}`. `EmbedUrl` is
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

## Browser and SDK transport

`createSessionEmbeddingClient({allowedEmbedOrigins, getEmbedUrl, title?})` is the
v2 SDK entry point. The trusted application supplies exact embed origins and a
callback to its own authenticated backend; the SDK does not receive the backend's
API credential. `mount(container, callbacks)` returns `{iframe, refresh, destroy}`.
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
