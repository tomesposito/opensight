# Issue #214 — durable egress reservations

## Implemented behavior

Capped hosted tenant requests reserve the whole remaining monthly allowance
before the API-call charge. The tenant-row lock serializes admission against recorded
bytes plus live reservations, including insertion. Other admissions for that scope receive
429 while the reservation is held. A response may still cross the cap once;
settlement records its full actual bytes on the settlement date and deletes the
reservation in the same transaction. Reservations never enter usage rollups,
events or metrics. Both admission methods validate corrupt and unsafe counters.

A settlement failure rolls back both recording and deletion, retains the full
claim, and logs `EGRESS_RECORD_FAILED`. Later admissions stay denied even after
the write fault disappears or usage is reinitialized. There is no automatic
release or fallback recording after failure. Reservations count only in their
admission month.

The server selects settlement or release once. Failures before byte counting
starts release without an egress event; errors after it starts retain the
existing response-byte accounting. Release still works if tenant suspension
races admission. Uncapped release is a no-op without database access. Zero-byte
settlements retain the existing zero-byte event. Drain waits for the selected
settlement/release operation before removing the request from its active set.

The original `checkEgress`/`recordEgressBytes` tests, sequential HTTP test and
billing-usage assertions were retained unchanged.

## Necessary integration beyond the brief's named files

The new table is registered with reference readiness, single-node backups,
serverless migration/runtime grants and backup inventories, initial activation
checks, and tenant erasure. The existing billing-usage test exposed that erasure
otherwise rejects the new tenant store; inspection also showed backup inventories
would omit live claims. Tests verify claim preservation through backup, restore,
registered migration and retention, compatibility with pre-reservation backups,
and erasure of only the requested tenant's claims. These integrations preserve
the required durable behavior without changing the reservation design.

No dependencies, external services or AWS calls were added. `SOLUTION_DESIGN.md`
was not edited. All commits stay on `work/issue-214-egress-reservation`; nothing
was pushed or merged.

## Verification

API build, production TypeScript and test TypeScript checks passed. The final
focused run passed **109 / failed 0 / skipped 5** (114 tests; no cancellations
or todos). All skips require live Postgres. It ran the following API files with
`TMPDIR=/tmp TZ=UTC node --test --test-isolation=none`:

- `hosted-egress.test.mjs`, `hosted-egress-maintenance.test.mjs`
- `hosted-billing-usage.test.mjs`, `hosted-usage.test.mjs`
- `single-node-maintenance.test.mjs`, `tenant-erasure.test.mjs`
- `serverless-backup.test.mjs`, `serverless-migration.test.mjs`
- `runtime-initial.test.mjs`

Root `npm test` exited **0** with **4,863 passed / 0 failed / 36 skipped**
(4,899 tests, including all 32 Python SDK tests; no cancellations or todos).
All skips require live Postgres: 34 API and 2 query-engine tests.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,152 | 0 | 34 |
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
| **Total** | **4,863** | **0** | **36** |

The run used `TMPDIR=/tmp`, `TZ=UTC`, no `DATABASE_URL`, and the existing
`OPENSIGHT_CHROMIUM` setting with the installed browser's local policy wrapper.
No browser tests or assertions were changed. The full log and parsed counts
are in `.opensight/issue-214-verification/root-npm-test.log` and
`root-test-counts.json`; the final focused log is `focused-api-final.log`.
`git diff --check` passed.

The first sandboxed test attempt aborted inside Node before producing totals.
Completed HTTP runs use approved local socket access. The initial lifecycle
checkpoint passed 19 / failed 0 / skipped 0. A broader intermediate run passed
107 / failed 0 / skipped 5, before the two final release regressions were added.
Preliminary verification was stopped for a clean rebuild after that follow-up.

## Static demo review

`npm run build:demo --workspace=@opensight/web` passed. Dashboard and author
captures at 1280 × 800 had zero page errors, zero external HTTP requests, and
no horizontal overflow. Both captures are byte-for-byte identical to issue
#213. Artifacts and logs are in the ignored `.opensight/issue-214-verification/`.

Compared the dashboard against `docs/images/sample-dashboard.png`: chart values,
navigation and card arrangement agree, with responsive width differences.
Compared the editor against the private `qs-author-light-flow.jpg` reference:
Data → Visuals/field wells → sheet ordering and docked controls remain intact.
Existing differences in banners, spacing and the empty canvas remain as recorded
in previous gap notes. No new user-visible UI gap was observed.

This backend fix does not change UI assets, so README media were not regenerated.
The rebuilt artifact is a static demo; visual fidelity remains unmeasured.
