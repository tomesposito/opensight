# Data sources gallery

Choose **Data → Data sources**, then choose one of the 23 connector
cards. Search matches connector names or categories. Source details remain docked
beside the gallery on desktop and flow below it on narrow screens. All controls
have labels; cards are keyboard-accessible buttons with selected state.

The static demo uses the browser-safe registry without loading database drivers
or the Excel parser. It shows **Needs local or hosted API** for files,
**Needs hosted API / not configured** for credentialed and hosted connectors, and **Not yet implemented** for other database
connections. Its upload and validation controls are disabled. There are no
simulated connections, sample upload success messages, or network requests.

The default fixture API enables a [local file workspace](local-data.md): upload
files up to 8 MiB, inspect their expiry and choose **Prepare this upload**.
After saving a prep pipeline, **Build a chart** opens its fields in Author.
Credentialed connector validation stays disabled in local mode.

The hosted app exposes this mode to users with build capability. Its file form
sends selected bytes to the authenticated upload API, reports actual staged row
counts and column types, and clears earlier success when a different file is
selected. The file extension selects the initial format; the format can be
changed explicitly. CSV delimiters can be detected or chosen, and Excel worksheet
selection is available. Invalid uploads show the API's named error. Configuration
validation accepts server environment variable names, never credential values,
and keeps credentialed sources in their honest not-configured state.

See [registry](connector-registry.md), [file staging and API](connector-file-upload.md)
and [MySQL](connector-mysql.md) for supported semantics and limits. The static
artifact is `packages/web/dist/opensight-demo.html`, rebuilt using
`npm run build:demo --workspace @opensight/web`. It is a local preview, not a
deployed server.
