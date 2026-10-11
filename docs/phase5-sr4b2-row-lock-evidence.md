# Phase 5 SR4b2 — row-lock correction evidence

The real initial browser acceptance reached authenticated application routes but
upload reservation returned `COORDINATION_UNAVAILABLE`. Aurora's database log
identified permission denied on `sr_control`. The existing operator had SELECT
only; PostgreSQL also requires a column UPDATE privilege for row locking.

The correction adds a zero-only, non-null lock sentinel to the three locked
configuration tables. The non-owner operator can lock rows but cannot update
admission/epoch, entitlements or budget data. The tenant cannot acquire these
locks. A private initial repair binds the original bootstrap and activation
receipts and refuses previously accepted durable work, foreign schema, changed
configuration/testers and later epochs. It preserves the application digest and
uses a separately pinned administration artifact in the existing private Lambda.

Implementation checkpoint: `1964968`. Full root `npm test`, offline in Linux ARM64:
**2,447 passed / 0 failed / 17 skipped / 0 cancelled**, 2,464 total. All skips are
live-PostgreSQL tests.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 456 | 0 | 15 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 504 | 0 | 2 |
| Web | 1,210 | 0 | 0 |
| Root conformance | 25 | 0 | 0 |

The focused administration/migration run with local PostgreSQL 16.15 passed
**16 / 0 / 0**. The new regression reproduces the denied lock under real runtime
roles, proves serialization and protected-field denial, checks transactional
rollback and exact retries, and successfully reserves/completes an upload through
separate operator/tenant SQL roles. Cross-tenant operation reads remain denied.
Object transfer/dispatch use test transports in this local check; it does not
substitute for the pending real AWS browser workflow.

OpenTofu mock tests: validation/pilot **12 passed / 0 failed**; ingress
**5 passed / 0 failed**. Focused operator conformance: **18 passed / 0 failed**.
The immutable administration image is
`sha256:3d516a40ce19fe3a833d19cf6d5b269042220a575909d55bfa27ec1e73100181`.
All nine runtime smoke checks passed under an unprivileged identity, read-only
root, no network, and bounded temporary storage. Registry scan and actual AWS
repair remain to be recorded. The active application image remains the SR4b1
candidate; initial activation and tester credentials are preserved.

The hosted frontend and its manifest are byte-identical to SR4b1. The demo was
rebuilt; the 251-frame tour had zero errors/external requests and 162 exact frame
matches to SR4b1. The inspected author difference is confined to saved-time text.
The comparison is recorded in the gap notes. No product
UI changes require refreshed README media. A static demo is not a live deployment.
