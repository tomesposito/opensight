# Issue #54 — Auto-save drafts

Implemented from the supplied locked issue brief on `work/issue-54-auto-save`.
No dependencies were added and `SOLUTION_DESIGN.md` is unchanged. See
[Auto-save drafts](auto-save-drafts.md) for the behavior contract and
[ITD D-17](itd/D-17-local-draft-autosave.md) for the single-copy persistence decision.

## Integration and verification

The version-1 collection accepts optional validated ISO manual/auto timestamps.
Auto-save preserves the manual checkpoint marker, assigns an ID to a new draft,
and refuses to replace an entry whose manual timestamp is newer than the
caller's last-synced timestamp. Deleted entries remain deleted. Manual saving
clears the auto marker. Recovery loads the stored work immediately; checkpoint
and dismissal clear the notice, and dismissal retains the content.

The hook restarts a 2-second timer on changes and reads the current draft at
execution. Manual saving and unmount cancel it. Saving commits before the
synchronous write; success updates the baseline and ID, allowing Copy draft
link. Failure leaves the edits intact, emits one detailed toast and waits for
another edit to retry. The same error on a later attempt is announced again.
Manual failures use the same detailed toast path, including shortcuts and the
palette; existing manual-success feedback remains. Auto-save success is quiet.
Unavailable draft links do not auto-save an empty replacement.

Six new store tests and eleven new component tests run through the existing
web/root glob. The focused regression run passed **75 / failed 0 / skipped 0**,
covering metadata, migration, limits, stale manual conflicts, debounce timing,
current content, StrictMode/unmount cleanup, recovery, draft switching, links,
blocked storage and full storage. Existing save-failure tests now assert the
recovery toast without a success notification.

`npm run build:demo` in `packages/web` rebuilt the static demo and embed
artifacts with strict TypeScript checks. Chromium acceptance observed
**Unsaved changes → Saving… → Saved · HH:MM**, then restored the edited title
on reload. Both recovery actions, manual cancellation, draft-link availability,
a real second tab's newer manual checkpoint, and blocked/full storage without
retry loops passed. Light, dark and 390px layouts passed. The indicator uses
12px Arial and the existing muted chrome color; the narrow recovery notice
fits within the viewport without internal overflow. The static acceptance run
had **zero page errors and zero external requests**. Firefox, WebKit and
screen-reader speech output were not exercised.

## Visual comparison and refreshed media

At 1440px, Home was pixel-identical to the preserved pre-build demo. Empty
Author changed 5,440 pixels within the old dirty-warning/status text area;
populated Author changed 16,835 pixels within the save-controls row. Both
Author captures retained their original dimensions and the canvas remained
unchanged. The local QuickSight NEW LOOK reference confirms the compact
Arial chrome, navy/blue bands and Data → Visuals/wells → sheet arrangement.
The new indicator and recovery notice stay beside the local save controls.
No new unresolved visual defect was found, so no new gap issue was needed.
No QuickSight auto-save reference was supplied; auto-save visual parity and
overall visual fidelity remain unmeasured.

README describes the debounce and recovery behavior and includes the new
`docs/images/auto-save.png`. Affected Author, keyboard, palette, Q, chart,
URL-action and toast feature images were recaptured. Local-data, local-draft
and expired-source images were also refreshed using a synthetic CSV against a
loopback-only API. Save/reload, reopen, rename/delete and API-restart recovery
checks passed with five prepared-data queries and no fixture-data fallback.
That local capture also had zero page errors and zero external requests. The
hero GIF was regenerated using the maintained adaptation of
`~/workspace/tools/screenshots/readme-gif-44.mjs` and its FFmpeg palette workflow.
The tour now includes auto-save and reload recovery alongside the existing
feature sequence. It produced 204 frames with zero page errors, assembled at
960×600 and 10fps.

Scripts, browser captures, comparisons, GIF frames and verification logs remain
locally in ignored `.opensight/issue-54/`. External HTTP requests were blocked
during static capture. Reference screenshots were not committed. The demo is
a static artifact, not a deployed server.

## Final full-suite results

`TZ=UTC npm test` from the repository root exited **0**:
**1,857 passed / 0 failed / 12 skipped / 0 cancelled**. All skips require live
PostgreSQL with `DATABASE_URL`; no web test was skipped. Workspace builds and
strict TypeScript checks passed.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 303 | 0 | 10 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 500 | 0 | 2 |
| Web | 797 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| **Total** | **1,857** | **0** | **12** |

The post-reboot sandbox attempt could not bind the API tests' loopback
listeners (`listen EPERM` on `127.0.0.1`) and was stopped. The complete run
above used local-listener permission and passed without code changes. Its
log is `.opensight/issue-54/full-suite-resumed-local.log`.

`git diff master --check` is clean. Completed checkpoint commits were
preserved after the reboot; all Issue #54 commits remain on the requested
work branch. Nothing was merged, pushed or published.
