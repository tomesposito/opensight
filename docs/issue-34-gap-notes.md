# Issue #34: connector honesty

Implemented on `work/issue-34-connector-honesty` from `63dff746`, following the
approved issue brief. The two implementation checkpoints were preserved after
the VM reboot. No new connector, dependency or upload behavior was introduced;
`SOLUTION_DESIGN.md` is unchanged.

## Availability and presentation

Data sources features file upload and its upload → prepare → chart path. The
**Show unavailable connectors** checkbox defaults off and unmounts unavailable
cards and their selected details when cleared. Enabling it reveals the full
catalog under **Not yet available**. Search stays within the visible groups.

PostgreSQL appears as **Needs setup** only when hosted source discovery reports
an available operator-provisioned source and prep navigation is present. Its
action opens that existing source in preparation. Local mode, missing sources,
derived datasets and failed discovery keep it behind the toggle. Source
discovery cannot provision credentials or create connections.

Searching `packages/api/src` for `mysql` and `MySQL` found no matches. MySQL is
therefore deliberately marked `unimplemented` in the shared product registry;
its existing dialect and library executor remain. Validation and the connect
API report **Not yet implemented**. PostgreSQL names the missing operator
connection, SaaS/AWS entries name the missing hosted implementation, and static
upload explicitly says it is unavailable in the static demo. Unavailable
configuration fields and validation buttons remain disabled. The registry,
gallery and MySQL documentation describe these distinctions.

## Browser evidence

`packages/web/scripts/verify-connector-gallery.mjs` starts a real isolated local
API and Vite, uses Chromium, and separately loads the rebuilt single-file demo
with HTTP(S) blocked. Chromium's loopback restriction is handled by forwarding
unchanged browser requests and actual responses through Node to the same local
origin, as in issue #33. No API responses or chart rows are mocked.

The completed browser run and nine captures survived the reboot. Its checks
passed for both local and static modes:

- Only **Upload a file** is rendered by default; the unavailable region is absent.
- The toggle reveals 22 entries under **Not yet available**. Search cannot reveal
  them while the toggle is off. Clearing it removes the selected unavailable
  details and restores upload.
- MySQL reports **Not yet implemented**. PostgreSQL explains operator setup and,
  in local mode, that connection setup is unavailable in the local workspace.
- Static upload is disabled and explicitly labeled unavailable in the demo.
- Desktop (1440 pixels) and mobile (390 pixels) captures have no horizontal
  overflow with the catalog hidden or expanded.
- One synthetic `team,amount` CSV upload returned HTTP 201 with three rows.
  **Prepare this upload → Save pipeline → Build a chart**, followed by an O
  question and **ADD TO ANALYSIS**, returned and rendered North **6** and South
  **3** from the prepared dataset API.

The run recorded **1 actual upload, 6 actual query requests, 0 page errors and
0 external requests**. The existing issue #29 capture script now opens the
toggle before selecting MySQL and closes it again for its upload capture.

## Visual review and README

The local and static gallery captures were compared visually with the private
`lookfeel-references/dyn-04-data-sources.png` reference. The page retains the
source search, blue selected card, docked right-hand details and narrow-screen
stacking. Its intentional difference is a featured full-width upload card and
an optional unavailable section instead of an always-visible 23-card grid.
The details and card text remain readable in the checked viewports. No new
layout defect was found. Visual fidelity is not measured.

The README includes the gallery in both `docs/images/data-sources.png` and the
hero GIF, so both are refreshed. The screenshot shows the real local upload
view. The tour uses `capture-readme-tour.mjs`, adapted from the required external
`readme-gif.mjs`, against the rebuilt offline demo and asserts that the gallery
shows only upload with the toggle off. It captured 82 frames with no page errors;
FFmpeg assembles them at 960×600 and 10 frames per second (8.2 seconds). The static
demo in `packages/web/dist` is a local preview, not a deployed server.

## Verification logs

Evidence is retained under ignored `.opensight/issue-34/`: `registry-tests.log`,
`gallery-tests-final.log`, `api-build.log`, `demo-build.log`, `browser.log`,
`browser/`, `gif-final.log`, `gif/`, and `gif-assembly.log`.

The original `full-tests.log` ends during compilation at the reboot. The first
resumed sandbox run also ended during compilation with SIGTERM (exit 143),
retained as `full-tests-sandbox-interrupted.log`. Neither is counted as a
completed test run. Chromium capture initially failed because the sandbox
blocked its socket setup; the permitted run outside the sandbox succeeded.
The final root-suite run is recorded separately in `full-tests-final.log` and
`full-tests-final.exit`.

The first run outside the sandbox completed the workspace suites with 1,574
passed / 2 failed / 0 skipped (`full-tests-initial.log`, exit 1); root conformance
did not run because the workspace command failed. Both failures were fixed in
separate checkpoints before the final full rerun:

- The existing H4 worker-cancellation test could finish a small job between its
  start event and the next 2 ms polling tick, producing **Missing expected
  rejection**. The test now aborts synchronously when the real worker-start
  notification is recorded and awaits the rejection immediately. It still
  checks worker admission, cancellation, no persisted upload, released resource
  slots and the 750 ms cancellation limit. Runtime code is unchanged. Its
  focused run passed with a maximum cancellation time of 29.2 ms
  (`cancellation-test.log`).
- The existing local-upload UI test still expected the old demo wording. It now
  requires both the API prerequisite and the explicit static-demo limitation,
  preserving its disabled-file, local-size-limit and expiry checks. All four
  local-data tests passed (`local-data-tests.log`).

## Final full-suite result

The exact command
`TZ=UTC DATABASE_URL=postgresql://postgres@localhost:5433/opensight npm test`
ran from the repository root and exited **0**: **1,582 passed / 0 failed /
0 skipped**, with no cancelled tests. All live PostgreSQL checks ran. Strict
TypeScript checks and workspace builds ran through the standard test scripts.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 255 | 0 | 0 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 4 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Query engine | 514 | 0 | 0 |
| Web | 574 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| **Total** | **1,582** | **0** | **0** |

The cancellation test also passed in this complete run, with an 8.2 ms maximum
cancellation time. API build, static-demo build, real-stack and static browser
acceptance, README capture and GIF assembly passed. The browser scripts pass
syntax checks and `git diff --check` is clean. No merge, push, public history
change or issue closure was performed.
