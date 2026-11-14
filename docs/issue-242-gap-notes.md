# Issue #242 — equal-second Stripe event reconciliation

Invoice, subscription and checkout ordering now use separate durable evidence
in the billing row. Same-second status/access conflicts use documented
precedence; verified successful transitions supply tier evidence independently.
The public `lastStripeEventCreated` is the maximum applied creation time, not
the stale-event fence. See [billing reconciliation](billing.md#event-reconciliation-211-242)
for the tie rules, checkout binding domain and legacy migration behavior.

The guarded nullable `stripe_ordering` column preserves older-event protection
for databases with the former global watermark. Pre-watermark databases retain
their stored status and access without rejecting valid creation times, including
zero. No raw Stripe payload is persisted and no Stripe lookup is added. The tie
rules are deterministic policy, not a claim to recover chronology within a
Stripe second. Different-subscription binding replacement still requires a
strictly newer authorized binding event.

## Verification

The final repository-root `npm test` completed with exit **0**:
**5,232 passed / 0 failed / 36 skipped / 0 cancelled**, comprising 5,268 tests
including the Python SDK. All skips require live PostgreSQL: 35 require
`DATABASE_URL`, and one requires live TLS PostgreSQL configuration.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,348 | 0 | 34 |
| Bundle parser | 207 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 28 | 0 | 0 |
| Python SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 619 | 0 | 2 |
| Web | 2,678 | 0 | 0 |
| Root conformance and site | 110 | 0 | 0 |

Focused billing and checkout-operation tests passed **97 / 0 / 0**. Coverage
includes both delivery orders in fresh fixtures, reload between deliveries,
same-second conflicting statuses/prices, invoice failure/success, checkout
conversion, cancellation deadlines, delayed independent domains, concurrent
instances, additive migration and live/expired trials. Existing foreign-binding,
older-reactivation, replay, audit, pause-notice and checkout reservation tests
remain green. PostgreSQL column-discovery and parent-lock contracts are exercised
over local fixtures; live PostgreSQL was unavailable.

The full run used `TMPDIR=/tmp`, `TZ=UTC` and the installed Playwright headless
shell via `OPENSIGHT_CHROMIUM`, outside the sandbox for local HTTP/browser
fixtures. Strict TypeScript passed. An initial sandboxed focused run aborted
in Node's native callback handling at HTTP fixtures; the complete focused run
outside the sandbox passed. An earlier root run was intentionally stopped to
add the pre-watermark migration regression and fix; only the subsequent complete
run supplies the totals above. No assertions were weakened or skips added.

## Static demo review

`npm run build:demo --workspace=@opensight/web` passed. Offline dashboard and
author captures at 1280 × 800 produced no page errors, external HTTP requests
or horizontal overflow. Both captures are pixel-identical to the #227 reference
captures (zero changed pixels). The private `qs-author-light-flow.jpg` comparison
retains the Data → Visuals/field wells → sheet arrangement; the existing banner,
spacing and empty-canvas differences remain. No new visual gap was found.

This is a rebuilt local static demo, not a deployed server. QuickSight visual
fidelity remains unmeasured. README media are unchanged because this issue
changes no UI.

Logs, counts and local capture artifacts are retained under the ignored
`.opensight/issue-242-verification/` directory. No dependencies, AWS calls,
live Stripe calls, `SOLUTION_DESIGN.md` edits, merges or pushes are part of this
work. All checkpoint commits remain on `work/issue-242-stripe-equal-second`.
