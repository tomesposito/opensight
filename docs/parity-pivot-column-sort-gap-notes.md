# Pivot column sorting: verification and captures

## Implementation checks

The supplied offline phase-plan brief is the contract for this slice. Work is
on `work/parity-pivot-column-sort`, starting at `2108542a`. No dependencies, AWS,
external network calls, deployment, merge or push are part of the work.
`SOLUTION_DESIGN.md`, dependency manifests and lockfiles are unchanged.

Compiler validation covers both dialects and every sort nesting level. The
converter reuses the column schema and AggregationSort numerical shape, without
adding a FieldId. Category and pivot sorts share the same result-value
aggregation function and null-last comparator. Pivot ordering changes only the
outer column axis traversal; inner columns and rows keep independent ordering.

All 48 existing pivot-field-sort full-output hashes and all 72 aggregation-sort
hashes pass unchanged. Tests compare detail/subtotal/total cell identities for
all 16 pivot total/subtotal combinations. The existing duplicate-detail guard
remains; aggregate tests supply distinct detail groups across row dimensions.

Draft/import tests include default SUM, explicit-direction imports, foreign
measure IDs, native/bundle round-trips, retained invalid definitions, unrelated
edits, kind changes, visual/sheet remapping, and stale-reference cleanup.
Review identified that O-generated well replacement returns before the ordinary
reducer cleanup; that path now clears stale column sorts before draft validation.
The focused regression proves replacement takes effect and its draft persists.

## Focused verification

Strict TypeScript passed. The new file passed **72 passed / 0 failed / 0 skipped**.
The broader compiler, authoring, bundle, converter, Properties, O-dashboard and
sort regression run passed **434 passed / 0 failed / 0 skipped**. Logs:

- `/tmp/opensight-column-sort-new-tests.log`
- `/tmp/opensight-column-sort-focused.log`

The earlier ordering-only regression passed 261 tests. Intermediate authoring
checks caught two test-expectation mistakes: remaps use the established
`opensight_local_sales` identifier, and an imported empty list remains a
retained no-op. Both expectations now match the existing import/remap contract.

The sandboxed test runner initially reported only file-level counts. Reported
case counts come from the complete runs outside the process sandbox; no tests
were removed, weakened or skipped to bypass the environment.

## Demo and capture procedure

`npm run build:demo --workspace @opensight/web` passed, including strict
TypeScript and embed builds. Log: `/tmp/opensight-column-sort-demo.log`.
The artifact is a local static demo, not a deployed server.

`packages/web/scripts/capture-pivot-column-sort.mjs` loads the demo from `file://`
and blocks all external HTTP/HTTPS. It uses the installed Playwright headless
shell via `OPENSIGHT_CHROMIUM`. Before rebuilding, the old demo was copied to
`/tmp/opensight-before-column-sort.html` for the comparison run. Captures are
1440×900 and stay outside the repository as required by the slice brief:

`~/workspace/goals/opensight/hidden_files/issue-parity-pivot-column-sort/`

The script waits for autosave before taking comparison screenshots. An initial
bar-dark mismatch was confined to autosave status chrome (bounds x16–1262,
y88–185); seven other pairs already matched exactly. Waiting for the same
settled state makes the comparison meaningful without hiding any UI.

## Capture results and reference comparison

The final capture run passed with **zero page errors and zero external
requests**. All eight bar/line/table/pie light/dark screenshot pairs are
byte-identical to the pre-slice demo after autosave settles. The acceptance
script records their SHA-256 hashes and the pivot's before/after table values.

The requested evidence directory contains:

- `pivot-column-sort-light.png` and `pivot-column-sort-dark.png`: 1440×900
  Properties captures showing Sum ascending, Software before Hardware.
- `pivot-default.png`: the default column order.
- `before-{bar,line,table,pie}-{light,dark}.png` and matching `after-*` files.
- `baseline.json` and `acceptance.json`: hashes, typography, geometry, actual
  rows, zero-error/request counts, save/reload and stale-measure cleanup results.

The pivot aggregates across East and West: Hardware totals 550, Software 350.
Descending retains Hardware first; ascending moves Software first. The rows
remain East then West; the cells move intact from `[200,300]` / `[350,50]` to
`[300,200]` / `[50,350]`. All six aggregation choices, clearing, save/reload and
measure removal passed in the browser. Controls use 12px Arial with no page
horizontal overflow. Visual review found that the shared button style did not
highlight a selected direction in light chrome; a rule scoped to Column sort
now makes that state visible, with browser assertions for both themes.

Compared visually with local
`lookfeel-references/qs-2026/qs-properties-group-color.jpg`: the Data → Visuals →
canvas order, docked Properties, compact type and disclosure sections remain.
The new controls are legible in both themes. The existing narrow card, gallery
and explanatory offline chrome remain differences. No supplied reference shows
pivot ColumnSort itself; exact geometry and broader visual fidelity remain
unmeasured. No issue was filed under this slice's offline/no-GitHub boundary.
Capture artifacts remain outside the repo as explicitly required by the brief.

Final capture command:

```sh
OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" node packages/web/scripts/capture-pivot-column-sort.mjs
```

Logs: `/tmp/opensight-column-sort-before-capture.log` and
`/tmp/opensight-column-sort-capture.log`. The pre-slice run uses `--baseline`
and `OPENSIGHT_DEMO=/tmp/opensight-before-column-sort.html`.


## Full root verification

```sh
OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" TZ=UTC npm test
```

The complete root run exited **0**: **6,156 passed / 0 failed / 37 skipped**
(**6,193 tests**, no cancellations or todos). Every skip requires live
PostgreSQL: 35 in API and 2 in query engine. All **3,196 web tests** passed,
including the **72 new ColumnSort tests**. Strict TypeScript and the measured
H4 tenant-flood/timing checks passed. No media work ran concurrently with the
full suite.

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
| Web | 3,196 | 0 | 0 |
| Root checks | 110 | 0 | 0 |
| **Total** | **6,156** | **0** | **37** |

The full suite ran once to completion outside the process sandbox using the
installed Chromium shell. It ran as a persistent local process so the complete
root command survived tool-session boundaries. No test was removed, weakened
or skipped to bypass the environment.

Full log: `/tmp/opensight-column-sort-root.log`; exit status:
`/tmp/opensight-column-sort-root.exit`; machine-readable counts:
`/tmp/opensight-column-sort-test-counts.json`.

All six checkpoints are on `work/parity-pivot-column-sort`. The slice is
complete; RowLabelSort and TrendGroupSort remain unsupported as specified.
No merge or push was performed.
