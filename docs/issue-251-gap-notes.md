# Issue #251 — delivery attempt limits during recovery and claim

The single-node job runner now enforces `MAX_DELIVERY_ATTEMPTS` (10) during
crash recovery, pending delivery claims and receipt persistence failures after
SMTP acceptance. Recovery and terminal failure updates settle occurrences
transactionally through the shared settlement helper. See
[tenant automation](tenant-automation.md) for the delivery semantics.

## Verification

Strict API TypeScript compilation passed. The focused job, digest and durable
job suites passed **53 passed / 0 failed / 0 skipped**. Twelve new regressions
cover interrupted and pending rows at and above the cap, accepted-send receipt
failure at the cap, below-cap ambiguity, recovery rollback, stale claim
snapshots, committed attempt counts and settlement with other recipients still
pending. The original #233 tests, including MAX-1 recovery and operator retry
in place, remain unchanged.

The focused run used `TMPDIR=/tmp`, `TZ=UTC` and the installed Chromium through
`OPENSIGHT_CHROMIUM`, outside the sandbox for local fixtures. An initial
sandboxed focused run failed three digest tests; all passed in this fixture
environment without source or assertion changes. No dependencies or skips
were added.

The repository-root `npm test` produced complete final summaries for all
workspaces and root conformance/site tests: **5,300 passed / 0 failed /
36 skipped / 0 cancelled**, comprising 5,336 tests including the Python SDK.
All skips are existing live PostgreSQL tests: 35 require `DATABASE_URL`, and
one requires live TLS PostgreSQL configuration.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,413 | 0 | 34 |
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

The full run used the same local fixture environment described above. Its
command session returned status **143** despite the complete passing
summaries; the cause was not established, so this is not recorded as a zero
exit for the full command. No test process remained running. A separate rerun
of the final root conformance/site command passed **110 / 0 / 0** and exited
**0**, also recorded in `root-final-checks.exit`. Those repeated tests are not
added to the full-run totals above.

## Static demo review

The local single-file demo was rebuilt from source. Dashboard and author
captures at 1280 × 800 are pixel-identical to the #249 reference captures:
zero changed pixels, no page errors, no external HTTP requests and no
horizontal overflow. Comparison with the private `qs-author-light-flow.jpg`
reference retains the Data → Visuals/field wells → sheet arrangement. Existing
banner, spacing and empty-canvas differences remain; no new visual gap was
found. README media are unchanged because this issue changes no UI.

This is a local static demo, not a deployed server. QuickSight visual fidelity
remains unmeasured. Logs and capture artifacts are retained in the ignored
`.opensight/issue-251-verification/` directory.
