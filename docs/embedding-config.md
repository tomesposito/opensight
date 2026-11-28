# H5: embedding configuration and appearance (#25)

H5 adds durable tenant configuration and an offline appearance preview.
[H6 (#26)](embed-sessions.md) now supplies hosted sessions under the recorded
HQ-5/HQ-6/HQ-7/HQ-12 decisions. Phase 3c v1 remains separate and unchanged:
registered dashboard/visual snapshots, 60–900 second TTL, default 300 seconds,
existing signatures, SDK, authorization and exact-origin checks.

## Resources and concurrency

`GET /api/embedding/config` and `PUT /api/embedding/config` require an active H2
membership and an H1 tenant administrator. Namespace-prefixed aliases retain H1
scope checks. PUT replaces the six original fields and accepts a surface ceiling. Unknown fields are rejected.
No request can assert a tenant, subject, role or asset owner.

```json
{
  "enabled": true,
  "allowedParentOrigins": ["https://product.example"],
  "embedOriginId": "canonical",
  "maxSessionSeconds": 300,
  "appearance": {
    "palette": "navy",
    "font": "system",
    "layout": "comfortable",
    "productName": "OpenSight",
    "iframeTitle": "OpenSight dashboard",
    "logoAssetId": null,
    "faviconAssetId": null
  },
  "surfaceCeiling": {
    "experiences": ["dashboard", "visual", "q", "console", "full-app"],
    "menus": ["navigation", "account"],
    "actions": ["authoring", "filtering", "parameterControls", "question"],
    "chrome": ["header"]
  },
  "features": {
    "registeredDashboards": true,
    "registeredVisuals": true,
    "parameterControls": false,
    "filtering": false,
    "anonymous": false,
    "authoring": false,
    "export": false,
    "download": false,
    "persistentReaderState": false
  }
}
```

Both methods return `{config, revision, capabilities, policy}` and a quoted numeric
`ETag`. A new tenant has revision `0`, disabled embedding, empty parent origins,
null origin/lifetime, default appearance and the feature values above. PUT
requires `If-Match: "0"` (or the current ETag); absence is 428
`EMBED_REVISION_REQUIRED`, malformed/wildcard/weak/multiple tags are 400, and stale
revisions are 412 `EMBED_CONFIG_REVISION_CONFLICT`. Unlike existing H1/H3 version
conflicts (409), this endpoint follows the embedding proposal's explicit 412
contract. Failed edits change neither config, revisions, sessions nor audit events.

The operator-owned `h5_embedding_config` table uses tenant/namespace foreign keys;
hosted startup initializes it idempotently alongside the existing schema. Do not
grant tenant SQL roles access to it. Every operation checks a server-issued
context, current tenant state, membership, authorization revision and admin role.
Writes serialize on the tenant row, replace config and increment its revision,
bump H1 configuration revision, revoke H2 sessions and append
`embedding.config.changed` in one transaction. All replacements, including
appearance-only changes, conservatively require fresh login. H3 revision checks
therefore also reject stale data publication. H4 admission/worker budgets remain
in force for data execution; config does not execute queries or add a data path.
H6 embed grants bind to this config revision and are invalidated by replacements.
This makes no claim of recalling an already delivered v1 snapshot.

### Full-app sessions (#336)

Registered `FullApp` sessions use these same tenant settings, exact parent
origins and lifetime ceilings; there is no additional product flag. Enable
`features.authoring` for analysis editing and preparation, and
`features.registeredDashboards` for dashboard access. Both the landing route and
each later operation check the relevant flag and the member's current
capabilities/resource grants. Anonymous full-app issuance is unsupported even
when `features.anonymous` is enabled. Ask O additionally requires an AI-capable
member and configured provider.

Changing any embedding configuration revision revokes existing full-app
sessions just as it revokes the fixed experiences. Saving an analysis through
the full-app editor keeps the session active because content saves follow the
standalone versioned analysis-write path. See [full-app issuance and authority](embed-sessions.md#full-app-experience-336-d-102-q1)
for the request shape, allowed routes and session behavior.

### Session attribute claims (#338)

The product backend sets `SessionTags` for each registered, delegated or
anonymous session at issuance. To scope a grant by account, enable the dataset's
`RowLevelPermissionTagConfiguration` and map the `account` tag key to its
physical account column. The claimed rows must also pass the registered
viewer’s source and dataset membership rules, and existing column permissions
apply. Missing or unusable tag rules deny the claimed read. These checks apply
with every appearance, surface ceiling and filtering setting.
See [session attribute claims](embed-sessions.md#session-attribute-claims-338).

### Surface ceiling (#337)

Each array above lists the surfaces that may appear in this tenant's H6 sessions.
Supply all four arrays when replacing the ceiling. Empty arrays exclude every
item in that group. Unknown fields, unknown names, duplicates and non-array
values return 422 `EMBED_SURFACE_INVALID` before the configuration write.

New tenants and stored configurations from before #337 use the full vocabulary
shown above. Existing feature flags and the issued principal and experience
still bound every mount. A legacy PUT that omits the whole ceiling preserves the
stored ceiling, including empty arrays. Successful replacements invalidate prior
sessions through the existing configuration revision.

An excluded experience cannot be issued. Other excluded controls stay hidden,
including when a host omits its declaration. Requesting a visible or disabled
control outside the ceiling or grant returns 403 `EMBED_SURFACE_DENIED`.
Required notices remain on fixed frames. See the [SDK mount contract](embed-sessions.md#per-embed-surface-control-337)
for control names, applicable experiences and examples.

## Operator configuration

Deployment configuration comes only from `OPENSIGHT_EMBEDDING_POLICY`, a JSON
environment value with exactly `origins`, `tenants` and `assets` arrays. Missing
configuration disables all tenant embedding grants; malformed configuration fails
startup with 503 `EMBED_OPERATOR_CONFIG_INVALID`. Arrays have at most 1,024
entries, origin lists at most 64 entries, and the environment value at most 8 MiB.

- `origins`: `{id, origin}` records. IDs are server-owned. Every origin must equal
  `OPENSIGHT_PUBLIC_ORIGIN` (canonical HTTPS); other hosts are refused pending H11.
- `tenants`: `{tenantId, allowedParentOrigins, embedOriginIds, maxSessionSeconds}`.
  Tenant IDs come from operator provisioning. Lists are exact allowlists; no
  wildcard, path, query, credentials, fragment, implicit port normalization or
  case normalization. HTTPS is required except explicit loopback HTTP development.
  Tenants can only narrow these lists. Origin violations return the same 403
  `EMBED_ORIGIN_DENIED`, without domain-owner or membership details.
- `assets`: `{id, tenantId, kind, pngBase64}` where kind is `logo` or `favicon`.
  These are operator-registered assets owned by that tenant. Tenant config can
  reference only matching IDs/kinds; unknown, foreign, URL and wrong-kind values
  all return 422 `EMBED_ASSET_UNAVAILABLE`. No upload endpoint or external fetch
  is provided. No asset bytes or other tenants' registry entries appear in config
  responses. PNGs must be noninterlaced 8-bit RGB/RGBA, at most 512×512 and 64 KiB.
  The validator checks signature, chunk lengths, CRCs and decompressed scanlines,
  bounds decompression, then re-encodes without metadata. SVG, animation, ancillary
  chunks, trailing data and malformed rasters are refused.

`policy` in the response lists only the current tenant's parent origins, available
embed IDs/canonical origins, lifetime ceiling and asset IDs/kinds. It is non-secret.
Existing config is revalidated against operator policy on every read; narrowing
policy never silently leaves a stale effective grant. An invalidated config can
be explicitly replaced using its last ETag (a 412 requires resolving the current
revision operationally if no valid GET remains). No signing key, redirect origin
or arbitrary asset URL is accepted in a request body.

Management requests require the trusted API host and, if supplied, its exact
Origin. They are not cross-origin parent application endpoints. Foreign host,
Origin or forwarded-host values on embedding routes return 403
`EMBED_ORIGIN_DENIED`; parent allowlists never authorize config administration.
No new CORS transport is introduced.

`maxSessionSeconds` is a positive safe integer at or below the operator's explicit
finite ceiling. Null means unset and is allowed only while disabled. H6 requests are 15–600
minutes, default 600; the example value above predates H6 and must be raised to at
least 900 to permit a session. H5 never applies it to the existing v1 TTL.

## Appearance and capability boundary

The appearance presets are `palette` (navy, teal, plum), `font` (system,
sans), and `layout` (comfortable, compact).
Product name is limited to 80 characters and iframe title to 160. Labels accept
Unicode letters/numbers, spaces and a small punctuation set. Markup, encoded
markup, URL syntax, control/bidi characters, event-handler attributes, CSS
`url()`/`expression()` and oversized inputs are rejected. React renders text as
text; no HTML insertion or dynamic style parser is used. Asset IDs only reference
the validated tenant-owned PNG registry described above.

### Design tokens (#339)

A tenant administrator can include an optional `tokens` object inside
`appearance` when replacing the configuration. Each member is optional.
Omitting `tokens` or sending `{}` restores preset styling. Existing stored
configurations need no migration.

| Token | Accepted values | Effect |
| --- | --- | --- |
| `surface` | Opaque six-digit hex color, e.g. `#fffaf1` | Frame, application surfaces and chart backgrounds |
| `text` | Six-digit hex color | Frame text and chart labels |
| `accent` | Six-digit hex color | Branding, navigation accents and controls |
| `chartPaletteSeed` | Six-digit hex color | First analysis palette color, including KPI values. Subsequent series keep their palette colors. Explicit per-visual palettes take precedence. |
| `fontFamily` | `system`, `sans`, `serif`, `mono` | Local system UI, Arial, Georgia or monospace stack |
| `radius` | JSON integer from 0 to 24 inclusive | Corner radius in CSS pixels |
| `density` | `compact`, `comfortable` | Frame and full-app spacing |

For example, include the following tokens alongside the preset and branding fields in the appearance object.

```json
{
  "tokens": {
    "surface": "#fffaf1", "text": "#302b25", "accent": "#814527",
    "chartPaletteSeed": "#ae633b", "fontFamily": "serif", "radius": 10,
    "density": "compact"
  }
}
```

Colors require a leading `#` and exactly six hexadecimal digits. Unknown
members, CSS declarations, functions such as `url()`, markup, unlisted fonts,
and values of the wrong type return HTTP 422 `EMBED_DESIGN_TOKENS_INVALID`.
The entire PUT fails, preserving the configuration, ETag, sessions and audit
history. A successful replacement follows the usual revision and renewal rules.
Choose readable text and accent colors for the intended surface.

Features describe consumption capabilities and never grant resource or data
permissions. Registered dashboard/visual consumption, anonymous embedding,
authoring, filtering and parameter controls can be true. Filtering and parameter
controls remain **false by default**, as do anonymous embedding and authoring.
Issue #335 (D-102 Q3) enables real controls in live H6 dashboard/visual sessions:
`filtering` exposes editable category filters; `parameterControls` exposes typed
parameters used by those visuals, including parameter-bound filters and calculated
fields. Both use the existing planner with the viewer's RLS/CLS. See the
[state contract](embed-sessions.md#filtering-and-parameter-controls-335).

A disabled flag hides its controls and rejects even an empty submitted state map
with 403 `EMBED_FEATURE_DISABLED`. Replacing config invalidates existing sessions,
including when a flag is turned off. Appearance never changes this authority.
Unsupported true flags and unknown flag names return 422
`EMBED_FEATURE_UNSUPPORTED`; export, download and persistent reader state must
remain false. Phase 3c snapshots and the H5 offline preview have no live data
session and do not display simulated filtering or parameter controls.

## Decided scope and remaining boundaries

HQ-5 permits narrow appearance/chrome changes; required OpenSight notices remain.
HQ-6 enables anonymous embedding and registered authoring in H6. Export/download
and persistent reader state remain rejected. HQ-7/HQ-12 session lifetimes, native
issuance shapes, single-use bootstrap and versioned browser transport are
implemented in [H6](embed-sessions.md). The historical H5-only refusal of session
issuance no longer describes current behavior.

HQ-9/H11 remains separate: custom embed origins cannot enter the registry. Domain
operations return 422 `EMBED_FEATURE_UNSUPPORTED`. No DNS, certificates, redirects,
AWS or external calls are part of these implementations.

No dependencies are added. Tests run under root `npm test`, including v1
regressions and explicit appearance/origin/ownership bypass attempts.

## Offline preview and capture

`npm run build:demo --workspace=@opensight/web` builds the main static demo, v1
renderer and `packages/web/dist/opensight-embed-preview.html`. Open that last file
locally: it has four real iframes for loading, empty, permission error and expiry.
The OpenSight and synthetic Atlas presets exercise approved palette/font/layout
choices, plain product/title text and local validated-format logo/favicon PNGs.
Choose **Cedar sample · design tokens**, then **Light** or **Dark** under
**Host context** to compare two synthetic token sets in the same renderer.
See the [light capture](images/embed-tokens-light.png) and [dark capture](images/embed-tokens-dark.png).
The v1 renderer shares these state components with its fixed default appearance;
H5 tenant branding is not silently applied to legacy v1 URLs.

`node packages/web/scripts/capture-embed-preview.mjs` uses the loop's existing
`playwright-core` and Chromium installation, blocks all external HTTP requests,
asserts frame titles, state/permission text, notices, raster assets, forbidden
controls, overflow and computed token styles, and writes fourteen screenshots to
`/tmp/h5-embed-preview`. These include both Cedar host contexts, the original
preset matrices and individual states, an alternate palette and a mobile view. Override the tool directory,
browser executable or output directory with `OPENSIGHT_SCREENSHOT_TOOLS`,
`OPENSIGHT_CHROMIUM` or `OPENSIGHT_SCREENSHOT_OUTPUT`. No package/browser download
is part of this command. Shared component and injection regression tests run in
root `npm test`; browser assertions run separately using this local harness.
