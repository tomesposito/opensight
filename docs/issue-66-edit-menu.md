# Issue #66 — Edit menu follow-up

Source: [issue #66](https://github.com/tomesposito/opensight/issues/66), with
no comments, and the implementation requirements in the working brief.

## Undo and Redo

The editor records reversible commands around its immutable authoring reducer.
Each command retains the forward result and inverse draft, including visual
IDs, layout, selected visual/sheet, field wells, properties, and dependent
visual-action mappings. Undo applies the inverse; redo applies the captured
result, independent of the current selection. There are at most 50 commands.
A new content edit clears redo; rejected and identical edits do not.

All authoring mutations use this history, including layout, sheets, parameters,
calculations, theme and titles. Selection and NEW LOOK are navigation/preferences
and do not consume or clear history; replay reveals the edited sheet/visual and
preserves NEW LOOK. Autosave, explicit Save and Favorites save the real current
draft without clearing history. Opening, importing, replacing, copying or
removing an analysis resets history, as does leaving/reloading the editor.
History is session-local and is never written to storage or definition exports.

Edit → Undo/Redo and their palette actions use the same commands. Empty stacks
leave keyboard-reachable `aria-disabled` items with focus/hover explanations.
Revealed menu explanations remain expanded until the menu closes, so a focus
change cannot move the next action between pointer-down and click.
Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y work throughout the editor, including live
property inputs. Modal dialogs retain native text editing; composition, repeats
and already-consumed keys are ignored. The shortcuts help lists these keys.

No dependency, hosted service, environment variable or solution-design change
is required.

## Analysis Settings

Edit → Analysis Settings opens a native modal even on an analysis without data.
It edits the name (1–256 characters), description (up to 4,000 characters), and
analysis theme (keep the current custom theme, Light or Dark). Apply validates
and commits all three as one command; Cancel/Escape discard staged changes and
return focus. Themes drive the existing chart/canvas renderer and preserve
per-visual palette overrides. Custom colors and fonts remain in Edit → Themes.

The settings persist in device-local drafts and copies. Definition JSON and
.qs downloads include the name and the `definition.opensightDescription` and
`definition.opensightTheme` extensions; reimport restores them. Older drafts
need no migration. Imported secondary resources remain unchanged, and unknown
imported description extensions are retained read-only until explicitly edited.
Dataset-only imports gain an analysis resource when settings are authored.

Locale/date-format defaults and sharing/permissions remain individually
`aria-disabled` and keyboard reachable, with permanently visible explanations
to keep the modal stable as focus changes. The former
is not supported consistently by the current rendering paths; UTC date grouping
is unchanged. Sharing requires a hosted analysis and API integration. Neither
limitation disables the feasible local settings surface.
