# Filter actions and drill-down

In Author mode, select a visual and open **Filter actions** in Properties. Add
an action, choose the source dimension, and choose all compatible targets or
explicit targets. Each target lists its eligibility and allows an explicit
field mapping. Mappings require matching types and a dimension grouped by the
target. KPIs, unresolved datasets, unsupported numeric grouping, and missing
fields display their reasons. Actions stay on the current sheet.

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
executed with guessed semantics. URL and navigation actions remain out of scope.

Regression coverage is included in root `npm test`: UI selection/reset and drill
navigation, fixture and live HTTP/DuckDB parity, pending/cancellation behavior,
hierarchy validation, eligibility reasons, and JSON/ZIP/native-ID round trips.
No new dependencies were introduced.
