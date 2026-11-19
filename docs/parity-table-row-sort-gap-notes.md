# Table row sorting: verification and captures

## Implementation checks

The compiler's existing `model.sort` pass runs before both table return paths.
No second comparator or table-specific sorting pass was added. The existing
`axisEntries` map groups typed keys independently of source contiguity. Tests
exercise interleaved measure ordering and compare all subtotal/total values
with unsorted output, including distinct numeric/string/null group keys.

Twelve full-output SHA-256 baselines were captured before implementation from
`ddb9ea7689d32281384e75b2ee438d66d143b3d1`. All combinations of totals/subtotals
with populated, empty and unavailable rows are covered. Function source is
included in the hashes, following the small-multiples-sort precedent.

Table groupBy dimensions already live in draft `rows`; the existing grouped
bound-field list, stale-sort cleanup and draft-storage shape validation cover
them. Tests confirm removal of the first dimension, later dimension or measure
clears its sort without disturbing unrelated sorts.

Export/remap inspection found only `smallMultiplesSort` field-ID rewriting in
`projectVisual`. `categorySort` is not rewritten anywhere, so no `rowSort`
rewrite was added. Native IDs differing from column names remain read-only on
bundle import, like the existing category-sort path. A regression test exposed
a column-name/native-ID mismatch that could otherwise be admitted as editable;
the table importer now requires the draft name to identify the same bound field.

A docs scan for table sort configuration being unsupported found no stale
implementation statement. `docs/research/api-surface.md` is the historical
API/bundle observation inventory, not the current compiler capability list.
The current Properties documentation now includes Row sort.

## Verification

The focused compiler/authoring/bundle/Properties/facet regression run passed
**257 passed / 0 failed / 0 skipped**, including 35 new table-row-sort cases.
Strict TypeScript passed. The log is
`/tmp/opensight-table-row-sort-focused.log`.

`npm run build:demo --workspace @opensight/web` passed, including strict
TypeScript and embed builds. The local single-file demo is 2,494,776 bytes.
The supervisor shim was not run. Build log:
`/tmp/opensight-table-row-sort-demo-build.log`.

The full root suite exited **0**: **5,873 passed / 0 failed / 37 skipped**
(5,910 tests; no cancellations or todos). All skips require live PostgreSQL: 35
in API and 2 in query engine. All 2,913 web tests passed, including the 35 new
table-row-sort cases. The run included the 32 Python SDK and 110 root checks.

## Offline captures and reference comparison

`packages/web/scripts/capture-table-row-sort.mjs` passed with **zero page errors
and zero external requests**. It loads `packages/web/dist/opensight-demo.html`
from `file://`, blocks external HTTP/HTTPS, verifies visible ordering, and captures both chrome themes under
`.opensight/parity-table-row-sort/browser/`. Direction defaults,
clearing, save/reload and sorted-field removal all passed. The pinned sample
starts Hardware (200) → Software (300); descending visibly changes it to
Software (300) → Hardware (200). Measure sort also defaults to descending.

Both 1440×1000 captures use 12px Arial controls with no horizontal page
overflow. Files in the capture directory are `table-none.png`,
`table-descending-light.png`, `table-descending-dark.png` and `acceptance.json`.
Capture log: `/tmp/opensight-table-row-sort-capture.log`.

```sh
OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" node packages/web/scripts/capture-table-row-sort.mjs
```

Chromium could not start inside the process sandbox; the successful capture
used the installed Playwright shell outside it, with HTTP/HTTPS blocked.

Review copies: [light](images/parity-table-row-sort-light.png),
[dark](images/parity-table-row-sort-dark.png). Compared with local references
`qs-2026/qs-properties-group-color.jpg` and
`qs-2026/qs-properties-display-settings.jpg`: Data → Visuals → canvas order and
docked Properties sections remain intact. The field select and direction
buttons are compact and legible in both themes. The table surface continues
to use its analysis theme independently of the chrome theme. The offline
notice, narrow default card and larger explanatory chrome remain existing
differences. The existing shared property arrow-button styling has no selected
fill in light chrome; dark chrome highlights the selected direction and both
themes expose it through `aria-pressed`. A shared light-theme pressed-state
style remains a UI follow-up; Group/Color behavior was kept unchanged.
There is no dedicated table sort reference in the supplied set; visual fidelity
remains unmeasured. No GitHub issue is filed because this is a phase-plan
fallback and network access is outside the brief's scope.

The README hero GIF is deliberately unchanged: the tour never opens table sort
controls, as explicitly ruled in the brief. The rebuilt demo is a local static
artifact, not a deployed server. No dependencies, AWS calls, deployment, merge
or push are part of this slice; `SOLUTION_DESIGN.md` is unchanged.


## Full root verification

```sh
OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" TZ=UTC npm test
```

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,500 | 0 | 35 |
| Bundle parser | 213 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 28 | 0 | 0 |
| Python SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 867 | 0 | 2 |
| Web | 2,913 | 0 | 0 |
| Root checks | 110 | 0 | 0 |
| **Total** | **5,873** | **0** | **37** |

The full log is `/tmp/opensight-table-row-sort-root.log`; exit status is in
`/tmp/opensight-table-row-sort-root.exit` and machine-readable counts are in
`/tmp/opensight-table-row-sort-test-counts.json`. The first process ended with
signal 143 during API tests; its partial log is retained as
`/tmp/opensight-table-row-sort-root-interrupted.log` and is excluded from the
counts. The unchanged full command completed in a persistent local process
outside the sandbox using the installed Playwright shell. No test was removed,
weakened or skipped to work around that interruption.
