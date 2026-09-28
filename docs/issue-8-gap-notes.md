# Issue #8 Phase A verification

On 2026-09-28, rebuilt `packages/web/dist/opensight-demo.html` from the issue branch
and opened the actual single-file artifact in Chromium via `file://`.

Desktop (1440 px) and mobile (390 px) browser checks verified all 23 connector
cards, selection, search and its empty state, the MySQL/Salesforce hosted-API
messages, disabled offline upload/validation, and no horizontal overflow on
mobile. No JavaScript page errors or HTTP requests occurred. Captures are local
review artifacts at `/tmp/issue8-gallery-desktop.png`,
`/tmp/issue8-gallery-mysql.png`, `/tmp/issue8-gallery-mobile.png`, and
`/tmp/issue8-builder.png`.

Compared the rebuilt builder capture with `qs-author-light-flow.jpg` and
`qs-editor-newlook.jpg` in the supplied reference set. The navy menu, FIT TO WIDTH,
PUBLISH, NEW LOOK and left-to-right Data → Visuals → sheet flow remain present.
The sheet is the largest workspace region; properties stay docked. The reference
contains populated visuals while a fresh demo opens an empty canvas, so this is
a structural review, not a pixel-parity measurement. Existing demo notices occupy
more vertical space than the reference. No new unresolved rendering defect was
identified. There is no supplied connector-gallery reference image; the gallery
uses the existing app typography, borders and colors. QuickSight fidelity has
not been measured.

Root verification: `npm test` from the repository root exited successfully:
**1,254 passed / 0 failed / 1 skipped** (1,255 total). The only skip is the existing
live PostgreSQL executor because `DATABASE_URL` is unset. All MySQL tests ran,
including the loopback TCP failure path. The suite includes config validation for
every connector, mapped/unsupported dialect tests, all five file formats, actual
DuckDB staging, malformed inputs, and API user/namespace bypass attempts.

Authenticated local HTTP integration tests verify real upload staging and private
previews. Web tests verify the gallery and authenticated client transport. An
additional localhost browser check could not navigate because this Chromium
environment returned `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`; it is not
reported as a hosted browser pass. Static-demo browser checks above did pass.

Phase A boundaries and future work are documented, not simulated: MySQL live-server
differential validation and five deferred SQL functions; hosted implementations
for AWS/SaaS and other SQL engines; persistent dataset publication from staging.
These remain follow-up connector work. No GitHub/network publishing was performed,
consistent with the build brief. SOLUTION_DESIGN.md is unchanged.
