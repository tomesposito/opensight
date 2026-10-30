# Issue #159 verification and visual comparison

The implementation follows the issue brief. Aggregate declarations and cache
policies remain caller-owned options; imported assets and HTTP query bodies do
not control them. There are no new dependencies or changes to
`SOLUTION_DESIGN.md`. Postgres supports both aggregate execution and caching.
The CSV executor supports caching and manual invalidation; aggregate-table
provisioning and MySQL cache options remain outside this slice.

## Behavioral checks

Planner checks cover strict declaration validation, SUM rollup, COUNT rewriting,
exact date-grain matching, and source fallback for unsupported aggregations,
calculations, post-processing, non-grain fields, and protected queries. Raw
date filters on truncated dimensions also fall back to preserve source semantics.
Embedded Postgres (PGlite) executes aggregate SUM queries and compares their
results with source SQL and DuckDB CSV execution. COUNT comparisons include an
empty selection, where the rolled-up sum is coalesced to zero to retain COUNT's
empty-input behavior.

Cache checks cover copied rows, counters, fake-clock TTL expiry, FIFO capacity,
prefix/all invalidation, key separation, and local refresh after a CSV edit.
Failed refreshes cannot serve old cached rows. Both executor paths bypass cache
reads and writes for security-context requests. A regression test changes a
table calculation without changing its SQL: cached SQL rows are processed using
the fresh plan, so the result changes correctly.

The focused planner/executor checks passed 67 / 0 failed / 0 skipped before the
additional regressions; the final focused performance/Postgres checks passed
43 / 0 / 0. API query checks passed 14 / 0 / 0 and web author-query checks passed
12 / 0 / 0. Tests are included through the existing root workspace test globs.

The initial sandboxed query-engine suite had one environmental failure because
the existing MySQL test could not listen on loopback (`EPERM`). The full root
run uses the permissions needed by its local test servers.
The first full run also encountered the default Hatch browser's missing daemon
policy configuration in the web tests. The corrected full run selects the installed
Playwright headless executable through the tests' existing `OPENSIGHT_CHROMIUM`
environment option; no test is disabled or changed to accommodate the environment.

## Full root verification

The corrected root `npm test` run exited **0** with **4,411 passed / 0 failed /
36 skipped**, including 32 Python SDK tests. No tests were cancelled or marked
TODO. All skips require live PostgreSQL: 34 API tests (including the TLS CLI
integration) and two query-engine tests. `DATABASE_URL` was not configured.
Browser tests used `OPENSIGHT_CHROMIUM` pointing to the installed Playwright
`chrome-headless-shell` build 1243.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 877 | 0 | 34 |
| Bundle parser | 199 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| TypeScript headless SDK | 28 | 0 | 0 |
| Python headless SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 40 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 539 | 0 | 2 |
| Web | 2,440 | 0 | 0 |
| Root conformance | 88 | 0 | 0 |
| **Total** | **4,411** | **0** | **36** |

The complete log is `/tmp/issue159-root-final.log`; parsed counts are
`/tmp/issue159-root-counts.json`.

## Demo and visual checks

`packages/web/scripts/build-demo.mjs` rebuilt the static single-file demo after
TypeScript checks and API/embed builds. Offline captures at 1440×900 recorded
zero page errors and zero external requests. Live and fixture results show no
provenance label. A separate component capture uses real local live/cache results
and a clearly labeled aggregate test fixture to verify both labels at 12px Arial;
it is not shipped as a functional warehouse demo.

Compared with the prior `docs/images/sample-dashboard.png`, chart values and card
placement remain intact; branding and navigation differences predate this issue.
Compared with the local QuickSight `qs-2026/qs-autograph-empty.jpg` reference,
Data → Visuals → canvas ordering remains intact. Existing differences include
offline notices, control density, the dotted canvas, and the docked Properties
panel. The provenance label stays in the existing card footer. No issue-specific
visual regression was identified, so no new visual gap was filed. Visual fidelity
remains unmeasured, and the static demo is not a deployed server.

README dashboard/author screenshots and the hero GIF were refreshed. The maintained
`capture-readme-tour.mjs` adaptation of `~/workspace/tools/screenshots/readme-gif.mjs`
captured 246 frames with no browser errors or external requests; the documented
ffmpeg palette workflow assembled them at 960×600 and 10fps. The installed
Playwright headless browser was used because the default Hatch Chromium requires
browser-daemon configuration unavailable to these scripts.

Captures and verification are in `/tmp/issue159-captures/`, tour frames in
`/tmp/issue159-tour/`, and test logs in `/tmp/issue159-*.log`.
