# Issue #148: cold-start startup verification

The deterministic reproduction supports the issue's proposed mechanism: a
gateway timestamp 14 seconds before Lambda entry leaves only 8 seconds of work
under the old deadline, so a 9-second database wake fails. The outer invocation
deadline error was classified as `WORKSPACE_UNAVAILABLE`. The startup-only
anchor and classification fixes let that case complete read-only readiness and
make genuine invocation budget exhaustion return `WORKSPACE_STARTING` with
`Retry-After: 5`. Runtime semantics are documented in
[phase5-sr1-runtime.md](phase5-sr1-runtime.md#sql-deadlines-and-cleanup).

## Regression evidence

The original six startup tests passed while both new cold-start regressions
failed before the fix. With only the anchor fix, the successful wake passed and
the shorter-budget case still failed on UNAVAILABLE versus STARTING. After the
classification fix, all eight tests passed. Additional guarantee checks cover
the 25-second cap with a longer Lambda duration, no-budget rejection before SQL,
and actual cleanup failure followed by process quarantine in a child process.

The final focused runtime run passed **39 / failed 0 / skipped 1**; the skip
requires live PostgreSQL. It includes startup, composition, lifecycle, native
cleanup, ingress and authorizer tests. Error assertions require exactly
`{errorCode}` and verify retry headers and diagnostic suppression. A readiness
timeout still cancels at two seconds; its outer-scope cancellation surfaces the
deadline code, while directly reported statement timeouts remain unavailable.

The existing ordinary-request expiry test is unchanged. No browser retry policy,
authorizer deadline, cleanup implementation, database sleep policy, dependency,
schema, migration, IAM or deployment configuration changed. `SOLUTION_DESIGN.md`
and the historical D-81 decision record are unchanged. No AWS calls were made.

## Static demo review

`npm run build:demo --workspace=@opensight/web` passed. Chromium captured the
rebuilt local `packages/web/dist/opensight-demo.html` at 1440×900 with HTTP/HTTPS
blocked, reporting zero page errors and zero external requests. The capture
script and images are `/tmp/opensight-issue-148-capture.mjs` and
`/tmp/opensight-issue-148-demo/{home,author}.png`.

Compared the dashboard with `docs/images/sample-dashboard.png`: synthetic
values, charts and card layout remain intact; branding/navigation differences
predate this issue. Compared the author editor with the local
`qs-2026/qs-autograph-empty.jpg` reference: Data → Visuals → sheet ordering and
toolbar remain intact. Existing differences include larger controls, offline
disclosures, the dotted empty canvas and the docked Properties panel. No new UI
gap was identified, and no frontend change requires refreshed README images or
GIF. Visual fidelity remains unmeasured. The demo is a local static artifact.

## Full root verification

Run from the repository root with the established temporary directory outside
the checkout, short enough for Chromium sockets:

```sh
TZ=UTC TMPDIR=/home/hatch/workspace/.tmp npm test
```

The complete output is `.opensight/issue-148/verification/full-suite.log`.
Focused and reproduction logs are in the same ignored verification directory.
The checked aggregate is `results.json`, and `full-suite.exit` records exit 0.

The completed UTC run on Node 24.22.1 passed **3,950 / failed 0 / skipped 33**,
with **0 cancelled and 0 todo** (3,983 tests total). This includes all 32 Python
SDK tests. Every skip requires `DATABASE_URL` or live TLS PostgreSQL settings.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 758 | 0 | 31 |
| Bundle parser | 199 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK (JavaScript) | 28 | 0 | 0 |
| Headless SDK (Python) | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 505 | 0 | 2 |
| Web | 2,140 | 0 | 0 |
| Root conformance | 88 | 0 | 0 |
| **Total** | **3,950** | **0** | **33** |

An earlier full-suite attempt received SIGTERM during API tests before any
suite totals, with no test failure reported. Its partial log is
`full-suite-interrupted.log`. The completed run used a retained terminal session;
no code, test expectations, timeouts or skip conditions changed for the rerun.

All requested work is committed on `work/issue-148-cold-start-startup` in
checkpoints. No merge, push or deployment was performed.
