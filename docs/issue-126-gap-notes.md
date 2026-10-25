# Issue #126: pie Other bucket collisions

When a pie slice limit includes an Other bucket, a retained literal `Other`
category now joins that bucket within its own facet. For `Other=100`, `A=20`,
`B=10` with a one-slice limit, the result is one `Other=130` slice. With a
two-slice limit, the result is `A=20`, `Other=110`; no additional category is
promoted into the vacated retained position. A literal `Other` already among
the collapsed rows contributes to the same sum.

This follows the folding semantics requested in #126. It avoids separate
identities with indistinguishable labels. Each bucket sums non-null measure
values, remains null if all contributing values are null, and clears tooltip
extras. An all-null pie bucket still fails the existing null-slice validation.
Result bindings are respected, and input rows are not mutated.

EXCLUDE keeps or drops the real category normally. No-limit, at-limit and
under-limit groups retain their original rows and tooltip extras. Facets apply
the rule independently. Source category uniqueness is checked before limiting,
so neither folding nor dropping rows can hide duplicate source categories,
including literal `Other` duplicates. Repeated categories across different
facets remain valid.

## Consumers and interaction scope

- Pie series and their legend use the single combined category name. The
  native data table uses the same limited rows and totals.
- Detailed tooltips and conditional formatting resolve the combined values;
  faceted pies retain #125's explicit series-to-facet-row mapping.
- Row selections retain the existing `Other` label. Filter actions and drill
  paths use that label; they do not expand a bucket into its constituent
  categories. This change introduces no new selection identity.
- The existing chart click callback in `VisualCard.tsx` passes only `dataIndex`
  to `rowSelection`, which indexes the flat data table. It does not remap a
  later facet's local index via `seriesIndex`. That pre-existing facet-click
  limitation is separate from this compiler collision fix and needs follow-up;
  the per-facet tooltip and formatting paths are covered here.

## Verification

Regression tests in `packages/web/test/slice-limit.test.mjs` are included by
the existing web test glob and root `npm test`. They cover retained and
collapsed literal Other values, preserved totals, no-op limits, EXCLUDE,
source duplicates in retained/collapsed positions, aliases, nulls, zeroes,
input immutability, tooltip extras, conditional formatting, table output,
label-based filter/drill selections, and the rendered ECharts legend.

The focused slice-limit, pie-small-multiples and facet-series-mapping run
passed **32 tests, 0 failed, 0 skipped**. Strict TypeScript compilation passed.

The complete root `npm test` run exited successfully: **3,867 passed, 0 failed,
32 skipped** (3,899 tests total). Every skip requires live PostgreSQL. These
counts include all 2,098 web tests, 32 Python SDK tests and 88 root conformance
tests. No dependencies were added, and `SOLUTION_DESIGN.md` was not changed.

## Static demo inspection

`node packages/web/scripts/build-demo.mjs` rebuilt
`packages/web/dist/opensight-demo.html` (793 modules, 2,224,277 bytes).
Chromium loaded it from `file://` with HTTP/HTTPS requests blocked. The normal
dashboard and empty author canvas had no page errors; both PNG captures were
byte-identical to their pre-change baselines. The existing README screenshots
and hero GIF depict unchanged UI, so no replacement was needed.

Temporary demo copies substituted only synthetic fixture rows and the baseline
or updated compiler. Before the fix, the retained-Other chart and faceted chart
each showed the duplicate-category error. Afterward, all three examples rendered:
retained `Other=130`; collapsed `A=50, Other=30`; and facets
`East: Other=130`, `West: A=50, Other=20`. Expanded native data tables showed
the same totals, with one Other row per facet. No page errors occurred.

Compared the author canvas and collision captures with the local reference
`qs-2026/qs-pie-small-multiples.jpg`. The Data → Visuals → canvas arrangement,
panel titles, shared legend and percentage labels remain intact. Existing
differences in panel sizing, legend placement and offline disclosures remain;
this fix changes data handling, not geometry. No new presentation gap was found.
This is an offline static artifact, not a deployed server, and visual fidelity
against QuickSight remains unmeasured.

Capture/build scripts, before/after HTML and PNGs, and build logs are in
`/tmp/opensight-issue-126/`. Full-suite output is in
`/tmp/opensight-126-full-test.log`.
