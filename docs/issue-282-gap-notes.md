# Issue #282 — hosted session restore

Implements confirmed IDD D-99: a separate HttpOnly refresh cookie restores the
hosted app session before any access gate. On-demand clients run credential-free
startup first; a sleeping workspace shows a wait. Invalid cookies preserve the
existing Connect/sign-in sequence. Bearers remain in memory; embeds are unchanged.

## Acceptance evidence

The targeted API checks passed 76 tests and web component/client checks passed
81 tests. Coverage includes cookie attributes, short/remember-me deadlines,
rotation, concurrent single-use exchange, replay/tampering, cross-tenant and
origin attempts, expiry, session revocation, disabled users, tenant suspension
and resume, signing-key retirement, logout and workspace switching. React tests
cover gate ordering, cancellation, timeout, offline/local behavior and StrictMode.

The local browser acceptance script `packages/web/scripts/capture-session-restore.mjs`
passed awake reload, sleeping reload, cookie rotation, no gate flash, logout and
post-logout fallback against the real hosted auth handler with temporary SQLite
and synthetic accounts. Startup/wake is stubbed; no hosted infrastructure is
contacted. It recorded **0 page errors / 0 external requests**. Screenshots and
the browser report are in ignored `.opensight/issue-282/hosted/`.

## Visual review

The freshly rebuilt static demo was compared against the existing classic
editor, new-look editor and Q reference pairings, with the same masks and
pixel tolerance of 16. Pixel differences remain **41.22%**, **33.97%** and
**45.30%**, respectively, matching issue #333. These are differences, not
fidelity grades. No new visual gap was found. The hosted wait initially
inherited dark card text on the navy background; this was corrected and the
browser acceptance rerun passed. Hosted restore has no QuickSight reference
measurement.

The README hero was regenerated from the rebuilt demo using the prescribed
`readme-gif.mjs` storyboard, adapted for current navigation, and its ffmpeg
palette/assembly recipe at 2 fps. The affected Connect screenshot was refreshed
from the synthetic hosted browser run. Other static feature surfaces did not
change. Captures and parity results are in ignored `.opensight/issue-282/`.
The demo is a local static artifact, not a deployed server.

## Final verification

The full root `npm test` completed on 2026-11-26 with exit code **0**:
**8,616 passed / 0 failed / 38 skipped / 0 cancelled** (8,654 tests).
All 38 skips require live PostgreSQL: 36 in API and two in the query engine,
with `DATABASE_URL` or live TLS PostgreSQL not configured. The Python SDK's
34 passing tests are included in these totals.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| api | 1,657 | 0 | 36 |
| bundle-parser | 213 | 0 | 0 |
| cli | 78 | 0 | 0 |
| embedding-sdk | 10 | 0 | 0 |
| headless-sdk | 33 | 0 | 0 |
| opensight-headless-sdk-python | 34 | 0 | 0 |
| mcp-server | 82 | 0 | 0 |
| o-interpreter | 42 | 0 | 0 |
| parity | 11 | 0 | 0 |
| query-engine | 2,731 | 0 | 2 |
| web | 3,605 | 0 | 0 |
| root-conformance | 120 | 0 | 0 |
| **Total** | **8,616** | **0** | **38** |

The completed command was
`OPENSIGHT_CHROMIUM=/home/hatch/workspace/tools/chromium-wrapper.sh npm test`.
The existing wrapper supplies this VM's required browser policy; local HTTP
servers and browser subprocesses ran with the execution permissions they need.
The log is `/tmp/opensight-issue-282-npm-test.log`, with parsed counts retained
in ignored `.opensight/issue-282/root-test-counts.json`. The root conformance
case verifies the real web client against hosted login, reload restoration,
cookie rotation and server-side logout.

The 27 targeted backup/restore checks passed, including migration and restore of
registered backups made before refresh cookies existed. The full-suite edge
freshness check identified a stale generated route allowlist; both checked-in
edge files were regenerated locally, and dedicated edge/gateway restore
admission, cookie transport and route-bypass tests were added. `node site/check.mjs`
passed after regenerating the getting-started page; the public docs manifest
does not consume `docs/idd`, but it does consume the updated first-run guide.

No merge, push, deployment, AWS call, new dependency, private reference image
or personal data is part of this change.
