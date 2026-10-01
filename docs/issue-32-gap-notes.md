# Issue #32: device-local drafts and reopen verification

Implemented on `work/issue-32-local-drafts` from `master` at `109a7456`, following
its run brief. `SOLUTION_DESIGN.md`, dependencies, hosted authentication, server
persistence, and deployment behavior are unchanged. No merge, push, issue closure,
or external service calls are part of this work.

## Behavior and boundaries

Author now has explicit Save draft, New analysis, and a collapsible Local drafts
list with name, updated time, reopen, rename, and delete. Definition-only JSON
uses bounded, atomic localStorage writes: 20 records and at most 4 MiB of UTF-16
text per collection. Local/demo collections are separate; hosted keys also
separate namespace and user. Legacy local/demo drafts migrate without deleting
the original. Corrupt entries cannot open and can be deleted; invalid collection
metadata is never silently overwritten. Quota and privacy failures explain the
reason and leave JSON export available, including for an unfinished analysis.

Saving is explicit. Switching analyses checkpoints meaningful edits first;
failed checkpoints preserve the open editor. Other navigation does not autosave,
and unsaved edits are labeled. This is browser-local storage, not server saving,
sync, sharing, or a security boundary. See [local drafts](local-drafts.md).

Reopen checks prepared dataset availability and schema before running a chart.
Expired uploads show re-upload and reconnect guidance without substituting sample
rows. Compatible prepared replacements retain the visual definitions. A rename
preserves query identity. If a previous cancelled read still holds the local
execution gate, queries retry only `BLAZE_BUSY` / HTTP 409, at most three times
with cancellable delays; authentication and other failures are not retried.
Publish remains an informational stub with separate local, static, and hosted
wording, without a universal AWS requirement.

## Browser acceptance and visual comparison

The [capture harness](../packages/web/scripts/capture-local-drafts.mjs) runs real
Vite, local node:http API, DuckDB, and Chromium against synthetic CSV data. As in
issue #29, the installed browser's loopback restriction requires a synthetic
origin forwarded through Node to the real local stack. External HTTP and
WebSockets are blocked; this is only a test transport.

Acceptance passes save → reload → reopen → rename/delete. It restarts the actual
API with the persisted pipeline file, proves the uploaded rows are gone, and
checks that no chart query or chart appears for the expired source. It then
re-uploads, prepares compatible columns, reopens the original draft, reconnects,
and verifies North: units 6, doubled 12. No sales query occurs. Static-demo save,
per-mode local/demo Publish messages, and a real JSON download with a deliberately
blocked localStorage getter also pass. There are zero page errors and zero
external requests. Hosted copy, corrupt/hostile storage, quota/record limits,
legacy migration, schema mismatch, retry limits, and cancellation have unit/UI
coverage in the root suite.

Desktop captures retain the Data → Visuals → sheet flow, docked Properties and
the existing toolbar. The drafts list is collapsed initially. Expanded history
and the source warning stay in normal document flow; neither overlays the sheet.
The warning names the missing data and gives actionable recovery controls. At
390px the draft actions wrap and the capture has no horizontal page overflow.
The recovered chart contains real prepared totals. Screenshots were compared
with the existing README captures and `qs-editor-newlook.jpg`; this remains a
visual review, not a measured fidelity claim.

The existing dense utility chrome and tall mobile sheet remain within the
already separated #31/#35 navigation/polish scope. No additional unresolved
regression was found. No GitHub write was made under the run brief's no-network
build constraint; the runner owns publication.

Affected README screenshots (`author.png`, `local-data.png`) are refreshed;
`local-drafts.png` and `expired-draft.png` illustrate the new documentation.
The supplied `readme-gif.mjs` storyboard is adapted to this checkout and installed
capture tools, uses fixed frame holds, and adds a saved-draft scene. The static
demo is rebuilt in `packages/web/dist`; it is not a deployed server.

## Verification

Local evidence is retained in the ignored `.opensight/issue-32/` directory:
`browser.log`, `browser/`, `recovery-targeted.log`, `fallback-targeted.log`,
`demo-build.log`, `gif.log`, `gif-assembly.log`, `final-demo-capture.log`, and
`full-tests-final.log`.

The first full run reached one obsolete web assertion expecting the generic
storage warning and disabled empty-draft export. The assertion now checks the
specific unavailable-browser reason and available export fallback. No tests
were skipped or weakened to bypass runtime behavior. The required complete rerun passes.

`TZ=UTC DATABASE_URL=postgresql://postgres@localhost:5433/opensight npm test`
from the repository root completed with **1,540 passed / 0 failed / 0 skipped**.
All live PostgreSQL suites ran. Strict TypeScript, package builds, and root
conformance tests ran through the workspace scripts. This covers all runtime
changes through `d64bfff1`; later commits are documentation and captures.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 255 | 0 | 0 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 4 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Query engine | 512 | 0 | 0 |
| Web | 537 | 0 | 0 |
| Root conformance | 3 | 0 | 0 |
| **Total** | **1,540** | **0** | **0** |

`npm run build:demo --workspace @opensight/web` exited 0. Final browser
acceptance exited 0. The final static Author recapture reported zero page errors
and zero external requests. The GIF capture reported 62 frames and zero page
errors; FFmpeg assembly exited 0 and ffprobe verified 960×600, 6.2 seconds,
62 frames. `git diff --check` passes. All work stays on the requested branch;
merge, publication, and issue closure remain with the runner.
