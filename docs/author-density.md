# Issue #41: Author density and typography

The editor uses compact 4/8px spacing, 28px standard controls, 26px field rows,
and 13px dock headings. The visual gallery has a 168px scroll area. Field wells,
Properties sections, sheet controls, card headings and table cells use less
padding so more of the analysis fits in the viewport.

Chrome, docks and card controls use `Arial, "Helvetica Neue", Helvetica,
sans-serif`, documented in `AGENTS.md`. These are system fonts; no font asset,
remote font request or dependency was added. Analysis themes still select chart
and table typefaces, and explicit title/table text sizes remain authoritative.

Save/New, Local drafts and Import bundle share a wrapping utility row. Opening
either native disclosure expands it in document flow. The redundant Builder v1
and Fixtures/Offline badges were removed; the detailed preview notice, sample
row provenance, API requirements, device-save status, export limitations and
publication notice remain available in their existing locations.

The Data → Visuals/wells → sheet → Properties order, desktop track widths,
44px collapsed rails, responsive defaults, stored grid geometry, selection and
keyboard controls retain their existing semantics. No query, reducer, dataset,
chart compiler or hosted behavior changed. `SOLUTION_DESIGN.md` is unchanged.

Build the local static artifact with:

```sh
npm run build:demo --workspace @opensight/web
```

Run the density tour with the existing Playwright/Chromium installation:

```sh
OPENSIGHT_SCREENSHOT_OUTPUT=/path/to/private/captures \
  node packages/web/scripts/capture-density-tour.mjs
```

The tour adapts issue #4's header checks to the current product navigation and
O naming. It checks both themes at 1440×900, header contrast, menu focus/closure,
FIT TO WIDTH, publication disclosure, O submission, saved theme, native utility
disclosures, gallery keyboard access, dock collapse/reopening and responsive
geometry from 390 to 1920 pixels. Screenshots, per-area reference comparisons
and geometry reports remain in the private look-and-feel directory. The demo
is a local static file; QuickSight visual fidelity remains unmeasured.

## Validation (2026-10-06 UTC)

Root `npm test` exited **0** with **1,682 passed / 0 failed / 0 skipped /
0 cancelled**, with `TZ=UTC` and `DATABASE_URL` pointing to the existing local
PostgreSQL test service. Strict TypeScript checks and root conformance passed.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 313 | 0 | 0 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| Interpreter | 32 | 0 | 0 |
| Query engine | 514 | 0 | 0 |
| Web | 611 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| total | 1682 | 0 | 0 |

The first root attempt overlapped browser captures and GIF encoding and failed
the existing H4 containment timing test (maximum execution 6.74s against 3s,
competing tenant 12.25s against 6s). That run was stopped. With the media work
finished, the complete root rerun passed unchanged assertions: 1.94s maximum
execution and 3.36s competing-tenant latency. No timing threshold was relaxed.

The demo build exited 0. The density tour produced 10 final light/dark captures
with no page errors or external requests; 38 toolbar contrast checks retained
a minimum 5.44:1. At 1440×900, docks begin 120px higher and the canvas begins
176px higher than the clean issue #40 baseline, with all four track widths
unchanged. These measure OpenSight's own layout, not QuickSight parity.

The pivot (8 captures), radar (9 captures) and local draft/recovery tours all
exited 0 with no page errors or external requests. Refreshed `author.png`,
`pivot.png`, `radar.png`, `local-data.png`, `local-drafts.png` and
`expired-draft.png`, plus the README hero GIF: 106 frames, 960×600, 10fps,
10.6 seconds. The hero uses the maintained repository adaptation of the
workspace `readme-gif.mjs` capture and its FFmpeg palette assembly commands.
