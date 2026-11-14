# Issue #246 — observable cache fill cleanup

`LiveResultCache.stats()` now exposes `activeFills` and `trackedFillKeys` alongside
its existing counters and entry/byte totals. See
[live-query performance](live-query-performance.md#result-caching) for their
semantics. Executor behavior is unchanged; the regression coverage now observes
cleanup before a successful retry could supersede a leaked marker.

The local regression executes four distinct visual requests against a temporary
bad-header CSV. The PostgreSQL regressions use the existing mocked client to fail
four distinct requests at each of the connect and query stages. Each case checks
zero entries, retained bytes, active fills, and tracked keys before recovery,
then verifies a previously failed key executes live, stores, and serves from
cache. The cache-level test also checks nonzero counts, including multiple fills
for one key, and cleanup through both `set` and `releaseFill`. These tests use
temporary files or mocks and fixed cache clocks; no live database is required.

## Targeted verification and mutation self-check

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Live performance | 49 | 0 | 0 |
| PostgreSQL executor | 18 | 0 | 0 |
| Combined, after restoring both mutations | 67 | 0 | 0 |

The strict query-engine build and public API type check passed.

Each mutation removed only the executor's `releaseFill` call from its `finally`,
rebuilt the query engine, and ran the relevant regressions:

- Local: **1 passed / 1 failed / 0 skipped**, exit 1. The cache-level positive
  test passed; the executor regression failed with `activeFills: 4` and
  `trackedFillKeys: 4`, both expected to be zero.
- PostgreSQL: **0 passed / 2 failed / 0 skipped**, exit 1. Both the connect and
  query failure regressions failed with `activeFills: 4` and
  `trackedFillKeys: 4`, both expected to be zero.

Both source files were restored exactly, the query engine rebuilt, and the
combined targeted suites passed again. No mutation is committed.

## Full root verification

The repository-root `npm test` completed with exit **0**:
**5,245 passed / 0 failed / 36 skipped / 0 cancelled**, comprising 5,281 tests
including the Python SDK. All skips are existing live PostgreSQL tests:
35 require `DATABASE_URL`, and one requires live TLS PostgreSQL configuration.
No skips were added.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,358 | 0 | 34 |
| Bundle parser | 207 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 28 | 0 | 0 |
| Python SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 622 | 0 | 2 |
| Web | 2,678 | 0 | 0 |
| Root conformance and site | 110 | 0 | 0 |

The full run used `TMPDIR=/tmp`, `TZ=UTC`, and the installed Playwright headless
shell via `OPENSIGHT_CHROMIUM`, outside the sandbox for local HTTP/browser
fixtures. Screenshot work finished before the full suite started. Workspace
builds and strict TypeScript checks passed.

## Static demo review

`npm run build:demo --workspace @opensight/web` passed. Offline dashboard and
author captures at 1280 × 800 are pixel-identical to the #242 reference captures
(zero changed pixels), with no page errors, external HTTP requests, or horizontal
overflow. The private `qs-author-light-flow.jpg` comparison preserves the
Data → Visuals/field wells → sheet arrangement; existing banner, spacing, and
empty-canvas differences remain. No new visual gap was found.

This is a rebuilt local static demo, not a deployed server. QuickSight visual
fidelity remains unmeasured. README media are unchanged because this issue
changes no UI.

Verification logs and local artifacts are retained in the ignored
`.opensight/issue-246-verification/` directory.
