# Issue #58 — Data prep canvas and Steps panel

Implemented from the supplied issue brief on `work/issue-58-prep-canvas`
(run `codex-issue-58`). The existing preparation contracts in
`SOLUTION_DESIGN.md` remain unchanged. No dependencies were added.
See [Dataset preparation](data-prep.md) for configuration and semantics.

The left Steps catalog stays visible while Configure and Preview share the
bottom workspace. It uses the requested group order and operation names.
Compact source and transformation nodes show the resolved pipeline, with
LEFT/RIGHT labels at joins and an explicit output marker. Secondary sources
appear above their consuming node; self-joins keep distinct instances and
right-side earlier-step references retain links to the existing result.
Branch creation, output selection, reordering and invalid-reference repair
use the existing pipeline model.

The join editor has left/inner/right/full icons, typed searchable column lists,
paired key selectors and dashed placeholders. Choosing either side of a new
key creates a real configuration entry; an incomplete pair blocks Apply.
Right output columns expands the existing prefix and alias controls.
Tabs retain unapplied edits and support arrow keys and Home/End, as does the
join-type selector. Dataset execution controls remain in an expandable section.
The static demo exposes schema configuration and export; live preview and saves
require a local or hosted API.

## Reference comparison and remaining gaps

Compared the rebuilt synthetic OpenSight captures with the local QuickSight
new data-prep screenshot and the external “Data Prep new experience” gap notes.
No reference image or customer content was copied into the repository.

The requested Steps grouping, dotted canvas, compact nodes, join-side labels,
bottom tabs, join selector and column/key layout are present. Editor controls
use the Arial/Helvetica stack at 12px, with 13px dock headings. On narrow screens,
the catalog and canvas scroll within their own regions and the join tables stack
in left/right order above the keys.

OpenSight retains its navigation, dataset actions, explicit Apply button,
source-staging action, output marker and API/Blaze explanations. The reference
has a flatter toolbar and more canvas height relative to its chrome. Secondary
step results use labeled links, and raw secondary sources connect vertically;
the reference uses curved links. Zoom/pan controls, Steps search and dragging
columns are outside this brief; native scrolling and selectable columns are
available. This is a qualitative screenshot comparison, not measured visual
fidelity. Append's strict `PREP_SCHEMA_MISMATCH` behavior remains the deliberate
issue #19 divergence. Follow-up visual refinement stays with the data-prep
parity plan; no network issue creation or design-file edit was performed under
the offline/no-design-edit instructions.

## Verification

The focused prep suite passed **28 / failed 0 / skipped 0**. It covers grouped
steps, tab state, all four join icons, searchable typed columns, incomplete
composite keys, invalid types and aliases, source instances, branching,
preview isolation, bundle round trips and append schema failures. A new test
builds add data → change type → join through UI handlers, verifies the pipeline
against the existing contract, and executes the result through real DuckDB
upload staging to verify the prepared rows.

`npm run build:demo --workspace @opensight/web` passed, including strict
TypeScript checks. The single-file demo was rebuilt again after the final
responsive CSS adjustment. `capture-prep-canvas.mjs` verifies keyboard tab/radio
navigation, partial-key refusal, column search, source consumption, draft reload,
append rejection and connector alignment. It recorded zero page errors and zero
external HTTP requests. Desktop workspace width and scroll width both measure
1,334px; the 390px viewport has 390px document scroll width.

The local verification artifacts are in ignored `.opensight/issue-58/`.
The rebuilt static demo is a local artifact, not a deployed server.

The README data-prep screenshot and hero GIF are refreshed from the final build.
The maintained `capture-readme-tour.mjs` adaptation of the supplied screenshot
script now builds a type-change/join flow and opens its Configure panel. The
207-frame tour was assembled with the documented ffmpeg palette workflow at
960×600 and 10fps. The external local-only LOOKFEEL_GAP section also records the
comparison and remaining work.
