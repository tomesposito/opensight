# Input tables

Input tables are governed, editable tables that OpenSight owns (issue #161,
IDD decided 2026-10-30). They exist for the data a workspace collects itself —
a forecast next to actuals, a status list, planning numbers — entered through
a grid instead of maintained in a side spreadsheet.

The rules that make them safe:

- **Sources are never mutated.** An input table is a new table in the
  workspace's own store. OpenSight holds no write credentials for any
  connected source, and no edit ever reaches one.
- **Write access is per table.** The table's owner and workspace
  administrators manage an explicit editors list. Editing is also an
  author-class act: a user whose role is reader can never write, even when
  listed as an editor. Everyone else in the workspace sees current values
  read-only.
- **Columns are typed from day one.** Each column is text, number, date, or
  boolean, and required or optional. Values are validated on entry; an
  invalid calendar date, a non-finite number, a missing required value, or an
  unknown column is refused with a named error (`INPUT_TABLE_*`). The column
  schema is fixed when the table is created in v1.
- **Row patches merge against the latest committed row.** Different-cell
  concurrent patches both apply. Same-cell patches without an
  `expectedVersion` remain last-write-wins; callers can supply the table
  version to reject stale saves instead.
- **Every change is audited.** Table creation, renames, row adds, cell
  updates (old → new value), row deletes, editor changes, and table deletion
  are appended to an append-only audit trail in the same store update as the
  change itself, so data and audit cannot diverge. Deleting a table keeps
  its audit trail readable (the D-84 retention rule: audit entries are
  retained).

## Where they live

v1 ships on the local/organization API server (`createApiServer`). Tables
persist in a dedicated JSON store — `.opensight/input-tables.json` by
default, overridable with `OPENSIGHT_INPUT_TABLE_STORE` — written atomically
(temp file + rename) and validated strictly on load: a corrupt store fails
closed at startup with `INPUT_TABLE_STORE_CORRUPT`. The hosted server does
not expose input tables yet; see `docs/issue-161-gap-notes.md`.

## API

All routes are namespace-scoped; a table in another namespace is a 404.

| Route | What it does |
| --- | --- |
| `POST /api/input-tables` | Create a table (author capability). Body: `name`, optional `boundDatasetId`, `columns`, optional `editors`. |
| `GET /api/input-tables` | List tables with counts and the caller's `canEdit` / `canManage`. |
| `GET /api/input-tables/:id` | The full table: columns, rows, editors. |
| `PATCH /api/input-tables/:id` | Rename and/or set `boundDatasetId` (editors and above). |
| `PUT /api/input-tables/:id/editors` | Replace the editors list (owner or administrator). Editors must be workspace users. |
| `POST /api/input-tables/:id/rows` | Add a row (editors). Body: `values` keyed by column name. |
| `PATCH /api/input-tables/:id/rows/:rowId` | Update cells (editors). Body: `values`, optional `expectedVersion`; the merged row is revalidated. |
| `DELETE /api/input-tables/:id/rows/:rowId` | Delete a row (editors). |
| `DELETE /api/input-tables/:id` | Delete the table (owner or administrator). Audit is retained. |
| `GET /api/input-tables/:id/audit` | The append-only audit entries, oldest first. Works after deletion. |

Row PATCH merges and validates against the latest committed row inside the
serialized store mutation. Audit old values come from that same row.
Optional `expectedVersion` must be a positive safe integer (otherwise
400 `INPUT_TABLE_INVALID_VERSION`). It is compared with the table's current
`version` inside the mutation; a mismatch returns 412
`INPUT_TABLE_VERSION_CONFLICT` without changing the table or appending an
audit entry. This is a table-wide version, so any intervening table change
can cause a conflict, including a change to another row. Reload the table
and reconcile edits before retrying. Omitting the version preserves
last-write-wins behavior for the cells in the patch.

Limits: 1–32 columns per table, 10,000 rows per table, text values up to
10,000 characters, table names up to 120 characters. `boundDatasetId` binds a
table to a dataset for context; in v1 it is an opaque reference validated for
shape only.

## Use in data prep

An input table is a prep source like an uploaded dataset. Its source id is
`input-table-<tableId>`; it appears in `GET /api/prep-sources` and can be a
pipeline's input or a join source:

```json
{ "version": 1, "input": "upload-source-id",
  "steps": [{ "id": "join", "kind": "join",
    "config": { "source": "input-table-<tableId>", "joinType": "inner",
                "keys": [{ "left": "region", "right": "region" }], "prefix": "fc_" } }] }
```

Prep reads the table's current rows through the in-memory table path.
A reference to a table in another namespace resolves to nothing and the
pipeline fails closed with `PREP_SOURCE_NOT_FOUND`. In the Data UI, the
table also appears in the Data Prep source picker under the same id.

## In the Data UI

The Data page has an **Input tables** tab: create a table (name, optional
bound dataset, typed columns), edit its grid in place (typed cell inputs,
per-row save, add/delete rows), manage editors, and read the audit trail.
Row Save sends the loaded table version because it submits the full row;
a stale save reports a conflict and keeps the draft for review.
Users without an editor grant see the grid read-only, with the reason stated
plainly.
