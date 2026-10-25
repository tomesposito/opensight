# Issue #124: duplicate imported sheets

Duplicating an imported sheet now creates a saveable draft and independently
identified sheet and visuals on bundle export. The original sheet's definition
and filter groups remain unchanged.

## Identity and persistence

Imported copies retain `memberPath`, dataset bindings, issues, and the
`local`/`remapped`/`replaced` flags. Their exported `sheetId` and `visualId` equal
their newly allocated draft IDs. Optional `sourceSheetId` and `sourceVisualId`
identify the original bundle resources; copies of copies retain those original
source IDs. A copied sheet stays in its source analysis/dashboard member even
after the original draft sheet is deleted.

Validation requires those source resources to exist, copy IDs to match the draft
IDs and avoid every original bundle ID, and each visual baseline ID to match its
current ID. Imported visuals on copied sheets require source provenance and
empty source filter bindings. Ordinary imports still require their exact sheet,
visual variant and visual ID in the source bundle. Invalid copy markers and
mismatched baselines fail closed.

The baseline is a deep copy of the visual after action IDs and intra-sheet
references are remapped. These optional metadata fields fit the existing v2 draft
format. Legacy imports without the fields retain their existing validation.

## Export and guards

Copies serialize their current editable state, including edits made before
duplication, and preserve the dataset identifier until explicitly remapped.
They retain unresolved-field validation and preview guards. Unsupported visual,
calculated-field and filter issues remain in the copied draft, including after
remapping or replacing a visual.

Source `filterGroups` bindings are cleared on copies. Every copied editable
filter generates a new group scoped to the new sheet/visual IDs, even when it
matches the copied baseline. Editing or removing that filter does not rewrite or
split the source group. Interaction export serializes all copied actions with
the new identities; navigation to the source sheet targets the copy, while
navigation to other imported sheets resolves to their original exported IDs.
Empty imported sheets also export independently.

## Verification

Regression coverage lives in `packages/web/test/bundle-roundtrip.test.mjs`, which
is included by the web workspace's test glob and root `npm test`. It exercises
manual save, autosave, persisted-shape validation, ZIP export/re-import, empty
sheets, repeated copies, non-primary members, source deletion, mixed local and
imported visuals, filter isolation, all action types, dataset remapping, unsupported
guards and corrupt metadata.

The focused authoring, bundle round-trip, interactions and sheets-menu run passed
132 tests with zero failures or skips. No dependency or UI presentation changes
were needed.

## Static demo inspection

`node packages/web/scripts/build-demo.mjs` rebuilt the single-file static demo
(793 modules, 2,224,042 bytes). Chromium loaded the rebuilt file with HTTP/HTTPS
requests blocked, imported a synthetic two-visual sheet, duplicated it, waited
for autosave, saved manually, exported JSON and reloaded the copied sheet.
The persisted draft validated; the download contained distinct `sheet-1` and
`sheet-2` identities and an unchanged original sheet. No page errors occurred.

Captures in `/tmp/opensight-issue-124-demo/` include `author-before.png` from the
prior demo, `author-after.png` from the rebuilt demo, and `duplicate-saved.png`.
Compared them with the local QuickSight `qs-2026/qs-menu-sheets.jpg` reference:
Data → Visuals → canvas ordering, docked properties, toolbar and chart layout
remain intact. Existing offline/import disclosures still take more vertical
space than the reference. No new presentation gap was identified, so no README
image/GIF refresh or new UI issue was needed. The footer continues to say visual
fidelity is not measured. This is a static artifact, not a deployed server.

Browser script: `/tmp/opensight-issue-124-capture.mjs`; verification log:
`/tmp/opensight-issue-124-browser.log`.
