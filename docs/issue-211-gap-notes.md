# Issue #211 — Stripe event reconciliation

## Scope and behavior

Verified Stripe events retain their creation time. Each tenant's billing row
persists its last applied creation time, with first-applied-wins handling for
equal seconds. Older or equal events are recorded as `stale`; events for
another subscription are `foreign_subscription`; unlisted event types are
`ignored`. These outcomes leave billing state, entitlement audits and pause
notifications unchanged. PostgreSQL tenant-row locking and SQLite's existing
write transactions serialize reconciliation, including initial bindings.

Explicit binding remains available through tenant-bound checkout, stored
operator payment links, and subscription creation for the bound customer.
See [billing semantics](billing.md#event-reconciliation-211) for migration,
event types, ordering and binding details. Issues #212 and #227 remain outside
this change.

The brief described `past_due` as already pausing access. The checked-out
implementation, billing documentation and existing test instead retain access
during Stripe retries and pause at `unpaid`; cancellation pauses at period end.
Issue #211 preserves that existing behavior and its assertions. A new event for
the current subscription still performs the existing pause/restoration action.

## Regression coverage

The focused billing, mail and signup run passed **41 tests, 0 failed, 0
skipped**. Coverage includes reverse-order cancellation and tier changes,
equal timestamps in both delivery orders, reload durability, concurrent
events, PostgreSQL lock placement, nullable-column migration, old subscription
events through customer and metadata lookup, explicit rebinding, unknown
event types, event-ID replays, and the signed HTTP access gate.

Existing event fixtures gained creation timestamps. Trial conversion, signup
conversion and paid mail fixtures now establish subscriptions through checkout
instead of an unbound subscription update; their original behavior assertions
remain intact. No dependencies were added.

The completed root `npm test` run exited **0**: **4,834 passed, 0 failed,
36 skipped**, out of 4,870 tests (including 32 Python SDK tests). All skips
are live-Postgres integrations: 34 in the API and 2 in the query engine.
There were no cancellations or todos. The final run includes all workspaces
plus root conformance and site documentation tests. Its log and per-workspace
counts are `.opensight/issue-211-verification/root-npm-test.log` and
`root-test-counts.json`; the interrupted attempts are excluded from totals.

The first root run reached the web tests, where the platform Chromium binary
refused startup without its required WebGL domain-policy arguments. That run
was stopped and its log retained separately. The final run uses the existing
`OPENSIGHT_CHROMIUM` setting with an ignored local wrapper that supplies the
platform's existing policy file and its SHA-256 digest. A focused browser
check passed with that setting; no repository browser code or tests changed.
A subsequent attempt hit the pre-existing Parquet round-trip test's 10-second
deadline. That test passed unchanged in 1.7 seconds when run alone (and in 1.6
seconds on the first root attempt). Its log is retained separately; limits and
assertions were not relaxed, and the complete root command was restarted.

## Static demo review

Rebuilt `packages/web/dist` with
`npm run build:demo --workspace=@opensight/web`. Captured dashboard and author
views at 1280 × 800 with HTTP requests blocked: **0 page errors, 0 external
requests, no horizontal overflow**. Captures and checks are in the ignored
`.opensight/issue-211-verification/` directory.

Compared the author capture with the private `qs-author-light-flow.jpg`
reference: Data → Visuals/field wells → sheet ordering and docked controls
remain intact. The existing explanatory banners, spacing and empty canvas
differ from the populated QuickSight reference, as recorded in earlier gap
notes. Compared the dashboard with `docs/images/sample-dashboard.png`: its
navigation, synthetic values and chart arrangement agree, with responsive
width differences between capture sizes. No new UI gap was observed.

This issue changes backend billing only, so README media were not regenerated.
Visual fidelity remains unmeasured; the rebuilt artifact is a static demo.
