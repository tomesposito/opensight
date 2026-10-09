# Issue #60 — Author menu bar parity

The Author toolbar follows the supplied File, Edit, Data, Insert, Sheets,
Objects, Search menu specification. This change uses the existing editor
capabilities; it adds no dependencies or hosted services.

File keeps Import and definition exports (.qs and JSON), adds Rename, and
uses the same honest Publish notice as the toolbar. Exports expands the two
existing download choices. Favorites, Save as Analysis (a separate copy),
Share, Print, and PDF export are unavailable with specific reasons. Autosave
On is a checked, read-only status for device-local autosave; storage failures
are exposed in its explanation. This status does not claim a successful save.

Unavailable actions remain keyboard reachable with `aria-disabled`, cannot
run a handler, and explain why on focus or hover and through their accessible
description. Menus retain native disclosure keyboard behavior, Escape and
outside-click closure. No reference screenshots belong in this repository.

Edit opens Analysis theme in Properties, even from the Interaction tab or a
collapsed dock. Undo, Redo and Analysis Settings explain their missing editor
support. Theme controls require a dataset because the empty editor has no
Properties dock.

Data opens the Data dock, data sources (or preparation when that is the
available entry point), calculated fields, and parameters. Prepare data is
retained below the reference items. Navigation checkpoints unsaved work using
the existing draft guard. Add Parameter opens the existing editor and focuses
the name; repeated activation keeps it open, with an explicit Cancel action.
