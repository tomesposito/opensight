# Issue #9 verification and visual review

The source of truth was GitHub issue #9 and its empty comment list, read in full
on 2026-09-29. Work is on `work/issue-9-data-prep` with checkpoint commits.
`SOLUTION_DESIGN.md` is unchanged. No merge or publish was performed. The parent
owns the static demo rebuild; this run inspected a localhost Vite development
renderer with offline mode enabled instead of rebuilding that artifact.

Browser checks at 1440 px and 390 px exercised adding/configuring rename and
calculated-column nodes, schema updates, export, navigation from the author Data
menu, and the disabled offline save/preview states. No page errors or page-wide
horizontal overflow occurred. Graph/table overflow stays within their containers.
External HTTP requests were blocked. Chromium's request routing served the local
development assets through its request context, avoiding this VM's local-network
navigation restriction. Local captures:

- `/tmp/issue9-prep-desktop.png`
- `/tmp/issue9-prep-mobile.png`
- `/tmp/issue9-author.png`

The screenshot review moved selected-step configuration above the transformation
catalog so the editor controls appear immediately. The prep view uses the existing
typography, borders, and colors, with a left dock and a dominant graph/preview area.
The supplied reference directory contains analysis-editor screenshots but no
prep-canvas screenshot. Comparison with `qs-author-light-flow.jpg` confirms that
the existing Data → Visuals → sheet order and dominant analysis canvas remain.
The reference is populated and the fresh builder is empty; this is a structural
check, not a pixel-parity measurement. The footer still says visual fidelity is
not measured. No new unresolved rendering defect was identified.

Boundaries are explicit: static demo previews require a hosted API; protected
sources and cross-engine combinations are rejected; uploads expire at restart;
pipeline saves persist metadata, not materialized rows or analysis publication.
These are documented execution boundaries, not simulated UI functionality.

Final root verification: `npm test` exited 0 with **1,282 passed / 0 failed /
1 skipped** (1,283 tests total). The sole skip is the existing live Postgres
executor because `DATABASE_URL` is unset. All embedded Postgres differential tests
ran, as did every DuckDB, API, web, and root conformance test. The final suite also
covered explicit-null preview rejection, portable numeric-to-string conversion,
Postgres transaction/timeout/error redaction, and partially typed negative filters.

A separate real-HTTP browser check used an isolated localhost API, a synthetic test
authentication callback, and synthetic CSV rows only. It uploaded three rows via
the file connector, previewed two grouped outputs (`East: 6`, `West: 3`), saved the
pipeline, selected it again from saved datasets, and reloaded its live step preview.
No page errors occurred. `/tmp/issue9-prep-hosted.png` captures that real local API
result. This is an integration harness, not a deployed server. Both development
renderers and the temporary API were stopped after verification.
