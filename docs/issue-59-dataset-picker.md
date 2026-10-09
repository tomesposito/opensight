# Issue #59 — Create Analysis dataset picker

Implemented from the supplied issue brief on
`work/issue-59-dataset-picker`. `SOLUTION_DESIGN.md` is unchanged;
no dependencies were added.

**Analyses → New analysis**, the direct `#/analyses/new` URL, and Author's
**New analysis** open the same native modal. Select opens a fresh draft bound
to the chosen dataset and its columns. Author checkpoints meaningful edits
before opening the dialog; Cancel and Escape preserve its existing draft.
The existing inline picker and Data preparation's Build a chart path remain.

The catalog uses the existing `GET /api/prep-sources` endpoint. Only prepared
dataset references are selectable: raw uploads must first be prepared and
saved. Unavailable datasets retain their named error and disabled radio.
Failed requests show an error and a refresh action; changed requests, filters,
pages and refreshes cannot submit a hidden or stale selection.

Search filters dataset names without case sensitivity. Pagination defaults
to 25 items, with 50/100 alternatives. The Source column distinguishes files
and PostgreSQL with inline SVG icons. The Type column uses the API's actual
BLAZE or Direct query mode. The catalog does not supply owners or modification
dates, so those columns say “Not available”; refresh timestamps are not
misrepresented as modification dates.

Local workspaces list the synthetic sales sample only after explicit opt-in.
The static demo offers its existing labeled sample without API calls.
Selecting it preserves the existing sales binding. Topics is disabled with
an explanation that topic support needs a hosted API. Create dataset opens
Data preparation in connected mode; the static demo disables it with a
local/hosted API explanation.

## Verification and reference comparison

The focused dialog, application routing, draft and empty-first suites pass:
**48 passed / 0 failed / 0 skipped**. Tests cover dataset/schema binding,
preserved edits, sample opt-in, permission bypass attempts, stale responses,
error recovery, filtering, pagination and direct/repeated new-analysis URLs.

The repeatable browser capture is
`packages/web/scripts/capture-dataset-picker.mjs`; it uses the installed
Playwright harness with a temporary real local API and Vite server, plus the
freshly rebuilt single-file static demo. Captures and logs stay in ignored
`.opensight/issue-59/`. The demo is a local artifact, not a deployed server.

The real browser flow uploads synthetic CSV, saves its preparation, selects
that dataset in the dialog, and verifies a chart response containing the
prepared North total of 6. No sales query occurs before explicit sample opt-in.
It checks empty and searched states, disabled Topics, keyboard tab containment,
Escape/Cancel focus restoration, existing-work preservation, the dark Author
entry point, local sample selection and the static demo selection. At 390px,
the dialog is 358px wide with 16px margins; the table scrolls inside it.
The browser run recorded zero page errors and zero external HTTP requests.

The private side-by-side comparison uses a crop of the supplied QuickSight
reference beside the real local-stack capture, scaled to the same dialog width.
The title/subtitle, segmented tabs, search, pale-blue table header, source icons,
dataset radios, pagination and bottom-right actions follow the reference.
Remaining differences: slightly roomier rows, a sparse real catalog instead of
the reference's eight rows, BLAZE terminology, unsupported Topics, and unavailable
owner/date metadata. OpenSight retains an explicit refresh action and API
explanations; the reference also has sorting/menu affordances outside this
brief. This is a qualitative comparison, not measured visual parity.
No reference image or personal content is tracked. Follow-up refinement remains
with dataset-picker parity; no GitHub issue or phase-plan writes were made under
the brief's no-network/no-design-edit constraints.

The README adds a synthetic Create Analysis capture and refreshes the hero
GIF from the final rebuilt demo: 221 frames, 960×600, 10fps. The maintained
tour adapts the supplied screenshot script and assembles the GIF with its
documented ffmpeg palette workflow. The final mobile capture keeps all page
navigation controls on one row below Refresh datasets.

`TZ=UTC npm test` from the repository root exited **0**:
**1,933 passed / 0 failed / 12 skipped / 0 cancelled**.
Every skip requires live PostgreSQL with `DATABASE_URL`; no web test was skipped.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 304 | 0 | 10 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 502 | 0 | 2 |
| Web | 870 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| **Total** | **1,933** | **0** | **12** |

The complete log, recorded exit status and parsed counts are in
`.opensight/issue-59/verification/`. An interrupted attempt and the initial
run that exposed outdated editor-test entry routes are retained separately.
Shortcut, command-palette and toast test helpers now open the Author route;
the dedicated creation tests exercise the dataset dialog. All 870 web tests
also passed independently before the final full-root rerun. Browser captures
and GIF assembly were finished before that run; no test limits were changed.
