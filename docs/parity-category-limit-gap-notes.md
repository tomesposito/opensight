# Category limits: offline captures and gaps

`npm run build:demo --workspace @opensight/web` passed, including strict
TypeScript and embed builds. The local single-file demo is 2,490,213 bytes.
The supervisor's `build-demo-shim.mjs` was not run. This is a local static
artifact, not a deployed server.

`packages/web/scripts/capture-category-limit.mjs` loaded that rebuilt demo
from `file://`, blocked HTTP/HTTPS, and recorded **zero page errors and zero
external requests**. It exercised INCLUDE/EXCLUDE, invalid-count retention,
clearing, save/reload, view-data and changes to all five newly supported kinds.
For the pinned bar sample, the unlimited rows are Hardware=200, Software=300;
a count of one produces Hardware=200, Other=300, and EXCLUDE keeps Hardware=200.
Compiler tests cover multi-row sums beyond this two-category demo sample.

The captures use 1440×1000, reduced motion, 12px Arial controls, and have no
horizontal page overflow in either light or dark mode:

- [Limited bar, light / refreshed README Properties screenshot](images/properties-panels.png)
- [Limited bar, dark](images/parity-category-limit-bar-dark.png)
- [Limited bar with view-data](images/parity-category-limit-bar-data.png)

Additional unlimited, EXCLUDE, line, area, combo and percentage-bar captures,
plus `acceptance.json`, are under `.opensight/parity-category-limit/browser/`.
The build and capture logs are `/tmp/opensight-category-demo-build.log` and
`/tmp/opensight-category-capture.log`.

Compared the bar and Category limit captures with the local reference
`qs-2026/qs-properties-group-color.jpg`. Data → Visuals → canvas ordering,
docked Properties, compact labels and the count control's position before
Legend remain consistent. Line/area/combo expose only the new limit section,
without adding Group/Color sort controls. The existing larger explanatory
text, card geometry, legend placement and offline disclosures still differ
from the reference; visual fidelity is not measured. No new presentation gap
was found. No GitHub issue was filed because the brief prohibits network access
and identifies this as a phase-plan fallback with no issue.

The README hero GIF was deliberately not regenerated: the tour never sets a
category limit, as explicitly ruled in the brief. The README Properties
screenshot was refreshed because that feature image shows the changed
Group/Color section; its caption now describes the working category limit.

## Verification and scope

The focused compiler, pie, facet, forecast and Properties run passed
**164 passed / 0 failed / 0 skipped**, including 53 new category-limit tests
and the base compiler suite. Its old rejection of a valid bar limit now checks
an out-of-range limit instead.
Strict TypeScript checks passed. The final full root `TZ=UTC npm test` run
exited **0**: **5,783 passed / 0 failed / 37 skipped**, 5,820 total tests and
no cancellations. This includes all 2,823 web tests, 32 Python SDK tests and
110 root conformance/site tests. All 37 skips require live PostgreSQL
(35 API, 2 query engine).

The full log is `/tmp/opensight-category-root-verified.log`; the per-workspace
counts are `/tmp/opensight-category-test-counts.json`. The successful run used:

```sh
OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" TZ=UTC npm test
```

The sandbox prevents Chromium startup (`Operation not permitted`) and hides
individual child-test results. Full-suite verification and captures therefore
run outside that sandbox, using the installed Playwright headless shell via
`OPENSIGHT_CHROMIUM`; no browser download or dependency change is needed.

The one brief mismatch is the grouped-bar end-to-end case: this checkout
rejects its second dimension before the limit pass. The production shared
transform is directly tested with grouped/faceted rows while the existing
parser restriction remains, as detailed in [the semantics doc](parity-category-limit.md#grouped-row-scope).
No query engine, sorting behavior or grouped-bar renderer was added.
