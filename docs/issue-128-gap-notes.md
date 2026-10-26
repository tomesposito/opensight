# Issue #128: retained fields after dataset replacement

Manage data → Replace keeps the analysis definition when the new dataset
has missing, renamed, or differently typed columns. For a draft with an
explicit dataset, unresolved references are a persistable editing state.
Save, autosave, and reload preserve field names and calculation expressions;
replacement does not remove references or guess a mapping.

Wells, small multiples, breakdowns, category and parameter filters, date
hierarchies, tooltip fields, controls, and interaction bindings remain in
the draft. Title and sheet edits still save while these references are
unresolved. `unresolvedFieldDiagnostics` derives their current status and
identifies the sheet/visual, control, or calculation, field name, location,
and reason. It follows calculation dependencies using the expression parser,
so braces inside strings and parameter references are not mistaken for
dataset fields. Restoring a compatible schema clears the diagnostics.

The built-in sample draft with **no explicit dataset** keeps its existing
strict membership checks against `SALES_FIELDS`. Imported bundles keep their
existing import diagnostics. No persisted flag, draft-version change, or
new dependency is needed.

## Validation and execution boundaries

Only schema-dependent membership/type checks are deferred for explicit
datasets. Unresolved names must be nonempty, trimmed, and free of NULs;
duplicate well assignments, invalid identities, unknown keys, visual-kind
constraints, layout, parameter declarations, and control structure still
fail validation. Hierarchy size, uniqueness, and date-grain ordering are
also checked. Tooltip fields, control bindings, and visual actions already
used structural persistence validation; their membership did not need
relaxing.

Missing calculation fields already bind as `unknown`. For persistence,
explicit dataset column types and the calculations that depend on them also
bind as `unknown`, allowing expressions to survive a transitive column type
change. Schema-independent calculation type checks, literal types, parser
syntax, function restrictions, banned constructs, names, and empty-expression
checks remain enforced. Calculation cycles are explicitly rejected across
the full dependency graph. Schema-dependent calculation type errors appear
in diagnostics and block affected queries and export.

The Data panel lists unavailable fields and repair guidance. Affected cards
use the existing unavailable placeholder with named fields; query construction
returns no request for them. The compiler accepts their row-free definitions
as unavailable without throwing or fabricating results. Unrelated visuals
can continue to query.

`serializeDraft` refuses bundle/analysis-resource export with
`UNRESOLVED_FIELDS`, naming the fields to repair. This guard is independent
of local persistence. Query-engine and authorization checks are unchanged.

## Repair and UI handoff

Undo the replacement, replace back to a compatible schema, or reassign the
affected wells and repair dependent filters, calculations, hierarchy levels,
tooltips, and bindings. Unused calculated fields also need compatible
references before bundle export. Undo restores the complete prior dataset
and definition; if that was the saved snapshot, the draft is clean again.

UI surfaces changed: the **Data panel** gains the unavailable-fields list;
**visual cards** show the existing placeholder for unresolved local fields;
**Manage data → Replace** explains the list and continued draft saving.
Export errors now name unresolved fields. Per the issue brief, the supervisor
handles demo rebuild, screenshot comparison, and README imagery after merge.

## Verification

The regression first reproduced `saveDraft` rejecting an incompatible
replacement. Tests in `packages/web/test/dataset-replace-unresolved.test.mjs`
are wired into root `npm test` by the existing web test glob. They cover
field-reference and expression round trips, manual save/autosave, diagnostic
locations, transitive calculations, type changes, undo, replace-back repair,
continued edits, structural rejection, export errors, and unavailable rendering.

Strict TypeScript compilation and the focused authoring/manage-data/query run
passed **75 tests, 0 failed, 0 skipped**. The final full root run,
`TZ=UTC npm test`, exited successfully with **3,885 passed, 0 failed,
32 skipped** (3,917 tests total; zero cancelled or todo). This includes all
2,116 web tests, 32 Python SDK tests, and 88 root conformance tests. Every skip
requires live PostgreSQL with `DATABASE_URL` set. The initial sandbox attempt
was interrupted after local listeners and child processes were denied with
`EPERM`; the complete successful run used the required sandbox permissions.

Full-suite output: `/tmp/issue-128-full-test-verified.log`.
No dependencies were added, and `SOLUTION_DESIGN.md` was not changed.
