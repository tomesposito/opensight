# Small multiples sorting — parity-sm-sort

This phase-plan fallback slice implements `SmallMultiplesSort` for bar,
percentage bar, line, area, combo and pie. The supplied run brief is the
contract; `SOLUTION_DESIGN.md` is unchanged. No dependency, configuration,
query execution or hosted service is added.

Native `SortConfiguration.SmallMultiplesSort` and internal
`sortConfiguration.smallMultiplesSort` accept a list containing at most one
field sort. For example:

```json
{"smallMultiplesSort": [{"fieldSort": {"fieldId": "region", "direction": "DESC"}}]}
```

The native equivalent uses `SmallMultiplesSort`, `FieldSort`, `FieldId` and
`Direction`. Direction is `ASC` or `DESC`, defaulting to `ASC` when absent.
An absent key or empty list leaves sorting unset. The field ID must identify
the assigned SmallMultiples field, never a category, measure or unbound field.
A nonempty sort without a facet, multiple entries, unknown keys, malformed
wrappers and invalid directions fail with a named `CompileError`. Other visual
kinds reject the key, including an empty list, through the existing key gate.

Facet groups sort by the typed facet cell before `SmallMultiplesLimitConfiguration`
selects its first N panels. The comparator is shared with category/field sorts:
numeric pairs compare numerically, other non-null values compare as strings,
and null is last in both directions. Equal values retain their existing order.
Category sort still controls rows within panels. The merged `Other` panel is
appended after the retained panels; it is never sorted among them. A literal
facet called `Other` remains distinct from that merged panel. Per-panel category
limits and layout caps run afterward. Charts, detailed tooltips and view-data
use the same ordered groups; view-data still includes rows beyond layout caps.
Without facet sorting, first appearance in the existing display order is
unchanged, including existing category sorts and panel limits.

In Multiples Options, an assigned facet exposes **Sort panels by [field]**
with None, Ascending and Descending. None clears the sort. Invalid edits retain
the last valid value. Removing or replacing the facet clears stale sort state;
reassigning the same field or changing unrelated wells preserves it. Draft
storage validates both the shape and facet membership. Serialization includes
the sort only for a faceted kind with an assigned facet.

Bundle imports admit only valid single facet sorts into editable state.
Malformed imports remain in the original definition with read-only diagnostics,
matching the facet-limit precedent; export preserves them rather than silently
removing the configuration. Native field IDs that differ from column names stay
bound when a sort is added, edited or cleared. Native-definition conversion,
JSON/.qs export/import and draft storage retain valid sorts alongside category
sorts and both kinds of limits.

Only **one sort entry** is supported, matching OpenSight's existing categorySort
limit. No multi-field or measure-ranked facet sorting is claimed. Sentence
composition is not applicable. Visual fidelity is not measured; the existing
facet geometry differences remain. See [verification and captures](parity-sm-sort-gap-notes.md).

`packages/web/test/small-multiples-sort.test.mjs` is included by the existing
root-suite web glob. Its 55 cases cover both dialects, all six kinds, typed
ordering and null placement, limits/Other/layout, tooltips/view-data, reducer
and storage validation, import/export, native conversion and Properties controls.
Thirty-six SHA-256 baselines from pre-slice commit `203d0faa` verify byte-identical
full compiled output (including formatter source) when sorting is unset.
