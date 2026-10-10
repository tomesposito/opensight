# Issue #69: Objects menu follow-up

Implements the Objects menu items left honestly disabled in #60 that can be built without a hosted backend or ML.

## What shipped

**Reference Lines** (`Objects → Reference Lines`)
- Add dashed lines at fixed values on the value axis of bar, line, area, combo, and scatter charts.
- Each line has a value, optional label, and color. Rendered via ECharts markLine.
- Stored on the visual as `referenceLines`; serialized to the bundle as `opensightReferenceLines`; validated on import.

**Export Visual to CSV** (`Objects → Export Visual to CSV`)
- Downloads the visual's current query rows as CSV (RFC 4180 escaping).
- Works for any visual with data; reports honestly when no rows have loaded.

**Export Table to Excel** (`Objects → Export Table to Excel`)
- Downloads table/pivot visuals as SpreadsheetML (`.xls`), which Excel opens natively.
- Available only for table and pivot visuals; other visual types keep a clear explanation.

**Placement** (`Objects → Placement`)
- Numeric column/row/width/height inputs for the selected visual in the Properties panel.
- Previously only sheet objects had numeric placement; visuals were drag-only.

**Tooltips** (`Objects → Tooltips`)
- Show/hide toggle in Display settings. Serialized as `tooltipVisibility` in the chart configuration.

## Honestly disabled (with reasons)

- **Highlights**: use Conditional Formatting for data-driven emphasis; dedicated highlight rules are not built.
- **Style**: per-visual card styling beyond themes and palettes is not built.
- **Rules**: visibility rules need a hosted rule engine; all visuals are always visible here.
- **Forecast / Anomaly**: need an ML backend, which OpenSight does not include. Nothing is computed or shown; the menu says so instead of faking it.

## Tests

`packages/web/test/objects-menu.test.mjs` (8 tests): reference line add/update/remove/validation, bundle serialization, CSV escaping, SpreadsheetML structure, tooltip toggle.
