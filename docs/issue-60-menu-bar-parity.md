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

Insert creates sheets, empty bar visuals (change type in Visuals), and insight
visuals. Q opens the existing local deterministic question panel, preserving
its no-AI/hosted disclosures. Calculated fields, filters and parameters open
their existing editors; filters require a selected visual. Text and image
objects remain unavailable. Data-dependent actions are disabled without data.

Sheets adds and renames sheets using the existing controls and retains sheet
switching below the reference items. Sheet tabs also appear before data is
added, so these actions have a visible result. Duplication, separate sheet
title/description objects, and layout settings remain unavailable. Existing
canvas dragging/resizing and FIT TO WIDTH are unchanged.

Objects opens Format Object, Field Wells, Title, Subtitle, Data Labels, Legend,
Conditional Formatting and Actions. It reveals the correct Properties tab and
all collapsed ancestors, then moves keyboard focus. Label/legend availability
matches the renderer's visual-type capability checks. All reference actions
require a selected visual. Visual selection and removal remain below them.
Tooltips customization, highlights, reference lines, numeric placement,
per-card style, visibility rules, forecast/anomaly authoring and CSV/Excel
query-result exports explain their missing editor support.
