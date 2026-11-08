# Issue #219 — input-table PATCH concurrency

Row patches merge, validate and construct audit changes against the current
draft row inside the serialized store mutation. The existing early checks
and commit-time authorization recheck remain. Optional `expectedVersion`
checks the table version before mutation; the row editor passes its loaded
version because it submits every cell. See [input tables](input-tables.md)
for the error codes and retry semantics.

## Verification

The four new API regressions failed against the previous implementation:
different-cell writes lost an update, same-cell writes audited a stale old
value, and version checks were unsupported. After the fix, the focused API
run passed 13 / failed 0 / skipped 0, including the existing #218 revocation
tests and sequential last-write-wins check. The focused client and Data UI
run passed 25 / failed 0 / skipped 0. It checks optional version transmission,
412 error propagation, and retaining a row draft after a rejected save.

## Static demo review

`npm run build:demo --workspace=@opensight/web` passed. The rebuilt dashboard
and author captures at 1280 × 800 are byte-for-byte identical to the #214
captures, with no page errors, external HTTP requests or horizontal overflow.
The dashboard agrees with `docs/images/sample-dashboard.png` in chart data,
navigation and card arrangement; widths adapt to the capture viewport.
The author capture retains the Data → Visuals/field wells → sheet ordering
shown by the private `qs-author-light-flow.jpg` reference. Existing differences
in banners, spacing and the empty canvas remain; no new visual gap was found.

This change adds a version to Save requests without changing the layout or
visual assets, so README media were retained. The rebuilt artifact is a static
demo; visual fidelity remains unmeasured. Logs and captures are in the ignored
`.opensight/issue-219-verification/` directory.
