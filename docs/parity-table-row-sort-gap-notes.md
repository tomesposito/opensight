# Table row sorting: verification and captures

## Implementation checks

The compiler's existing `model.sort` pass runs before both table return paths.
No second comparator or table-specific sorting pass was added. The existing
`axisEntries` map groups typed keys independently of source contiguity. Tests
exercise interleaved measure ordering and compare all subtotal/total values
with unsorted output, including distinct numeric/string/null group keys.

Twelve full-output SHA-256 baselines were captured before implementation from
`ddb9ea7689d32281384e75b2ee438d66d143b3d1`. All combinations of totals/subtotals
with populated, empty and unavailable rows are covered. Function source is
included in the hashes, following the small-multiples-sort precedent.

Table groupBy dimensions already live in draft `rows`; the existing grouped
bound-field list, stale-sort cleanup and draft-storage shape validation cover
them. Tests confirm removal of the first dimension, later dimension or measure
clears its sort without disturbing unrelated sorts.

Export/remap inspection found only `smallMultiplesSort` field-ID rewriting in
`projectVisual`. `categorySort` is not rewritten anywhere, so no `rowSort`
rewrite was added. Native IDs differing from column names remain read-only on
bundle import, like the existing category-sort path. A regression test exposed
a column-name/native-ID mismatch that could otherwise be admitted as editable;
the table importer now requires the draft name to identify the same bound field.

A docs scan for table sort configuration being unsupported found no stale
implementation statement. `docs/research/api-surface.md` is the historical
API/bundle observation inventory, not the current compiler capability list.
The current Properties documentation now includes Row sort.

## Verification

The focused compiler/authoring/bundle/Properties/facet regression run passed
**257 passed / 0 failed / 0 skipped**, including 35 new table-row-sort cases.
Strict TypeScript passed. The log is
`/tmp/opensight-table-row-sort-focused.log`. Full root counts and offline capture
results follow after running them against the completed implementation.

## Capture plan and scope

The offline script is `packages/web/scripts/capture-table-row-sort.mjs`.
It loads `packages/web/dist/opensight-demo.html` from `file://`, blocks external
HTTP/HTTPS, verifies visible ordering, and captures both chrome themes under
`.opensight/parity-table-row-sort/browser/`. It also checks direction defaults,
clearing, save/reload and sorted-field removal.

Review copies are `docs/images/parity-table-row-sort-light.png` and
`docs/images/parity-table-row-sort-dark.png`. Reference comparison uses the local
QuickSight Group/Color and Display settings references. Visual fidelity remains
unmeasured. No GitHub issue is filed because this is a phase-plan fallback and
network access is outside the brief's scope.

The README hero GIF is deliberately unchanged: the tour never opens table sort
controls, as explicitly ruled in the brief. The rebuilt demo is a local static
artifact, not a deployed server. No dependencies, AWS calls, deployment, merge
or push are part of this slice; `SOLUTION_DESIGN.md` is unchanged.
