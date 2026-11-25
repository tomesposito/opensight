# Pivot column label sorting: verification and captures

Slice: `codex-parity-pivot-column-label-sort`, phase-plan fallback with no GitHub
issue. Work is confined to `work/parity-pivot-column-label-sort`.

## Implementation checks

Both converter dialects preserve the native FieldSort wrapper. Normalization
rejects malformed lists/wrappers, unknown keys, duplicate field IDs and any
reference outside the bound Columns dimensions. Every non-pivot kind rejects
even an empty ColumnLabelSort. Previous blanket pivot rejection assertions now
cover malformed shapes; valid pivot sorts are accepted.

ColumnLabelSort feeds the existing axis traversal and shared `compareCells`
total order. It overrides only the same field's flat field sort. Measure
ColumnSort still overrides only the outer column level, including stable
aggregate ties. Row field sorts, RowLabelSort and RowSort work independently.
All sixteen row/column total/subtotal combinations preserve every cell by
identity and total placement. The existing 48 full-output pivot baselines pass
unchanged; an additional check compares empty ColumnLabelSort against absent
lists across all baseline inputs.

Draft/reducer/storage checks cover column-only membership, duplicate prevention,
last-valid-state behavior, moving fields to Rows, field removal, dataset
remapping, kind changes and O-generated well replacement. Bundle and native
round-trips exercise editable valid imports and verbatim retention of invalid
or missing-direction imports, including native-ID/column-name mismatches.
Independent row label/measure sorts and column measure/field sorts survive
editing and clearing column label sorts. Properties tests verify display names,
all three choices, independent changes, invalid-selection rejection and the
no-Columns prerequisite.

## Targeted verification

Strict TypeScript passed with both the web and test configurations. The final
expanded targeted run passed **470 passed / 0 failed / 0 skipped**, covering
pivot ColumnLabelSort, RowLabelSort, field sort, row sort, column sort,
authoring, bundle round-trips, converter and Properties suites. The new
ColumnLabelSort suite has **48 tests**. Log:
`/tmp/opensight-column-label-sort-focused.log`.

Node's process sandbox reported child-file exits instead of individual tests
in the first isolated run. Targeted tests therefore used
`node --test --test-isolation=none`; the full root suite uses its ordinary
workspace commands outside that process sandbox. Earlier development runs are
not added to the final targeted or root totals.

## Demo and offline captures

`npm run build:demo --workspace @opensight/web` passed, including strict
TypeScript and the embed builds. Log:
`/tmp/opensight-column-label-sort-demo-build.log`.

`packages/web/scripts/capture-pivot-column-label-sort.mjs` passed against the
rebuilt local static demo with **zero page errors and zero external requests**.
HTTP/HTTPS requests are blocked. Default Chromium failed to start with
“Hatch WebGL domain policy is required for browser startup”; the installed
Playwright headless shell succeeded outside the process sandbox.

Both **1440×900** captures show Column label sort → region → Descending,
with West before East. Hardware retains West 350 / East 200; Software retains
West 50 / East 300. Rows stay Hardware then Software. Acceptance also verifies
ASC, Default, save/reload, removal of the sorted Columns field and the
prerequisite message. Rows never appear in the column-label selector. Controls
use 12px Arial with no horizontal page overflow.

Bar, Line, Table and Pie in both themes match the pre-slice rebuilt demo
**byte-for-byte across all eight screenshot SHA-256 hashes**. Baselines were
captured before the authoring UI change using the existing row-label-sort
capture script. All eight baseline hashes also match the previous row-label-sort
slice’s saved `acceptance.json`, independently confirming the pre-slice reference.

Captures belong under
`~/workspace/goals/opensight/hidden_files/issue-parity-pivot-column-label-sort/`,
not in the repository:

- `pivot-column-label-sort-light.png` and `pivot-column-label-sort-dark.png`
- `pivot-default.png`
- `before-{bar,line,table,pie}-{light,dark}.png` and corresponding `after-…` files
- `baseline.json` and `acceptance.json`
- `hero-frames/f000.png` through `hero-frames/f036.png`

Capture log: `/tmp/opensight-column-label-sort-capture.log`. Compared visually
with the local reference `lookfeel-references/qs-2026/qs-properties-display-settings.jpg`:
Data → Visuals → canvas order and the docked Properties disclosures remain
intact. The new selector and explanation are legible in both themes. The large
visual-type gallery, narrow initial card and offline explanatory chrome remain
existing differences. No dedicated QuickSight ColumnLabelSort reference is
supplied; no broader fidelity claim is made. No issue was filed because this
is an explicitly offline phase-plan slice with no associated issue.

The README hero GIF (`docs/images/opensight-tour.gif`) was regenerated from the
fresh demo using `~/workspace/tools/screenshots/readme-gif.mjs` and its ffmpeg
palette/assembly commands. A temporary copy at
`/tmp/opensight-column-label-sort-hero.mjs` uses the installed headless shell and
current navigation helper; Ask O is opened in Author and explicitly requests
`sum revenue by region`. Thirty-seven frames completed with zero page errors and
zero external requests. Frames remain outside the repository. Logs:
`/tmp/opensight-column-label-sort-hero.log` and
`/tmp/opensight-column-label-sort-hero-assembly.log`. Feature screenshots stay
external as required by the brief.

The supervisor's publishing shim remains a post-merge step. The rebuilt demo
is a local static artifact, not a deployed server. This branch contains no
merge, push or deployment. No new dependencies, AWS calls or external network
access were used. `SOLUTION_DESIGN.md` is unchanged. Visual fidelity remains
unmeasured.

## Full root suite

The complete root command uses the installed Playwright headless shell:

```sh
OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" TZ=UTC npm test
```

The suite ran in a detached local process outside the process sandbox and
exited **0**: **8,494 passed / 0 failed / 38 skipped** (**8,532 tests**, no
cancellations or todos). All 38 skips require live PostgreSQL: 36 in API and
2 in query engine. All **3,573 web tests** passed.

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
| Web | 3,573 | 0 | 0 |
| Root conformance/site checks | 120 | 0 | 0 |
| **Total** | **8,494** | **0** | **38** |

Full log: `/tmp/opensight-column-label-sort-root.log`; exit status:
`/tmp/opensight-column-label-sort-root.exit`; machine-readable per-workspace
counts: `/tmp/opensight-column-label-sort-test-counts.json`. Only this complete
run contributes to the root totals.

All requested slice items are complete. The supervisor's post-merge publishing
shim is deferred as directed; this branch was neither merged nor pushed.
