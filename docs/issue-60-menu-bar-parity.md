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
