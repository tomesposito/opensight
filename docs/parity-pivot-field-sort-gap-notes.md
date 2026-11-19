# Pivot field sorting: verification and captures

## Implementation checks

Pivot parsing admits only flat `fieldSortOptions` entries. The native converter
maps `FieldSortOptions`, `FieldId` and `SortDirection` without a `FieldSort`
wrapper. The existing shared comparator orders sibling groups within each
requested axis level. The aggregation and matching path is unchanged.

Forty-eight full-output SHA-256 baselines were captured before implementation
from `809591f0`. They include function source and all 16 row/column total and
subtotal combinations with populated, empty and unavailable rows. All match.
Tests compare every detail, subtotal and total cell by identity across sorted
and unsorted output, including both measures.

Import requires explicit valid directions and bound dimension IDs matching the
corresponding draft column names. No export-time ID rewrite was added. Invalid
entries retain diagnostics and export verbatim. The existing bundle-envelope
validator rejects non-object outer sort configurations before visual import.

Independent review found that visual/sheet dataset remapping can remove a
dimension before the ordinary reducer cleanup. Remapping now shares the same
pivot-sort cleanup; the focused regression covers both remap actions and a
subsequent draft-storage round-trip.

The new Properties labels share field display names with the existing name
editors. The Properties regression helper now identifies the requested control
type as well as its label, and its expected section order includes Field sort.

## Focused verification and demo

Strict TypeScript passed. The focused pivot/table run passed **122 passed /
0 failed / 0 skipped**, including **87 new pivot tests**. The broader compiler,
authoring, bundle, converter, Properties and pivot regression run passed
**324 passed / 0 failed / 0 skipped**. Logs:

- `/tmp/opensight-pivot-field-sort-focused.log`
- `/tmp/opensight-pivot-field-sort-regression.log`

`npm run build:demo --workspace @opensight/web` passed, including strict
TypeScript and embed builds. The requested
`node ~/workspace/goals/opensight/hidden_files/build-demo-shim.mjs` also passed,
updating the local demo artifact (2,505,545 characters including the existing
mock API shim). Build log: `/tmp/opensight-pivot-field-sort-demo-build.log`.

## Offline captures and reference comparison

`packages/web/scripts/capture-pivot-field-sort.mjs` passed with **zero page
errors and zero external requests**. It loads the freshly built static demo
from `file://` and blocks all external HTTP/HTTPS. Capture command:

```sh
OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" node packages/web/scripts/capture-pivot-field-sort.mjs
```

The process sandbox prevents Chromium startup; captures used the installed
Playwright shell outside it. Both 1440×1000 themes have 12px Arial controls
and no horizontal page overflow. Browser acceptance verifies independent row
and column sorts, ascending/descending/default selections, save/reload and
sorted-field removal. The sample changes East → West to West → East, and
Hardware → Software to Software → Hardware, with cell values moving intact.

Captures and machine-readable acceptance live under
`.opensight/parity-pivot-field-sort/browser/`: `pivot-none.png`,
`pivot-descending-light.png`, `pivot-descending-dark.png`, `pivot-readme.png`
and `acceptance.json`. Log: `/tmp/opensight-pivot-field-sort-capture.log`.
Review copies: [light](images/parity-pivot-field-sort-light.png) and
[dark](images/parity-pivot-field-sort-dark.png).

Compared visually with local `qs-2026/qs-properties-group-color.jpg` and
`qs-2026/qs-properties-display-settings.jpg`: Data → Visuals → canvas order,
docked Properties, compact headings and predictable section disclosures remain
intact. Both field selects are legible in light and dark chrome. The pivot
surface retains its independent analysis theme. The narrow default card,
large visual gallery and explanatory offline chrome remain existing differences
for future UI parity work. There is no dedicated pivot-sort reference in the
supplied set; visual fidelity remains unmeasured. No GitHub issue was filed:
this is an explicitly offline phase-plan fallback with no associated issue.

The README pivot screenshot is refreshed, retaining the collapsed East group
example while showing Field sort. The hero GIF was regenerated from the newly
rebuilt demo using `~/workspace/tools/screenshots/readme-gif.mjs` and its ffmpeg
palette/assembly commands. The original hard-coded Chromium failed to launch;
a temporary copy at `/tmp/opensight-pivot-field-sort-readme.mjs` uses the installed
Playwright shell and the repo's current `navigate` helper in place of the removed
source-picker control. The query explicitly requests `sum revenue by region` so the current interpreter
does not need to ask for an aggregation. All HTTP/HTTPS is blocked; 27 frames completed with zero
page errors. Frames: `/tmp/opensight-pivot-field-sort-hero-final/frames/`; log:
`/tmp/opensight-pivot-field-sort-readme.log`.

The rebuilt demo is a local static artifact, not a deployed server. No new
dependencies, AWS calls, deployment, merge or push are part of this slice.
`SOLUTION_DESIGN.md` remains unchanged.

## Full root verification

```sh
OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" TZ=UTC npm test
```

The final complete run exited **0**: **5,960 passed / 0 failed / 37 skipped**
(**5,997 tests**, no cancellations or todos). All skips require live PostgreSQL:
35 in API and 2 in query engine. All 3,000 web tests passed, including the 87 new
pivot-field-sort cases.

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
| Web | 3,000 | 0 | 0 |
| Root checks | 110 | 0 | 0 |
| **Total** | **5,960** | **0** | **37** |

Full log: `/tmp/opensight-pivot-field-sort-root.log`; exit status:
`/tmp/opensight-pivot-field-sort-root.exit`; machine-readable totals:
`/tmp/opensight-pivot-field-sort-test-counts.json`.

The first session ended with signal 143 during compilation; its log is
`/tmp/opensight-pivot-field-sort-root-interrupted.log`. An intermediate run was
stopped to add the independently identified remap cleanup regression; its log is
`/tmp/opensight-pivot-field-sort-root-pre-remap-review.log`. Neither partial run
contributes to the counts. The final unchanged root command ran to completion
in a persistent local process outside the process sandbox, with the installed
Chromium shell. No test was removed, weakened or skipped to bypass the environment.
