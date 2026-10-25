# Issue #138: accounting and verification

AI charges now commit with durable warning intents in `h8_ai_warnings`. Warning
delivery and acknowledgement share a separate tenant-serialized transaction.
Admission and recording retry pending warnings; audit failures leave charges
committed and warnings pending. The crossing snapshot and timestamp survive retry.
The legacy audit lookup uses a savepoint so an audit read failure cannot abort
the charge transaction on PostgreSQL.

## Integration findings

The first full-suite attempt exposed eight bootstrap failures: initial setup
requires an exact table inventory. The warning table therefore also participates
in owner migrations, runtime operator grants, bootstrap emptiness checks and
registered backup inventories. Backups without the table remain recognized;
upgrades create it empty and current backups preserve its rows. No bootstrap or
backup checks were weakened.

The outage regression resets the audit migration marker before rerunning
`initializeUsage` to repair the deliberately dropped audit table. The existing
owner migration trusts that marker; its production behavior was not changed.

Only two test files changed:

- `packages/api/test/ai-spend-caps.test.mjs`: rewrites the final outage test to
  prove bounded provider calls across fresh instances, then adds legacy warning
  deduplication, delivery rollback/retry and charge-commit failure coverage.
  All other existing test expectations remain unchanged.
- `packages/api/test/serverless-backup.test.mjs`: adds pending-warning preservation
  and compatibility with backups created before the warning table existed.

`AISettings.complete`, `aiUsage`, metrics and cap-denial behavior are unchanged.
No dependencies, design documents, deployment settings or UI code changed.

## Completed focused verification

Built with `npm run build --workspace=@opensight/api`. API test types were checked
with `node ../../node_modules/typescript/bin/tsc -p test/tsconfig.json` from
`packages/api`. After the migration integration, both API and test types were
rechecked with `node ../../node_modules/typescript/bin/tsc` and the same test
type-check command.

The following test commands ran from `packages/api`:

| Command | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| `node --test --test-isolation=none test/ai-spend-caps.test.mjs` | 19 | 0 | 0 |
| `node --test --test-isolation=none test/ai-spend-caps.test.mjs test/ai-spend-routes.test.mjs` | 21 | 0 | 0 |
| `node --test --test-isolation=none test/ai-spend-caps.test.mjs test/ai-spend-routes.test.mjs test/runtime-initial.test.mjs test/serverless-migration.test.mjs test/serverless-backup.test.mjs test/serverless-audit-upgrade.test.mjs` | 45 | 0 | 10 |

All ten focused skips require live PostgreSQL. Local provider transports are
stubs; no paid provider or AWS calls run.

Earlier sandbox attempts could not bind local HTTP listeners (`EPERM`). The
initial combined accounting/routes run aborted after reporting 19 passes and
one failure, without final totals. The isolated diagnostic command
`node --test --test-reporter=tap test/ai-spend-routes.test.mjs` reported 0 passed,
1 failed, 0 skipped after the child process aborted. The normal combined command
passed with loopback access, as recorded above. The superseded first `npm test`
attempt was stopped after the eight bootstrap failures; it has no complete totals.

## Full root verification

The final `npm test` from the repository root exited 0 on Node 24.22.1:
**3,792 passed / 0 failed / 30 skipped / 0 cancelled**, 3,822 total. This includes
3,764 Node passes and all 28 Python SDK tests (`unittest` reported `OK`). Every
skip requires `DATABASE_URL` or live TLS PostgreSQL configuration.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 677 | 0 | 28 |
| Bundle parser | 199 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| TypeScript headless SDK | 28 | 0 | 0 |
| Python headless SDK | 28 | 0 | 0 |
| MCP | 74 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 505 | 0 | 2 |
| Web | 2,067 | 0 | 0 |
| Root conformance | 88 | 0 | 0 |

The final log is `/tmp/opensight-issue-138-root-tests-final.log`; focused logs are
`/tmp/opensight-issue-138-caps-tests.log`,
`/tmp/opensight-issue-138-spend-tests-unrestricted.log`, and
`/tmp/opensight-issue-138-integration-tests.log`.

## Static demo inspection

`npm run build:demo --workspace=@opensight/web` passed. Captured the rebuilt
`packages/web/dist/opensight-demo.html` dashboard and author editor at 1440×900
with `node /tmp/opensight-issue-138-capture.mjs`. HTTP/HTTPS requests were blocked;
Chromium reported zero page errors. Captures are
`/tmp/opensight-issue-138-demo/home.png` and
`/tmp/opensight-issue-138-demo/author.png`.

Compared the dashboard to `docs/images/sample-dashboard.png` and the editor to
the local QuickSight reference `qs-2026/qs-menu-file.jpg`. Sample values and chart
layout remain intact. The editor retains Data → Visuals → canvas ordering,
toolbar chrome and docked properties. Current navigation and offline disclosures
differ from the older references; no issue-138 UI regression was identified.
The footer remains “Local rendering preview · visual fidelity not measured”.
This is a static artifact, not a deployed server, and this inspection does not
establish measured fidelity. There are no frontend changes requiring README
image/GIF refreshes.

All requested implementation and local verification work is complete. Live
PostgreSQL checks remain unrun because their required configuration is absent.
No merge, push, deployment or external service call was performed.
