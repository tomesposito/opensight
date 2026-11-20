# KPI trend aggregation sort: verification and gaps

Slice: `kpi-trend-aggregation-sort` (phase-plan fallback, no GitHub issue).
Branch: `work/parity-kpi-trend-aggregation-sort`; base: `124b6f76`.

## Contract and focused checks

The compiler accepts one bound aggregation sort in either dialect, validates
nested keys and measure membership, and applies shared aggregate/cell semantics
before KPI comparison, totals, sparkline and target rendering. Draft state,
storage/migration, import/export and Properties expose the same supported subset.
See [semantics and limits](parity-kpi-trend-aggregation-sort.md).

The dedicated web test file contains 48 passing tests covering both dialects,
all six aggregations and both directions, stable ties and nulls, invalid shapes,
trend and measure membership, targets, date grains and bindings, duplicate keys,
comparisons, immutable input, draft lifecycle, migration, editable/retained
imports, native-ID re-export, remaps and Properties interactions. The focused
run alongside existing KPI trend and target suites passed **131 / 0 / 0**
(passed / failed / skipped). The new file also passed with the normal isolated
Node runner outside the filesystem sandbox: **48 / 0 / 0**. It is included in
the existing web/root test glob without a package-script change.

Before production edits, the test compiler was built from base `124b6f76` and
84 complete compiled-output SHA-256 hashes were recorded. Cases cover both
dialects, absent/category/date trends, field ASC/DESC and no sort, targets, and
populated/empty/unavailable results. Every hash still matches. No existing test
assertion or baseline was changed. Initial focused failures came from a new
negative-test target fixture missing its required SUM wrapper; the fixture was
corrected so the test reaches the intended target-only sort rejection.

## Offline browser evidence

The reproducible script is
`packages/web/scripts/capture-kpi-trend-aggregation-sort.mjs`. It bundles the
actual Author component and styles in memory, mounts them in the normal editor
main container in a temporary file shell, and aborts all HTTP(S) requests.
It does not build or modify `packages/web/dist`, and is not a deployed server.
The installed Playwright tooling supplies the browser driver; no dependency was
added. Chromium requires execution outside the filesystem sandbox in this
session because its sandbox host cannot start there.

```sh
OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" \
  node packages/web/scripts/capture-kpi-trend-aggregation-sort.mjs
```

Captures: [light](images/kpi-trend-aggregation-sort-light.png) and
[dark](images/kpi-trend-aggregation-sort-dark.png). They show monthly revenue
sorted by Average descending, with its reordered sparkline, comparison and target.
The completed run reported **zero page errors and zero external requests**.
The script checks ascending/descending measure order, aggregation selection,
save/reload, reset to chronological field order and stale-sort cleanup after
removing the measure. Evidence and raw captures are written to
`/tmp/opensight-kpi-trend-aggregation-sort-captures/`.

At 1440 × 900 the controls use 12px Arial-family text, the selected direction
is distinct in both themes, and there is no horizontal page overflow. The editor
retains Data → Visuals/wells → sheet flow, compared visually with the available
`qs-author-light-flow.jpg` reference. Properties stays docked; the analysis theme
keeps the canvas and KPI light in both chrome themes. The reference has no
matching KPI measure-sort panel, so these are layout/regression checks, not a
measured QuickSight fidelity claim. The existing narrow reset button wraps its
label; the new selects fit within the dock.

The README tour does not exercise the new control, so its GIF is unchanged per
the brief. No static-demo rebuild was run; the supervisor handles it after merge.
No GitHub issue was created because this offline brief names no issue and
forbids network access.

## Full root verification

Full-root results are recorded in the item 8 checkpoint after running
`TZ=UTC npm test`. No dependencies, AWS calls, network downloads, design edits,
merge or push are part of this slice.
