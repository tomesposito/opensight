# Issue #12 verification and visual review

Work is on `work/issue-12-blaze`. The three completed pre-reboot checkpoints
(`cde11e95`, `50910cb1`, `15398143`) and unfinished edits were retained. The issue
#15 addendum was specified separately in `2cbeac86`, then implemented in
`b38a1bac`. Screenshot review's label correction is saved in `7e9de358`.
Merge, publishing, deployment, issue closure and the README hero GIF
remain with the sweep owner.

## Behavior and boundaries

Blaze stores complete prepared output as bounded in-process column arrays. Manual
and interval refreshes publish only complete snapshots; failed, invalidated,
evicted or running snapshots cannot fall back to source/stale rows. Query and
output responses identify cached data and the refresh times of its dependencies.
The existing prepared-dataset reference can use a ready Blaze join input.

Issue #15 requires Blaze for cross-source joins and pivot, unpivot, append and
aggregate steps, including saved dependencies. Save, dependency changes and
startup promote required pipelines without executing them. Direct mode is refused
with `BLAZE_MATERIALIZATION_REQUIRED`; bounded editing previews remain available.
Simple single-source pipelines, including source/previous-step reuse, retain
direct execution. The prep panel explains required materialization.

Cache rows are ephemeral. Metadata/schedules can persist, but restart begins with
empty caches. Accounted capacity is not an operating-system RSS bound: native SQL,
upload staging, driver batches and query evaluation have additional overhead.
PostgreSQL inputs must be cached separately before mixing with file/cache inputs.
Arbitrary prepared-dataset publication into analysis visuals remains separate
hosted integration work. The static demo never claims hosted materialization.
No dependency was added and no AWS service or external network was used.

## Automated verification

Root `TZ=UTC npm test` exited 0: **1,323 passed / 0 failed / 1 skipped**
(1,324 total). The only skip is the existing live-Postgres executor because
`DATABASE_URL` is unset. Counts by runner:

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 141 | 0 | 0 |
| Bundle parser | 187 | 0 | 0 |
| Embedding SDK | 4 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Query engine | 493 | 0 | 1 |
| Web | 463 | 0 | 0 |
| Root conformance | 3 | 0 | 0 |

Checks cover full materialization beyond preview size; shared query calculations;
cached/source-free reads and join inputs; owner/namespace/role bypass attempts;
refresh failures, invalid pipelines and concurrent edits; restart; row, text,
memory and LRU limits; fake-time scheduling; bounded PostgreSQL cursor intake;
UI freshness labels and stale responses; mandatory modes for all advanced steps;
cross-source versus self/previous-step joins; transitive policy enforcement and
legacy metadata migration. Actual DuckDB and embedded Postgres (PGlite)
comparisons ran. HTTP tests use localhost and synthetic data. UTC matches the
repository's established date-test environment.

## Browser and visual checks

`TZ=UTC npm run build:demo --workspace @opensight/web` rebuilt
`packages/web/dist/opensight-demo.html`. Local Chromium verification uses the
fresh artifact with external requests blocked. A separate local development
renderer connects to a real localhost API using an isolated synthetic author,
two synthetic CSV uploads and a stub mail transport.

The hosted flow joins sales to a Blaze region lookup, then aggregates revenue.
It verifies automatic Blaze selection, disabled direct mode, the materialization
explanation, manual refresh, a five-minute refresh interval, two cached output
rows (East 2000, West 650), and both root and input refresh timestamps. The
static flow builds a join, checks disabled hosted controls and the offline
message, and returns to the analysis editor with its explicit offline sample
label. Both flows run at desktop and 390-pixel mobile widths; graph/table
scrolling remains inside its containers, without document overflow. The completed
tour reports zero page errors.

README captures are refreshed in `docs/images/data-prep.png` and
`docs/images/author.png`; `docs/images/blaze.png` shows the synthetic local API
example. Mobile inspection captures are `/tmp/issue12-hosted-mobile.png` and
`/tmp/issue12-static-mobile.png`. The hero GIF is deliberately left to the sweep
owner, as instructed by this build's brief.

Compared with the preceding README prep/author images and the supplied
`qs-author-light-flow.jpg`, the left dock, typography, navy/teal author chrome and
Data → Visuals → sheet order remain consistent. Blaze controls occupy a normal
document section above the prep canvas. Screenshot review found and corrected an
unsaved offline output badge that incorrectly defaulted to DIRECT QUERY; it now
waits for real execution metadata. No unresolved new rendering defect was found.
The available QuickSight image depicts analysis authoring, not Blaze preparation;
this is a structural comparison and visual fidelity remains unmeasured. These
checks and screenshots are local verification, not a deployed server.
