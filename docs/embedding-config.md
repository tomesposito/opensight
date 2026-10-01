# H5: embedding configuration and appearance (#25)

H5 adds durable tenant configuration and an offline appearance preview. It does
not issue hosted embed sessions. H6 depends on HQ-7; `enabled: true` is stored
intent, not a way to bypass that gate. Phase 3c v1 remains separate and unchanged:
registered dashboard/visual snapshots, 60–900 second TTL, default 300 seconds,
existing signatures, SDK, authorization and exact-origin checks.

## Resources and concurrency

`GET /api/embedding/config` and `PUT /api/embedding/config` require an active H2
membership and an H1 tenant administrator. Namespace-prefixed aliases retain H1
scope checks. The body replaces all six fields below; unknown fields are rejected.
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
Future H6 embed grants must bind to this config revision. H5 has no such grants to
revoke and makes no claim of recalling an already delivered v1 snapshot.

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
finite ceiling. There is no selected H6 default or product cap: null means unset
and is allowed only while disabled. The example value above is illustrative, not
a product decision. H5 never applies it to the existing v1 TTL.

## Appearance and capability boundary

Approved tokens are `palette: navy|teal|plum`, `font: system|sans`, and
`layout: comfortable|compact`. They select fixed styles, not caller-supplied CSS.
Product name is limited to 80 characters and iframe title to 160. Labels accept
Unicode letters/numbers, spaces and a small punctuation set. Markup, encoded
markup, URL syntax, control/bidi characters, event-handler attributes, CSS
`url()`/`expression()` and oversized inputs are rejected. React renders text as
text; no HTML insertion or dynamic style parser is used. Asset IDs only reference
the validated tenant-owned PNG registry described above.

Features describe consumption capabilities and never grant resource or data
permissions. Only registered dashboard/visual consumption can be true. All
unsupported true flags and unknown flag names return 422
`EMBED_FEATURE_UNSUPPORTED`; known unsupported flags must be false. This includes
parameter controls and filtering: Phase 3c snapshots have no interactive data
session, so H5 does not display simulated controls.

## Deliberate fail-closed divergences and open decisions

- **HQ-5:** appearance is configuration plus an explicitly labeled offline iframe
  theme preview. No authoring-app, email, export, help-link or light/dark policy is
  inferred. OpenSight attribution, fixture warnings, permission/error details and
  legal-notice placement cannot be removed by theme fields. This slice does not
  decide entitlement or branding-removal policy.
- **HQ-6:** anonymous embedding, embedded authoring, export/download and persistent
  reader state remain rejected. Registered dashboard/visual consumption is the
  supported capability scope, still subject to H1–H4 authorization and admission.
- **HQ-7/H6:** `/api/embedding/sessions` and subresources return 503
  `EMBEDDING_NOT_CONFIGURED` after authentication. No new signing, bootstrap,
  renewal, browser credential or lifetime contract is implemented. Hosted mode
  retains its refusal to fall back to fixture/v1 data stores.
- **HQ-9/H11:** customer embed origins cannot enter the registry. Authenticated
  domain operations return 422 `EMBED_FEATURE_UNSUPPORTED`, without disclosing
  claims or ownership. No DNS, certificates, redirects, AWS or external calls.

No dependencies are added. Tests run under root `npm test`, including v1
regressions and explicit appearance/origin/ownership bypass attempts.

## Offline preview and capture

`npm run build:demo --workspace=@opensight/web` builds the main static demo, v1
renderer and `packages/web/dist/opensight-embed-preview.html`. Open that last file
locally: it has four real iframes for loading, empty, permission error and expiry.
The OpenSight and synthetic Atlas presets exercise approved palette/font/layout
choices, plain product/title text and local validated-format logo/favicon PNGs.
The v1 renderer shares these state components with its fixed default appearance;
H5 tenant branding is not silently applied to legacy v1 URLs.

`node packages/web/scripts/capture-embed-preview.mjs` uses the loop's existing
`playwright-core` and Chromium installation, blocks all external HTTP requests,
asserts frame titles, state/permission text, notices, raster assets, forbidden
controls and overflow, and writes twelve screenshots to `/tmp/h5-embed-preview`.
The eight per-state/brand captures, two full matrices, alternate palette and
mobile-width view cover the acceptance states. Override the tool directory,
browser executable or output directory with `OPENSIGHT_SCREENSHOT_TOOLS`,
`OPENSIGHT_CHROMIUM` or `OPENSIGHT_SCREENSHOT_OUTPUT`. No package/browser download
is part of this command. Shared component and injection regression tests run in
root `npm test`; browser assertions run separately using this local harness.
