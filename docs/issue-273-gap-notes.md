# Issue #273 — S3 file source verification

Implemented the supplied issue-273 run brief on
`work/issue-273-s3-file-source`, with checkpoint commits for each item.
`SOLUTION_DESIGN.md` and `.github/workflows/*` are unchanged. No AWS calls,
external network access, deployment, merge or push were performed. An offline
`npm install` attempt found no registry cache; the query-engine manifest and
lockfile were updated to reuse the already-installed, license-verified S3 SDK
3.1149.0 without downloading packages.

## Behavior and scope

See [S3 resources, configuration and semantics](connector-s3.md). S3 uses the
existing file parser and contained hosted prep/DuckDB path. It has a dedicated
config schema, explicit environment-resolved credentials, operator allowlisting,
bounded streaming and prefix listing, sanitized named errors and cancellation.
The stored source is an expiring, owner-scoped snapshot with encrypted rows;
its config contains environment names and plain bucket/key/prefix only.
S3 Analytics remains a hosted stub.

All five brief items are implemented. The current web source dialog still
excludes AWS connectors; the supported provisioning surface is the hosted API.
There is no automatic S3 refresh. These are documented implementation boundaries
of the file-source path, not claims of hosted UI or live-account verification.
**Tom's verification in his own AWS account remains his follow-on.**

## Focused verification

The final focused run passed **158 / failed 0 / skipped 0**. It covers registry
validation; all five file formats; fake SDK request shapes; CSV through the hosted
API into an aggregated prepared dataset; shared parser errors; declared and
actual XLSX uncompressed-size guards; pre-read and streaming byte ceilings;
prefix page/count caps and metadata-only output; environment-only stored config;
missing object/bucket/credentials and access denial; timeout/cancellation;
owner/tenant/build-role bypass attempts; policy/configuration revocation; source
expiry and restart; atomic failure; and serverless route admission.

The first full-suite attempt caught stale generated edge artifacts after the
shared route allowlist change. Both packaged copies were regenerated, and an
explicit S3 browse/neighbor-denial regression was added. The focused edge and
ingress run then passed **22 / failed 0 / skipped 0** before restarting the full
suite. This changes packaged source only; no CloudFront deployment occurred.

Tests are included by the existing query-engine and API test globs in root
`npm test`. No test uses live S3. Strict TypeScript builds passed. Focused API
checks required loopback listeners and the existing contained-worker processes;
the sandbox blocks those, so they were run with the required local permissions.

## Static demo review

Rebuilt the demo and embed entries with
`npm run build:demo --workspace @opensight/web`. Headless Chromium captured the
prior and rebuilt local demo at 1280 × 800, with all external HTTP requests
blocked. Dashboard, Create data source and Create dataset captures each have
**zero changed pixels**. Neither capture reported page errors, external requests
or horizontal overflow. The browser artifact contains no S3 SDK command code.

Compared with `qs-2026/qs-data-create-datasource.jpg`, the source dialog retains
the centered overlay, search, connector tiles and footer controls. Existing
catalog breadth, icon, spacing and surrounding-chrome differences remain;
there is no new visible gap to file. The active dialog still excludes AWS, so
this API change needs no README screenshot or hero GIF refresh. QuickSight
visual fidelity remains unmeasured. The rebuilt artifact is a local static demo,
not a deployed server.

Logs, screenshots and pixel counts are retained in the ignored
`.opensight/issue-273-verification/` directory.

## Supervisor full-suite verification (2026-11-16)

The Codex build's own full-suite run was cut off by the supervisor's launch
timeout after item 5. The supervisor (Muse) committed item 5 and reran the
full root suite independently: all 10 workspaces ran — node totals
**5,482 tests / 5,444 passed / 1 failed / 37 skipped**, plus the Python SDK's
32 tests (OK). The single failure was the H4 measured two-tenant flood test
in `packages/api/test/containment.test.mjs`: one execution took 3,170 ms
against the 3-second ceiling under full-suite load on the shared-CPU VM.
Rerun in isolation it passes **6 / 6** (max execution 1,393 ms). This is the
known load-sensitivity class recorded in AGENTS.md for this test, unrelated
to the S3 changes (which touch no containment code).

## Checkpoint commits and files

| Item | Commit | Scope |
| --- | --- | --- |
| 1 | `717453cf` | Registry, config validation and honest state |
| 2 | `d7d096f1` | SDK dependency and bounded S3 source module |
| 3 | `e5945282`, `f5d51f7a` | Hosted source creation, browse and normal prep integration |
| 4 | `077e276d` | Fake-SDK formats, guards, errors and security regressions |
| 5 | This checkpoint | Documentation, changelog, demo review and full-suite evidence |

**Item 1 files:**

- `packages/query-engine/src/connectors.ts`
- `packages/query-engine/test/connectors.test.mjs`

**Item 2 files:**

- `package-lock.json`
- `packages/query-engine/package.json`
- `packages/query-engine/src/index.ts`
- `packages/query-engine/src/source-s3.ts`
- `packages/query-engine/src/upload.ts`
- `packages/query-engine/test/source-s3.test.mjs`

**Item 3 files:**

- `packages/api/src/hosted-data-routes.ts`
- `packages/api/src/hosted-data.ts`
- `packages/api/src/hosted-server.ts`
- `packages/api/src/hosted-sources.ts`
- `packages/api/src/runtime-ingress.ts`
- `packages/api/src/serverless-application.ts`
- `packages/api/src/source-maintenance.ts`
- `packages/api/src/source-s3-config.ts`
- `packages/api/src/source-schema.ts`
- `packages/api/test/runtime-ingress.test.mjs`
- `packages/api/test/source-http.test.mjs`
- `packages/api/test/source-s3-helpers.mjs`
- `packages/api/test/source-s3.test.mjs`

- `ops/serverless/edge-viewer.js`
- `ops/serverless/modules/edge/edge-viewer.js`
- `packages/api/test/edge-viewer.test.mjs`

**Item 4 files:**

- `packages/api/test/source-s3-errors.test.mjs`
- `packages/query-engine/test/source-s3.test.mjs`
- `packages/query-engine/test/upload-fixtures.mjs`
- `packages/query-engine/test/upload.test.mjs`

**Item 5 files:**

- `CHANGELOG.md`
- `docs/connector-s3.md`
- `docs/connector-registry.md`
- `docs/connector-gallery.md`
- `docs/connector-file-upload.md`
- `docs/connector-athena.md`
- `docs/issue-273-gap-notes.md`
