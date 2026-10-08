# Issue #50 — Toast notifications

Implemented on `work/issue-50-toast-notifications` from the issue brief.
No dependencies were added. `SOLUTION_DESIGN.md` and `README.md` are unchanged.

## Behavior and integration

`packages/web/src/Toasts.tsx` provides a React context and one persistent
`role="status"` host in `Application.tsx`. The host stacks notifications at
the bottom center, using the editor's Arial typography and navy palette.
Announcements are polite, and adding a toast does not move keyboard focus.
Each notification has a named, keyboard-accessible dismiss button.

Toasts last five seconds, then fade over 180 ms. Identical messages collapse
while visible; duplicate calls do not extend their lifetime. Hover or keyboard
focus pauses dismissal and starts a fresh five seconds when both leave.
Reduced-motion preferences disable the fade. Timers are cleaned up on dismissal
and unmount. Notifications survive page navigation but reset when the workspace
mode or identity changes.

- **Save draft:** `Draft saved` appears only after the manual save succeeds.
  Existing storage-error and device-local explanations remain available.
- **Copy draft link:** the new Author control copies the saved analysis route
  through the browser Clipboard API. `Link copied` appears only after the write
  resolves. The control requires a saved, unchanged draft and is disabled during
  a clipboard write. Query parameters are omitted from the copied URL. Visible
  help explains that this is a link into this browser's device-local storage,
  not a shared analysis. Clipboard failure leaves a persistent error with an
  address-bar fallback.
- **PUBLISH:** the toast says, `Publishing is unavailable in this editor.
  Nothing has been published.` The existing mode-specific explanation remains.
  No publication operation or success confirmation was invented.
- **Bundle import:** successful ZIP/file-picker and JSON/drop imports produce
  `Bundle imported` after the import report closes, including via Escape.
  Waiting for the modal to close keeps the toast visible and its close button
  accessible. Reviewing an old report does not announce another import.
  Invalid imports and imports paused by a failed draft checkpoint never report
  success.

Automatic draft checkpoints, draft renames/deletions, exports, the separate
embedded console's server save, and unrelated administrative actions do not
emit toasts. This keeps notifications scoped to the requested editor actions.
There is no new public sharing, publication backend, or clipboard fallback that
claims success without writing.

## Verification and visual review

The two new `test/*.test.mjs` files run through the existing web/root test glob.
Their 18 tests cover lifecycle, deduplication, independent timers, cleanup,
hover/focus, status semantics, real Save draft and copy controls, asynchronous
clipboard completion and failures, successful/failed/paused imports, honest
publication in all three modes, navigation, and identity changes. Timer tests
use Node's mocked clock. The focused run, including the existing draft, bundle,
and navigation tests, passed **51 / failed 0 / skipped 0**.

`npm run build:demo --workspace @opensight/web` rebuilt the static demo and embed
artifacts. Chromium verified real clipboard writing/reading, duplicate saves,
keyboard dismissal, timed removal, honest publication, and the import modal's
Escape path. Light, dark, 390px mobile, and reduced-motion checks passed with
zero page errors or external requests. Screen-reader speech output, Firefox,
and WebKit were not exercised.

Comparison against the previous demo at 1440px found **zero changed Home
pixels**. Empty and populated Author captures differed only within the new
copy-link utilities row (16,838 pixels each); canvas dimensions and the
Data → Visuals/wells → sheet arrangement remained unchanged. Review against
the local QuickSight author reference retained that layout. QuickSight toast
appearance has not been measured; overall visual fidelity remains unmeasured.
No new unresolved visual defect was found.

The README hero GIF and affected Author feature screenshots were refreshed,
and `docs/images/toasts.png` shows stacked save/copy feedback. The maintained
adaptation of the workspace README capture flow produced 145 frames with zero
page errors; FFmpeg assembled a 960×600, 10fps GIF. The synthetic local API flow
also passed save/reload/reopen, expiry, recovery, and blocked-storage export
checks with zero page errors or external requests. Capture copies correct
existing ambiguous Add visual selectors and use Escape for the already-recorded
Ask Q/header layering issue; product behavior is unchanged by those adaptations.

Screenshots, reference comparisons, capture scripts, and logs are retained
locally under ignored `.opensight/issue-50/`. No reference images, credentials,
or customer data are committed. The demo remains a static artifact, not a
deployed server. Nothing was merged, pushed, published, or closed remotely.

## Final full-suite results

`TZ=UTC npm test` from the repository root exited **0**:
**1,794 passed / 0 failed / 12 skipped / 0 cancelled**. All skips require live
PostgreSQL with `DATABASE_URL`; no web or browser test was skipped. Strict
TypeScript checks and workspace builds passed.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 303 | 0 | 10 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 500 | 0 | 2 |
| Web | 734 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| **Total** | **1,794** | **0** | **12** |

The first attempt was stopped after sandbox socket restrictions prevented the
existing API tests from listening. A second attempt overlapped browser/media
capture and exceeded the existing containment test's 3-second execution limit
(5,610 ms); it was stopped as well. The final run used the required local socket
permissions and ran independently after captures finished. That containment
check passed at 1,543 ms; no implementation or assertion was changed to obtain
the pass. Logs of all attempts and machine-readable final totals remain in
`.opensight/issue-50/`. `git diff 7f8c1203 --check` is clean.
