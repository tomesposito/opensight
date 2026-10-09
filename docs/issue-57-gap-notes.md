# Issue #57 — Properties panel parity

Implemented from the supplied build brief on
`work/issue-57-properties-panels`. See [control behavior and limits](properties-panels.md).
The work does not edit `SOLUTION_DESIGN.md`, introduce dependencies, or change
the dataset/sample-data lifecycle. Nothing is merged, pushed or published.

## Reference review

Reviewed all five local `qs-properties-*` reference screenshots and the
external LOOKFEEL_GAP “Properties panel sections” notes. No reference image or
customer content was copied into the repository. Captures contain only the
rebuilt OpenSight demo and synthetic local CSV data.

Display settings groups CARD TITLE, CARD STYLE and CARD LAYOUT, followed by
Multiples Options, Group/Color, Legend and Data labels. The controls preserve
the reference wording and placeholders (Auto, 20 (Default), Small, 1px, 24px,
Default: 20 and Outside), with explicit support notes where OpenSight cannot
apply them. Legend and Data labels visibility/precision have moved out of the
general Display settings section without duplicating their controls.

Compared the light/dark captures of all five accordions with the references.
The reference has compact edit/eye affordances; OpenSight retains directly
editable title/subtitle fields and named checkboxes. Support explanations and
existing title-size/precision controls make the sections taller. They scroll
within the existing dock. Per-card layout, facet rendering, separate titles
and per-element typography remain unavailable; the UI neither implies these
work nor serializes their placeholder values. Fonts follow the analysis theme
rather than claiming Amazon Ember is installed.

This is a qualitative comparison, not a measured claim of visual fidelity.
Follow-up work belongs to the properties/faceted-rendering plan after a design
spec: custom alt text; card style/padding; facet layout and panel styles;
separate group/legend titles; Author sort and slice limits; label content,
placement, typography and overlap. No network issue creation or phase-plan
edit was performed under the offline/no-design-edit brief. These limits remain
recorded under issue #57 rather than silently added to this build's scope.

## Verification

The focused properties, display and round-trip run passed **21 / failed 0 /
skipped 0**; the calculation/builder interaction regression run passed
**10 / failed 0 / skipped 0**. `tsc --noEmit -p packages/web/tsconfig.json` passed. The full demo
build passed, and the final single-file demo was regenerated after the browser
accessibility fixes. `TZ=UTC npm test` from the repository root exited **0**:
**1,913 passed / 0 failed / 12 skipped / 0 cancelled**. All skips require
live PostgreSQL with `DATABASE_URL`; no web test was skipped.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 304 | 0 | 10 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 502 | 0 | 2 |
| Web | 850 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| **Total** | **1,913** | **0** | **12** |

The complete final log is `.opensight/issue-57/full-suite-final.log`;
`.opensight/issue-57/full-suite-final.exit` records exit 0.
`git diff --check` is clean.

The offline properties script verifies title/subtitle edits, field display
names, legend placement/visibility, label precision, manual save/reload,
reference section order, native disabled fieldsets and their descriptions,
#55 empty visual guidance, and #56 Small multiples assignment/removal with the
explicit preview limitation. Both editor themes use 12px Arial controls;
the dock has 218px client width and 218px scroll width at the 1440px viewport.
The 390px layout has no page overflow. The run recorded **zero page errors and
zero external HTTP requests**.

Browser verification caught and fixed an ambiguous card/group title label,
added an explicit accessible name to Legend position, and kept Alt text
within the dock with the editor font. Capture scripts now open the separate
Legend/Data labels accordions and wait for responsive dock collapse before
opening the mobile panel. An old Add visual capture selector was scoped to
the build panel to distinguish it from the toolbar action.

An initial root-suite run overlapped builds/browser capture and failed the
load-sensitive two-tenant API flood check; it was stopped. The isolated retry
passed that check but the command ended with SIGTERM before suite completion.
A persistent local runner records the final complete log and exit status.
No API test or threshold was changed, and no failure is waived. The first
complete run found one existing calculation test selecting the first textarea
on the page; the new disabled Alt text box exposed that ambiguity. The test
now selects the calculation dialog textarea and still verifies expression
validation, field assignment and the live query request. The entire root suite
was rerun after that correction and passed.

The local API/browser run also completed **10 prepared-data queries** and the
upload → chart → save/reload → reopen/rename/delete → API restart → expiry →
re-upload/reconnect flow, plus static save and blocked-storage export. It
reported zero page errors and zero external requests. The field-well capture
run passed its empty-state, keyboard/drag, save/reload and mobile checks.

The hero GIF uses the maintained adaptation of
`~/workspace/tools/screenshots/readme-gif.mjs`,
`packages/web/scripts/capture-readme-tour.mjs`: 207 frames, 960×600, 10fps.
Affected Author, Q, saved-state, chart and local-data screenshots are refreshed
from the rebuilt demo/local synthetic API. The static demo is a local artifact,
not a deployed server. Detailed local logs, captures and frames remain in
ignored `.opensight/issue-57/`.
