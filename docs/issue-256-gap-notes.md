# Issue #256 — trial expiry and paid-request serialization

Trial expiry now takes the same PostgreSQL tenant-row lock as request creation,
tier changes, resolution and Stripe mutations before changing billing state.
Each candidate tenant has its own transaction, with the expiry predicate
rechecked after locking. Resolution reads current billing state under that
lock. This preserves the pending-request retention hold, starts 30 days from
decline/withdrawal of a paused workspace, and leaves a winning grant active.
SQLite retains its serialized write transactions and existing semantics.
Pause audits commit with billing changes; notifications happen after commit.
See [waiting-list conversion](waiting-list-conversion.md) for the semantics.

## Verification

Strict API TypeScript compilation passed. The focused billing, operation,
paid-request and hosted-PostgreSQL suites passed **164 passed / 0 failed /
3 skipped / 0 cancelled**. The skips require live PostgreSQL (`DATABASE_URL`).
The new live test covers all three resolutions in both lock orders when a
database is available; it was not run against a live server here.

Eleven new deterministic tests cover decline/withdraw/grant in both orders,
request creation and tier changes in both orders, audit rollback, concurrent
expiry deduplication, and reentrant `load()` during post-commit notification.
The dialect harness models tenant locks explicitly rather than relying on
SQLite's global transaction serialization. The same resolution schedules also
run through the real PostgreSQL adapter in the optional live test.

As a negative control, the ten dialect interleaving tests were run against a
temporary transpilation of the pre-fix billing implementation: seven passed
and three failed. Decline and withdrawal reproduced a paused workspace with no
pending request and no retention deadline; grant exposed an unnecessary pause
audit. The fixed build was restored before the passing verification runs.

Verification uses `TMPDIR=/tmp`, `TZ=UTC` and the installed headless Chromium
through `OPENSIGHT_CHROMIUM`, with local HTTP/browser fixtures outside the
sandbox. Initial sandboxed focused runs aborted in Node's
`InternalCallbackScope::Close()` assertion; the same focused tests then passed
outside the sandbox. No dependencies were added.

The repository-root `npm test`, with the required `OPENSIGHT_CHROMIUM`
override, exited **0**: **5,318 passed / 0 failed / 37 skipped / 0 cancelled**,
comprising 5,355 tests including the Python SDK. All skips require live
PostgreSQL: 36 require `DATABASE_URL`, and one requires live TLS PostgreSQL
configuration. This includes the new #256 live interleaving test.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,431 | 0 | 35 |
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

## Static demo review

The local single-file demo was rebuilt. Dashboard and author captures at
1280 × 800 are pixel-identical to the #251 references: zero changed pixels,
no page errors, no external HTTP requests and no horizontal overflow.
Comparison with the private `qs-author-light-flow.jpg` reference retains the
Data → Visuals/field wells → sheet flow. Existing banner, spacing and empty
canvas differences remain; this issue introduces no new visual gap. README
media are unchanged because this issue changes no UI.

This is a local static demo, not a deployed server. QuickSight visual fidelity
remains unmeasured. Logs and captures are in the ignored
`.opensight/issue-256-verification/` directory.
