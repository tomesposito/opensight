# Category aggregation sorting: verification and captures

## Implementation checks

This is the offline phase-plan fallback `parity-aggregation-sort`, with no
GitHub issue. Work stays on `work/parity-aggregation-sort`, based on master
`6cd1f7eb`. No dependencies, network calls, AWS, merge or push are part of this
slice. `SOLUTION_DESIGN.md` is unchanged; the supplied slice specification is
the implementation contract.

Seventy-two complete compiled-output SHA-256 baselines were captured from
`6cd1f7eb` before implementation. They cover all six supported kinds, facet and
non-facet inputs, plain field sorting, populated/empty/unavailable data, and
function source. All match after the change.

Aggregation ordering shares the row-sort pipeline point, comparator and
post-sort consumers. Tests check multi-row categories, typed category values,
nulls, stable ties, result aliases, per-facet ordering, facet sort/limits,
CategoryItemsLimit, detailed tooltip identities and conditional formatting.
Only aggregation-sorted visuals admit repeated category rows; unchanged
configurations retain the existing duplicate-category guard.

Draft and import checks include mutual exclusion, invalid-edit preservation,
well replacement/removal, visual and sheet dataset remapping, kind changes,
malformed retention and verbatim export, and native/API nested-shape conversion.
Review identified a surviving-sort remap case: export now rebinds the sort's
measure column alongside the wells. A regression validates the exported visual.

## Focused verification

Strict web and API TypeScript compilation passed. The focused suite initially
passed 121 tests; three additional remapping/alias/invalid-edit regressions were
added during review. The final broader compiler, authoring, bundle, converter, Properties and sort
regression run passed **598 passed / 0 failed / 0 skipped**, including all
124 new aggregation-sort cases. Log:
`/tmp/opensight-aggregation-sort-regression-final.log`. The first sandboxed run could not launch Chromium (`ECONNRESET` in
bundle-import-label hover); the installed Playwright headless shell outside the
process sandbox runs that test successfully. No tests were removed or weakened.

## Demo and reference captures

`npm run build:demo --workspace @opensight/web` passed, including strict
TypeScript and all embed builds. The requested `build-demo-shim.mjs` passed,
writing the local shimmed artifact (2,511,591 characters). Build log:
`/tmp/opensight-aggregation-sort-demo-build.log`.

`packages/web/scripts/capture-aggregation-sort.mjs` passed with **zero page
errors and zero external requests**. It loads the rebuilt static demo from
`file://` and blocks external HTTP/HTTPS. Command:

```sh
OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" node packages/web/scripts/capture-aggregation-sort.mjs
```

Captures ran outside the process sandbox with the installed Playwright shell.
Both 1440×1000 themes retain 12px Arial controls and no horizontal overflow.
Acceptance verifies measure-mode defaults, ascending/descending ordering,
all six aggregation choices, top-N composition, field-mode restoration,
save/reload and removal of the sorted measure. The actual demo categories
change Hardware (200), Software (300) to Software (300), Hardware (200);
top one retains Software (300). No sample values or visual state were injected.

Artifacts under `.opensight/parity-aggregation-sort/browser/` include
`bar-default.png`, `bar-measure-light.png`, `bar-measure-dark.png`,
`bar-top-one.png`, `bar-readme.png` and `acceptance.json`. Log:
`/tmp/opensight-aggregation-sort-capture.log`. Review copies:
[light](images/parity-aggregation-sort-light.png),
[dark](images/parity-aggregation-sort-dark.png).

Visual comparison against local `qs-2026/qs-properties-group-color.jpg`
confirms the retained Data → Visuals → canvas flow, docked Group/Color
properties, compact labels and disclosure sections. Measure, aggregation and
direction controls remain legible in both themes. The narrow initial card,
large gallery and explanatory offline chrome remain existing differences.
The reference does not expose its sort editor; exact sort-editor geometry and
broader visual fidelity remain unmeasured. No GitHub issues were filed, per
this slice's offline boundaries.

The README Group/Color screenshot (`docs/images/properties-panels.png`) was
refreshed because the Sort mode selector is visible on that surface. The hero
GIF's dashboard, O question/answer, data preparation and data-source surfaces
have no visible delta from this change; the GIF is unchanged as requested.
The static artifact is a local demo, not a deployed server.

## Full root verification

```sh
OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" TZ=UTC npm test
```

The complete root run exited **0**: **6,084 passed / 0 failed / 37 skipped**
(**6,121 tests**, no cancellations or todos). All 37 skips require live
PostgreSQL: 35 in API and 2 in query engine. All **3,124 web tests** passed,
including the **124 new aggregation-sort tests**. Strict TypeScript passed.
The H4 measured two-tenant flood/timing check passed. No media work ran
concurrently with the full suite.

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
| Web | 3,124 | 0 | 0 |
| Root checks | 110 | 0 | 0 |
| **Total** | **6,084** | **0** | **37** |

Full log: `/tmp/opensight-aggregation-sort-root.log`; exit status:
`/tmp/opensight-aggregation-sort-root.exit`; machine-readable totals:
`/tmp/opensight-aggregation-sort-test-counts.json`.

The full suite ran once to completion outside the process sandbox with the
installed headless shell. The earlier sandbox limitation affected only the
focused browser regression, not this root run. No tests were removed, weakened
or skipped to bypass the environment.

All ten requested checkpoints are committed on `work/parity-aggregation-sort`.
The working tree is clean; no merge, push or GitHub action was performed.
`SOLUTION_DESIGN.md`, dependency manifests and lockfiles remain unchanged.

## Follow-up: native category-sort planning

The subsequent `parity-category-sort-planner` slice admits the native
FieldSort/AggregationSort CategorySort shapes for bar, line/area and pie.
It validates admission while preserving the entire plan, SQL and grouped
fixture results. Display ordering remains with the compiler. See the
[planner contract](parity-category-sort-planner.md) and
[new verification evidence](parity-category-sort-planner-gap-notes.md);
the compiler results and captures above remain historical evidence.
