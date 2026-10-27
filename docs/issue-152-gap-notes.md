# Issue #152: browser enrollment verification

The completed UI/client/mail checkpoints were retained. The follow-up closes the
hosted router's 405 response for session-based invitation acceptance, replaces
the J2/J7 API enrollment setup with actual browser enrollment, and updates
first-run/authentication guidance and the Unreleased changelog. Runtime behavior
and QR licensing are described in [browser enrollment](issue-152-browser-enrollment.md).
`SOLUTION_DESIGN.md` is unchanged; no dependency, schema or deployment was added.

## Regression evidence

The hosted HTTP suite passes 21 tests, with zero failures or skips. Its two new
regressions prove that concurrent acceptance succeeds once, credentials and TOTP
state remain unchanged, the current session stays in its original workspace,
and subsequent login includes the new membership. Foreign identities, forged
principal fields, unauthenticated requests, expired/revoked links and suspended
workspaces are denied without accepting the invitation.

The root suite includes tests for client credential omission and exact request
bodies; enrollment UI password validation, QR/manual key rendering, named error
dead ends, already-enrolled sign-in/session acceptance, cancellation and resume;
invitation mail links; and exact QR matrices against the independent existing
MIT reference implementation. No new QR package is installed or bundled.

J2 and J7 run in real Chromium against the local hosted stack and PostgreSQL,
using stub invitation mail. The browser reads its displayed base32 key, confirms
a live code, checks that the hash is cleared and credentials reach sign-in, then
waits for a later TOTP time step before signing in. J2 also enrolls its Reader AI
through the browser and retains the plain-sign-in, reader-role and workspace
picker assertions. Its second-workspace API membership acceptance is unchanged.
QR codes and setup keys are masked in screenshots, including failure captures.

## Persona results (2026-10-27)

The full J1–J8 runner exited 0: **61 passed / 0 failed / 8 gaps / 0 skipped**.
All eight child processes exited 0. Gaps remain product/environment findings,
not passing assertions or skipped tests.

| Journey | Passed | Failed | Gaps |
| --- | ---: | ---: | ---: |
| J1 discovery | 5 | 0 | 2 |
| J2 first login | 12 | 0 | 0 |
| J3 first dashboard | 8 | 0 | 1 |
| J4 reader daily | 9 | 0 | 2 |
| J5 migration | 6 | 0 | 1 |
| J6 self-host | 7 | 0 | 0 |
| J7 operator | 7 | 0 | 1 |
| J8 embedding preview | 7 | 0 | 1 |

J2 `browser-enrollment` and `reader-browser-enrollment`, and J7
`admin-browser-enrollment`, all **pass**. J7 retains the missing provisioning UI
gap. The other retained gaps are the homepage QuickSight proposition, request
access, local dashboard publication, unconfigured AI provider, reader access to
publisher-owned prepared data, unconfigured imported Athena source, and future
live embedding. No assertion was weakened or failure relabeled to close #152.

The local report and sanitized captures are under
`.opensight/issue-152-personas/REPORT.md`. The run used the existing local
PostgreSQL service, installed Chromium and a short disk-backed temporary path;
the sandbox network namespace cannot reach that service, so loopback tests ran
with the available sandbox escalation. No external network service or AWS was
used.

Two root-suite attempts exposed temporary-directory constraints: migration
safety correctly rejects symlinks (`MIGRATION_SYMLINK_REJECTED`), while Chromium
cannot start with the longer real path. Those runs were stopped. The isolated
migration suite passed **23 / 0 / 0** (passed/failed/skipped); a short real path,
`.opensight/t`, then passed both six Chromium hover tests and the migration
regression. The full suite was restarted with that path. No source changes or
relaxed assertions were needed for these environment fixes.

## Visual review

Rebuilt `packages/web/dist` with `npm run build:demo --workspace=@opensight/web`.
The persona suite captures the actual rebuilt static demo and checks horizontal
overflow, browser errors and external requests. Compared its J1 dashboard capture
with `docs/images/sample-dashboard.png`: chart values and card arrangement remain
intact. Branding/navigation differences already predate this issue. Enrollment
is a hosted surface and does not change the static demo's visible UI; README
feature screenshots and the hero GIF therefore remain unchanged under this
issue's explicit exception. No deployed-server or measured-parity claim is made.
