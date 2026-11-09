# Issue #230 — notebook retained-result byte budgets

The notebook store bounded each SQL cell result on its own, so 100 cells ×
20 retained runs of individually valid results could retain ~15 GiB in one
notebook. Retained results are now also bounded in aggregate, counted as the
JSON bytes of the result payloads (run `data` and snapshot payloads):

- Per run: 8 MiB (`OPENSIGHT_NOTEBOOK_RUN_BYTES`). Results are kept in cell
  order; a result that does not fit loses its data and records
  `NOTEBOOK_RESULT_BUDGET_EXCEEDED`, and visuals depending on it fail with
  `NOTEBOOK_DEPENDENCY_FAILED` instead of reusing it.
- Per notebook: 64 MiB across runs + snapshots combined
  (`OPENSIGHT_NOTEBOOK_NOTEBOOK_BYTES`).
- Per store: 256 MiB (`OPENSIGHT_NOTEBOOK_STORE_BYTES`).

Budgets must satisfy run ≤ notebook ≤ store. On a new run, count retention
applies first, then the oldest runs of that notebook are evicted until the
notebook budget fits, then the store's oldest runs (any notebook) until the
store budget fits. Snapshots are explicit saves and are never evicted; a
snapshot save that would exceed the notebook or store budget is refused with
`NOTEBOOK_SNAPSHOT_LIMIT_EXCEEDED`, and if snapshots alone leave no room a
new run is executed and returned but not retained. The same budgets are
enforced by `validateNotebookState`, so an over-budget persisted store fails
closed as `NOTEBOOK_STORE_CORRUPT`. See [notebooks](notebooks.md) for the
retention policy.

Deliberately unchanged: ordinary metadata operations still go through the
automation store's clone-on-read/write path — bounding retained payload
bytes caps how much any clone can carry, but projections for notebook
metadata reads remain follow-on work, as does per-cell payload streaming.

## Verification

Focused suite: `packages/api/test/notebooks.test.mjs` passed 22 / failed 0 /
skipped 0, including four new #230 tests. Each new test measures a real
result's byte size under the default budgets and then sets budgets relative
to it, so every cell result is individually valid and only the aggregate
binds: per-run drop + dependent-visual failure, byte eviction retaining 2 of
5 runs under the count cap (verified again after a store reload), snapshot
refusal at the notebook budget, and `validateNotebookState` rejecting
run-, notebook- and store-level aggregate overruns.

Full root suite: 4,999 tests across 11 suites — 4,963 passed, 0 failed, 36
skipped, exit 0 (independently run by the supervisor; the 36 skips are the
usual live-Postgres and opt-in cases).

## Static demo review

This is an API-only change with no UI delta; the demo is rebuilt from the
merged master as usual and retains the prior visuals. The rebuilt artifact
is a static demo; visual fidelity remains unmeasured.
