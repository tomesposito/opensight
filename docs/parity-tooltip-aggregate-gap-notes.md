# Tooltip aggregate parity verification

This phase-plan fallback adds detailed rendering for treemap, word cloud,
box plot and histogram. The original row-based detailed formatter is
byte-identical to base commit `7b719f57`; its existing pinned tests are unchanged.
The obsolete fallback tests were converted to positive renderer/editor coverage.
All 16 other pre-existing tooltip test bodies are byte-identical to the base.

The focused tooltip/detail/extra-compiler run passes **70 / 0 / 0**
(passed / failed / skipped). It covers exact field output, hidden fields,
field-label titles, aggregation toggles, governed formats, escaped labels,
missing extras, empty groups, quartile interpolation and real ECharts callback
parameters. Treemap leaves retain their source row, parents omit extras,
overwritten display paths keep the later row, and duplicate typed category
paths still fail closed. An 83-row cloud proves extra-field provenance through
sorting and the 80-word cap. Box/histogram extras warn once without replacing
missing-column diagnostics or suppressing detailed output.

`npm run build:demo --workspace @opensight/web` passes, including strict
TypeScript and embed builds. The artifact is a local static demo, not a deployed
server. The build log is `/tmp/tooltip-aggregate-demo-build.log`.

`capture-tooltip-aggregate.mjs` drives all four kinds in the rebuilt demo,
enables detailed tooltips through Interaction properties, hovers actual SVG
marks and checks the displayed detailed text. All four captures pass with
**zero page errors, zero external requests and no horizontal page overflow**
at 1440×1100. Captures and `acceptance.json` are under
`/tmp/tooltip-aggregate-captures/`; shareable OpenSight-only stills are in
`docs/images/tooltip-*.png`. Chromium uses the installed headless shell via
`OPENSIGHT_CHROMIUM`; sandbox process restrictions require local execution
permission. No browser or dependency was downloaded.

The README hero was regenerated with `capture-readme-tour.mjs`, the current
repository adaptation of `~/workspace/tools/screenshots/readme-gif.mjs`, and
its documented ffmpeg palette commands: **253 frames**, 960×600, zero page
errors or external requests. The four affected feature stills were captured
against the same rebuilt demo.

Compared against local `parity-tooltip-section.png` and
`qs-2026/qs-add-field-to-tooltip.jpg`: the Data → Visuals → canvas ordering,
docked Interaction controls, field visibility checkboxes, primary-value title,
aggregation toggle and Add field entry remain. Treemap leaf hover visibly
contains both hierarchy levels, word hover contains its weight, box hover
contains five statistics, and histogram hover contains range/frequency.
The old basic-fallback hint is absent. No new tooltip layout gap was found.
The narrow histogram card still clips its pre-existing x-axis title at the
right edge; chart-axis layout is outside this tooltip slice. No GitHub issue
was opened under the explicit no-network constraint. These comparisons do not
measure pixel fidelity or establish visual equivalence.

Design choices follow the brief: empty box groups omit statistics; histogram
Frequency remains visible when its measure field is hidden; box statistics
use explicit statistic labels without Sum prefixes. None of these four kinds
is in `FACETED_KINDS`, so no new facet mapping is required. Basic treemap/word
series omit the new metadata to preserve their existing output.

## Full root verification

`TZ=UTC npm test`, with `OPENSIGHT_CHROMIUM` set to the installed headless
shell, exited **0**: **5,111 passed / 0 failed / 36 skipped**. This includes
32 Python SDK tests; the Node runners total 5,079 passed. Every skip requires
`DATABASE_URL` or live TLS PostgreSQL. No test was cancelled or marked todo.
The complete log is `/tmp/tooltip-aggregate-root-test.log`.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,294 | 0 | 34 |
| Bundle parser | 199 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 28 | 0 | 0 |
| Python headless SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 619 | 0 | 2 |
| Web | 2,619 | 0 | 0 |
| Root conformance and site | 110 | 0 | 0 |
| **Total** | **5,111** | **0** | **36** |

`git diff --check` passes. The five checkpoint commits remain on
`work/parity-tooltip-aggregate`; no merge, push, AWS call or deployment occurred.
`SOLUTION_DESIGN.md`, `.github/` and dependency manifests/lockfiles are unchanged.
No implementation deviation from the run brief was needed. The required README
capture used the repository's maintained adaptation of the external tour script;
GitHub issue filing was omitted under the explicit no-network rule.
