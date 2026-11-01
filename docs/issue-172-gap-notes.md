# Issue #172 verification

Hosted metric execution and vocabulary now use the existing checked tenant
transaction with a catalog restricted to the requesting user, exact dataset and
linked metrics. Execution additionally follows prepared input/append dataset
references by exact owner/key. The existing metric model, generic asset
transaction, storage schema, write paths and local backend behavior are retained.
Definition resolution deduplicates repeated dataset bindings within one call.
Bound metrics still load their own version history; this slice removes unrelated
workspace bodies from metric admission.

The new metadata tests compare targeted execution and vocabulary with the full
catalog across administrators, owners, editors, peers and readers, published
versions with newer drafts, other datasets and prepared join/append chains.
They preserve missing-dataset and cycle errors, hidden drafts, empty vocabulary,
tenant isolation and checked admission failures. Reads leave resources, links,
revisions and events unchanged.

The read-volume test adds 120 unrelated analyses, dashboards and metrics. A
legacy-dataset lookup still issues five checked queries and returns exactly four
resource bodies: the requesting user, dataset and its two metrics. Returned body
bytes and results remain identical. Corrupting unrelated analysis, dashboard and
metric bodies at SQL level makes the old catalog path fail JSON parsing while
both targeted reads still succeed. Recursive coverage checks exact keys, owner
scope and one read per reachable dataset, including shared dependencies and the
catalog's existing support for object-valued append references seeded at SQL
level (the current prep writer accepts append source IDs only).

Consumption tests cover per-call deduplication, distinct owners and kinds,
unchanged per-binding results, fresh reads on the next call, ordinary definitions
requiring no lookup, failure propagation and the local transaction fallback.
Hosted HTTP coverage exercises analysis creation, dashboard visual queries,
dashboard vocabulary, Ask O and prepared queries with an unrelated malformed
asset present. The focused runs passed 16 tests with no failures or skips.

The full root `npm test` run exited zero with **4,487 passed / 0 failed /
36 skipped**, including 32 Python SDK tests. There were no cancellations or TODOs.
All skips require live PostgreSQL: 34 API checks and two query-engine checks.
`DATABASE_URL` was unset; browser tests selected the installed Chromium headless
shell through `OPENSIGHT_CHROMIUM`. Local HTTP tests and Chromium ran with the
permissions needed for loopback sockets and browser startup. The complete log is
`/tmp/issue-172-npm-test.log`; per-workspace counts are in
`/tmp/issue-172-test-counts.json`.

`npm run build:demo --workspace=@opensight/web` rebuilt the static demo and embed
artifacts successfully. Offline Chromium captures of Renderable Sales at 1280×800
before and after the rebuild had **zero changed pixels** and zero browser errors.
Captures are in `/tmp/issue-172-screenshots/`. The README dashboard reference has
the same synthetic chart content and card structure; its viewport and palette
differences already existed in the pre-change capture. No issue-specific visual
regression was found. Visual fidelity remains unmeasured, and this artifact is a
static fixture demo, not a deployed server.

No new dependency, configuration, AWS operation, network publication or solution
design edit is part of this issue. No issue-specific UI change requires refreshed
README media.
