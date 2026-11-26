# Issue #334 — completed migration sequence

This branch is `work/issue-334-migration-extractor`. The supplied D-97 ruling and
approved addendum govern the implementation. No merge, push, deployment or live
AWS verification was performed. `SOLUTION_DESIGN.md` is unchanged.

The reboot resume began with a clean tree at `238d7bac`. Earlier checkpoint
commits were preserved. Work resumed at item 4, after the verified extractor and
shared-report slice; no earlier checkpoint was rebuilt as a new implementation.

## Q6 sequencing

| Q6 step | Work items | State |
| --- | --- | --- |
| 1. Extractor and shared report | 1–3 | Complete in prior checkpoints |
| 2. v1 import and report read | 4 | Complete — atomic persistence, authoring admission and member-scoped reads |
| 3. MCP migration flow | 5 | Complete — two generated tools, existing remap tools and member action history |
| 4. Ask O guidance | 6 | Complete — deterministic commands and fingerprint-grouped proposals; no auto-apply |

Documentation, changelog, negative tests and README imagery are updated for the
complete sequence (items 7–8). Final root verification is recorded below.

## Checkpoints and files

Prior commits, retained unchanged:

- `138207f1`: decided D-97 and architecture-register link (item 1).
- `e784857a`: shared versioned report, fingerprints and coverage (item 2).
- `0df0f1a1`: extractor, mocks, manifest diff and IAM policy (item 3).
- `699b5be3`: initial extractor guide and changelog.
- `91fb0fd6`: credential/report boundaries and inventory-loading regression.
- `39c088c6`: keep unused report initialization out of embed artifacts.
- `238d7bac`: prior full-suite verification: 8,639 passed / 0 failed / 38 skipped.

The following file inventories are taken directly from the resumed checkpoints.
Shared registry generation is in item 4 so CLI/SDK/MCP inventory stays in parity;
item 5 proves the real MCP migration flow.

### Item 4 — v1 import and report read (`62c8700c`)

- `docs/api/openapi-v1.yaml`
- `docs/migration-extractor.md`
- `packages/api/src/metadata-resources.ts`
- `packages/api/src/metadata-schema.ts`
- `packages/api/src/metadata.ts`
- `packages/api/src/migration-model.ts`
- `packages/api/src/migration-routes.ts`
- `packages/api/src/v1-audit-operations.ts`
- `packages/api/src/v1-route-contract.ts`
- `packages/api/src/v1-routes.ts`
- `packages/api/test/metadata.test.mjs`
- `packages/api/test/v1-migration.test.mjs`
- `packages/bundle-parser/src/browser.ts`
- `packages/bundle-parser/src/index.ts`
- `packages/bundle-parser/src/migration-report.ts`
- `packages/bundle-parser/src/migration-security.ts`
- `packages/cli/scripts/generate.mjs`
- `packages/cli/src/generated.ts`
- `packages/cli/test/openapi-coverage.test.mjs`
- `packages/headless-sdk-python/src/opensight_headless/client.py`
- `packages/headless-sdk-python/test/test_openapi_coverage.py`
- `packages/headless-sdk/src/client.ts`
- `packages/headless-sdk/src/types.ts`
- `packages/headless-sdk/test/openapi-coverage.test.mjs`
- `packages/mcp-server/src/generated.ts`
- `packages/mcp-server/test/openapi-coverage.test.mjs`
- `packages/migration-extractor/src/resources.ts`
- `packages/web/package.json`
- `packages/web/tsconfig.server.json`

### Item 5 — MCP migration flow (`7391dd9f`)

- `docs/connectable-mcp.md`
- `docs/headless-v1-mcp.md`
- `packages/api/test/mcp-governance.test.mjs`
- `packages/api/test/mcp-oauth.test.mjs`
- `packages/mcp-server/test/hosted.test.mjs`
- `packages/mcp-server/test/http.test.mjs`
- `packages/mcp-server/test/transport-auth.test.mjs`

### Item 6 — Ask O guidance and boundary follow-ups (`f4c13bcf`)

- `docs/api/openapi-v1.yaml`
- `package-lock.json`
- `packages/api/src/hosted-ai.ts`
- `packages/api/src/metadata-schema.ts`
- `packages/api/src/migration-routes.ts`
- `packages/api/src/o-generative.ts`
- `packages/api/src/o-migration.ts`
- `packages/api/test/hosted-ai.test.mjs`
- `packages/cli/src/dispatch.ts`
- `packages/cli/src/generated.ts`
- `packages/cli/src/help.ts`
- `packages/headless-sdk/package.json`
- `packages/headless-sdk/src/client.ts`
- `packages/headless-sdk/src/index.ts`
- `packages/headless-sdk/src/types.ts`
- `packages/mcp-server/src/generated.ts`
- `packages/o-interpreter/package.json`
- `packages/o-interpreter/scripts/generate-migration-policy.mjs`
- `packages/o-interpreter/src/index.ts`
- `packages/o-interpreter/src/migration-policy.generated.ts`
- `packages/o-interpreter/src/migration.ts`
- `packages/o-interpreter/test/migration.test.mjs`
- `packages/web/src/OEntry.tsx`
- `packages/web/src/OMigration.tsx`
- `packages/web/src/style.css`
- `packages/web/test/o-migration.test.mjs`

