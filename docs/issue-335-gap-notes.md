# Issue #335: live embed controls and verification

Branch: `work/issue-335-embed-filtering`. D-102 Q3 and the supplied issue brief
govern this H6 slice. No dependency, SDK protocol, source execution path or
`SOLUTION_DESIGN.md` change was needed. No merge, push, AWS call or deployment was
performed.

## Behavior and security

Filtering and parameter controls are supported tenant capabilities and remain off
by default. Dashboard/visual frames edit only values bound by the saved asset and
the authorized visual plans. State stays in frame memory and is submitted on each
refresh or reconnect. Reset all re-loads saved defaults; no reader state is stored
on the server. The existing secured planner runs before source I/O, and the
existing contained workers and revision checks still govern publication.

The extended root-wired embed suites cover independent flags, unknown and
mistyped state, duplicate/oversized values, disabled or out-of-scope filters,
calculated-field parameters, default isolation, anonymous tags, source/dataset
RLS intersection, and direct/calculated CLS-denied bindings. A west-region
selection cannot expose the registered reader's denied west row. Its empty KPI
sum is `null`, consistent with the shared evaluator. Invalid state and CLS
references fail before the test source-read hook can run.

The frame tests cover complete typed submissions, hiding stale results during
refresh, reset, failed refreshes, escaped labels, absent controls when flags are
off, and credential-only HTTP requests without parent-message state. Browser
verification caught native form submission being blocked by the existing iframe
sandbox; Apply and Enter now use explicit handlers without relaxing that sandbox.
The parent frame retains the latest successful result, so a visibility/status
recheck cannot remount the dashboard with its original selections or results.

The full suite also caught the new inline renderer crossing the existing
serverless response budget. Sign-in and Data-page CSS now load only in the main
app, preserving their cascade there and removing unused CSS from embeds. The
session renderer is 1,563,288 bytes before shell payload insertion; the existing
CSP/nonce/envelope test passes without changing the 2 MiB limit. Serverless ingress
now admits content POST under the same auth/body contract; a regression keeps
status GET-only and rejects other unintended embed method combinations.

## Browser and visual review

The existing `packages/api/scripts/verify-embed-browser.mjs` harness was extended
and passed with local HTTPS parent/frame servers, live PostgreSQL, synthetic
data, the real hosted API and contained workers. The installed Playwright
headless shell was selected through `OPENSIGHT_CHROMIUM`; no download was needed.
Evidence is in `/tmp/issue-335-browser-final/evidence.json`. Desktop documentation
uses the settled captures from `/tmp/issue-335-browser/`; the final browser run
captured the same controls during their visibility-remount entrance animation.

- Dashboard and visual-only inputs change the authorized total from 40 to 30.
  Selecting west yields no matching total, and reset restores 40. Visibility
  rechecks preserve the applied total and parameter values.
- Disabling both flags removes controls; direct state submission returns
  `EMBED_FEATURE_DISABLED`. Forged messages, bootstrap race/replay, blocked
  third-party cookies, author saves, revocation, expiry, suspension, key rotation
  and the v1 total-500 regression also pass.
- The 1280px [dashboard capture](images/embed-session.png) and
  [visual capture](images/embed-filtering-visual.png) retain the H6 header and
  notices. Compact controls dock left and leave the chart dominant, following the
  reference's left-to-right flow. The [390px capture](images/embed-filtering-mobile.png)
  stacks the controls above the chart with no horizontal overflow.
- The rebuilt static demo was compared with `docs/images/sample-dashboard.png`;
  the navigation, chart arrangement, theme and explicit fixed-data notice remain
  consistent. The supplied `qs-author-light-flow.jpg` was reviewed for dock/canvas
  order. This is a layout review, not a measured QuickSight fidelity claim.

The README hosted embed screenshot and hero GIF were refreshed. The GIF follows
the supplied `readme-gif.mjs` storyboard with current navigation selectors and the
documented ffmpeg palette/assembly steps, against `packages/web/dist/opensight-demo.html`.
The capture reported zero page errors. Static demo files are not a deployed API;
the offline preview continues to omit live controls. No remaining user-visible
regression was identified, and no external issue was filed under the no-network
constraint.

## Verification

Targeted API/HTTP tests: **17 passed / 0 failed / 0 skipped**.
Targeted frame/transport and corrected CSS interaction tests: **30 passed / 0 failed / 0 skipped**.
Targeted serverless ingress/envelope checks: **2 passed / 0 failed / 0 skipped**.
`npm run build:demo --workspace=@opensight/web`, `node site/build-docs.mjs` and
`node site/check.mjs` pass. Generated documentation is committed with its sources.

The initial sandboxed test attempt could not create local listeners or contained
workers. A root attempt with concurrent browser captures reported a failure in
the existing H4 measured two-tenant performance test and was stopped. That test
passed with the captures stopped. Managed foreground shells also terminated long
runs with signal 15 before a summary, so complete root verification uses a detached
local job with a durable log and exit-status file. A subsequent run exposed the
renderer envelope regression described above. The CSS interaction fixture was
updated to follow the unchanged app cascade after the imports moved. The final
live browser/capture job exited successfully; its log is
`/tmp/issue-335-pre-final.log`. Final root counts after these fixes are recorded
below.

### Post-reboot verification

The first post-reboot root attempt exited 1 with **8,550 passed / 1 failed /
38 skipped** across the workspace suites. The root conformance/site suite did not
run because the workspace command failed. The sole failure was the existing
`v1 dashboards: synchronous CSV/PDF artifacts use frozen definitions and live data,
never stored renders` test: the second CSV request returned 409
`EXECUTION_CANCELLED` before PDF rendering. Its isolated retry passed **1 / 0 / 0**
with the original assertions and execution budgets; no code or test changes were
made. The complete attempt and retry logs are
`/tmp/issue-335-resumed-root.log` and `/tmp/issue-335-export-retry.log`.
