# Custom actions and drill-down

In Author mode, select a visual and open **Interaction → Custom actions** in Properties. Choose
**Filter** in the action-type picker and add an action, choose the source dimension, and choose all compatible targets or
explicit targets. Each target lists its eligibility and allows an explicit
field mapping. Mappings require matching types and a dimension grouped by the
target or included in its hierarchy. KPIs, unresolved datasets, unsupported numeric grouping, and missing
fields display their reasons. Filter actions stay on the current sheet.

Click a bar segment, pie slice, or table row to apply its selection. A line
chart with a datetime axis offers the ECharts range brush. The accessible
**View data** rows provide another way to select categories. Select the same
category again or use **Reset actions** to clear it. Multiple source selections
intersect with each other and with the visual's saved and parameter filters.

Use **Drill hierarchy** to define ordered dimension levels or the built-in
Year → Quarter → Month sequence. Save the hierarchy, then choose **Drill down**
and select a category or row. **Drill up** and the breadcrumb buttons return to
an ancestor. Bar, line, pie, table, and pivot visuals support this navigation;
pivot drill selects row dimensions, excluding subtotal and total rows. Editing
dimension wells clears the attached hierarchy so the assigned fields remain
authoritative. Drill paths and active action selections are temporary and are
not saved as definition filters.

Live interactions reuse typed parameter declarations, bindings, and filters in
`POST /api/datasets/sales/query`. The API's strict request shape is unchanged.
The query planner additionally accepts UTC YEAR, QUARTER, and DAY grouping,
alongside MONTH. Browser fixtures run the same validated plan over pinned sales
rows. A sheet with interactions recomputes all its visuals across all regions;
a sheet without interactions or parameters retains the original fixed preview
behavior. Live queries debounce for 250 ms, hide previous results immediately,
and discard superseded responses. Errors never substitute fixture results.

Bundle definitions use camelCase `actions[].actionOperations[].filterOperation`
with `selectedFieldsConfiguration` and same-sheet `targetVisualsConfiguration`.
Native field and visual IDs are preserved across edits. Per-target mappings use
the `opensightFieldMappings` extension on the action. Hierarchies use native
`columnHierarchies[].explicitHierarchy` or `dateTimeHierarchy` wrappers;
`opensightName` and `opensightLevels` preserve builder names and the exact ordered
levels. Native explicit column lists and implicit datetime hierarchies import
without these extensions. Untouched native shapes and unknown JSON round-trip
verbatim. Unsupported operations, populated native drill-down filters, and
multiple simultaneous hierarchies are retained and reported rather than
executed with guessed semantics. URL and same-analysis navigation actions are
also supported as described below.

Regression coverage is included in root `npm test`: UI selection/reset and drill
navigation, fixture and live HTTP/DuckDB parity, pending/cancellation behavior,
hierarchy validation, eligibility reasons, and JSON/ZIP/native-ID round trips.
No new dependencies were introduced.

## URL actions

Choose **URL**, add an action, and enter its name, source dimension and absolute
HTTP(S) URL template. `{region}` and other grouped-dimension placeholders use the
clicked selection, with each value encoded as a URI component. Repeated
placeholders are supported. The default target is a new tab; the editor also
offers the current tab. Both use `window.open` with `noopener,noreferrer`.
No hosted API is needed for the browser navigation itself.

Origin eligibility matches filter actions. Unknown dimensions, missing clicked
values, malformed placeholders, empty templates, invalid URLs and non-HTTP(S)
schemes disable execution with named `URL_*` problems in the action editor.
Unfinished templates remain editable and can be saved locally. The actual
interpolated URL is validated again on every click. A brush selection never
opens a URL. Browser popup settings can still block opening a new tab.

## Navigation actions

Choose **Navigation**, add an action, and choose a target sheet in the current
analysis. Optional mapping rows associate source grouped dimensions with declared
analysis parameter names. Each mapping must resolve to a parameter with the same
field type. Only one source field can map to a given parameter. Unknown or deleted
sheets, missing fields or parameters, duplicate parameter targets, incompatible
types and invalid clicked values show named `NAVIGATION_*` problems.

All mappings are checked before any state changes. A successful click applies
parameter values through the same reducer path as parameter controls, then
selects the destination sheet. Default parameter values remain unchanged; bound
filters and controls reflect the new current values. A click sets one value even
for a multi-value parameter. Datetime grouping buckets map to their UTC start
(e.g. `2025-Q2` becomes `2025-04-01`); numeric parameters never coerce strings.
No mappings means only the sheet changes. A brush selection never navigates.

These actions work client-side in the static demo. Sheets and parameters from
another analysis/dashboard resource in an imported bundle are excluded.
Cross-analysis/dashboard navigation is out of scope because there is no dashboard
registry to resolve it. On a click, filter selection runs first, then URL actions,
then the first valid navigation action. Armed drill mode handles the click instead.

## URL/navigation bundle subset and integrity

Both new kinds require `status: "ENABLED"`, `trigger: "DATA_POINT_CLICK"` and
exactly one recognized operation. Export uses:

- `actionOperations: [{ urlOperation: { URL, target? } }]`, where `target` is
  `_blank` or `_self`. Import also accepts camelCase `url` with optional
  `urlTarget: "NEW_TAB" | "SAME_TAB"`; conflicting aliases are rejected.
- `actionOperations: [{ navigationOperation: { targetSheetId,
  parameterMappings } }]`, with a source-field-name → parameter-name object.
  Omitted mappings import as an empty object.

The `opensightSourceField` action extension preserves the chosen source dimension.
Without it, import uses the first grouped dimension. Native sheet IDs resolve
only within their originating resource and export back to native IDs. Missing
native IDs remain unresolved and cannot accidentally match a local sheet ID.

The build brief does not define the nested `navigationTarget` shape. Until that
shape is specified, such operations remain unrecognized, retained and reported;
they are never interpreted as same-analysis navigation. Unknown keys, triggers,
operation combinations and mapping shapes also remain opaque. Duplicate action
IDs are not imported as executable actions. Edits preserve opaque entries and
unchanged native action shapes, including when another action kind is edited or
removed. Recognized but invalid URL templates or navigation mappings remain
editable with named problems and never execute.

Root `npm test` includes URL interpolation and unsafe-scheme rejection, action
editor and click execution, atomic navigation parameter changes, destination
fixture results, same-resource identity resolution, and JSON/ZIP/local-storage
round trips with unknown-operation preservation. No dependencies were added.
Visual fidelity has not been measured. Per this build brief, demo rebuild and
README media refresh are handled by the watchdog after verification.
