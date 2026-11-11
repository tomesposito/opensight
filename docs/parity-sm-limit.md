# Small multiples panel limits — parity-sm-limit

This phase-plan fallback slice implements `SmallMultiplesLimitConfiguration`
for bar, percentage bar, line, area, combo and pie. It follows the supplied
brief; `SOLUTION_DESIGN.md` is unchanged. No dependency or configuration is added.

The native `SortConfiguration.SmallMultiplesLimitConfiguration` and bundle
`sortConfiguration.smallMultiplesLimitConfiguration` accept `itemsLimit`
(integer 1–100) and `otherCategories` (`INCLUDE` by default, or `EXCLUDE`). A
count requires a supported kind and a SmallMultiples field. Invalid values or
unknown keys fail closed. Without a count, the original warning remains exactly:
“no top-N/Other bucket is computed; all supplied result rows are shown.”
No QuickSight default count is assumed.

Groups follow first appearance in the existing display order. OpenSight still
does not parse `smallMultiplesSort`; this is a documented QuickSight divergence.
The first N groups remain ordinary panels. With INCLUDE, all remaining groups
merge into one extra panel titled `Other` (fixed English). Categories in that
panel follow first appearance and measures sum, retaining null when every
contributing value is null. Extra tooltip fields are empty, as with pie slice
limits. EXCLUDE drops the remaining groups. Duplicate source category/facet
pairs fail before limiting, and non-finite merged totals fail closed.

The shared facet-limit pass feeds pie, cartesian and area/combo/percentage-bar
layouts, detailed tooltips and view-data. Pie slice limits apply afterward,
within each resulting panel. A retained literal `Other` facet remains one of
the first N panels; the merged extra panel has the same fixed title but stays
a distinct panel, following the brief's first-N-plus-one rule. Layout's 20-panel
cap, configured panel cap and visible grid capacity still apply afterward with
their existing warnings. As before, view-data includes rows before layout
truncation. Unset limits preserve existing rendering and row order.

In Multiples Options, an assigned facet exposes **Number of panels displayed**
and, when set, **Group the rest as Other**. Clearing the count removes the
limit; invalid edits retain the last valid setting. Removing the facet drops
the limit. Draft storage, native-definition conversion and editable JSON/.qs
import/export preserve it alongside category sort and pie slice limits.

Tests in `packages/web/test/small-multiples-limit.test.mjs` run through the
existing `test/*.test.mjs` root-suite wiring, including all six faceted kinds,
the three layout paths, validation, reducer/UI, binding aliases, null/overflow,
layout caps, tooltip/view-data and native/authored round-trips.

The docs scan found no small-multiples-limit stub in `issue-67-gap-notes.md`
(that document describes text/image objects). Stale facet-rendering limitations
in `field-wells.md`, `properties-panels.md` and the README are updated here.

## Verification and visual review

The focused renderer, authoring, import/export and component run passed
**117 passed / 0 failed / 0 skipped**. The new test file contributes 20 cases.
`npm run build:demo --workspace @opensight/web` passed, including strict
TypeScript and the embed builds. Logs are `/tmp/opensight-sm-limit-focused.log`
and `/tmp/opensight-sm-limit-demo.log`.

Reviewed the local reference `qs-2026/qs-pie-small-multiples.jpg`: the Data →
Visuals → canvas order, facet titles and one shared legend remain the intended
structure. The new controls reuse the existing Multiples Options dock styles;
layout geometry is unchanged. This is not a screenshot comparison or a
measured fidelity claim.

Fresh browser verification and README media refresh are blocked by this
environment: `/opt/meta-chromium/chrome` exits before opening the demo with
`Hatch WebGL domain policy is required for browser startup`, both inside the
sandbox and on an approved retry outside it. No browser assertion or capture
ran. The existing README media is unchanged. The runnable offline acceptance
script is `packages/web/scripts/capture-small-multiples-limit.mjs`; the adapted
required `readme-gif.mjs` storyboard is staged under `/tmp/opensight-sm-limit/`
against the rebuilt demo. The startup log is `/tmp/opensight-sm-limit-browser.log`.
Refresh the hero and capture the new controls once Chromium can start.

The demo is a local static artifact, not a deployed server. No GitHub action,
push or merge was performed; this slice has no GitHub issue.
