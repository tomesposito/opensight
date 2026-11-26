# Issue #334 — extractor/report checkpoint

This build follows the supplied D-97 ruling and approved addendum. The branch
is `work/issue-334-migration-extractor`. It completes Q6 step 1 (extractor and
shared report contract); Q6 steps 2–4 remain unimplemented. The precise remaining
work and acceptance cases are in [the migration guide](migration-extractor.md#verification-and-remaining-sequence).
No merge, push, deployment or live AWS verification is part of this checkpoint.

## Sequencing and files

Build work item 1 records the decision before code:

- `docs/idd/D-97-quicksight-migration.md`
- `docs/hosted-architecture.md`

Build work item 2 extends the existing import result and shares the projection:

- `packages/bundle-parser/src/migration-report.ts`
- `packages/bundle-parser/package.json`
- `packages/bundle-parser/src/definition-converter.ts`
- `packages/bundle-parser/src/index.ts`
- `packages/bundle-parser/src/browser.ts`
- `packages/bundle-parser/test/migration-report.test.mjs`
- `packages/web/src/authoring.ts`
- `packages/web/src/bundle-authoring.ts`
- `packages/web/src/definition-converter.ts`
- `packages/web/src/migration-report.ts`
- `packages/web/test/migration-report.test.mjs`

Build work item 3 provides the CLI and wires its JSON envelope into local import:

- `package-lock.json`
- `packages/migration-extractor/package.json`
- `packages/migration-extractor/tsconfig.json`
- `packages/migration-extractor/LICENSE`
- `packages/migration-extractor/scripts/build.mjs`
- `packages/migration-extractor/policy/read-only.json`
- `packages/migration-extractor/src/aws.ts`
- `packages/migration-extractor/src/cli.ts`
- `packages/migration-extractor/src/files.ts`
- `packages/migration-extractor/src/index.ts`
- `packages/migration-extractor/src/resources.ts`
- `packages/migration-extractor/test/extractor.test.mjs`
- `packages/migration-extractor/test/fixtures/README.md`
- `packages/migration-extractor/test/fixtures/describe-analysis.json`
- `packages/migration-extractor/test/fixtures/describe-dataset.json`
- `packages/bundle-parser/src/archive-core.ts` and the parser entry points above
- `packages/api/src/store.ts`
- `packages/api/test/migration-bundle-json.test.mjs`

Build work items 4–6 (Q6 steps 2–4) add no runtime operations here. The remaining
v1 work needs atomic, member-owned import/report persistence and explicit handling
of unresolved definitions. Existing authoring validates bindings before storage;
that guard was not relaxed. MCP still has 58 v1 operations and no extraction
operation. Ask O governance and authoring confirmation paths are unchanged.

Build work item 7 documents the delivered slice in `docs/migration-extractor.md`,
`packages/migration-extractor/README.md`, this note and `CHANGELOG.md`. The public
site generator consumes none of these new pages, so generated site pages stay
unchanged. Work item 8 includes all tests above plus the explicit no-extraction
transport test in `packages/mcp-server/test/openapi-coverage.test.mjs`. Deferred
v1/MCP/Ask O acceptance tests remain paired with their deferred implementations.

## Resolved specification details

The actual per-asset report lives in the web importer, not DefinitionStore.
`ImportResult` was moved into bundle-parser and extended; the web module re-exports
it. Portable serialization removes session-only names, paths and diagnostic text.
The shared API projection was moved unchanged from the web converter rather than
introducing another conversion engine. The old module remains a re-export.

DescribeDataSet supplies dataset definitions; the installed SDK has no
DescribeDataSetDefinition. List APIs are account/region scoped, with no namespace
filter. The CLI states that limit. The existing importer accepted single-member
JSON or ZIP, so its existing QsBundle envelope now also has a bounded JSON transport.

Portable coverage counts explicit import units conservatively, without claiming
numerical or visual parity. Existing supported Insight computations stay supported;
malformed/unsupported constructs retain their current fail-closed behavior. The
asset-export alternative is a documented unavailable seam, not a stub that claims
it ran. Only the customer/Tom can perform live AWS verification.

## Verification notes

The full-suite attempt caught an envelope-detection regression: a pre-existing
inventory summary also has a `members` array. Detection now requires a resource-
bearing envelope, validates the complete bundle before ingesting any member, and
has a directory-loading regression case. All 11 affected local-store/Blaze tests
passed after that correction. Report serializers also reject arbitrary runtime
enum/timestamp content, and canonical digests use locale-independent key ordering.

The embedded-response regression test also caught unused report initialization
entering the embed bundle through the parser barrel. The converter now has a
dedicated package entry point, and the immutable report vocabulary is marked as
pure initialization so unused exports can be removed. The embed-session artifact
shrunk by 2,473 bytes to 1,572,164 bytes. The existing response-size, CSP/nonces and
no-store test passes with its original limits and assertions.

An earlier full-suite attempt overlapped with demo compilation and failed the
existing H4 timing ceiling. That test passed in isolation without changes. The
final root run runs without concurrent builds or browser captures.

The targeted parser run passed 218 tests, the targeted converter/import run passed
100 tests, and the extractor's initial complete run passed 12 tests. The explicit
MCP no-extraction transport case passed with zero requests. Final root counts and
static-demo evidence are recorded below.

The final **root `npm test` exited 0: 8,639 passed / 0 failed / 38 skipped**
(8,677 total; 0 cancelled / 0 todo). All skips require live PostgreSQL: 36 in
the API and 2 in the query engine. Fixture servers and local Chromium ran with
`OPENSIGHT_CHROMIUM` pointing to the environment's Chromium wrapper. No AWS
requests or spend occurred.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,658 | 0 | 36 |
| Bundle parser | 218 | 0 | 0 |
| CLI | 78 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK (TypeScript) | 33 | 0 | 0 |
| Headless SDK (Python) | 34 | 0 | 0 |
| MCP server | 83 | 0 | 0 |
| Migration extractor | 12 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity tooling | 11 | 0 | 0 |
| Query engine | 2,731 | 0 | 2 |
| Web | 3,609 | 0 | 0 |
| Root conformance and site | 120 | 0 | 0 |

The final run includes the inventory-summary regression, embedded-response
size/CSP check, existing H4 timing ceiling, all new migration-report/extractor
tests and MCP no-extraction assertion. The log and machine-readable totals are
retained locally in ignored `.opensight/issue-334/`.

## Static demo comparison

The final static demo was rebuilt after the implementation settled. Three
reference captures completed with **0 page errors / 0 external requests**.
Using the existing pairings, masks and tolerance 16, pixel differences were
**41.22% classic editor / 33.96% new-look editor / 45.30% Q surface**. The deltas
against the prior issue-282 baseline were +0.0001 / -0.0013 / 0.0000 percentage
points, respectively. These are pixel differences, not fidelity grades. No new
visual gap was identified. The rendered editor controls and layout did not
change, so existing README imagery remains representative and was not regenerated.
The demo is a local static artifact, not a deployed server. Captures and pairing
reports are retained only in ignored `.opensight/issue-334/`.
