# Issue #66 — Edit menu visual verification

Compared the rebuilt local static demo with the supplied QuickSight Edit-menu
reference from the local reference set. The reference was viewed locally and
was not copied into the repository. Edit retains Undo, Redo, the separator,
Themes and Analysis Settings in reference order, with the existing navy/blue
toolbar, Arial system fonts and compact controls.

The menu remains wider than the reference and lacks its small item icons,
as recorded in #60. Empty history explains availability on focus and hover;
revealed explanations remain expanded until the menu closes so they cannot
move a later action during activation. Settings uses a native modal with
visible labels, staged edits, a theme preview and explicit explanations for
the unavailable locale/date defaults and hosted permissions. These explanations
stay visible to keep Apply and Cancel in place as focus changes.

Visual fidelity has not been measured; the demo disclosure remains unchanged.
The local settings surface does not claim parity with settings unavailable in
the reference image. No new GitHub issue or phase-plan edit was made under the
offline/no-spec-edit brief.

The capture workflow adapts the supplied `readme-gif.mjs` and its ffmpeg palette
and assembly commands. Run `node packages/web/scripts/capture-edit-menu.mjs`
against a freshly rebuilt `packages/web/dist/opensight-demo.html`. All HTTP(S)
requests are blocked and counted. Raw captures, definition exports, frames
and browser logs stay in ignored `.opensight/issue-66/browser/`; only selected
sanitized feature images and the assembled hero GIF go into `docs/images/`.
The screenshots depict a local static demo, not a deployed server.

The browser tour passed **23 recorded checks, zero page errors and zero
external HTTP requests**. It compares complete saved drafts across field-well
drops/removals, automatic visual creation, visual add/remove, property changes,
undo/redo interleavings and new edits clearing redo. It exercises all requested
keyboard variants, empty-stack explanations, palette actions, staged settings,
Cancel/Escape focus return, validation, real theme changes, definition export
and reload persistence with fresh history.

Edit and Settings fit at 1440, 1100, 760 and 390px in light and dark themes.
Keyboard navigation reaches the disabled explanations; the native dialog keeps
background controls inert, including attempted programmatic focus. Native Tab
navigation may visit browser chrome before returning to the dialog. The separate
root-wired geometry suite verifies that explanations never move Apply/Cancel
during activation. No new unresolved visual defect was identified.

README media: **64 frames, 960×600, 10fps, 6.4 seconds**. Refreshed the hero GIF,
Author and command-palette screenshots; added Edit-menu and Analysis Settings
screenshots. The capture script uses the textbox's accessible name for populated
descriptions, whose textarea text can also appear in label-selector text.
