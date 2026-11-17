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
- **Row patches require the version the editor loaded.** Every patch must
  supply `expectedVersion` and match the table's current version before it
  merges against the latest committed row. Concurrent edits can conflict
  even when they change different cells; reload and reconcile before retrying.
- **Every change is audited.** Table creation, renames, row adds, cell
  updates (old → new value), row deletes, editor changes, and table deletion
  are appended to an append-only audit trail in the same store update as the
  change itself, so data and audit cannot diverge. Deleting a table keeps
  its retained audit trail readable, subject to the count and byte retention
  policy below (D-84).

## Where they live

v1 ships on the local/organization API server (`createApiServer`). Tables
persist in a dedicated JSON store — `.opensight/input-tables.json` by
default, overridable with `OPENSIGHT_INPUT_TABLE_STORE` — written atomically
(temp file + rename) and validated strictly on load: a corrupt store fails
closed at startup with `INPUT_TABLE_STORE_CORRUPT`. The hosted server does
not expose input tables yet; see `docs/issue-161-gap-notes.md`.

## Audit retention

The local JSON store keeps up to **1,000 audit entries and 16 MiB per table**
and **10,000 audit entries and 64 MiB overall**, across all tables and namespaces
(#220, #245). Bytes are the sum of each entry's serialized JSON size in UTF-8,
including metadata and JSON escaping (excluding the enclosing array). Each
append first prunes that table's oldest entries until both its caps hold, then
prunes the oldest entries overall until both overall caps hold. Retained
entries stay in append order; byte or overall caps may leave a table with
fewer than 1,000 entries. Pruning and the data change persist in the same
atomic store update.

The just-appended entry always survives. If it alone exceeds the per-table
byte budget, all older entries for that table are evicted; if it alone exceeds
the overall byte budget, all older entries overall are evicted. This deliberate
single-entry exception keeps the latest audit evidence without rejecting the
mutation. The next append applies the same oldest-first policy.

This policy implements [D-84](idd/D-84-tenant-erasure-audit-retention.md):
deleting a table does not erase its audit history; normal retention expires
the oldest entries as new entries arrive. There is no time-based expiry or
archive in this local store. A deleted table's audit endpoint remains readable
while it has retained entries; after all its entries are pruned it returns 404.
Legacy stores above count or byte caps still load without pruning or failing closed;
the caps apply on append (per table for the table receiving the entry, then
overall).

Row-add and row-delete audit details keep the complete row, and updates keep
old and new cell values. With at most 32 columns and 10,000 characters per
text cell, one maximal ASCII update is roughly 640 KB. The 16 MiB budget
allows roughly 26 such updates, while 64 MiB bounds the combined history;
ordinary small entries still reach the existing count caps. Multibyte text
and JSON escapes consume their actual serialized bytes.

Single-table reads clone only the requested table. Audit reads project only
authorization metadata and namespace-visible entries: paginated reads count
the visible entries and select the requested page before cloning, without
cloning table rows, columns or off-page audit payloads (#245). Unpaginated
reads still return all visible entries. List and prep paths still read the
whole store, and mutations still clone and atomically rewrite it.

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
| `PATCH /api/input-tables/:id/rows/:rowId` | Update cells (editors). Body: `values`, required `expectedVersion`; the merged row is revalidated. |
| `DELETE /api/input-tables/:id/rows/:rowId` | Delete a row (editors). |
| `DELETE /api/input-tables/:id` | Delete the table (owner or administrator). Audit is retained. |
| `GET /api/input-tables/:id/audit` | Retained audit entries, oldest first; optional `limit` and `offset`. Works after deletion while entries remain. |

Without pagination parameters, the audit response stays `{ entries }` and
includes all retained entries for that table. Supplying `limit` or `offset`
returns `{ entries, total, limit, offset }`: `total` is the table's retained
entry count before slicing. `limit` is an integer from 1 to 1,000 (default
1,000 when only `offset` is supplied); `offset` is a nonnegative safe integer
(default 0). For example, `?limit=2&offset=2` returns the third and fourth
oldest retained entries. Offsets at or beyond `total` return an empty page.
Invalid or repeated pagination values return 400
`INPUT_TABLE_AUDIT_PAGINATION_INVALID`. Unknown query parameters are rejected,
and every input-table route except this audit GET still rejects query
parameters. Namespace checks apply before slicing, including after deletion.

Row PATCH merges and validates against the latest committed row inside the
serialized store mutation. Audit old values come from that same row.
`expectedVersion` is required and must be the table version the editor loaded.
Omitting it returns 400 `INPUT_TABLE_VERSION_REQUIRED`. A supplied value that
is not a positive safe integer returns 400 `INPUT_TABLE_INVALID_VERSION`.
The version is compared with the table's current `version` inside the mutation,
after rechecking editor authorization; a mismatch returns 412
`INPUT_TABLE_VERSION_CONFLICT`. Every rejection leaves table data, table
version and audit unchanged. This is a table-wide version, so any intervening
table change can cause a conflict, including a change to another row. On
conflict, reload the table and reconcile edits before retrying with the fresh
version. There is no unconditional row-patch option.

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
