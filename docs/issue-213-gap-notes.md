# Issue #213 — quotas independent of signup rollout

## Scope and behavior

The non-reference, non-invocation hosted server initializes and composes usage
when entitlements are present, billing configuration is usable, or signup is
enabled. Present entitlements are parsed, including empty or malformed values
that must fail startup. Without explicit entitlements, the existing unrestricted
defaults remain; billing's per-tenant tier override still resolves fail-closed.
See [billing configuration](billing.md#configuration) and
[signup semantics](self-serve-signup.md).

Reference and serverless invocation composition, signup routes, operator queue
draining, and signup startup validation are unchanged. No dependencies were
added, and `SOLUTION_DESIGN.md` was not edited.

## Regression coverage

The HTTP regressions use the existing non-reference H8 fixture without manually
initializing usage. They cover explicit entitlements with signup unset and
`false`, repeated quota denials, tenant isolation, all existing signup endpoints
remaining 404, invalid entitlement startup, and the unmetered control.

The billing-only regression sends a locally signed paid checkout webhook to
assign a zero-call Light tier. Product requests return `USAGE_LIMIT_EXCEEDED`
(429), while the other operator tenant retains unrestricted defaults. It uses
`/api/users` because billing intentionally exempts `/api/session` for resolution;
the test also confirms that session remains accessible with the paid tier.
Stripe is stubbed and no external call is made.

Before the fix, the selected regressions reported **1 passed / 5 failed / 0
skipped**, reproducing both missing quota gates and missing entitlement
validation. After the fix, the focused API run covering hosted usage, billing,
billing usage and signup reported **68 passed / 0 failed / 1 skipped**. The skip
requires live Postgres. API build and production/test TypeScript checks passed.

The sandbox denies loopback listening (`EPERM`); the first sandboxed test
attempt aborted inside Node before reporting counts. The counted HTTP runs
used approved local socket access without changing tests or assertions.

## Full root verification

Root `npm test` exited **0** with **4,842 passed / 0 failed / 36 skipped** out
of 4,878 tests, including all 32 Python SDK tests. There were no cancellations
or todos. All skips require live Postgres: 34 API and 2 query-engine tests.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,131 | 0 | 34 |
| Bundle parser | 199 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| TypeScript headless SDK | 28 | 0 | 0 |
| Python headless SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 597 | 0 | 2 |
| Web | 2,542 | 0 | 0 |
| Root conformance and site docs | 103 | 0 | 0 |
| **Total** | **4,842** | **0** | **36** |

The full log and parsed counts are in the ignored
`.opensight/issue-213-verification/root-npm-test.log` and
`root-test-counts.json`. The run used `TZ=UTC`, no `DATABASE_URL`, and the
existing `OPENSIGHT_CHROMIUM` setting with a local wrapper supplying the
platform's WebGL domain-policy file and digest. Browser test code is unchanged.

## Static demo review

`npm run build:demo --workspace=@opensight/web` passed. Captured dashboard and
author views at 1280 × 800 with HTTP/HTTPS requests blocked: **0 page errors,
0 external requests, no horizontal overflow**. Captures and the review report
are in the ignored `.opensight/issue-213-verification/` directory.
Both screenshots are byte-for-byte identical to the issue #211 captures.

Compared the dashboard with `docs/images/sample-dashboard.png`: navigation,
synthetic chart values and card arrangement agree, with responsive width
differences. Compared the editor with the private `qs-author-light-flow.jpg`
reference: Data → Visuals/field wells → sheet ordering and docked controls
remain intact. The explanatory banners, spacing and empty canvas retain the
differences recorded in earlier gap notes. No new UI gap was observed.

This backend fix does not change UI assets, so README media were not regenerated.
Visual fidelity remains unmeasured; the rebuilt artifact is a static demo.
