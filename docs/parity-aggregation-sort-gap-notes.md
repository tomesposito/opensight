# Category aggregation sorting: verification and captures

## Implementation checks

This is the offline phase-plan fallback `parity-aggregation-sort`, with no
GitHub issue. Work stays on `work/parity-aggregation-sort`, based on master
`6cd1f7eb`. No dependencies, network calls, AWS, merge or push are part of this
slice. `SOLUTION_DESIGN.md` is unchanged; the supplied slice specification is
the implementation contract.

Seventy-two complete compiled-output SHA-256 baselines were captured from
`6cd1f7eb` before implementation. They cover all six supported kinds, facet and
non-facet inputs, plain field sorting, populated/empty/unavailable data, and
function source. All match after the change.

Aggregation ordering shares the row-sort pipeline point, comparator and
post-sort consumers. Tests check multi-row categories, typed category values,
nulls, stable ties, result aliases, per-facet ordering, facet sort/limits,
CategoryItemsLimit, detailed tooltip identities and conditional formatting.
Only aggregation-sorted visuals admit repeated category rows; unchanged
configurations retain the existing duplicate-category guard.

Draft and import checks include mutual exclusion, invalid-edit preservation,
well replacement/removal, visual and sheet dataset remapping, kind changes,
malformed retention and verbatim export, and native/API nested-shape conversion.
Review identified a surviving-sort remap case: export now rebinds the sort's
measure column alongside the wells. A regression validates the exported visual.

## Focused verification

Strict web and API TypeScript compilation passed. The focused suite initially
passed 121 tests; three additional remapping/alias/invalid-edit regressions were
added during review. The final broader compiler, authoring, bundle, converter, Properties and sort
regression run passed **598 passed / 0 failed / 0 skipped**, including all
124 new aggregation-sort cases. Log:
`/tmp/opensight-aggregation-sort-regression-final.log`. The first sandboxed run could not launch Chromium (`ECONNRESET` in
bundle-import-label hover); the installed Playwright headless shell outside the
process sandbox runs that test successfully. No tests were removed or weakened.

## Demo and reference captures

Pending the freshly rebuilt static demo and offline browser acceptance. The
static artifact is a local demo, not a deployed server.

## Full root verification

Pending the full `TZ=UTC npm test` run after media work completes. Only tests
requiring a live PostgreSQL instance may be skipped.
