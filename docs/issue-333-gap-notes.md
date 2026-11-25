# Issue #333 — bounded Insight custom narratives

Implements IDD D-96 (custom narratives): literal text, same-Insight computation
catalog references, bound SUM measure references and number/date formats.
Structural validation is shared by import, draft admission, queries and the
compiler. Rendering publishes values from the existing per-kind arithmetic;
field binding and list bounds fail closed. The original template survives
native conversion, bundle import/export and author draft storage unchanged.

The editor adds a textarea, catalog/measure insertion control and format choice
inside the existing Insight Properties section. It preserves computations and
uses the same query as the computed form. Imported measure identities remain
stable in author wells, including when reopening an edited export or switching
visual types. No dependencies, AWS calls or external services were added, and
`SOLUTION_DESIGN.md` was not edited.

## Acceptance evidence

Automated coverage includes every catalog path, all four date grains, number
and percent precision, visual formatting, unavailable scalars, field-only
configurations, malformed syntax, unsupported parameters/functions/conditionals,
missing computations, unbound/dimension fields, out-of-range list indices,
rendered text at/over 1,000 characters, numeric emphasis and paragraph splitting.
Published totals and ranked results equal the computed narrative's numeric
parts; forecast values and intervals also match the computed form. A query spy
proves one identical grouped query and no substitution fetches.

Native API and bundle paths render the same text and export the template byte
for byte, including after editing and reopening. Author control events produce
validated, serialized templates that render identically to imported templates.
The existing dollar/parameter rejection cases remain in the narrative,
anomaly, compiler, builder and author-query tests.

The offline browser acceptance script
`packages/web/scripts/capture-insight-custom-narrative.mjs` checks formatted
insertion, replacing selected text and restoring the caret, numeric emphasis,
light/dark rendering, reference/syntax/size errors, clearing to computed prose
and save/reload. It passed with **0 page errors / 0 external requests**. The
existing Insight tour also passed all 15 captures with **0 page errors / 0
external requests**.

## Visual comparison and README

The final `build:demo` completed successfully, and custom-template browser
acceptance passed again against that build. The rebuilt static demo was compared against the existing classic editor,
new-look editor and Q reference pairings, preserving their masks and pixel
tolerance of 16. Pixel differences are **41.22%**, **33.97%** and **45.30%**,
respectively, unchanged from issue #330. Existing chrome/fixture differences
remain; these percentages are differences, not fidelity grades. No new visual
gap was identified. The custom editor was inspected in light and dark with the
controls scrolled into view and no horizontal overflow. Visual fidelity of the
new custom editor against QuickSight has not been measured.

Insight feature images and the README hero are refreshed from the rebuilt
static demo. The hero uses the prescribed `readme-gif.mjs` storyboard adapted
for current navigation, the current demo path and a custom-narrative scene,
with the script's ffmpeg palette/assembly recipe (2 fps for the captured
32-frame, 16-second storyboard). The longer repository tour
has a stale data-preparation join step, so it was not used for the final GIF.
The demo remains a local static artifact, not a deployed server. Browser
captures and parity reports are under ignored `.opensight/issue-333/`.

## Verification

The full root `npm test` exited **0** on the completed implementation:
**8,509 passed / 0 failed / 38 skipped / 0 cancelled** (8,547 tests).
All 38 skips are live PostgreSQL integration cases: 36 in API and two in the
query engine, with `DATABASE_URL` or live TLS PostgreSQL not configured.
The Python SDK's 34 passing tests are included in these totals.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| api | 1,597 | 0 | 36 |
| bundle-parser | 213 | 0 | 0 |
| cli | 78 | 0 | 0 |
| embedding-sdk | 10 | 0 | 0 |
| headless-sdk | 33 | 0 | 0 |
| opensight-headless-sdk-python | 34 | 0 | 0 |
| mcp-server | 79 | 0 | 0 |
| o-interpreter | 42 | 0 | 0 |
| parity | 11 | 0 | 0 |
| query-engine | 2,704 | 0 | 2 |
| web | 3,588 | 0 | 0 |
| root-conformance | 120 | 0 | 0 |
| **Total** | **8,509** | **0** | **38** |

The default Chromium failed startup. Browser checks and the full suite use
the installed Playwright headless shell through `OPENSIGHT_CHROMIUM`.
The initial sandboxed root attempt was interrupted after a runtime failure
during compilation; a foreground rerun ended with signal 15 before a summary.
Both incomplete attempts are excluded. The completed root command ran as a
detached local job with a durable log and exit-status file, using the environment
needed by local test servers and browser subprocesses. Counts are retained in
`.opensight/issue-333/root-test-counts.json`; the completed run log is
`/tmp/issue333-root-final.log`. No merge, push or deployment was performed.
