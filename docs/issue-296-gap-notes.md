# Issue #296 — cumulative delivery limits at every claim

Both delivery runners now require `attempts < 10` and `total_attempts < 30`
in the same SQL update that consumes an attempt. A rejected exhausted claim
dead-letters the row and settles its occurrence once every recipient is
terminal. Recovery applies both bounds, including pending rows and interrupted
sends whose sequence counter is still below 10. Durable recovery preserves
ambiguous SMTP evidence in the execution record while closing the exhausted
delivery and outbox event.

Operator retry retains the existing limits of two operator retries and 30 total
attempts, and never resets cumulative counters. A reopened delivery receives only its
remaining cumulative allowance. No migration, dependency, configuration or UI
change is needed. See [tenant automation](tenant-automation.md) for semantics.

## Verification

Strict API TypeScript compilation passed. The focused delivery and durable-job
suites passed **63 passed / 0 failed / 0 skipped**. The 21 new regressions cover
atomic guards against stale claim snapshots, cumulative counts returned by the
claim, exhausted recovery at and above 30, and the actual legacy-column
migration seeding 29 attempts. Migration cases exercise operator retry,
successful final delivery, SMTP failure, and receipt failure followed by a new
runner recovering the committed claim in both execution paths. Existing
#233/#251/#252 assertions retain their intent.

The repository-root `npm test` exited **0**: **8,117 passed / 0 failed /
38 skipped / 0 cancelled**, comprising 8,155 tests including the Python SDK.
All skips are existing live PostgreSQL tests: 37 require `DATABASE_URL`, and
one requires live TLS PostgreSQL configuration. The run used `TMPDIR=/tmp`,
`TZ=UTC` and the installed Chromium through `OPENSIGHT_CHROMIUM`, outside the
sandbox for local fixtures. No dependencies or skips were added.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,525 | 0 | 36 |
| Bundle parser | 213 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 28 | 0 | 0 |
| Python SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 2,588 | 0 | 2 |
| Web | 3,402 | 0 | 0 |
| Root conformance and site | 119 | 0 | 0 |

## Static demo review

The single-file demo was rebuilt from source. Dashboard and author captures at
1280 × 800 are pixel-identical to the pre-change captures: **zero changed
pixels**, no page errors, no external HTTP requests and no horizontal overflow.
The private `qs-author-light-flow.jpg` reference still shows the same
Data → Visuals/field wells → sheet arrangement. Existing banner, spacing and
empty-canvas differences remain; no new visual gap was found. README media
are unchanged because this issue changes no UI.

This is a local static demo, not a deployed server. QuickSight visual fidelity
remains unmeasured. Logs and capture artifacts are retained in the ignored
`.opensight/issue-296-verification/` directory.
