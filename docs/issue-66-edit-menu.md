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
Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y work throughout the editor, including live
property inputs. Modal dialogs retain native text editing; composition, repeats
and already-consumed keys are ignored. The shortcuts help lists these keys.

No dependency, hosted service, environment variable or solution-design change
is required.
