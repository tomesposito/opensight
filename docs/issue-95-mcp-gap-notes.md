# Issue #95 MCP slice — review gate and baseline verification

2026-10-13, branch `work/issue-95-mcp`. This checkpoint contains a
contract proposal and draft IDD D-42. **The MCP implementation is
blocked on product review**, as required by the frozen contract's rule
that product-shaped questions come back for review rather than freezing
silently. The [slice document](headless-v1-mcp.md) names the eight
questions and the exact resume boundary. No MCP server, tool,
transport, or dependency is claimed as implemented.

## Verification

Full root `npm test` exited 0: **2,664 tests: 2,646 passed / 0 failed /
18 skipped / 0 cancelled**. The slice document records the totals.
All skips explicitly require live PostgreSQL (`DATABASE_URL` is unset;
the local Postgres on :5433 was up, but the suite only runs the live
tests when `DATABASE_URL` is set). Full per-suite log:
`~/workspace/goals/opensight/hidden_files/test-logs/issue-95-mcp-npm-test.log`
(kept out of the repo).

| Suite | Tests | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| API | 529 | 513 | 0 | 16 |
| Bundle parser | 199 | 199 | 0 | 0 |
| Embedding SDK | 10 | 10 | 0 | 0 |
| Interpreter | 32 | 32 | 0 | 0 |
| Parity | 11 | 11 | 0 | 0 |
| Query engine | 506 | 504 | 0 | 2 |
| Web | 1,320 | 1,320 | 0 | 0 |
| Root conformance | 57 | 57 | 0 | 0 |
| **Total** | **2,664** | **2,646** | **0** | **18** |

`node ~/workspace/goals/opensight/hidden_files/build-demo-shim.mjs`
rebuilds the static demo after publish. This is not a deployed server.
Runtime sources, dependency manifests, `SOLUTION_DESIGN.md` and
`docs/api/openapi-v1.yaml` match the master base (`5ad73972`).
Document links resolve locally and `git diff --check` passes. Nothing
was merged or pushed at the time this checkpoint was written; there
were no new dependencies or AWS calls.

## Corrections and groundings from the code

While grounding the proposal, two details were verified against the
implementation rather than assumed from the slice docs:

- The v1 DELETE dataset response is `{ id, removed: true }`
  (`packages/api/src/v1-routes.ts`); the v1 PUT dataset response is
  the save summary `{ id, name, version, execution }`, not the full
  composed describe. The slice document's tool table records the
  latter exactly.
- The OpenAPI spec's 11 implemented operations carry only one
  `operationId` (`runDatasetQuery`, camelCase). The proposal's tool
  names are the snake_case mechanical mapping; adding snake_case
  `operationId` values to all 11 operations is spec-only alignment
  for the implementation step, not a REST change.

## Dependencies restated, not re-decided

- No MCP tool ships for an operation whose REST contract is still a
  proposal. The deferred-tools table (13 analyses + 12 dashboards +
  15 assets = 40) snapshots the D-39/D-40/D-41 proposal tables; if a
  proposal changes during its review, its MCP tools follow the
  approved table, not this snapshot.
- Transport (Q1) and credential carriage (Q2) are the product calls
  this slice exists to surface; neither is resolved by the proposal.
- SDK/CLI generation, MCP prompts/resources, Streamable HTTP
  transport, and upload-durability tools (#91) are out of scope here.

## Offline capture and reference comparison

This slice changes documentation only, so no new captures were taken:
there is no UI delta to compare. The demo rebuild is byte-equivalent
to the assets slice's rebuilt demo for the static assets (docs are not
shipped in the demo bundle). No new user-visible gap was introduced; no
issue was filed or scheduled by this proposal. No visual-parity claim
is made and README media is unchanged.
