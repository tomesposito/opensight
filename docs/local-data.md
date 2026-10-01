# Local file data

Issue #29 enables the run brief's local upload → preparation → chart workflow.
`SOLUTION_DESIGN.md` remains unchanged. Hosted authentication and connectors keep
their existing contracts.

The default `OPENSIGHT_MODE=fixture` API CLI enables local data. Run the API and
web development server together; the static HTML demo cannot upload files.
Library hosts opt in with `createApiServer({ dataRoot, localData: true })`.
Local data cannot be combined with hosted mode, configured authentication or
PostgreSQL prep bindings. It is a single shared workspace for people using that
local API, not a login or tenant boundary. Keep the local API on loopback.

In **Data sources**, select **Upload a file**, choose CSV (or an existing supported
format) and optionally a delimiter. The server validates every row, infers column
types, and stages values in an in-memory DuckDB table. Files are limited to
**8 MiB**, **100,000 rows** and **256 columns**, with at most **20 uploads**.
The local JSON envelope allows 12 MiB for base64 overhead. Oversized files return
HTTP 413; invalid formats, ambiguous delimiters and inconsistent types produce
named errors. No filenames, paths, URLs or SQL are accepted. CSV formula-like
values remain text; spreadsheet formulas are rejected. No parser executes them.

Each local upload returns a generated source handle and an explicit UTC
`expiresAt`, **24 hours** after ingestion. Uploads also disappear when the API
restarts. Expired sources cannot be previewed or used by direct queries; upload
the file again and rebind the pipeline. Expired DuckDB tables are reclaimed.
No file contents are written to disk, sent to external services or synced.

Choose **Prepare this upload** to see columns/types and preview transformations.
Calculated columns, filters and renames use the existing prep compiler and
DuckDB executor. Save the pipeline, then choose **Build a chart**. The author
uses the prepared output's actual fields and queries its dataset ID. Use
**Save draft** in Author to keep the analysis definition on this device;
[Local drafts](local-drafts.md) provides reopen, rename, delete and expired-source
recovery. A new dataset starts a new analysis draft; the dataset picker can
reopen saved local pipelines. Direct queries execute preparation against DuckDB on each request.
Boolean fields remain supported in prep; convert them to text or numbers before
charting. Existing Blaze requirements still apply to transformations that need cached
output; refresh those datasets before charting. Blaze snapshots retain their
existing lifetime and visibly labeled refresh time.

Saving a pipeline stores metadata only (`OPENSIGHT_PREP_STORE`, default
`.opensight/prep.json`). It does not retain uploaded rows or publish an analysis.
Expired or missing sources fail explicitly, never fall back to the sales fixture.
Local file access does not enable MySQL/PostgreSQL connectors, hosted publishing,
user administration or AI services.

`GET /api/local-data` advertises this explicit local capability without issuing
a session. `/api/session` still requires configured authentication. The UI only
enters the local workspace after verifying the local capability. Hosted API
requests remain authenticated; there is no fallback from a rejected session to
local upload. Static sample mode makes no API requests.
