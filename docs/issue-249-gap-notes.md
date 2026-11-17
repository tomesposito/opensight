# Issue #249 — answer receipt expiration and admission bounds

Hosted Ask O receipts now have indexed expiration cleanup independent of key
reuse and configurable per-tenant admission limits. See
[answer receipt semantics](issue-229-ai-answer-receipts.md#expiration-cleanup-and-tenant-admission-249)
for batch limits, active-reservation protection and configuration.

## Verification

The focused receipt suite passed **12 passed / 0 failed / 0 skipped**. Its four
existing #229 test bodies are unchanged. Eight new #249 regressions cover index
installation on existing tables, unrelated-tenant cleanup of distinct expired
keys, full-scope reservation protection, the 20-by-500 batch bound and repeated
maintenance, tenant count and payload admission, expiration during generation,
and positive-integer environment validation. Strict API TypeScript compilation
passed.

The final repository-root `npm test` completed with exit **0**:
**5,287 passed / 0 failed / 36 skipped / 0 cancelled**, comprising 5,323 tests
including the Python SDK. All skips are existing live PostgreSQL tests:
35 require `DATABASE_URL`, and one requires live TLS PostgreSQL configuration.
No skips or dependencies were added.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,400 | 0 | 34 |
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

The complete run used `TMPDIR=/tmp`, `TZ=UTC` and the installed Playwright
headless shell via `OPENSIGHT_CHROMIUM`, outside the sandbox for local HTTP and
browser fixtures. An initial sandboxed root attempt aborted in Node's native
callback handling at API fixtures and was stopped; only the subsequent complete
run supplies these totals. No assertions were weakened. Workspace builds and
strict TypeScript checks passed.

## Static demo review

`node packages/web/scripts/build-demo.mjs` rebuilt the local single-file demo
from source. Offline dashboard and author captures at 1280 × 800 are
pixel-identical to the #246 reference captures: zero changed pixels, no page
errors, no external HTTP requests and no horizontal overflow. Comparison with
the private `qs-author-light-flow.jpg` reference retains the Data → Visuals/field
wells → sheet arrangement; existing banner, spacing and empty-canvas differences
remain. No new visual gap was found.

This is a local static demo, not a deployed server. QuickSight visual fidelity
remains unmeasured. README media are unchanged because this issue changes no UI.
Logs, exact counts and capture artifacts are retained in the ignored
`.opensight/issue-249-verification/` directory.
