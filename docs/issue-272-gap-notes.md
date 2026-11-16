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
| 6 | This checkpoint | Demo rebuild and screenshot/reference comparison |

## Full-suite verification

The final root `npm test` result will be recorded in the item 7 checkpoint.
