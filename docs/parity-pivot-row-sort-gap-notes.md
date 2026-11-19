# Pivot row sorting: verification and captures

Slice: `parity-pivot-row-sort` (phase-plan fallback, no GitHub issue), built by
Muse directly on `work/parity-pivot-row-sort` — the sweep's reboot guard
(uptime over 60 minutes) blocked a long Codex launch, and the run was
registered with a saved brief before the first edit so the watchdog could
resume it.

## Verification (independent, supervisor-run)

Full root `npm test` was run from the repo root on the final branch tree
(`TZ=UTC`, Playwright headless shell via `OPENSIGHT_CHROMIUM`). The first run
failed exactly one test — `properties-panel.test.mjs` enumerates the pivot
Properties sections in order and did not yet list the new **Row sort**
section; the expectation was updated (commit 8 of the slice) and the web
workspace suite was re-run in full, followed by the conformance/site suites
the aborted root run had not reached. Every other workspace segment comes
from the first root run, on the identical tree except that one test-file
expectation.

Final tallies, all segments reconciled:

| Segment | Tests | Pass | Fail | Skipped |
| --- | --- | --- | --- | --- |
| api | 1,535 | 1,500 | 0 | 35 |
| bundle-parser | 213 | 213 | 0 | 0 |
| cli | 73 | 73 | 0 | 0 |
| embedding-sdk | 10 | 10 | 0 | 0 |
| headless-sdk | 28 | 28 | 0 | 0 |
| headless-sdk-python | 32 | 32 | 0 | 0 |
| mcp-server | 74 | 74 | 0 | 0 |
| o-interpreter | 42 | 42 | 0 | 0 |
| parity | 11 | 11 | 0 | 0 |
| query-engine | 869 | 867 | 0 | 2 |
| web | 3,270 | 3,270 | 0 | 0 |
| conformance + site | 110 | 110 | 0 | 0 |
| **Total** | **6,267** | **6,230** | **0** | **37** |

The 37 skips are the standing live-Postgres skips. The delta against the
Pivot ColumnSort slice's verified totals (6,193 tests / 6,156 pass / 37
skipped) is exactly the 74 new tests in
`packages/web/test/pivot-row-sort.test.mjs`, all passing; the three updated
assertions in the pivot-column-sort, pivot-field-sort and table-row-sort
suites pass in place.

## Demo and captures

The static demo was rebuilt with the goal's demo shim after merge. This
slice's only visual change is the additional **Row sort** Properties section
for pivots, which renders only when a pivot is selected; no screenshot tour
was re-captured for this run (the Properties control itself is covered by
the react-test-renderer tests in `pivot-row-sort.test.mjs`). No visual
regression is expected elsewhere: compiled output for visuals without a
pivot `rowSort` is unchanged, and the existing pivot baselines pass
unmodified.
