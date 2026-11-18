# Small multiples sorting: verification and captures

`npm run build:demo --workspace @opensight/web` passed, including strict
TypeScript and the embed builds. The local single-file demo is 2,493,239 bytes.
The supervisor's `build-demo-shim.mjs` was not run. This is a local static
artifact, not a deployed server.

The focused compiler/facet regression run passed **153 passed / 0 failed /
0 skipped**, including all 55 new small-multiples-sort cases. Thirty-six
pre-slice output baselines match byte for byte with sorting unset. The log is
`/tmp/opensight-sm-sort-focused.log`.

## Offline acceptance

`packages/web/scripts/capture-small-multiples-sort.mjs` loaded the rebuilt demo
from `file://`, blocked HTTP/HTTPS and recorded **zero page errors and zero
external requests**. The pinned sample's panels start East → West; Ascending
keeps East → West and Descending visibly changes them to West → East.
With a one-panel INCLUDE limit, Ascending shows East → Other and Descending
shows West → Other; EXCLUDE retains only the first panel. Save/reload preserves
the sort and limit. Pie-to-bar conversion, clearing and field-removal cleanup
also passed.

Captures use 1440×1000, reduced motion and 12px Arial controls, with no horizontal
page overflow in either light or dark mode:

- [Descending panels, light](images/parity-sm-sort-light.png)
- [Descending panels, dark](images/parity-sm-sort-dark.png)

All captures and the acceptance report are under `.opensight/parity-sm-sort/browser/`:

- `pie-none.png`
- `pie-ascending.png`
- `pie-descending-light.png`
- `pie-descending-dark.png`
- `pie-descending-include.png`
- `bar-descending-include.png`
- `acceptance.json`

Build and capture logs are `/tmp/opensight-sm-sort-demo-build.log` and
`/tmp/opensight-sm-sort-capture.log`. The run uses the already-installed shell:

```sh
OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" node packages/web/scripts/capture-small-multiples-sort.mjs
```

## Reference comparison and scope

Compared the light/dark captures with local references
`qs-2026/qs-properties-multiples.jpg` and `qs-2026/qs-pie-small-multiples.jpg`.
Data → Visuals → canvas ordering, per-panel titles, one shared legend and a
docked Multiples Options section remain intact. The sort select uses the
existing compact controls above the panel limit and Layout section. Its field
label and selected direction remain readable in both themes.

The existing narrow-card pie sizing, extra explanatory text, legend placement
and offline disclosures still differ from the reference; the analysis theme
continues to own the chart surface independently of the chrome theme. Visual
fidelity is not measured. No new presentation gap was found. No GitHub issue
was filed: this is a phase-plan fallback without an issue, and network access
is outside the brief's scope.

Only a single sort entry is supported, matching categorySort. Sentence
composition is not applicable. The former unparsed-smallMultiplesSort divergence
is resolved in [the semantics doc](parity-sm-sort.md). The documentation scan
found that stale statement only in `parity-sm-limit.md`; it now links to the
resolution. README, field-well and Properties descriptions also reflect sorting.

The README hero GIF was deliberately not regenerated because the tour never
opens Multiples Options, as explicitly ruled in the brief. Existing README
feature screenshots do not show that section; the two new captures above show
its updated controls. No dependencies, AWS calls, deployment, merge or push
were added, and `SOLUTION_DESIGN.md` is unchanged.

## Full root verification

The final full root run exited **0**: **5,838 passed / 0 failed / 37 skipped**,
5,875 total tests, with no cancellations or todos. All 37 skips require live
PostgreSQL (35 API, 2 query engine). This includes all 2,878 web tests, 32 Python
SDK tests and 110 root conformance/site tests. No brief item is unfinished.

```sh
OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" TZ=UTC npm test
```

The full log is `/tmp/opensight-sm-sort-root.log`; exact workspace counts are
in `/tmp/opensight-sm-sort-test-counts.json`. The sandbox hid isolated child-test
results in the first focused attempt, so focused checks used Node's existing
`--test-isolation=none` option. The full root suite and offline browser captures
ran outside that sandbox using the installed Playwright shell; no download or
dependency change was needed.
