# Area forecast parity verification

This parity fallback extends issue #235 under the forecast-area run brief.
Area panels reuse the line forecast post-pass and `forecast.ts` computation;
each panel and measure gets its own forecast. Actuals keep their area fill,
the fitted/future segment has no fill, and only the interval band is shaded.
Authoring, bundle import/export, validation, Forecast properties and toolbar
guidance now cover date-based area charts. Disabled configs remain draft-local.
No design decision was needed: notes, warnings and forecast semantics follow
the existing line behavior.

The four forecast test files passed **34 passed / 0 failed / 0 skipped**.
They cover ordered bands, fitted/join/future points, extended axes, independent
panel/measure histories, insufficient/seasonal notes, invalid date categories,
draft validation, disabled exports, foreign imports and editor visibility.
An independent comparison against base commit `9138094e` found **18 line
compiler outputs byte-identical**, including serialized formatter functions,
across single/faceted charts with 3, 12 and 24 points and absent, nonseasonal
and automatic forecast configurations. Existing line assertions are retained.

`npm run build:demo --workspace @opensight/web` passed, including strict
TypeScript and embed builds. The log is `/tmp/forecast-area-demo-build.log`.
The offline forecast tour captures the line and area Forecast section, light
and dark area charts, area facets and non-date area visibility. The pinned
demo has only three date buckets: its quiet minimum-history note is correct;
synthetic compiler tests verify the rendered overlay with sufficient history.
The capture script now explicitly assigns fields in the current editor and
collapses other sections to keep Forecast visible. All five captures passed
with zero page errors, zero external requests and no horizontal overflow.
Artifacts and `acceptance.json` are in `/tmp/forecast-area-captures/`.

Compared the captures with the local QuickSight reference
`qs-2026/qs-properties-display-settings.jpg`: Data → Visuals → canvas ordering,
docked properties, compact controls and actual area fills remain intact.
The new Forecast section uses the existing line controls. No new unresolved
visual gap was identified. Visual fidelity is not measured. This is a rebuilt
local static demo, not a deployed service.

The README hero was refreshed with `capture-readme-tour.mjs` (the current
repository adaptation of `~/workspace/tools/screenshots/readme-gif.mjs`)
and its documented ffmpeg commands: 253 frames, zero browser errors or
external requests. The area feature capture is `docs/images/forecast-area.png`.
Browser checks used the installed Playwright Chromium through
`OPENSIGHT_CHROMIUM`; sandbox process restrictions required local execution
permission. No browser or dependency was downloaded.

## Full root verification

`TZ=UTC npm test`, with `OPENSIGHT_CHROMIUM` pointing to the installed
`chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`,
completed with exit code **0**. The log is `/tmp/forecast-area-root-test.log`.
Results: **5,098 passed / 0 failed / 36 skipped**, including 32 Python SDK
tests. The Node runners reported 5,066 passed, 36 skipped, zero cancelled
and zero todo. All skips require `DATABASE_URL` or live TLS PostgreSQL;
the default database environment was unchanged.

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
| Web | 2,606 | 0 | 0 |
| Root conformance and site | 110 | 0 | 0 |
| **Total** | **5,098** | **0** | **36** |

`git diff --check` passed. All checkpoints remain on
`work/parity-forecast-area`; no merge, push, AWS call or deployment occurred.
`SOLUTION_DESIGN.md`, dependency manifests/lockfile and `.github/` are unchanged.
