# Issue #29: local CSV upload, preparation and chart verification

Built on `work/issue-29-local-csv-upload` from `master` at `eafaac82`, following
its run brief. `SOLUTION_DESIGN.md`, hosted authentication/session/tenant code and
dependencies are unchanged. No remote connectors, deployment, merge, push or
issue closure is included. The runner owns publication.

## Implementation and boundaries

The fixture CLI explicitly enables a shared local data workspace. A library host
opts in with `localData: true`; combining it with hosted mode, authentication or
remote prep bindings refuses startup. Capability discovery does not issue a
session. Failed hosted credentials never enable local mode; principal headers,
authorization assertions and upload path/SQL fields remain rejected. Local
connector validation stays disabled, with its existing API auth requirement.

Local upload reuses strict parsing, type inference and in-memory DuckDB staging.
The browser and server enforce an 8 MiB decoded file limit; the local JSON envelope
allows 12 MiB. Existing 100,000-row, 256-column and 20-upload limits remain.
Canonical base64 validation avoids a repeated-group regex over large inputs.
Generated handles never derive from filenames, and values use SQL parameters.
Formula-like CSV cells remain literal text; spreadsheet formulas stay rejected.

Uploads carry a server-issued UTC expiry 24 hours after ingestion and disappear
at restart. Expired sources disappear from discovery and direct queries fail
closed; expired tables are dropped through the owner's serialized queue. The
scheduler reclaims expired tables, and expired uploads release session capacity.
Pipeline persistence stores only metadata. Blaze retains its documented cache
lifetime and refresh provenance.

The upload result opens its specific source in prep. Existing DuckDB transforms
provide columns/types, calculated columns, filters and renames. A saved prepared
dataset opens in Author, whose fields, defaults, queries, calculations, filters
and date bindings follow the selected schema. A local dataset picker lists saved
pipelines and starts a new draft when changing datasets. Local drafts use a
separate browser-storage key; missing or expired uploads never substitute sales
rows. Exports reference the local dataset handle, without embedding rows or
claiming a sales binding. Boolean fields need conversion in prep before charting,
matching the existing prepared-query contract.

## Browser and visual review

The [capture harness](../packages/web/scripts/capture-local-data.mjs) runs a real
local API, Vite and Chromium with synthetic data. As in issue #27, this machine's
browser blocks direct loopback navigation, so a synthetic document origin forwards
requests through Node to the real stack; all external HTTP and WebSockets are
blocked. This is test transport, not an app authentication mechanism.

The real flow uploads a semicolon CSV with non-sales columns and an arbitrary
MIME type, previews inferred types, renames amount to units, calculates doubled,
filters to North, saves the pipeline and builds a live bar chart. The actual
query result is North: units 6, doubled 12; no sales query is made. Reload restores
the local draft. MySQL remains disabled, and the upload form fits a 390px viewport.
The browser run reports zero page errors and zero external requests.

The local author screenshot retains Data → Visuals → canvas order, docked
Properties and the navy toolbar. Fields use their actual names and types;
non-sales fields appear under Columns. Prep retains its horizontally scrollable
DAG and bounded preview. Upload details disclose limits and expiry. Local capture
screenshots have no page-level horizontal overflow. The README includes the real
local chart, using only synthetic rows.

The static demo remains a separate offline artifact, with disabled uploads and
server saves. Its source and prep wording now correctly says a local or hosted API
can provide live data. Visual review compares the rebuilt demo with the existing
README feature screenshots and `qs-author-light-flow.jpg`; visual fidelity is not
measured. No new user-visible regression requiring an external issue was found.
No GitHub issue was filed under the run brief's no-network build constraint.

## Verification

Evidence is retained locally in the ignored `.opensight/issue-29/` directory:
`api-targeted.log`, `web-targeted.log`, `browser.log`, `browser/`,
`demo-build.log`, and `full-tests.log` with `full-tests.exit`.

The first targeted API run passed 20 / 0 / 0. The targeted web run passed
28 / 0 / 0 after preserving the fixture dropdown count-column behavior.

The full root command `TZ=UTC DATABASE_URL=postgresql://postgres@localhost:5433/opensight npm test`
exited **0** with **1,505 passed / 0 failed / 0 skipped**. `TMPDIR` was directed
to the ignored work directory because the shared `/tmp` filesystem was initially
full. All live PostgreSQL suites ran. Strict TypeScript and public-entry checks
ran through the workspace scripts. The completed suite includes all runtime
changes through `312a8831`; later commits contain documentation and captures.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 255 | 0 | 0 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 4 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Query engine | 512 | 0 | 0 |
| Web | 502 | 0 | 0 |
| Root conformance | 3 | 0 | 0 |
| **Total** | **1,505** | **0** | **0** |

An earlier web-only run found two fixture dropdown regressions caused by choosing
a categorical column for COUNT. Those were fixed by retaining the fixture's
numeric count column and selecting a real numeric column for local datasets.
The final full run above passes both cases. No test suites or skips were added
to avoid a failure.

`npm run build:demo --workspace @opensight/web` exited 0. Final browser acceptance
also exited 0, captured seven local/static views, and reported zero page errors
and zero external requests. The source, prep and author README screenshots were
refreshed from that rebuilt static artifact; `local-data.png` shows the real local
API workflow. The reviewed demo retains the docked panel order, canvas focus and
explicit offline limitations. It is not a deployed server.

The supplied `readme-gif.mjs` storyboard was adapted only for this checkout's
artifact path, installed screenshot tools and fixed frame holds. It produced
53 frames with zero page errors. Its supervising process returned a termination
status after reporting all frames; FFmpeg successfully assembled all 53, and
`ffprobe` verified a 960×600 GIF lasting 5.3 seconds. Assembly exited 0.
Additional local evidence: `gif.log`, `gif-assembly.log`, and `gif/`.

`git diff --check` passes. All work remains on the requested branch; merge,
publication and issue closure are left to the runner.
