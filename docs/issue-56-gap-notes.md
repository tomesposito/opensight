# Issue #56 — Field wells parity

Implemented from the supplied issue brief on `work/issue-56-field-wells`, based
on master `b77f489a`. The work does not edit `SOLUTION_DESIGN.md`, add
dependencies, or change the upload/sample-data lifecycle. Nothing is merged,
pushed or published. See [field-well behavior and limits](field-wells.md).

## Reference review

Reviewed the local `qs-autograph-empty.jpg`, `qs-pie-small-multiples.jpg` and
the external LOOKFEEL_GAP “Field wells” section. No reference image was copied
into this repository. All committed screenshots contain synthetic OpenSight
content generated from the rebuilt demo or a temporary local API.

The default and pie wells now follow GROUP/COLOR → VALUE → SMALL MULTIPLES.
Empty VALUE uses a dashed gold outline around “Add a measure”; assignments
replace that placeholder with rounded outlined pills and numeric/calendar type
icons. Data retains its dataset name and truthful execution badge, and the
search/calculation controls use the requested wording. The existing gallery,
specialized wells, native pickers and keyboard assignment paths remain usable.
Picker labels are available to assistive technology without adding duplicate
visible rows. The final empty pie wells end at approximately 890px in the
1440px-wide capture, so the complete set fits a 900px-high viewport.

Empty visuals retain their centered type name and exact #55 guidance. ADD now
creates an empty visual instead of preselecting dataset fields. All 23 types
are covered by rendered-markup tests, including uploaded-data and source-error
cases. Local mode still starts without data; samples remain opt-in.

## Explicit limits and follow-up

Small multiples is an assignable, removable, saved dimension well, with one
field at a time. The existing compiler does not render facets. Assigning the
well therefore produces `SMALL_MULTIPLES_UNSUPPORTED`, blocks preview queries
and exports, and retains the assignment in the draft. Removing it restores
ordinary preview/export when the remaining fields are valid. Faceted rendering
and count-of-records defaults shown in the pie reference require separate
specified work. No hosted-API claim or fabricated facet rendering was added.

Specialized charts retain their existing wells rather than being relabeled as
pie wells. The Data badge remains BLAZE/DIRECT QUERY rather than claiming SPICE.
The surrounding gallery, properties controls and canvas geometry still differ
from the reference. This is a qualitative screenshot review, not a measured
claim of overall QuickSight visual fidelity. No network issue creation or
phase-plan edit was performed under the offline/no-design-edit brief.

## Verification

`TZ=UTC npm test` from the repository root exited **0**:
**1,905 passed / 0 failed / 12 skipped / 0 cancelled**. All skips require live
PostgreSQL with `DATABASE_URL`; no web test was skipped. The run used permission
for local loopback listeners and browser subprocesses.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 304 | 0 | 10 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 502 | 0 | 2 |
| Web | 842 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| **Total** | **1,905** | **0** | **12** |

`tsc --noEmit -p packages/web/tsconfig.json` and the complete web
`build:demo` command passed. The final focused field-well and specialized-builder
run passed **51 / failed 0 / skipped 0**. `git diff --check` is clean.
The complete final root log is `.opensight/issue-56/full-suite-final.log`.

The first full run passed every workspace except one web assertion: radar's
“Optional color dimension” hint had been replaced. The hint was restored in
production UI, and the complete root suite was rerun. This was fixed rather
than waived as a baseline failure.

The offline Chromium acceptance script checks keyboard and drag assignment,
# and calendar icons, placeholder replacement/restoration, three-well order,
Small multiples save/reload/removal and the explicit preview limitation.
Light/dark captures use 12px Arial controls with dashed VALUE borders; a 390px
capture has no horizontal page overflow. The run recorded zero page errors
and zero external HTTP requests.

The temporary local API/browser run exercised upload → preparation → chart,
manual save/reload, draft reopen/rename/delete, upload durability across API
restart and explicit expired-source recovery after simulated 24-hour expiry.
It completed seven prepared-data queries with no fixture-sales query fallback,
no page errors and no external requests.

The static demo and embed artifacts were rebuilt. The maintained adaptation of
`~/workspace/tools/screenshots/readme-gif.mjs`, now checked in as
`packages/web/scripts/capture-readme-tour.mjs`, was updated for empty gallery
visuals and explicit field assignments. The hero GIF contains 207 frames at
960×600 and 10fps. Affected Author, keyboard, palette, auto-save, Q, chart,
URL-action, toast, local-data, draft and expired-source screenshots were
refreshed. The static demo is a local artifact, not a deployed server.

Local scripts, captures, frames and logs remain in ignored
`.opensight/issue-56/`; the reusable acceptance script is
`packages/web/scripts/capture-field-wells.mjs`.
