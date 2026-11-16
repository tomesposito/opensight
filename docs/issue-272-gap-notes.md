# Issue #272 — Athena query connector

Implemented the supplied brief on `work/issue-272-athena-connector` with a
checkpoint commit per item. `SOLUTION_DESIGN.md` remains unchanged. No AWS calls,
live-account checks, deployment, merge or push were performed.

## Implementation boundaries

See [Athena configuration, SQL and execution contract](connector-athena.md).
Athena has a dedicated environment-name schema, explicit SQL/type allowlists and
a library executor over the real AWS SDK command classes. Native `ATHENA` source
metadata is admitted without treating imported workgroup metadata as trusted
connection configuration. Hosted endpoint schemas, source provisioning and web
staging paths are unchanged. Other AWS stubs are unchanged.

The fake-client tests establish SDK request shape and lifecycle/error behavior,
not live Athena SQL equivalence or AWS account compatibility. Tom's live-account
verification and hosted provisioning remain follow-on work.

Focused checks: item 1 passed 75 tests; item 2 passed 116; item 3 passed 135; the
final item 4 run passed 184 tests, with zero failures or skips. Tests cover native
Athena metadata, header and type handling, pagination, sanitized failures,
timeout/abort (including stalled SDK requests and bounded stop cleanup),
post-processing, and RLS/CLS bypass attempts before client construction. They
are included by the existing root `npm test` workspace glob.

## Static demo review

Rebuilt the static demo and all embed entries with
`npm run build:demo --workspace @opensight/web`. Captured the prior and rebuilt
local demos at 1280 × 800 with installed headless Chromium, blocking external
HTTP requests. The dashboard, Create data source connector dialog and Create
dataset dialog each have **zero changed pixels**. No page errors, external
requests or horizontal overflow were observed.

The active source-creation dialog already excludes AWS entries, so the shared
Athena registry state/schema change does not visibly change the current demo
gallery. No Athena-specific UI copy or staging path was added. Under the brief's
conditional refresh rule, README screenshots and the tour GIF were retained:
the captures confirm there is no visible gallery delta to refresh.

Compared with `qs-2026/qs-data-create-datasource.jpg`, the dialog retains the
centered overlay, connector search, selectable tiles and footer controls. Existing
differences in catalog breadth (including AWS), icons, spacing and surrounding
chrome remain; this slice introduces no new visual gap. QuickSight visual
fidelity remains unmeasured. This is a local static demo, not a deployed server.

Capture scripts, build output, screenshots and pixel counts are retained in the
ignored `.opensight/issue-272-verification/` directory. The rebuilt demo contains
no Athena SDK execution commands or credential-provider code.

## Checkpoint commits

| Item | Commit | Result |
| --- | --- | --- |
| 1 | `e8948448` | Registry, dedicated environment schema, dialect and positional binds |
| 2 | `3fdfc3c1` | Athena SQL/type allowlists and exact SQL tests |
| 3 | `5c0abce9` | SDK dependency, executor, source metadata and dispatch |
| 4 | `f6e3fce2` | Fake SDK lifecycle, limits, result and security regression coverage |
| 5 | `9216b783` | Connector documentation, registry table and changelog |
| 6 | `6a09766c` | Demo rebuild and screenshot/reference comparison |
| 7 | This checkpoint | Independent full root test run and exact counts |

## Full-suite verification

Root `npm test` completed successfully (exit **0**): **5,558 passed / 0 failed /
37 skipped**, **5,595 tests total**, including 32 Python SDK tests. There were no
cancelled tests or todos. All 37 skips are pre-existing live-PostgreSQL checks:
36 require `DATABASE_URL`, and one requires live TLS PostgreSQL configuration.
Every new Athena test ran without a skip.

The run used `TZ=UTC`, `TMPDIR=/tmp` and installed headless Chromium through
`OPENSIGHT_CHROMIUM`, with loopback access for the existing local server tests.
No AWS calls or live-account verification were performed. Full output, exit
status and parsed counts are retained in `.opensight/issue-272-verification/`
as `root-npm-test.log`, `root-npm-test.exit` and `root-test-counts.json`.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| @opensight/api | 1,450 | 0 | 35 |
| @opensight/bundle-parser | 208 | 0 | 0 |
| @opensight/cli | 73 | 0 | 0 |
| @opensight/embedding-sdk | 10 | 0 | 0 |
| @opensight/headless-sdk | 28 | 0 | 0 |
| opensight-headless-sdk-python | 32 | 0 | 0 |
| @opensight/mcp-server | 74 | 0 | 0 |
| @opensight/o-interpreter | 42 | 0 | 0 |
| @opensight/parity | 11 | 0 | 0 |
| @opensight/query-engine | 799 | 0 | 2 |
| @opensight/web | 2,721 | 0 | 0 |
| root-conformance | 110 | 0 | 0 |

All seven brief items are complete. The static demo remains rebuilt, with no
visible gallery delta and no required README asset refresh. Hosted Athena source
provisioning and Tom's live AWS verification remain explicitly out of scope.
