# Issue #65 — File menu follow-up

The source of truth is GitHub issue #65 and its empty comment thread, read on
2026-10-09. This work follows its Favorites, separate-copy, namespace-aware
Share, Print and current-analysis PDF scope. It does not change
`SOLUTION_DESIGN.md` or add paginated reports.

Favorites are device-local draft metadata in the existing
`opensight.author.drafts.v1` localStorage collection. The existing local/demo
and hosted namespace/principal keys remain in use. Nothing is prepopulated.
File → Add to Favorites saves the current analysis and marks it in one atomic
write; Remove from Favorites clears the mark. Edits and renames preserve it;
deleting the draft removes it. Local drafts and My analyses display the mark
and offer a Favorites only filter. Storage failures preserve the saved value,
show a reason and retain the definition-export fallback. No configuration or
new dependency is needed.

Save as Analysis opens a naming dialog and atomically saves the current draft
under a new collection UUID, then opens that copy. It requires a nonblank name
different from the current title. The saved original is unchanged, including
when the source has unsaved edits. Copies retain sheets, layouts, parameters,
calculations, themes and imported bundle metadata, referencing the same data
sources. They start unfavorited. The new identity is a device-local draft ID;
this does not create a hosted resource or rewrite imported bundle resource IDs.
Cancel and failed writes create no copy; failures leave the dialog and edits
available for retry. Save draft subsequently updates the copy.

Focused Favorites/copy/menu verification: 37 passed, 0 failed, 0 skipped;
strict TypeScript checks passed.
