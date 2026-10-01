# Issue #33: local O answers

Implemented on `work/issue-33-nlq-answer` from `de86005`, following the run brief.
`SOLUTION_DESIGN.md`, server O routes, dependencies and hosted authorization are
unchanged. Publication remains with the runner.

## Behavior

Local O previews now delegate to the same `queryDataset(id, query, signal)` path
as field assignments. The preview client retains the active dataset, so query
construction, rendering and expired-source recovery have its ID and column types.
Hosted previews still require `queryO(query, dashboardId, signal)` and fail closed
if it is absent. No-client demos still compute synthetic fixture rows and show
the Offline demo label.

Two prerequisites were visible in the current branch beyond the diagnosed
preview wrapper. `OEntry` hid the whole bar in local mode because local users do
not have hosted AI capability; it now exposes deterministic questions there
without granting that capability or enabling generative mode. `prepareOVisual`
validated against sales fields only; it now receives the draft dataset, including
for calculated-field type checks. Questions against an uploaded `team,amount,day`
schema therefore reach the actual prepared dataset query. Switching datasets
clears stale interpretations. Source labels and the toolbar placeholder name the
active dataset; the sales source remains “Local sales API query.”

Unknown fields and unsupported calculations retain their named preparation
errors. Query failures never substitute fixture rows. Expired prepared sources
show the existing re-upload, prepare, reopen and reconnect guidance. ADD TO
ANALYSIS retains the selected visual, helper calculations and dataset binding.

## Regression coverage

`packages/web/test/o-entry-routing.test.mjs` adds eleven cases covering local
routing with and without `queryO`, dataset forwarding, hosted dashboard scope and
mode changes, hosted fail-closed behavior, offline rows and labels, uploaded
columns and ADD TO ANALYSIS, dates and calculated dates, both expired-source error
codes, preparation errors, and dataset-change invalidation. The existing API
failure test now mocks the local dataset endpoint. Hosted role regressions remain
unchanged. Focused checks passed before each runtime checkpoint.

## Browser and visual review

`packages/web/scripts/verify-o-answer.mjs` starts an isolated real local API and
Vite, uploads a synthetic CSV through the UI, and inspects both HTTP responses
and rendered SVG charts/data tables. Installed Chromium blocks loopback, so Node
forwards unchanged requests and responses at the actual browser origin; no API
responses or chart rows are mocked. The Vite transport adds `/api` before the API
route; the script records both paths and asserts the route after Vite's rewrite.

Acceptance checks include sales revenue by region (East 500, West 400), uploaded
amount by team (North 6, South 3), monthly uploaded dates (January 9), and adding
both answers to an analysis. Restarting that API retains prepared metadata but
loses uploaded rows, exercising the real `PREP_SOURCE_NOT_FOUND` recovery path.
An independent rebuilt `file://` demo is checked with HTTP(S) blocked.
The final browser run exited 0 with 17 actual API query requests, zero page
errors, zero external requests and zero hosted O requests. Early script-only
assertions were corrected for Vite's transport prefix and for the two expected
recovery notices; no product checks were removed.

The captures are compared visually against the private
`qs-author-light-flow.jpg` and `dyn-05-author-o-bar.png` references. The existing
Data → Visuals → sheet order and toolbar are retained. O keeps its existing
document-flow answer, with readable axes, real values, source labels and add
action; the denser QuickSight layout remains a known difference. No new layout
regression was found in the checked 1440-pixel desktop viewport. Visual fidelity
is not measured; connector and broader polish work remain outside this issue.

The README tour uses `capture-readme-tour.mjs`, adapted from the required external
`readme-gif.mjs`, against the freshly rebuilt static demo. It now waits for O's
chart, checks its offline label and shows ADD TO ANALYSIS. FFmpeg produces 82
frames at 960×600, 8.2 seconds. The README distinguishes that offline tour from
the real local uploaded-data O screenshot. Affected Author, local data, draft
history and expired-draft screenshots are refreshed from the same capture run.

## Verification evidence

Local logs and captures are retained under ignored `.opensight/issue-33/`:
`api-build.log`, `demo-build.log`, `browser.log`, `browser/`, `gif-final.log`,
`gif-final/`, `gif-assembly.log`, `full-tests.log`, and `full-tests-final.log`.
The initial full-suite process received SIGTERM during query-engine tests after
488 tests passed in the completed workspaces, with no reported failures. It is
not counted as a completed run; the final run records its exit status separately.

The complete rerun of
`TZ=UTC DATABASE_URL=postgresql://postgres@localhost:5433/opensight npm test`
from the repository root exited 0: **1,571 passed / 0 failed / 0 skipped**.
All live PostgreSQL tests ran. Strict TypeScript checks and workspace builds ran
through the standard scripts. `full-tests-final.exit` records the successful
exit status.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 255 | 0 | 0 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 4 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Query engine | 512 | 0 | 0 |
| Web | 565 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| **Total** | **1,571** | **0** | **0** |

API build, static-demo build, browser acceptance, GIF assembly and
`git diff --check` also passed. The static demo in `packages/web/dist` is a local
artifact, not a deployed server. All work is committed on the requested branch;
no merge, push or issue closure was performed.
