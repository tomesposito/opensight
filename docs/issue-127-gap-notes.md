# Issue #127: horizontal small-multiples bars

Each horizontal bar facet now uses a value x-axis and category y-axis, with
`inverse: true` preserving the category order from the non-faceted path.
Both axes retain their panel's `gridIndex`, and every series retains its
existing `xAxisIndex` and `yAxisIndex`.

Reference-line compilation already selects `xAxis` for horizontal bars; the
axis fix makes those lines land on the value axis in every panel. No changes
were needed in `display-options.ts` or `extra-charts.ts`. Vertical bars and
lines keep their existing axis assignments. No dependencies or configuration
were added, and `SOLUTION_DESIGN.md` is unchanged.

## Verification

Four regression tests were added to `small-multiples-facets.test.mjs`, included
by the existing web test glob and root `npm test`. Horizontal and vertical bar
tests use two panels with different category lists and lengths, checking order,
axis types, inversion, grid indices, series indices and values. Reference-line
coverage checks both lines on every series against value x-axes. A horizontal
faceted bar100 regression also pins its existing orientation and percent scale.
Existing compiler tests cover non-faceted horizontal bars and reference lines.

Before the fix, the horizontal bar and reference-line regressions failed;
the other 18 facet tests passed. Afterward, all 67 focused facet/compiler tests
passed with zero failures or skips. TypeScript compilation passed. Serialized
vertical faceted axis options were byte-for-byte identical before and after.

## Static demo inspection

The rebuilt single-file demo contains 793 modules and is 2,224,322 bytes.
A separate baseline was rebuilt with the original compiler source, avoiding
the stale demo artifact that was present at checkout. Chromium opened both
from `file://` with HTTP/HTTPS requests blocked, using the same synthetic draft.

The horizontal baseline incorrectly drew vertical bars and omitted both Goal
reference lines. The fixed demo draws horizontal bars with category y-axes and
a Goal line at x=250 in each panel. Both versions produced zero page errors.
Vertical before/after PNGs are byte-identical.

Compared the captures with the local QuickSight reference
`qs-2026/qs-properties-multiples.jpg`: Data → Visuals → canvas ordering, panel
titles, shared legend and docked properties remain intact. Existing differences
in panel geometry and offline disclosures remain. Panel titles retain their
in-grid placement and can touch the first horizontal bar; reference-line labels
can crowd value-axis labels. These spacing gaps are recorded for follow-up;
label placement is outside this orientation fix.
This is an offline static artifact, not a deployed server; QuickSight visual
fidelity remains unmeasured.

The README hero GIF was regenerated from the rebuilt demo with the prescribed
`readme-gif.mjs` workflow, adapting its local path, route navigation and accessible
button names to the current app. Its 38 frames are assembled with the documented
ffmpeg palette workflow at two frames per second for a readable 19-second tour.
The tour includes the fixed horizontal facets; the README caption matches it.
The matching [feature capture](images/small-multiples-horizontal.png) records
the two panels and their value-axis reference lines. The capture had no page
errors and blocked HTTP/HTTPS requests.

Build, capture and test artifacts are in `/tmp/opensight-issue-127/`.
