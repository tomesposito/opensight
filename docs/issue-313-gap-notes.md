# Issue #313 verification and visual checks

The fix follows the supplied issue brief. SOLUTION_DESIGN.md was not edited.
All checkpoint commits stay on `work/issue-313-nonadditive-combination`.

## Demo and screenshots

Rebuilt `packages/web/dist/opensight-demo.html` using `npm run build:demo
--workspace @opensight/web`. It is a static local demo, not a deployed server.

Ran `packages/web/scripts/capture-kpi-targets.mjs` against the pre-build demo
with `--baseline`, then against the rebuilt demo. All eight bar/line/table/pie
captures in light/dark themes have identical SHA-256 hashes. KPI target text,
progress, ascending/descending trend ordering, save/reload, 12px Arial editor
controls and 1440px page width pass the browser checks. Browser errors and
HTTP(S) requests are both empty. Artifacts are in `/tmp/opensight-313-captures`.

Reviewed the light/dark KPI captures and refreshed `docs/images/kpi-targets.png`
and `docs/images/kpi-targets-dark.png`. Refreshed the README hero with the existing
`capture-kpi-trend-tour.mjs` adaptation of `~/workspace/tools/screenshots/readme-gif.mjs`
and its palettegen/paletteuse ffmpeg assembly: 43 frames, 960×600, 4.3 seconds,
no browser errors or external requests. Frames and intermediate artifacts are
in `/tmp/opensight-313-tour`.

The managed Chromium executable lacked its startup policy; the installed
Playwright headless shell completed the checks with local execution permissions.
Both capture scripts abort HTTP(S) requests. No new visual gap was found in the
comparison. QuickSight visual fidelity remains unmeasured.
