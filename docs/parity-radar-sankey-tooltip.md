# Detailed tooltips for radar and sankey visuals

The `parity-radar-sankey-tooltip` phase-plan parity slice extends detailed
tooltips (`SelectedTooltipType: DETAILED` + `FieldBasedTooltip`) to radar
and sankey. Authoring export, bundle import and the Properties Tooltip
section use the compiler's shared gate; no UI code, dependencies, query
semantics or hosted resources are added. Only insight, KPI, table and pivot
remain outside the detailed-tooltip gate.

Both kinds use compiled datums rather than individual result rows:

| Datum | Detailed tooltip |
| --- | --- |
| Sankey link | Link name as title, source and destination names resolved from compiled nodes, and the compiled weight (including summed duplicate pairs) |
| Sankey node | Basic `name: value` when the hover value is a finite number; otherwise just the name, with no invented field lines |
| Radar polygon | Polygon name as title and one category-axis/value line per compiled indicator, in indicator order, using that polygon's measure format |

Sankey field-id titles use the source field's label. Source, destination and
weight lines honor hidden fields. Weight labels show “Sum of …” when
aggregations are enabled, except governed metrics, which keep their governed
name and format, following the existing detailed-tooltip convention. In
detailed mode the series' basic formatter yields to the option formatter;
basic mode keeps the existing formatter and compiled data unchanged.

Radar emits one series per color group × measure. Primary-value titles use
the polygon name (for example, “East · revenue”), or the measure name alone
when Color is absent or hidden. Field-id titles use the category field's
label. Hiding Category removes all axis lines; hiding the polygon's measure
leaves only the title. Each value uses that measure's governed format or
`displayCell`, including `(null)` for gaps. The title identifies the measure,
so axis lines do not repeat the measure or a “Sum of” prefix; the aggregation
toggle does not change these lines. Detailed radar explicitly uses an item
trigger so ECharts supplies polygon parameters. Basic output is unchanged.

Dynamic titles, field labels, node names and axis labels are escaped for
ECharts rich text. Neither kind adds source-row metadata. Tooltip extra fields
are omitted because links may sum multiple rows and polygons span category
rows. Each kind emits one warning when detailed mode has extras:

> Extra fields are not shown in radar detailed tooltips because each datum aggregates multiple rows.

The sankey warning uses the same wording with `sankey`. Existing missing
extra-column diagnostics remain intact.

Tests live in `packages/web/test/tooltip-detail.test.mjs` (compiled datum
mapping, title modes, field visibility, aggregation behavior, governed
formats, escaping, real ECharts parameters and formatter precedence, bundle
round trips, gates and Properties rendering) and
`tooltip-extra-fields.test.mjs` (aggregate warnings). Basic-mode fixtures
capture the pre-slice options, including formatter source, from `4c262fc4`.
Only the obsolete detailed-tooltip rejection cases were removed from
`radar.test.mjs`, `extra-builder.test.mjs` and `sankey-builder.test.mjs`.
All are included by root `npm test`.

Divergence notes: QuickSight renders its own detailed-tooltip composition;
this slice matches field content and visibility, not pixels. Visual fidelity
is not measured. README GIF not regenerated: the tour never opens these
tooltips. Static-demo captures and comparison findings are recorded in
[the gap notes](parity-radar-sankey-tooltip-gap-notes.md).
