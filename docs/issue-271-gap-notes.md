# Issue #271 — manual Redshift connector

Implemented the supplied brief on `work/issue-271-redshift-manual`, with
checkpoint commits per item. `SOLUTION_DESIGN.md` is unchanged. No AWS calls,
live-cluster verification, deployment, merge or push occurred.

## Implementation and verification boundaries

See [connector configuration and tested SQL contract](connector-redshift.md).
The manual connector uses the existing MIT-licensed pg driver and a dedicated
Redshift dialect. Auto-discovery remains a stub. Native-name/OID allowlists,
SQL text and connection statements are independently tested; this is not a
claim of live Redshift equivalence. Tom's live-cluster verification is follow-on.

The executor checks the declared database separately from the physical schema.
Quoted identifiers request case preservation through an explicit session setting.
Text casts specify `VARCHAR(65535)`, avoiding Redshift's default cast width.
Generated backslash literals use `CHR(92)` rather than depending on session
escape settings. Unsupported functions/types fail with named errors.

Hosted reads use one bounded SELECT and pg row events, without PostgreSQL
transactions, cursors or backend cancellation functions. The 10-second overall
stream deadline replaces pg's per-query callback timer: that timer would
otherwise accumulate rows and suppress Query error events. Regression tests
assert no buffered result rows and prompt sanitized failure propagation.

Existing exact endpoint/migration matching and generic analytics validation
now accept manual Redshift. Browser preparation stages admitted rows in DuckDB
and retains the original connector/dialect. Gallery and dataset/analysis source
selection reuse the query registry and require a matching available source.

## Static demo review

Rebuilt `packages/web/dist/opensight-demo.html` and compared 1280 × 800 captures
against the prior demo and `qs-2026/qs-data-create-datasource.jpg`. The dashboard
has zero changed pixels. The connector dialog adds the manual Redshift tile;
the setup form still requires an operator-provisioned source, and cannot select
one in the static demo. The form scrolls within the existing dialog.

The centered dialog, search, selectable tiles and footer flow follow the
reference's structure. Existing differences in catalog breadth, icons, tile
spacing and surrounding chrome remain; no new layout gap was found. Captures
had no page errors, external HTTP requests or horizontal overflow. Visual
fidelity remains unmeasured. This is a local static demo, not a deployed server.

Refreshed the README tour GIF and connector screenshot, and added a manual
Redshift setup screenshot. Capture scripts/results are in the ignored
`.opensight/issue-271-verification/` directory. The tour uses the prescribed
`~/workspace/tools/screenshots/readme-gif.mjs` workflow with current local
navigation and the installed headless Chromium executable.

## Checks

Focused checks passed: 68 API tests and the Redshift SQL/executor/stream tests.
All new connector tests run without skips. Full root-suite counts will be
recorded after verification.
