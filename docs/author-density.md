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
