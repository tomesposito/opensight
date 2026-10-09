# Local file data

Issue #29 enables the run brief's local upload → preparation → chart workflow.
`SOLUTION_DESIGN.md` remains unchanged. Hosted authentication and connectors keep
their existing contracts.

The README's [Run it](../README.md#run-it) section gives the verified install,
build, and two-terminal startup sequence for Node 24+ and npm. Open
[http://127.0.0.1:5173](http://127.0.0.1:5173) with both servers running.
The default `OPENSIGHT_MODE=fixture` API CLI enables local data without hosted
authentication or an external database. **Local workspace** opens on an empty **Home**, ready for your data. **Author**
starts without a dataset; **Analyses** and **Dashboards** start empty. The
[static HTML demo](first-run.md#local-demo-and-development-sign-in) cannot upload files.
Library hosts opt in with `createApiServer({ dataRoot, localData: true })`.
**Try sample data** explicitly enables the 8-row synthetic sales dataset for
this tab until reload. Home shows its labeled pinned sample dashboard; Author
labels the dataset **Sample sales data**. **Remove sample data** disables it in
one click and restores the empty Home and unbound Author canvas. Your uploaded
data and saved analysis definitions are retained; sample-based drafts are labeled
and need another explicit opt-in to run. Simply visiting Author does not create
an analysis. The static demo keeps its existing staged showcase.

Local data cannot be combined with hosted mode, configured authentication or
PostgreSQL prep bindings. It is a single shared workspace for people using that
local API, not a login or tenant boundary. Keep the local API on loopback.

Open **Data → Data sources → Upload a file**, choose CSV (or an existing supported
format) and optionally a delimiter, then select **Upload to staging**. The server validates every row, infers column
types, and stages values in a local DuckDB table. Files are limited to
**8 MiB**, **100,000 rows** and **256 columns**, with at most **20 uploads**.
The local JSON envelope allows 12 MiB for base64 overhead. Oversized files return
HTTP 413; invalid formats, ambiguous delimiters and inconsistent types produce
named errors. No filenames, paths, URLs or SQL are accepted. CSV formula-like
values remain text; spreadsheet formulas are rejected. No parser executes them.

Each local upload returns a generated source handle and an explicit UTC
`expiresAt`, **24 hours** after ingestion. Uploads survive API restarts with their original handles and expiry times. Expired sources cannot be previewed or used by direct queries; upload
the file again and rebind the pipeline. Expired DuckDB tables are reclaimed.
Rows and upload metadata are stored together in DuckDB transactions. Nothing is
sent to external services or synced.

The fixture CLI stores uploads at `.opensight/uploads.duckdb`, relative to its
working directory (`packages/api/.opensight/uploads.duckdb` when started with
`npm start --workspace @opensight/api`). DuckDB may also create a companion
`.wal` file for restart recovery. Set `OPENSIGHT_LOCAL_UPLOAD_DATABASE` to an
absolute path to choose another location. Keep the database and its WAL together;
only one API process can open the file. The directory is created with mode 0700
and the database with mode 0600. These files are ignored by Git.
Expiry is checked on startup, on access and by the running scheduler; expired
tables and metadata are reclaimed, not securely erased. This remains a 24-hour
workspace, not permanent archival storage.

Library hosts pass `localUploadPath` to `createApiServer` to enable the same
persistence; omitting it retains ephemeral staging for embedded/test use. The
path is trusted startup configuration, never accepted from an upload request.

Choose **Prepare this upload** to open **Data preparation**, see columns/types
and preview transformations.
Calculated columns, filters and renames use the existing prep compiler and
DuckDB executor. Select **Save pipeline**, then **Build a chart**. In Author,
select **Add visual** and assign fields; the chart uses the prepared output's
actual fields and queries its dataset ID. Use
**Save draft** in Author to keep the analysis definition on this device;
reopen it through **Analyses → My analyses** in the same browser and origin.
[Local drafts](local-drafts.md) explains rename, delete and expired-source
recovery. Drafts are not synced or published and do not retain uploaded rows.
A new dataset starts a new analysis draft; the dataset picker can
reopen saved local pipelines. Direct queries execute preparation against DuckDB on each request.
Boolean fields remain supported in prep; convert them to text or numbers before
charting. Existing Blaze requirements still apply to transformations that need cached
output; refresh those datasets before charting. Blaze snapshots retain their
existing lifetime and visibly labeled refresh time.

Saving a pipeline stores metadata only (`OPENSIGHT_PREP_STORE`, default
`.opensight/prep.json`). The separate DuckDB database retains uploaded rows until expiry; saving a
pipeline does not extend that expiry or publish an analysis.
Expired or missing sources fail explicitly, never fall back to the sales fixture.
Local file access does not enable MySQL/PostgreSQL connectors, hosted publishing,
user administration or AI services.

`GET /api/local-data` advertises this explicit local capability without issuing
a session. `/api/session` still requires configured authentication. The UI only
enters the local workspace after verifying the local capability. Hosted API
requests remain authenticated; there is no fallback from a rejected session to
local upload. Static sample mode makes no API requests.
