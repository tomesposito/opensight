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

## Visual review and final verification

Final full-suite counts, static-demo reference comparison and README media
refresh are recorded here after verification completes. No deployment, push,
new dependency, private reference image or personal data is part of this change.
