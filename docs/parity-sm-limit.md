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

The web workspace passed **2,596 passed / 0 failed / 0 skipped**, including the
20 new small-multiples-limit cases and the existing Chromium interaction tests.
The final full-root verification is recorded separately below after the media
refresh. `npm run build:demo --workspace @opensight/web` passed, including strict
TypeScript and the embed builds; the log is `/tmp/opensight-parity-sm-limit-demo.log`.

The default `/opt/meta-chromium/chrome` still cannot start in this environment.
The already-installed Playwright Chromium works through the existing
`OPENSIGHT_CHROMIUM` setting, without a download or dependency change:

```sh
export OPENSIGHT_CHROMIUM=/home/hatch/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
TZ=UTC npm test
```

The offline acceptance script `packages/web/scripts/capture-small-multiples-limit.mjs`
passed against the rebuilt demo: INCLUDE/EXCLUDE, invalid-count retention,
clearing, save/reload, pie-to-bar conversion and field-removal cleanup. Light and
dark captures have 12px Arial controls, no horizontal overflow at 1440px, zero
page errors and zero external requests. Captures and `acceptance.json` are under
`.opensight/parity-sm-limit/browser/`. The script now uses the current chart-type
selector and closes other Properties sections for a readable comparison.

Compared those captures with local references `qs-2026/qs-pie-small-multiples.jpg`
and `qs-2026/qs-properties-multiples.jpg`. Data → Visuals → canvas ordering,
per-panel titles, one shared legend and the docked Multiples Options section
remain intact. The new count and Other toggle use the existing compact controls
and precede the layout cap, which is still displayed separately. No measured
visual-fidelity claim is made.

Remaining look-and-feel work for the next parity fallback: improve faceted-pie
sizing and label placement in the default narrow card. The default labels can
crowd that card; documentation captures disable labels through the normal UI.
This renderer geometry predates the panel-limit slice. No GitHub issue was filed,
as the brief explicitly prohibits GitHub access and this slice has no issue.

Full-suite verification exposed an unrelated existing race in the SR1 late-connect
cancellation test: its 20ms sleep began before asynchronous invocation setup
completed. That test now waits for the actual abort event before releasing the
late connection, preserving its timeout and disposal assertions. Its focused
file passed **9 passed / 0 failed / 1 live-Postgres skip**. Production runtime
behavior is unchanged.

The demo remains a local static artifact, not a deployed server. No GitHub access
or publishing was performed during this verification.
