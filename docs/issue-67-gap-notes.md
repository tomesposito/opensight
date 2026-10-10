# Issue #67 — Text and image sheet objects

The issue brief is the specification for this UI slice. `SOLUTION_DESIGN.md`
is unchanged. No dependencies, hosted services or network calls are added.

`AuthorSheet.objects` is an optional parallel list of text/image objects. Old
version-2 drafts remain valid. Visuals and objects share `layout` and
`selectedId`; objects never enter query compilation or visual field wells.
Every edit uses the author reducer and the existing undo/redo snapshots.
Insertion, deletion and layout updates are atomic. Objects support mouse
handles, numeric grid placement and arrow keys on the Move handle;
Shift+arrows resizes. Mobile uses the existing stacked canvas preview, with
numeric placement available for the saved desktop layout. Objects menu
selection, Format Object, Style, Placement and removal include these objects.

Text is edited in place with font size (8–96 px), bold, italic, underline,
color and alignment. Formatting applies to the whole text box. Content is
limited to 20,000 characters. Hyperlinks and parameters-in-text have disabled
controls with explanations. Arbitrary imported rich HTML is retained in the
original bundle and named in the import report, without being executed.

Images use a device-local `image/*` file picker, a **4 MiB (4,194,304 byte)**
per-image cap, and a base64 image data URI. MIME, byte count, URI shape and
browser decoding are checked. Oversize files report `IMAGE_TOO_LARGE` and
are not downscaled or inserted. All image bytes are included in JSON and
`.qs` exports; no hosted upload or remote image URL is used. The async picker
refuses insertion if the draft changed while reading. The Properties panel
supports an accessible description, opacity and aspect-ratio preservation.
The default is `object-fit: contain`: resize the grid frame freely and fit the
image inside it without distortion or cropping. Clearing the option stretches
the image to the frame. The default does not lock the grid frame's ratio,
which keeps geometry consistent with the existing integer grid.

The serialization mapping is explicit and provisional where the bundle model
has no native embedded-image field:

| Draft | Bundle definition | PascalCase definition input |
| --- | --- | --- |
| Text identity | `sheets[].textBoxes[].sheetTextBoxId` | `Sheets[].TextBoxes[].SheetTextBoxId` |
| Text content/style | Escaped `content` text-box HTML plus `opensightText: {content, style}` | `Content`, `OpenSightText` |
| Image identity | `sheets[].images[].sheetImageId` | `Sheets[].Images[].SheetImageId` |
| Embedded bytes | `source.opensightDataUri` | `Source.OpenSightDataUri` |
| Image fit | `scaling.scalingType`: `SCALE_TO_FIT` / `SCALE_TO_FILL` | `Scaling.ScalingType` |
| Image description/opacity | `imageContentAltText`, `opensightOpacity` | `ImageContentAltText`, `OpenSightOpacity` |
| Placement | Grid elements with `TEXT_BOX` / `IMAGE`; columns ×3, rows unchanged | Existing `Layouts.Configuration.GridLayout` conversion |

The OpenSight extensions preserve exact content, formatting, image bytes and
opacity on JSON and ZIP round trips. They do not claim direct AWS import
compatibility. Plain foreign text can be edited; unsupported foreign markup,
URL-backed images and unknown fields remain read-only in the retained source
bundle and are never fetched or injected. Editing an imported supported
object patches its fields while preserving unknown metadata. Removing it
removes its projected element and placement, leaving opaque siblings intact.

Whole-box styling, rather than mixed formatting within a text selection, is
the supported subset. Text hyperlinks, parameters, remote images and arbitrary
foreign HTML rendering remain unavailable. Autosave uses existing browser
storage; quota failures retain the editor state and report the existing
export-to-keep-your-work explanation.

Browser and README verification results (recorded 2026-10-10 after capture):

- `packages/web/scripts/capture-text-image-objects.mjs` (new): 7 recorded
  checks against the rebuilt static demo, zero page errors, zero external
  HTTP requests. Insert -> Add Text / Add Image are enabled; text box content
  edits in place with font size/bold/alignment persisted; arrow-key move and
  Shift+arrow resize undo/redo step by step through the Edit menu; a generated
  SVG embeds from the device picker with description and opacity; the Objects
  menu selects the image and Placement focuses its numeric controls; removal
  via the Objects menu and undo restore. Raw captures stay in ignored
  `.opensight/issue-67/browser/`.
- The Codex run left 8 web-package test failures (two file inputs colliding
  in test selectors; empty-state copy changed to "Select a visual or object").
  Fixed in commit e9ce132c: tests disambiguate the bundle-import input by its
  `.qs` accept attribute, the image picker handler uses `e.currentTarget`
  like the import input, and the copy assertions match the new text.
- README media refreshed: hero GIF regenerated from the current demo
  (`docs/images/opensight-tour.gif`) and new feature screenshot
  `docs/images/text-image-objects.png` with a short README section. Note:
  `~/workspace/tools/screenshots/readme-gif-44.mjs` broke again on the
  ambiguous `page.click('text=Data')` (15 matches); `setMode` now uses the
  role-scoped product-nav selectors from
  `packages/web/scripts/app-navigation.mjs`.
