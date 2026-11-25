# Pivot row label sorting: verification and captures

Slice: `codex-parity-pivot-row-label-sort`, phase-plan fallback with no GitHub
issue. Work is confined to `work/parity-pivot-row-label-sort`.

## Implementation checks

Both converter dialects preserve the native FieldSort wrapper. Normalization
rejects malformed lists/wrappers, unknown keys, duplicate field IDs and any
reference outside the bound Rows dimensions. Non-pivot kinds reject even an
empty RowLabelSort. At this checkpoint, rejection tests covered the then-unsupported ColumnLabelSort.
[ColumnLabelSort](parity-pivot-column-label-sort.md) is now supported; its slice
replaces those assertions with non-pivot and malformed-shape rejection checks.

RowLabelSort feeds the existing pivot axis traversal and shared `compareCells`
function. It overrides only the same field's flat field sort. Measure RowSort
still overrides only the outer row level, including stable aggregate ties.
Column ordering is independent. All sixteen row/column total/subtotal
combinations preserve every cell by identity and total placement. The existing
48 full-output pivot baselines pass unchanged; an additional check compares
empty RowLabelSort against absent lists across all baseline inputs.

The brief describes the pre-#316 mixed-type comparator. This slice uses the
current shared total ordering, consistent with existing field sorts, as
explained in the [slice documentation](parity-pivot-row-label-sort.md).

Draft/reducer/storage checks cover row-only membership, duplicate prevention,
last-valid-state behavior, moving fields to Columns, field removal, dataset
remapping, kind changes and O-generated well replacement. Bundle and native
round-trips exercise editable valid imports and verbatim retention of invalid
or missing-direction imports, including native-ID/column-name mismatches.
Properties tests verify display names, all three choices, independent changes,
invalid-selection rejection and the no-Rows prerequisite.

## Targeted verification

Strict TypeScript passed with both the web and test configurations. The final
expanded targeted run passed **342 passed / 0 failed / 0 skipped**, covering
pivot RowLabelSort, field sort, row sort, column sort, authoring, bundle import,
converter and Properties suites. The new RowLabelSort suite has **46 tests**.
Log: `/tmp/opensight-row-label-sort-focused.log`.

Node's process sandbox reported only child-file exits in the first isolated
test run. Meaningful individual results were verified with in-process tests
and then the final ordinary isolated run outside the sandbox. These earlier
runs are not added to the final targeted or root counts.

## Demo and offline captures

`npm run build:demo --workspace @opensight/web` passed, including strict
TypeScript and the embed builds. Log:
`/tmp/opensight-row-label-sort-demo-build.log`.

`packages/web/scripts/capture-pivot-row-label-sort.mjs` passed against the
rebuilt local static demo with **zero page errors and zero external requests**.
It blocks HTTP/HTTPS. Chromium's process sandbox prevented startup, so the
installed Playwright headless shell ran outside that sandbox.

Both **1440×900** captures show Row label sort → region → Descending, with
West before East and every value moving intact. Acceptance also verifies ASC,
Default, save/reload, removal of the sorted Rows field and the prerequisite
message. Columns are unchanged and do not appear in the row-label selector.
Controls use 12px Arial with no horizontal page overflow.

Bar, Line, Table and Pie in both themes match the pre-slice rebuilt demo
**byte-for-byte across all eight screenshot SHA-256 hashes**. Baselines were
captured before the UI change using the existing column-sort capture script.

Captures belong under
`~/workspace/goals/opensight/hidden_files/issue-parity-pivot-row-label-sort/`,
not in the repository:

- `pivot-row-label-sort-light.png` and `pivot-row-label-sort-dark.png`
- `pivot-default.png`
- `before-{bar,line,table,pie}-{light,dark}.png` and corresponding `after-…` files
- `baseline.json` and `acceptance.json`

Capture log: `/tmp/opensight-row-label-sort-capture.log`. Compared visually
with the local reference `lookfeel-references/qs-2026/qs-properties-display-settings.jpg`:
Data → Visuals → canvas order and the docked Properties disclosures remain
intact. The new selector and explanatory text are legible in both themes.
The gallery size, narrow initial visual card and offline explanatory chrome
remain existing differences. No dedicated QuickSight RowLabelSort reference
is supplied; no broader fidelity claim is made. No issue was filed because
this is an explicitly offline phase-plan slice with no associated issue.

The README hero GIF (`docs/images/opensight-tour.gif`) was regenerated from the
fresh demo using `~/workspace/tools/screenshots/readme-gif.mjs` and its ffmpeg
palette/assembly commands. A temporary copy at
`/tmp/opensight-row-label-sort-hero.mjs` uses the installed headless shell and
current navigation helper; Ask O is opened in Author and explicitly requests
`sum revenue by region`. Thirty frames completed with zero page errors.
Frames remain outside the repository in the evidence directory's `hero-frames/`.
Logs: `/tmp/opensight-row-label-sort-hero.log` and
`/tmp/opensight-row-label-sort-hero-assembly.log`. Feature screenshots stay
external as required by this brief.

The supervisor's publishing shim remains a post-merge step. The rebuilt demo
is a local static artifact, not a deployed server. This branch contains no
merge, push or deployment.

## Full root suite

The complete root command uses the installed Playwright headless shell:

```sh
OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" TZ=UTC npm test
```

The first tool-managed process was terminated with signal 143 during the API
suite, before it produced a complete result. Its log is
`/tmp/opensight-row-label-sort-root-interrupted.log`; no partial-run results
are counted. The complete command was restarted in a detached local process
outside the process sandbox.

The final full run exited **0**: **8,446 passed / 0 failed / 38 skipped**
(**8,484 tests**, no cancellations or todos). All 38 skips require live
PostgreSQL: 36 in API and 2 in query engine. All **3,525 web tests** passed.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,597 | 0 | 36 |
| Bundle parser | 213 | 0 | 0 |
| CLI | 78 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 33 | 0 | 0 |
| Python SDK | 34 | 0 | 0 |
| MCP server | 79 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 2,704 | 0 | 2 |
| Web | 3,525 | 0 | 0 |
| Root conformance/site checks | 120 | 0 | 0 |
| **Total** | **8,446** | **0** | **38** |

Full log: `/tmp/opensight-row-label-sort-root.log`; exit status:
`/tmp/opensight-row-label-sort-root.exit`; machine-readable per-workspace counts:
`/tmp/opensight-row-label-sort-test-counts.json`. Only this complete run
contributes to the root totals.

No new dependencies, AWS calls or external network access were used.
`SOLUTION_DESIGN.md` is unchanged. Visual fidelity remains unmeasured.
