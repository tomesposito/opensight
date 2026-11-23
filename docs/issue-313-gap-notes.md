# Issue #313 verification and visual checks

The fix follows the supplied issue brief. SOLUTION_DESIGN.md was not edited.
All checkpoint commits stay on `work/issue-313-nonadditive-combination`.

## Embed response budget regression

The first full root run exposed `RESPONSE_TOO_LARGE` in the existing CSP/nonce
test. Adding the expression parser to the embed compiler grew its HTML from
1,550,575 bytes (a separate master-source build) to 1,562,715 bytes. The response
fits the 2 MiB serialized envelope, but the early wire-byte check subtracted an
additional 16 KiB header allowance and rejected it prematurely.

The early capture now bounds wire bytes at three quarters of the envelope cap;
the existing exact serialized-envelope check and 16 KiB header check still run
before returning a response. The CSP/nonce regression also asserts the actual
serialized size and rejection of an oversized payload. No response-envelope
limit, dependency or browser target changed.

## Historical output oracles

The new normalized binding metadata changes full-model hashes. Existing KPI,
category, facet, pivot and table baseline comparisons use a shared test helper
that asserts SUM metadata and omits only that field from the legacy comparison.
All stored expected hashes remain unchanged. The focused sort/baseline suites
pass 349 tests, with no failures or skips.

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
