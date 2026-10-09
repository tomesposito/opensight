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

Share remains keyboard-reachable with `aria-disabled` and a focus/hover/accessibility
explanation. Local and demo modes explicitly say sharing needs hosted API support.
Hosted mode requires a resolved session and identifies the current namespace, but
also explains the missing saved-hosted-analysis/share-management integration:
this Author editor still edits device-local drafts. A draft UUID, imported bundle
ID, or Copy draft link is never used as a hosted permission target. No sharing
request or fake grant/link is produced, including for administrators.

The existing hosted sharing API and HQ-2/HQ-6 decisions do not make a local draft
a hosted asset. Namespace-local user/group resolution, folder restrictions and
viewer row/column policies remain the required hosted semantics. The separate
embedded-author surface and server APIs are unchanged.

Print invokes native browser printing for a snapshot of the active sheet. The
snapshot retains current controls, rendered SVGs, tables, selection state,
errors/empty states and the existing data-source disclosure. It excludes menus,
editor docks, card actions, other sheets and definition/debug footers. Table
scroll positions are preserved: this is the visible view, not an all-rows report.
Pending visuals block printing with a retry explanation. Browser failures show
a reason. The temporary snapshot and document title are cleaned up after print
preview closes or the editor is left. Default paper is A4 landscape; the sheet
is scaled to fit one page. Browser settings can override the paper choice.

The root-wired offline Chromium tests verify native-print invocation/cleanup,
blocked states, literal titles, SVG fragment isolation, controls/table state,
print CSS and real single-page PDF output.

Export to PDF first explains the browser's Save as PDF/system PDF destination,
then opens that same snapshot in native printing. The user chooses Save as PDF
and completes Save in the browser; no download-success claim is made by the app.
Cancel never prints. Browsers without a PDF destination need one with PDF support.
No client PDF dependency is added, so there is no new license or renderer blocker.
This is a single current-sheet snapshot, not parked paginated reports, scheduling,
or a report designer. Print/PDF and menu checks: 13 passed, 0 failed, 0 skipped.

The visual review removed empty control-editing prompts from print output and
confirmed that changed dropdown values come from the live controls, not their
initial HTML attributes. Copy/PDF dialogs follow editor typography, theme and
spacing. Additional copy tests retain imported unknown bundle fields and prepared
dataset references while proving later copy edits leave the source untouched.
Focused store/UI/Chromium checks: 48 passed, 0 failed, 0 skipped.
