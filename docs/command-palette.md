# Command palette

Issue #53 implements the supplied build brief without changing
`SOLUTION_DESIGN.md` or adding dependencies.

Press **Cmd/Ctrl+K** to open quick navigation. The palette uses a native modal
dialog, focuses its labelled search field, and filters commands as you type.
Matching ignores case and supports substrings and ordered fuzzy characters;
word starts and consecutive matches rank higher. Equal scores retain menu order.
Use **Up/Down** to wrap through results, **Enter** to run the selected command,
and **Esc** or **Close** to dismiss. Empty results never execute a command.

Navigation uses the existing application routes and access checks: **Home**,
**Analyses**, **Data**, **Admin**, and **Author**. Only a loaded Author workspace
registers **Save draft**, **Toggle theme**, and its current sheets. Saving uses
the manual device-local save path; theme changes use the NEW LOOK chrome action.
**Open Q&A panel** is registered by an available Q panel, including the sample
dashboard. Commands disappear when their owning context unmounts.

The shortcut observes the existing typing, composition, repeat, and open-dialog
guards. Other Author shortcuts retain their existing scope. The palette closes
before executing actions, restoring the previously focused control when it still
exists. Navigation that removes that control falls back to the persistent Home
link. Opening Q&A then focuses its question input. Failed commands use the toast
host; successful saves retain the existing **Draft saved** notification.

The search is an accessible combobox controlling a labelled listbox, with an
active descendant and selected options. The native dialog contains Tab focus.
Editor typography, 4/8px spacing, navy chrome, and the current Author light/dark
treatment apply; the analysis chart theme is independent.

Unit and component tests run with the web workspace and root `npm test`.
Browser checks cover native focus, keyboard operation, context changes and
viewport fit against the freshly rebuilt static demo.
