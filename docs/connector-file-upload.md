# File connector: DuckDB staging

`parseUpload({ config, data, columns? })` validates the whole file;
`UploadStaging.create()` / `ingest(...)` materializes a session-owned in-memory
DuckDB table and returns `{ id, rowCount, columns, delimiter?, sheet? }`.
`preview(id)` reads up to 20 rows from that table; `close()` discards the session.
Staging is ephemeral. In the [local file workspace](local-data.md), save a prep
pipeline to chart its output through the DuckDB-backed query API.
No filesystem path, URL, or SQL is accepted from an upload. DuckDB extension
installation and external access are disabled. Values use bound parameters.
Failed ingestion drops its private table before returning a named error.

Config requires `format`: `csv`, `tsv`, `json`, `xls`, or `xlsx`. CSV detects comma,
tab, semicolon or pipe across all rows; ambiguous files require `delimiter`.
TSV requires tabs. UTF-8 BOM, CRLF, quoted delimiters, escaped quotes and quoted
newlines are supported. Empty text cells are null. Blank data records are retained
and validated, never silently skipped. Header-only CSV returns zero rows.
JSON must be a nonempty array of flat objects with identical keys in every row;
key order may vary. Duplicate keys, nested values and nonfinite numbers fail.
Excel must have headers at A1; choose `sheet` explicitly for multi-sheet files.
Formula/error cells and merged cells fail instead of using stale cached values.

Names must be unique ignoring case, nonblank, trimmed, at most 128 characters,
and free of control characters. Types are INTEGER (safe JS integers), DECIMAL
(finite double), STRING, BOOLEAN, and DATETIME (ISO date or UTC timestamp).
Inference checks every row, widens integer + decimal to decimal, and rejects
mixed types. All-null columns default to STRING. Optional `columns` specifies the
exact ordered schema. Declare STRING to retain numeric-looking text IDs or large
integer strings. JSON retains scalar types instead of coercing strings to numbers.
Limits: 8 MiB input, 100,000 rows, 256 columns, 20 staged tables per session.
No remote file reads or live database are required.

License verification at build time (2026-09-28): installed `xlsx@0.18.5`
`LICENSE` is Apache-2.0; installed `mysql2@3.24.4` `License` is MIT. All 19 newly
resolved packages in package-lock.json declare MIT or Apache-2.0 (adler-32,
aws-ssl-profiles, cfb, codepage, crc-32, frac, generate-function, iconv-lite,
is-property, long, lru.min, mysql2, named-placeholders, safer-buffer, sql-escaper,
ssf, wmf, word, xlsx). No proprietary parser was introduced.

## Hosted API

Authenticated users with `build` capability can use:

- `GET /api/connectors`: public schemas plus honest availability states.
- `POST /api/connectors/:id/connect` with `{ config }`: validates configuration
  only; credentialed connectors return `not_configured`, unimplemented engines
  return `not_implemented`. This route never opens a remote connection.
- `POST /api/uploads` with `{ config, base64, columns? }`: canonical base64 bytes,
  optional exact column schema; returns HTTP 201 with the staging summary.
- `GET /api/uploads/:id`: summary and up to 20 rows from the staged DuckDB table.

These legacy authenticated routes retain their existing limits. The default
fixture CLI separately enables [local uploads](local-data.md), with an 8 MiB
file cap and explicit 24-hour expiry; remote connectors remain gated. Reader access is denied. Upload IDs are scoped to both the
verified user and namespace; another principal receives `UPLOAD_NOT_FOUND`.
Request bodies cannot assert identity, credentials, paths or SQL. The HTTP JSON
envelope is capped at 1 MiB; the browser form limits files to 640 KiB to leave
room for base64/JSON overhead. Library staging retains its separate 8 MiB limit.
The server permits 32 owner sessions and serializes ingestion within each owner.
Staging is ephemeral, closes with the server, and is not an analysis dataset
catalog. Upload errors carry `errorCode`, `Message`, and `path`; oversized requests
return 413. No remote connector can be configured through upload request fields.