### Cross-path UI follow-up (`4dd04ec7`)

The hosted guide can load a stored import by ID through the existing governed
Ask O operation, so a CLI/SDK/MCP import can continue in-product. A member switch
invalidates pending answers before display. This closes a gap found during final
review without adding an operation or relaxing report authorization.

- `packages/web/src/OMigration.tsx`
- `packages/web/src/api-client.ts`
- `packages/web/src/access.tsx`
- `packages/web/test/o-migration.test.mjs`
- `packages/web/scripts/persona-journeys/j10-ai-agent-mcp.mjs` (60-tool inventory)

### Generated edge follow-up (`09050745`)

Full-suite verification found stale serverless edge artifacts. Both copies were
regenerated from the shared route contract. Equivalent POST checks share one
branch to keep the generated artifact at 9,971 bytes, below the unchanged 10,000
byte ceiling. The boundary tests cover both new routes, the 128-character import
ID limit, namespace scoping and rejection of extraction/neighboring paths.

- `packages/api/src/v1-route-contract.ts`
- `packages/api/test/edge-viewer.test.mjs`
- `ops/serverless/edge-viewer.js`
- `ops/serverless/modules/edge/edge-viewer.js`

### Embed artifact follow-up (`a10a237c`)

The root response-envelope test caught the 138 bytes of migration CSS included
in the embed shell. Moving those rules from `style.css` to the existing app-only
`app-chrome.css` preserves the guide layout and restores the embed artifact to
1,572,164 bytes. The actual CSP/nonce response-envelope test passes without any
limit or assertion change.

- `packages/web/src/style.css`
- `packages/web/src/app-chrome.css`

### Items 7–8 — completion documentation and verification

- `docs/migration-extractor.md`, this note, `docs/headless-v1-cli.md`,
  `packages/migration-extractor/README.md`, `README.md`, `CHANGELOG.md`.
- `docs/images/opensight-tour.gif`, `docs/images/q-side-panel.png`,
  `docs/images/o-answer.png`, `docs/images/migration-guide.png`.
- Tests remain beside their implementation and are included by root `npm test`.
  The site generator consumes none of the updated migration/headless pages;
  generated site pages need no content update. Root tests include site checks.

## Resolved specification details

The existing per-asset `ImportResult` and API definition projection were extended
in the prior slice, not replaced by parallel formats. Every surface consumes the
same portable report; session-local names, paths and diagnostic text are excluded.
Findings preserve distinct clean, deliberate-difference and failed-closed buckets.

Existing authoring requires resolved dataset links. The new hosted import stores
originals and the report in a member-owned `migration-import` metadata resource,
and atomically creates only supported, fully bound working analyses. Dataset and
source definitions, unresolved bindings and unsupported constructs remain staged,
without execution capability. Existing source/prep and analysis tools handle the
reviewed remap. Dashboards become unpublished working analyses, explicitly
reported as a deliberate difference. Nothing publishes or copies source grants.
No binding validation was relaxed. Immutable reports remain historical evidence;
a new import with `previousImportId` compares finding kinds after remediation.

Exactly two new v1 operations are registered: `import_bundle` and
`read_import_report`. CLI, both SDKs and MCP cover them. The read returns the exact
persisted report under tenant/namespace/importing-member scope, including against
another administrator. Extraction never becomes an MCP operation. Direct hosted
HTTP accepts at most 16 MiB; existing smaller MCP/serverless envelope limits still
apply. Large migrations should use smaller customer-selected bundles.

Ask O guidance uses the existing deterministic interpreter path, available without
a provider. It generates repository-root extractor commands for shell/auth choices
and verifies policy action copy against the shipped IAM artifact. Server-side
post-import guidance resolves a member-owned report by ID, never from a supplied
report body. Suggestions contain no patch or apply action: each requires review
and confirmation through normal authoring. This standard interpreter path uses no
AI credits or spend. Managed generative delivery charging, spend caps and retry
receipts remain unchanged and their regression tests still run.

Earlier extraction details remain: DescribeDataSet supplies dataset definitions
(the SDK has no DescribeDataSetDefinition); List APIs are account/region scoped,
not namespace-filtered. Asset export is a documented customer-run fallback, not
an export job performed by this CLI. Synthetic fixtures and sanitized export
shapes provide coverage, not live service verification or measured parity.

