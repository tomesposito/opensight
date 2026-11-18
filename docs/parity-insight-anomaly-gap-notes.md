# Insight anomaly parity verification

This phase-plan fallback implements the Insight Anomaly computation. There is
no GitHub issue for the slice. Work stays on `work/parity-insight-anomaly`, with
one checkpoint per brief item. No merge, push, dependency addition, AWS call,
external network access or `SOLUTION_DESIGN.md` edit is part of this work.

## Behavior and compatibility

Both parser dialects validate anomaly bodies, IDs, names and detection options.
The native planner binds the computation's date dimension and SUM measure;
the web converter, configuration validator, author query and narrative compiler
use the same bindings. The preset leaves detection options absent, using BOTH
and no percentage filter. Native PascalCase options round-trip unchanged.

Detection uses the whole chronological non-null series, with at least five
points, median center, MAD spread and robust z-score threshold 3.5. Zero MAD
makes only nonzero deviations candidates. The optional percentage threshold
uses the absolute median; a zero median skips that extra filter. Direction
filters positive or negative deviations. Null counts are disclosed, duplicates
are rejected before null exclusion, and nonfinite values or arithmetic fail
closed. At most five anomalies are named chronologically, with the remainder
count disclosed. The exact method is documented in [Insight](insight-visual.md).

The native planner's existing collection rule restricts TopBottomMovers to
all-movers collections because they bind category plus time. Anomaly follows
Forecast and PeriodToDate: it can share one date dimension with other admitted
computations, but cannot mix with movers. No collection rule was relaxed.
Like sibling computations, optional names remain metadata; sentences use field
display names. Custom narratives remain unsupported.

## Divergences

QuickSight uses ML anomaly detection. OpenSight's deterministic robust
statistics are explicitly labeled statistical in the narrative and capability
copy; ML-result parity is not claimed. Sentence composition is OpenSight's,
and no matching QuickSight anomaly screenshot or measured visual fidelity is
available. Missing calendar periods are not filled. The existing visual empty
state remains, while the narrative function itself reports insufficient data.

## Verification

Strict TypeScript compilation passed for the parser, query engine, web
application and web test build. The focused parser, planner and web Insight
suites passed **135 passed / 0 failed / 0 skipped**. Coverage includes both
validation dialects, native/prepared planner admission and bindings, malformed
options, shared-dimension collection rules, field projection/rebinding, native
conversion/import/query/SVG/export round trips, preset dispatch and non-date
errors, and every detector edge case in the brief. Additional checks cover the
inclusive robust-z and percentage thresholds, negative and zero medians,
even-length medians, all date grains, overflow and absent-default preservation.

The initial round-trip SVG assertion joined text nodes without accounting for
whitespace dropped at existing visual line boundaries. The assertion now checks
the rendered glyph content independent of wrapping; the exact narrative text
remains separately asserted. No production layout behavior changed.

The full repository-root `TZ=UTC npm test` exited **0** on 2026-11-18,
with `OPENSIGHT_CHROMIUM` set to the installed Playwright headless shell:
**5,730 passed / 0 failed / 37 skipped / 0 cancelled** (5,767 tests including
the Python SDK). All skips require live PostgreSQL: 36 lack `DATABASE_URL`,
and one lacks live TLS PostgreSQL configuration. No tests were removed,
skipped as a workaround, or given weaker timing limits.

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
| Web | 2,770 | 0 | 0 |
| Root checks | 110 | 0 | 0 |
| **Total** | **5,730** | **0** | **37** |

Logs and exit statuses are retained under
`.opensight/insight-anomaly/verification/`: `root-npm-test.log`,
`root-npm-test.exit`, `test-summary.json`, `focused-tests.log` and
`focused-tests.exit`. The complete suite ran outside the filesystem sandbox
for its local servers, native dependencies and browser subprocesses.

## Static demo and captures

`npm run build:demo --workspace @opensight/web` exited **0**, including strict
TypeScript and the embed builds. The demo hash and build log are retained in
the verification directory. This is a rebuilt local static demo, not a deployed
server.

The offline acceptance capture passed **5 scenes, 0 page errors, 0 external
requests and 0 horizontal-overflow failures** at 1440 pixels. Scenes cover the
existing summary and forecast plus anomaly's non-date error and light/dark
unavailable states. The pinned demo has only three dated points, so it honestly
reports that at least five non-null points are required. The narrative wraps
within its card and the preset retains its date requirement. Artifacts are in
`.opensight/insight-anomaly/browser/`.

The default Chromium launch hit `Hatch WebGL domain policy is required for
browser startup`. Captures and the full suite use the brief's installed
Playwright headless-shell override. Captures block all HTTP(S) requests.

A matching summary capture against the saved pre-change demo is pixel-identical
outside the edited capability note and its enclosing dock. The changed region
is x=214–430, y=874–981; both images are 1440×1324. Evidence is in
`baseline-browser/` and `verification/screenshot-comparison.json`. Visual review
against the local `qs-author-light-flow.jpg` reference retains the left-to-right
Data → Visuals/field wells → sheet flow and dominant canvas. No new layout gap
was found. Exact anomaly wording and pixel fidelity remain unmeasured.

The [Insight summary](images/insight.png) and
[forecast unavailable state](images/insight-forecast.png) screenshots were
refreshed because their capability note changed.

The README hero GIF is intentionally unchanged: the brief excludes it because
the tour never configures an Insight anomaly.
