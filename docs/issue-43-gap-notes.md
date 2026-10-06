# Issue #43: always-visible Author field wells

The Visuals dock now shows a Field wells section with empty ROWS, COLUMNS and
VALUES controls before a visual is selected. Their placeholders read “Add a
dimension” or “Add a measure”. They are native buttons: focus and Enter/Space
select the active well, while Escape leaves the selection and draft intact.
The Data hint names the destination and explains that a first assignment
creates a bar. The empty-canvas prompt describes the same workflow.

The reducer has a distinct `assign-with-no-selection` action. It validates the
field before creating and selecting one bar on the active sheet, with only
that field assigned. Measures go to VALUES; the default bar maps either
dimension well to Category. Selected grouped visuals keep their existing
row/column routing, pickers and removable pills. Invalid fields, BOOLEANs,
incompatible wells and stale events after a selection create no orphan visual.
BOOLEAN controls retain their conversion tooltip and are excluded from pickers.

The product decision is confirmed in [IDD D-15](idd/D-15-field-assignment-creates-visual.md).
No dependency, query engine, bundle schema or `SOLUTION_DESIGN.md` change.

## Independent verification

After resuming the branch following the VM reboot, root `npm test` exited **0**:
**1,676 passed / 0 failed / 12 skipped**, with no cancelled or TODO tests.
All skips require live PostgreSQL (`DATABASE_URL` is unset). The successful
run used local loopback permissions, which the API tests require; an earlier
sandboxed attempt was stopped after localhost listeners failed with `EPERM`.

| Stage | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 303 | 0 | 10 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| Interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 499 | 0 | 2 |
| Web | 619 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |

`npm run build:demo --workspace @opensight/web` also exited **0** after the
full suite. The rebuilt single-file demo remains a local static artifact.

## Layout and browser verification

The editor retains the Arial/Helvetica stack, 12px controls, 13px dock/field-well
headings and 4/8px well spacing. Only the empty-state gallery uses a shorter
136px scroll area, reserving room for all three wells; selected galleries
retain their 168px height. At 1440×900 in both themes, the last empty well ends
at 793.64px, the Visuals dock needs no internal scroll (438px client and scroll
height), and the document width is exactly 1440px. The existing sheet still
extends vertically beyond the viewport; this slice does not redesign that
canvas height. All three empty wells also fit the 1440×807 parity capture.

`packages/web/scripts/capture-field-wells.mjs` checks first dimension and measure
assignment, focus/Enter/Space/Escape, pill removal, selected-visual assignment,
type changes, pivot column routing and returning to empty wells after removal.
The final light/dark tour completed with **0 page errors and 0 external requests**.
Screenshots and geometry reports remain in the private issue-43 capture folder.

Both browser checks were rerun after the resumed demo rebuild. All nine fresh
field-well captures are pixel-identical to their preserved issue-43 captures.
The updated `capture-local-drafts.mjs` creates an uploaded-data chart through
field assignment, then verifies save/reload/reopen, API-restart expiry and
re-upload/reconnection. It completed 12 prepared-data queries with **0 page
errors and 0 external requests**, including mobile and static-demo checks.

## Reference comparison and remaining gaps

The requested protocol was rerun with the existing
`parity-pairings-2026-10-06.json` config. Reference pixels, viewports, fixtures,
regions, exclusions and tolerance were preserved. Only capture paths and the
hand-recorded structural evidence were updated. The original config/captures
remain private and the original committed baseline remains unchanged.

The new same-day baseline uses an issue suffix to preserve both reports:
[Markdown](parity-baseline-2026-10-06-issue-43.md) /
[JSON](parity-baseline-2026-10-06-issue-43.json).

An independent rerun after the reboot exactly reproduced the committed report
apart from its timestamp and sanitized paths. The subsequent fresh captures
match the original run's pixels, so its scores and checklist remain current.

| Visuals-panel region | Original 2026-10-06 | Issue #43 | Change |
| --- | ---: | ---: | ---: |
| editor-classic | 33.03% | 35.57% | +2.54 percentage points |
| editor-newlook | 41.76% | 44.09% | +2.33 percentage points |

Both diffs increased: the empty-well structure is present, but this run does
**not** establish improved pixel fidelity. Header/dock offsets, gallery shape,
and the empty demo canvas versus populated references remain substantial
differences. The unmodified Q pairing moved less than 0.01 percentage points in
each region; no aspect mismatch was reported.

The checklist marks empty wells present only after inspecting each capture.
Assigned pills and populated reference charts remain absent in these empty
pairings; pill behavior is demonstrated by separate selected-visual captures.
The old classic checklist also incorrectly claimed a toolbar ADD control;
it now records that ADD is in the Visuals dock. No score exclusions were added.
These remaining gaps are recorded here for the build loop; this build neither
publishes nor opens remote issues.

## README media

Refreshed `author.png`, `pivot.png`, `radar.png`, added `author-empty.png`, and
updated the README instructions for field-first creation. The hero GIF uses
the maintained repository adaptation of the workspace `readme-gif.mjs` flow
and its FFmpeg palette assembly: **118 frames, 960×600, 10fps, 11.8 seconds**.
It now shows empty wells and field-first creation before the existing tour.
Only generated demo media under `docs/images/` is committed; reference/tour
pixels stay private.
