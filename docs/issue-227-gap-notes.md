# Issue #227 — retry-safe Stripe creation

Run: `codex-issue-227`. Durable operation reservations commit before Stripe;
tenant locks serialize creation and result persistence. Retries retain the
original idempotency key, price and checkout origin. Payment links reuse the
completed result indefinitely. A second checkout request waits for an active
creation and returns the reserved `{id, url}`, even for a different requested
tier. Completed checkout reuse lasts 24 hours from result persistence; at the
boundary a new operation gets a fresh key. Unresolved pending/failed operations
retain their key. See [billing semantics and limitations](billing.md#retry-safe-creation-227).

## Verification

The full root `npm test` completed with exit 0: **4,999 tests, 4,963 passed,
0 failed, 36 skipped, 0 cancelled**. This includes the 32 Python SDK tests.
Every skip requires live PostgreSQL (database URL or live TLS configuration).
The run used `TMPDIR=/tmp` and `OPENSIGHT_CHROMIUM` pointing to the installed
Playwright headless shell. Local HTTP/browser fixtures ran outside the sandbox.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,227 | 0 | 34 |
| Bundle parser | 199 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 28 | 0 | 0 |
| Python headless SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 619 | 0 | 2 |
| Web | 2,545 | 0 | 0 |
| Root conformance and site | 103 | 0 | 0 |

Focused billing tests also passed: **43 passed / 0 failed / 0 skipped**.
Coverage includes both HTTP idempotency headers, committed-before-POST
reservations, concurrent instances, tenant/tier isolation, ambiguous failures,
configuration changes between attempts, process-loss rollback, stale pending
recovery, exact checkout-window boundaries, webhook binding between reservation
and execution, existing errors, once-only audits/link bindings, encrypted
backup/restore and tenant erasure. The PostgreSQL locking contract is exercised
over the SQLite fixture; live PostgreSQL execution was not available.

## Static demo review

`npm run build:demo --workspace=@opensight/web` passed. Offline dashboard and
author captures at 1280 × 800 produced no page errors, external HTTP requests
or horizontal overflow. Comparison with the #221 captures found the same
layout; pixel differences were confined to chart-type glyphs and axis text
(1,052 author pixels and 134 dashboard pixels, using a different Chromium
build). The private `qs-author-light-flow.jpg` reference still shows the same
Data → Visuals/field wells → sheet ordering. Existing banner, spacing and
empty-canvas differences remain; no new visual gap was found.

This is a rebuilt local static demo, not a deployed server. Visual fidelity
remains unmeasured. README media are unchanged because this issue changes no UI.
Logs, exact test counts and captures are retained under the ignored
`.opensight/issue-227-verification/` directory.

All commits remain on `work/issue-227-stripe-retry-safe`; nothing was merged or
pushed. `SOLUTION_DESIGN.md` and dependency manifests are unchanged. No new
dependencies, AWS calls or live Stripe calls were introduced.
