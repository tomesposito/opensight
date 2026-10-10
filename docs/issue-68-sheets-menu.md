# Issue #68: Sheets menu follow-up — Duplicate, Titles, Layout settings

Implements the Sheets menu items left honestly disabled in #60.

## What shipped

**Duplicate Sheet** (`Sheets → Duplicate Sheet`)
- Deep-copies the active sheet: visuals, text/image objects, controls, and layout.
- Every id is remapped (sheet, visuals, nested filter/url/navigation actions, objects, controls, layout placements), so the copy is fully independent — edits to the copy never affect the original.
- Navigation actions that targeted the source sheet are retargeted to the copy; other targets are preserved.
- Imported markers are cleared: the copy is a local sheet, not a bundle import.
- Named `{original} (copy)` and selected immediately.

**Sheet title / description objects** (`Sheets → Add Title`, `Sheets → Add Description`)
- Adds a text object at the top of the sheet (existing canvas content shifts down).
- Title: 24px bold, pre-filled with the sheet name. Description: 14px, placeholder text.
- Both are ordinary sheet text objects — editable, stylable, deletable like any text box from #67.

**Layout Settings** (`Sheets → Layout Settings`)
- Dialog with row height (20–120px) and item spacing (0–48px).
- Stored per sheet as `layoutSettings`; applied to the canvas grid; persisted in the analysis definition as `opensightLayoutSettings`; restored on bundle import.

## Persistence format

Sheet definitions carry an optional `opensightLayoutSettings: { rowHeight, margin }` alongside the QuickSight-compatible fields. Unknown to QuickSight; ignored on import elsewhere.

## Tests

`packages/web/test/sheets-menu.test.mjs` (9 tests): duplicate independence and id remapping, navigation retargeting, title/description placement and styling, settings validation, settings apply/reject, bundle round-trip.
