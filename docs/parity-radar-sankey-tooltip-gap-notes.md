# Radar/sankey detailed-tooltip acceptance and gap notes

Scope: the `radar-sankey-tooltip` phase-plan parity slice, built on
`work/parity-radar-sankey-tooltip` from `4c262fc4`. The run brief is the
slice contract; `SOLUTION_DESIGN.md` is unchanged.

## Compiler and focused checks

The focused tooltip, extra-field, radar and builder tests pass:
**75 passed / 0 failed / 0 skipped**. Coverage includes real ECharts
`getDataParams` for sankey links/nodes and radar polygons, the ECharts
tooltip model cascade, both title modes, per-field hiding, governed formats,
rich-text escaping, duplicate link aggregation, missing radar axes, extras
warnings and authoring/native API round trips. Existing unsupported native
options still fail closed.

Pre-slice compiled basic options were captured before any compiler edits,
including function source. Regression fixtures prove both explicit BASIC and
unset tooltip types remain byte-identical; detailed datums also retain the
same keys. No source-row metadata is added.

## Static demo and visual comparison

`npm run build:demo --workspace @opensight/web` succeeds, including strict
TypeScript checking and embed builds. The artifact is the local
`packages/web/dist/opensight-demo.html`, not a deployed server. Logs and
acceptance artifacts remain under `.opensight/radar-sankey-tooltip/` in the
repo. The first sandboxed demo build was terminated; the separate retry
completed successfully.

`capture-radar-sankey-tooltip.mjs` enables Detailed through the Interaction
properties and hovers real SVG marks. Both kinds pass with **zero page errors,
zero external requests and no horizontal overflow** at 1440×1100. The radar
capture uses three month axes and a Color dimension; the sankey capture shows
a link. Shareable stills are `docs/images/tooltip-radar.png` and
`docs/images/tooltip-sankey.png`; the capture summary is
`.opensight/radar-sankey-tooltip/browser/acceptance.json`.

Compared with local `parity-tooltip-section.png` and
`qs-2026/qs-add-field-to-tooltip.jpg`, the docked Tooltip section retains the
type selector, primary-value title and aggregation toggles, field visibility
checkboxes and Add field entry. Radar visibly shows its polygon title and
indicator/value lines; sankey shows its link title and source, destination
and weight lines. The existing Data → Visuals → canvas flow remains. No new
tooltip layout gap was found. This is a content/visibility comparison, not a
measurement of pixel fidelity or chart geometry parity.

The README GIF is not regenerated under the run brief's explicit ruling:
the tour never opens these tooltips. No GitHub issue was filed and no external network access was
used; the slice has no associated issue number.