## Verification

Targeted runs passed:

- Import/metadata: 15 passed, including member/tenant denial, credentials,
  unsupported staging, collision rollback and atomic durable retry receipts.
- MCP: 86 passed, including import → exact report → existing authoring remap,
  audit attribution, other-member denial and absence of extraction tools.
- API/Ask O governance: 41 passed, including unchanged credits/spend, no writes
  from guidance, forbidden report/apply inputs and current permissions.
- Interpreter: 46 passed, including policy drift, shell-input rejection,
  grouped fingerprints, deliberate differences and report-tampering rejection.
- CLI: 80 passed, including every generated operation's SDK transport mapping.
- Generated edge: 15 passed, including migration route admission and denials.
- Embed envelope: 1 focused CSP/nonce response check passed after placing the
  migration styles in the app-only stylesheet.
- UI: 24 Ask O and migration-guide checks passed; guidance cannot dispatch edits.
  Stored-report loading discards late answers after a member switch.

The initial sandboxed HTTP test attempt was denied localhost listeners (`EPERM`).
Those tests were rerun with local fixture-server access. No assertions or skips
were weakened. No network beyond local fixtures and no AWS requests were used.

The first resumed full run was stopped after its generated-edge freshness check
failed. The stale artifacts were corrected before restarting the root suite;
the incomplete run is not included in the final totals below.

The next run encountered the existing H4 two-tenant flood timing assertion:
maximum execution was 3,535.75 ms against its unchanged 3,000 ms ceiling. That
check passed in the earlier run. No timing thresholds or security assertions
were relaxed. The fresh full run passed this check at 1,537.67 ms maximum
execution with the same ceiling.
The earlier failing run also exposed the embed-envelope regression above; the
corrected artifact passed the independent response-level check.
Its API section finished at 1,664 passed / 2 failed / 36 skipped before the run
was stopped. The isolated H4 retry passed at 1,641.48 ms maximum execution with
the same 3,000 ms ceiling. Neither incomplete run contributes to final totals.

Final verification on 2026-11-26: root `npm test` exited **0** with
**8,660 passed / 0 failed / 38 skipped**, across 8,698 tests. There were no
cancelled tests or TODOs. All 38 skips require live PostgreSQL (36 API,
2 query-engine); no other skips were accepted. A local Chromium wrapper was
used for the offline browser tests. The complete run includes web and root
conformance/site checks.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| `@opensight/api` | 1,666 | 0 | 36 |
| `@opensight/bundle-parser` | 218 | 0 | 0 |
| `@opensight/cli` | 80 | 0 | 0 |
| `@opensight/embedding-sdk` | 10 | 0 | 0 |
| `@opensight/headless-sdk` | 33 | 0 | 0 |
| `opensight-headless-sdk-python` | 34 | 0 | 0 |
| `@opensight/mcp-server` | 86 | 0 | 0 |
| `@opensight/migration-extractor` | 12 | 0 | 0 |
| `@opensight/o-interpreter` | 46 | 0 | 0 |
| `@opensight/parity` | 11 | 0 | 0 |
| `@opensight/query-engine` | 2,731 | 0 | 2 |
| `@opensight/web` | 3,613 | 0 | 0 |
| `root-conformance` | 120 | 0 | 0 |
| **Total** | **8,660** | **0** | **38** |

## Static demo and imagery

The final demo was rebuilt from source; it is a local static artifact, not a
deployed server. The embedded-session artifact is 1,572,164 bytes, with the
existing response-size limit unchanged.

Three reference captures completed with **0 page errors / 0 external requests**.
At the existing masks and tolerance 16, pixel differences are **41.22% classic
editor / 33.96% new-look editor / 45.30% Q surface**. The reference states remain
visually unchanged from the first checkpoint; these percentages are pixel
differences, not fidelity grades. No new reference-comparison gap was identified.

The new migration guide was also captured at 390, 768 and 1440 pixels wide with
no panel/page horizontal overflow, page errors or external requests. README's
hero GIF was regenerated from the required `readme-gif.mjs` storyboard, adapted
only to this checkout's demo path, current navigation helper and Chromium wrapper,
then assembled with its ffmpeg palette commands. The affected Q panel and local
CSV answer images were refreshed, and the migration-guide screenshot was added.
The local API/browser acceptance flow verified 17 actual synthetic queries,
including CSV totals North 6 / South 3, with 0 page errors / 0 external requests.
No credentials or customer content appear in the screenshots.

Detailed logs, comparison pairings and capture evidence stay in ignored
`.opensight/issue-334/` and local `/tmp/issue334-*` files.
