# Issue #52 — Back to top

Implemented from the supplied issue brief on `work/issue-52-back-to-top`.
No dependencies were added and `SOLUTION_DESIGN.md` is unchanged. See
[Back to top](back-to-top.md) for behavior and accessibility details.

## Implementation and checks

`Application` owns one `BackToTop` instance across its pages. Dashboards,
sample pages, and the connector gallery use window scrolling, so nested
table/chart scroll areas need no changes. The control uses a passive listener,
removes itself at or below 600px, and reads the motion preference on every
activation. It sits below the header and Ask Q panel in the stacking order.

Seven component/integration tests run through the existing root test command.
The focused run passed **7 / failed 0 / skipped 0**. Coverage includes both
threshold directions, initial scroll restoration, visible/accessible naming,
smooth and reduced-motion requests, preference changes, StrictMode listener
cleanup, and the shared shell across dashboard and gallery routes.

`npm run build:demo --workspace @opensight/web` rebuilt the static demo and
embed artifacts, including strict TypeScript checks. Chromium exercised real
window scrolling at 600/601px, pointer activation, native Tab focus, the visible
focus outline, Enter and Space activation, return-to-top hiding, and an instant
reduced-motion jump. Sample dashboards, definition previews, the expanded
connector gallery, and a 390px viewport passed with zero page errors and zero
external requests. Firefox, WebKit, and screen-reader speech were not exercised.

## Visual review and media

At 1280px, comparison with the previous static demo found **zero changed pixels**
on Home at the top. At a 680px scroll position, **10,324 pixels** changed within
the button and its shadow; the dashboard layout was unchanged. The button uses
12px Arial with system fallbacks, navy chrome, 4/8px spacing, and the existing
focus outline. Desktop and mobile captures keep the control inside the viewport.
The local QuickSight author reference supplies the compact chrome and
Data → Visuals/wells → sheet layout guidance; no back-to-top reference was
provided. Back-to-top visual parity and overall visual fidelity are unmeasured.
No new unresolved visual defect was found.

The feature screenshot is `docs/images/back-to-top.png`, linked from the new
behavior doc and README. Existing feature screenshots remain representative
because their UI above the threshold did not change.

The README hero GIF was regenerated from the freshly rebuilt demo using the
maintained adaptation of `~/workspace/tools/screenshots/readme-gif-44.mjs`,
adding the scroll-and-return interaction to the existing tour. The live DOM
probe confirmed the current navigation links and Ask Q trigger. Capture produced
173 frames with zero page errors; FFmpeg used the script's palette workflow
to assemble the 960×600, 10fps GIF.

Browser scripts, captures, pixel comparisons, and logs are retained locally in
ignored `.opensight/issue-52/`. Chromium required permissions for local sockets
outside the filesystem sandbox; its capture scripts block external HTTP
requests. No reference images or private data were committed. The demo is a
static artifact, not a deployed server.

## Final full-suite results

`TZ=UTC npm test` from the repository root exited **0**:
**1,821 passed / 0 failed / 12 skipped / 0 cancelled**. All skips require live
PostgreSQL with `DATABASE_URL`; no web test was skipped. Workspace builds and
strict TypeScript checks passed.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 303 | 0 | 10 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 500 | 0 | 2 |
| Web | 761 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| **Total** | **1,821** | **0** | **12** |

The first full-suite attempt ran alongside another test run and a package
installation. The existing containment timing check exceeded its 3,000ms
execution limit at 4,020ms, and this attempt was stopped. After the competing
test run finished, the complete retry above passed; the same containment check
measured 2,587ms. No implementation or timing assertion was changed for the
retry. Both attempt logs and the final machine-readable totals are retained
under `.opensight/issue-52/`.

`git diff 2456861f --check` is clean. All committed changes are scoped to
issue #52. Nothing was merged, pushed, or published.
