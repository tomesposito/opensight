# Issue #51 — Author keyboard shortcuts

Implemented on `work/issue-51-keyboard-shortcuts` from the supplied issue brief.
No dependencies were added. `SOLUTION_DESIGN.md` is unchanged.
See [keyboard shortcuts](keyboard-shortcuts.md) for the registry, key list, and
extension instructions.

## Behavior and verification

The central registry supplies matching rules and every entry in the grouped
help dialog. Author owns one document listener and removes it on unmount.
The save button and shortcut share the existing local-draft save callback and
issue #50's `useToast()` API. Successful saves say **Draft saved**; storage
failures keep their existing explanation and never emit success. Editing does
not autosave. The reserved palette action is an intentional no-op and appears
as **coming in #53** in help.

Twenty new tests run in the existing Node/React test harness without a browser:

| Shortcut | Action coverage |
| --- | --- |
| Cmd/Ctrl+S | Both modifiers persist the latest edited draft, preserve its ID, prevent browser save, and use the existing deduplicating toast host. Failed storage emits no success. |
| ? / Shift+/ | Opens named native help with every registered label and combo, grouped by Analysis, Navigation, and Help; verifies the future palette label and Close focus restoration. |
| Esc | Registry leaves Escape unconsumed, including in editable controls; existing calculation/import cancel handlers and help close correctly. Help closes before the non-modal Ask Q panel beneath it. |
| Cmd/Ctrl+F | Opens the existing toolbar Search menu and focuses its search input for both modifiers. |
| Cmd/Ctrl+K | Both modifiers invoke the reserved handler without opening UI, changing the draft, moving search focus, or showing a toast. |

Registry tests also cover input/textarea/select/contenteditable targets,
descendants, text nodes, shadow event paths, extra modifiers, repeats, consumed
events, IME flags, composition lifecycle, modal guards, and listener cleanup.
Integration tests verify that a rerender during composition retains protection
and navigation removes listeners. The focused run, including existing toast-action and
Ask Q tests, passed **37 / failed 0 / skipped 0**.

## Demo and visual review

`npm run build:demo --workspace @opensight/web` rebuilt the static demo and embed
artifacts, including strict TypeScript checks. Chromium verified real Ctrl and
Meta saves followed by reload, search focus and menu dismissal, palette no-op,
typing/composition protection, named modal focus, Tab containment, restoration
on Close/Escape, existing calculation/import Escape, help above Ask Q, and
navigation cleanup. It reported zero page errors and zero external requests.
Light, dark, and 390px captures show all shortcuts without horizontal overflow.
Native macOS, Firefox, WebKit, and screen-reader speech output were not exercised.

At 1440px, the previous and rebuilt demo had **zero changed pixels** for Home,
empty Author, and populated Author with help closed. Review against the local
QuickSight author reference preserves the Data → Visuals/wells → sheet flow and
compact Arial chrome. The temporary help modal uses the existing chrome theme
variables, 12px body text, 13px group headings, and visible focus. No new
unresolved visual defect was found. Shortcut-dialog parity with QuickSight has
not been measured; overall visual fidelity remains unmeasured.

`docs/images/keyboard-shortcuts.png` is the new feature capture. Existing feature
screenshots remain representative because their UI did not change. The README
hero GIF was regenerated from the freshly rebuilt demo using the maintained
adaptation of `~/workspace/tools/screenshots/readme-gif-44.mjs`, adding keyboard
save and help to the tour. The capture produced 155 frames with zero page errors;
FFmpeg assembled the 960×600, 10fps GIF using the script's palette workflow.

Capture scripts, before/after images, pixel counts, and logs are retained locally
under ignored `.opensight/issue-51/`. No reference screenshots or personal data
were committed. The demo is a static artifact, not a deployed server. Nothing
was merged, pushed, published, or closed remotely. The palette remains deferred
to #53 as required; there are no other outstanding implementation items.
