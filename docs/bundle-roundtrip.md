# Author bundle round trip (Phase 1e)

In Author mode, choose **Import .qs or bundle JSON**, or drop one file onto the
import zone. A successful import opens a new device-local draft and checkpoints
existing edits first. If saving fails, the current work stays open; export it
before retrying. Invalid input leaves the draft unchanged and
shows the parser's error, including the member/property path where available.

**File → Download .qs** produces a ZIP containing camelCase members at
`analysis/{analysisId}.json`, `dashboard/{dashboardId}.json`,
`dataset/{dataSetId}.json`, and `datasource/{dataSourceId}.json`. Member envelopes,
identities and paths are validated before assembly; the completed ZIP is checked
again with the browser parser. Validation failures block the download. **Export
JSON** remains available and downloads the primary imported resource (the first
analysis, otherwise the first dashboard/resource). Use `.qs` to keep every resource.

Both paths work in the standalone `packages/web/dist/opensight-demo.html` built
by `npm run build:demo --workspace @opensight/web`. File input, parsing and Blob
downloads need no server, AWS access, or network connection.

## Authoring projection and dataset bindings

All imported analysis/dashboard sheets become tabs; their resource path is kept
in draft metadata. Globally unique internal UI IDs avoid collisions between
resources. Original sheet/visual IDs are used on export. Bar, line, pie, KPI,
table and pivot wells project dimension/measure column names into the existing
v1 authoring shapes, including direct and wrapped KPI wells. The existing type selector also works on imported visuals; changing the type
replaces its editable configuration and archives the original configuration.

The Data panel displays imported calculated expressions and parameters. Foreign
calculations remain read-only; compatible parameter declarations and controls
are live in Phase 2a ([usage and API contract](parameters-controls.md)). Compatible calculations already
bound to local sales also populate the v1 field list. Filter groups display their
original JSON and scope. A single enabled EQUALS category list with
NON_NULLS_ONLY, scoped to one visual and a known local text column, is editable
through the existing filter pills. Compatible parameter equality and inclusive range filters also execute.
Other filter configurations remain read-only;
previews depending on their unsupported semantics are blocked explicitly.
Unknown nested filter options are named in the report and block execution even
when the recognized category values remain editable. A filter with unresolved
sheet/visual references blocks its entire resource, including newly added cards.

Remote dataset declarations remain unresolved even if they have sales-like
column names. The per-card/per-visual **Remap to local dataset** action authorizes
local sales use, matches names without regard to case and checks field roles,
clears unmatched wells, and lists fields needing manual assignment. It does not
connect to imported datasources. **Remap sheet to local dataset** applies the same
matching to every unresolved card on that sheet, leaving other sheets alone.
Remapping adds a declaration using the reserved
identifier `opensight_local_sales` and the same example sales ARN emitted by v1.
A conflicting existing identifier blocks export. The original declarations and
dependency resources are retained. The exact example sales ARN is the local
binding marker when reading OpenSight exports. Unsupported visual semantics still
show a placeholder after remapping. Parameter-free offline previews retain v1's fixed sample limits. Sheets with
parameters recompute pinned sales rows locally; API mode queries the local CSV.
If an imported dataset dependency has the same ID as the example sales dataset,
it stays unresolved until explicitly remapped. The reserved local identifier
selects the configured sales data; it never connects to an imported datasource or
executes an imported dataset's transformations or security policies.

## Preservation contract and extensions

`AuthorDraft.bundle.original` contains the complete parsed member JSON.
`AuthorSheet.imported` and `AuthorVisual.imported` hold source identities,
bindings, import diagnostics and the initial authoring projection. These extend
the existing draft/reducer; no separate builder state or result rows are stored.
The import report names unsupported visual variants, properties and values;
unsupported visuals remain cards and remain in exported resources.

An untouched import/export preserves **structural JSON equality**, including
unknown properties, original casing inside opaque JSON, member order, absent
optional fields, parameter/filter configuration and original layouts. JSON
whitespace, object-key order, ZIP compression and ZIP timestamps are not part of
structural equality. Source JSON is retained verbatim as parsed values, not as
byte-for-byte original text.

Edits patch only the changed authoring projection into the original resource.
Unknown siblings and unedited field entries remain in place. Grid edits update
visual geometry while retaining other layout elements; unrepresentable grids
use a fallback in the editor and remain unchanged on export until edited.
Removing a sheet/visual also removes its references from selected filter scopes.
A grid edit replaces incompatible free-form/paginated layout variants while
preserving the original layout in the resource snapshot. Adding filters after
re-import allocates unused group IDs, preserving earlier filters and their scopes.

On the first edit to an imported resource, export adds this camelCase extension:

```json
{
  "opensightRoundTrip": {
    "version": 1,
    "originalResource": { "resourceType": "analysis", "...": "the complete original resource" }
  }
}
```

This archive copy preserves opaque configuration even when an explicit edit
replaces its parent (for example, dataset remapping replaces wells, or deleting
a visual removes its body). Subsequent edits after re-import retain the original copy and append distinct
source generations to an optional flat `priorResources` array in this extension.
Snapshots exclude the extension itself, so they do not nest; unchanged exports
do not append snapshots. This also preserves opaque data added by other tools
between OpenSight editing sessions. A conflicting, unrecognized value at the
reserved extension key blocks edits from being exported. Re-import sees the
edited resource plus this read-only extension. No AWS re-import compatibility
claim is made for OpenSight extensions; validation here is the bundle parser's
inventory contract. The v1 `opensightSubtotalOptions` table extension is unchanged.

## ZIP implementation and license verification

`@opensight/bundle-parser/browser` exposes `parseQsBundle`, `parseBundleJson`,
`assembleQsBundle`, `listZipMembers`, `parseBundleResource`, `summarizeQsBundle`
and `ZIP_LIMITS`, with no Node built-ins. It shares member/feature validation
and inventory code with the Node entry point; the Node filesystem/ZIP reader
continues to work as before.

The browser reader checks the central directory before inflation and checks
local headers, canonical paths, duplicates, compression methods, inflated sizes
and CRC32. Inflation processes small compressed chunks, enforcing actual output
sizes rather than trusting declared lengths. Shared limits are 32 MiB archive,
16 MiB per member, 64 MiB total uncompressed data, and 1,000 entries (including
directories). File sizes are checked before `arrayBuffer()`. The browser supports
stored and deflated ZIP32 members, including data descriptors; encrypted,
multi-disk and ZIP64 files fail with explicit errors. No files are extracted.

License check performed against the installed package metadata and license file:

- `fflate@0.8.3`: `MIT`. Already used by parser tests; promoted to a runtime
  dependency and imported through its browser entry point. It has no runtime
  dependencies. `node_modules/fflate/package.json` and `node_modules/fflate/LICENSE`
  confirm the license; the full notice is retained in the browser build.

Root `npm test` includes the new web tests via the existing workspace/test glob.
They cover synthetic and sanitized real archive round trips, every supported
visual, unknown features, per-resource identity/path validation, malformed ZIPs,
all ZIP budgets, dataset remapping, filter edits, draft restoration, picker/drop
interactions, and offline Blob downloads.
