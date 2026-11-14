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

Verification logs and local artifacts are retained in the ignored
`.opensight/issue-246-verification/` directory.
