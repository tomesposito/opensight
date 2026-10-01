# Data sources gallery

Choose **Data → Data sources**. The default gallery features **Upload a file**
with the upload → prepare → chart path. **Show unavailable connectors** defaults
off; enabling it reveals the rest of the 23-entry catalog under **Not yet
available**. Turning it off removes those cards and returns their selected
details to upload. Search matches names or categories within the visible groups;
searching never bypasses the toggle. Source details remain docked
beside the gallery on desktop and flow below it on narrow screens. All controls
have labels; cards are keyboard-accessible buttons with selected state.

The static demo uses the browser-safe registry without loading database drivers
or the Excel parser. It shows **Needs local or hosted API** for files,
**Needs a hosted API and an operator-configured connection** for PostgreSQL,
**Needs a hosted connector implementation** for SaaS/AWS, and **Not yet
implemented** for MySQL and other database connections. Its upload and
validation controls are disabled. There are no
simulated connections, sample upload success messages, or network requests.

The default fixture API enables a [local file workspace](local-data.md): upload
files up to 8 MiB, inspect their expiry and choose **Prepare this upload**.
After saving a prep pipeline, **Build a chart** opens its fields in Author.
Credentialed connector validation stays disabled. PostgreSQL stays behind the
toggle in local mode: the missing capability is an operator-provisioned hosted
source, not merely an API process.

In hosted mode, the existing prep-source discovery endpoint must report an
available PostgreSQL source before its card appears in the default view. The
card says **Needs setup** and **Prepare PostgreSQL data** opens that source in
prep. An API client, unavailable source, derived dataset or failed discovery
does not establish availability. Discovery errors are reported in the expanded
catalog. This gallery cannot provision credentials or create a database
connection; the documented configuration fields remain disabled.

The hosted app exposes this mode to users with build capability. Its file form
sends selected bytes to the authenticated upload API, reports actual staged row
counts and column types, and clears earlier success when a different file is
selected. The file extension selects the initial format; the format can be
changed explicitly. CSV delimiters can be detected or chosen, and Excel worksheet
selection is available. Invalid uploads show the API's named error. Configuration
metadata uses server environment variable names, never credential values.

See [registry](connector-registry.md), [file staging and API](connector-file-upload.md)
and [MySQL](connector-mysql.md) for supported semantics and limits. The static
artifact is `packages/web/dist/opensight-demo.html`, rebuilt using
`npm run build:demo --workspace @opensight/web`. It is a local preview, not a
deployed server.
