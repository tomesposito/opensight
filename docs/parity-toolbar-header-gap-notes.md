# Toolbar/header geometry parity

This sweep implements the toolbar/header geometry spec item. It does not open
an issue, publish, or change `SOLUTION_DESIGN.md`. Private references and all
comparison captures remain untracked; README stills contain only OpenSight.

## Measurement and implementation

The clean starting branch points at master `d27a7f54`. The #43 and #45 gap
notes and #44 parity report were reviewed. `docs/issue-44-gap-notes.md` is
absent from the checkout and Git history; #44's commits and baseline provide
its available evidence.

The rebuilt offline demo was captured in Chromium at 1440×900, light and dark,
using `packages/web/scripts/capture-toolbar-header.mjs`. Both themes share
the same header geometry and colors. Baseline: **0 page errors / 0 external
requests**; no horizontal overflow at 1100, 760 or 390px in either theme.

| Geometry (CSS px, 1440px wide) | Before | After |
| --- | ---: | ---: |
| Product navigation above editor | 113 | 113 |
| Product logo/name block x / width / height | 36 / 147.53 / 43 | unchanged |
| Identity band height | 50 | 32 |
| Identity padding vertical / horizontal | 6 / 16 | 2 / 16 |
| Analysis name input x / width / height | 35 / 1389 / 32 | 16 / 608 / 28 |
| Name input padding vertical / horizontal | 5 / 8 | 4 / 8 |
| Menu strip height | 44 | 36 |
| Menu padding vertical / horizontal | 14 / 10 | 8 / 8 |
| Gap between menus | 4 | 0 |
| First / last menu x | 16 / 333.45 | 16 / 285.45 |
| Control center offset from strip center | 0 | 0 |
| Q entry x / width / height | 403.48 / 420 / 30 | 552.44 / 259.19 / 28 |
| Q center distance from new-look reference center | 95.2 | 26.6 |
| FIT TO WIDTH x / width | 1102.69 / 97.98 | 1105.95 / 98 |
| PUBLISH x / width | 1204.67 / 70.63 | 1207.95 / 69.36 |
| NEW LOOK group x / width | 1287.30 / 136.70 | 1285.31 / 138.69 |
| Action padding vertical / horizontal | 5 / 10 | 4 / 8 |
| Strip bottom → dock top | 123.30 | 107.30 |
| Dock top | 330.30 | 288.30 |
| Dock columns | 190 / 216 / 758 / 220 | unchanged |

Reference measurements are approximate (classic is a compressed video image).
At source width 1206px, classic's identity/menu bands occupy approximately
y=104–123 / 123–148; new-look y=8–34 / 34–67. Uniform width normalization
to 1440px gives identity heights **22.7 / 31.0px**, menu heights **29.9 /
39.4px**. New-look's Q entry spans approximately x=500–687 (223.3px wide
normalized), with center x=708.7px normalized. The classic Q entry is not
legible enough for a reliable control measurement. New-look's NEW LOOK
control is on its separate action row; OpenSight preserves the existing
menu order and native Light/Dark selector.

The clearer new-look reference also permits approximate control measurements
(±2 source pixels; source width 1206px). Text starts, rather than invisible
hit-area edges, are used for menu spacing:

| New-look reference at 1440px width | Reference | Before | After |
| --- | ---: | ---: | ---: |
| File text x | 25.1 | 26.0 | 24.0 |
| Edit text x | 60.9 | 69.3 | 59.3 |
| Data text x | 97.9 | 114.0 | 96.0 |
| Insert text x | 138.5 | 163.4 | 137.4 |
| Sheets text x | 187.5 | 217.4 | 183.4 |
| Objects text x | 240.0 | 278.8 | 236.8 |
| Search text x | 297.3 | 343.5 | 293.5 |
| Menu center y relative to identity top | 50.7 | 72 | 50 |
| Q entry width / height | 223.3 / 19.1 | 420 / 30 | 259.2 / 28 |
| FIT TO WIDTH left edge | 1251.3 | 1102.7 | 1106.0 |
| PUBLISH left edge | 1356.4 | 1204.7 | 1208.0 |

The reference logo starts near x=23.9px and title text near x=162.4px after
normalization; its combined logo/title content spans roughly 227px. OpenSight's
product logo and editable title occupy separate rows. The final title's 608px
maximum bounds its editing area, not the text length. PUBLISH/FIT remain left
of the reference positions because the native NEW LOOK selector stays after
them in the existing strip. Reference NEW LOOK starts near x=1331.3px on the
separate row below; moving it there would change the specified control order.
The reference Q hit area is smaller than the retained 28px native button.

The shared product/section navigation and visible static-demo disclosures
account for additional vertical offsets. They must remain usable and honest.
Dock widths, gallery shape, canvas content and Q answer layout are outside
this sweep.


The identity band and strip use minimum heights with content padding, not
absolute positioning. Menu labels and actions share 12px Arial and a common
vertical center. Q has a flexible 220–280px basis, auto margins and a restored
pill outline (the older generic button selector overrode it). At narrower
widths it grows/wraps with the controls. Dataset names ellipsize without
truncating the accessible name; editable titles keep their complete values.
The app's title no longer has an orphan separator for a brand already shown
in product navigation. Standalone Author retains its logo and separator.

Disclosure margins/padding account for 16px of the 42px upward dock movement;
all disclosure text remains present. Reference strip-to-dock gaps are roughly
36–37px when normalized to 1440px; the demo's 107.3px remains larger because
it includes local save/import controls and honest execution/export notices.

The browser tour found a pre-existing obstruction: the sticky product header
(z-index 60) covered Q's Close button (panel z-index 40). The panel now sits at
70, above both sticky headers and below notifications/native modal dialogs.
Its width, answer content and layout are unchanged. Actual hit testing and
mouse/keyboard dismissal are verified. This also exposes the formerly covered
panel heading in the Home Q comparison.

## Reference comparison and remaining gaps

[Numeric evidence](parity-toolbar-header-measurements.json) records geometry,
responsive widths and both comparison protocols. Full captures/reports stay
in ignored local output. The baseline was rebuilt from `2f7e9c01` in an
isolated archive; both versions use the same capture script, settled auto-save
and fixed 12:00 UTC clock so saved timestamps cannot skew the comparison.

The original October 6 references, regions, exclusions, themes, viewports and
16-channel tolerance are unchanged (checked against the supplied config).
Capture state follows #45: empty Author and Home Q answering **revenue by
region**. The original baseline reports are preserved. No aspect mismatch
occurred and no exclusions were added. Lower percentages mean fewer different
pixels, not a compatibility grade.

| Original pairing / region | Before | After | Change (pp) |
| --- | ---: | ---: | ---: |
| editor-classic overall | 46.90% | 44.20% | -2.70 |
| editor-classic header-toolbar | 86.48% | 66.66% | -19.81 |
| editor-classic data-panel | 41.63% | 44.15% | +2.52 |
| editor-classic visuals-panel | 34.91% | 33.73% | -1.18 |
| editor-classic canvas | 42.73% | 41.97% | -0.76 |
| editor-newlook overall | 44.47% | 42.15% | -2.32 |
| editor-newlook header | 99.42% | 99.42% | 0 |
| editor-newlook toolbar | 99.85% | 99.85% | 0 |
| editor-newlook data-panel | 53.42% | 50.40% | -3.02 |
| editor-newlook visuals-panel | 44.32% | 42.23% | -2.09 |
| editor-newlook canvas | 36.52% | 34.05% | -2.46 |
| editor-newlook properties-panel | 30.00% | 27.00% | -3.00 |
| q-generative overall | 41.04% | 40.99% | -0.04 |
| q-generative header-toolbar | 98.31% | 98.07% | -0.24 |
| q-generative ask-q-panel | 62.01% | 61.83% | -0.18 |

No overall pairing regressed; Home Q's other three regions are identical.
The classic Data region **does worsen by 2.52 points** as the same field list
moves upward. Its horizontal geometry, content and gallery are unchanged.
The new-look header/toolbar scores still sample the extra white product
navigation above the actual editor. They cannot establish header parity.

A **separate editor-origin comparison** makes the scoped change measurable
without rewriting that baseline. It crops each reference to a fixed full-width
window: classic y=104–181; new-look y=8–98. Both 1440×900 captures start at
editor y=113, with a fixed window of 92 / 108px respectively; the existing
harness applies uniform scaling. Bands are never independently stretched.
Reference identity/menu regions are 19/25px and 26/33px at source resolution;
the rest of each window is recorded as below-menu. No pixels are excluded.

| Editor-origin region | Before | After |
| --- | ---: | ---: |
| Classic identity, both themes | 76.53% | 76.92% |
| Classic menu, both themes | 99.94% | 99.40% |
| New-look identity, both themes | 100.00% | 99.98% |
| New-look menu, light | 66.16% | 42.91% |
| New-look menu, dark | 66.16% | 42.91% |

The new-look menu improves by 23.25 points in this comparison. Identity colors,
branding, title text and the classic menu color still differ substantially.
The dark-theme below-menu region intentionally differs from the light
reference; it is reported in the numeric artifact, not excluded. This sweep
reduces measured geometry gaps; **it does not establish visual equivalence**.
Product navigation, disclosure offset, the separate reference action row,
gallery/dock shape, populated canvas and Q answer fidelity remain future work.
No GitHub issue was opened.

## Browser verification

The rebuilt single-file demo is a local static artifact, not a deployed server.
The final capture has **0 page errors / 0 external requests** in both themes,
with no horizontal overflow at **1440, 1100, 760 or 390px**. All seven popovers
fit their viewport. Desktop band heights remain 32/36px; mobile controls wrap.

The existing density/header tour passes menu Enter/Escape and focus restoration,
outside/action closure, Q, FIT TO WIDTH, PUBLISH disclosure, saved dark theme,
utility disclosures and the 1920/1440/1400/1399/1366/1280/1101/1100/760/390px
widths. Its **34 computed-color checks** have minimum contrast **5.44:1**.
The Q tour passes Enter/Space, Escape/Close, answer actions and focus restoration
in Home/Author desktop and mobile, with 400px desktop / 390px mobile panels.
Both tours have **0 page errors / 0 external requests**.

The uploaded Q tour passes **17 real local dataset queries**, no hosted O
queries, and zero browser errors/external requests. The local draft media
flow passes five prepared-data queries with zero browser errors/external
requests. All use synthetic fixtures.

## Independent verification

Final root `TZ=UTC npm test` exited **0** on 2026-10-08:
**1,869 passed / 0 failed / 12 skipped / 0 cancelled**. Every skip requires
live PostgreSQL because `DATABASE_URL` is unset. Strict TypeScript, the twelve
new offline Chromium geometry/stacking cases and root conformance all pass.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 303 | 0 | 10 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| Interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 500 | 0 | 2 |
| Web | 809 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| Total | 1869 | 0 | 12 |

An initial run concurrent with captures hit `EXECUTION_CANCELLED` in the
existing cached-preparation API test's 10-second execution budget. The final
suite ran without concurrent captures and passed unchanged. A second complete
green run also resolved an ambiguous command-runner signal status by recording
npm's own exit code in a durable local file: **0**, elapsed **426.15 seconds**.
No production timeout, test assertion or dependency was changed to obtain a pass.

`npm run build:demo --workspace @opensight/web` exited **0** and rebuilt the
single-file demo plus embed artifacts. No build output, private reference
pixels or reference-derived captures are committed. `SOLUTION_DESIGN.md` and
dependency manifests are unchanged. All checkpoint commits stay on
`work/parity-toolbar-header`; nothing was pushed or merged.

## README media

Refreshed Author empty/populated, auto-save, command palette, keyboard shortcuts,
radar, Sankey, waterfall, insight, pivot, Q side panel, uploaded Q, local data,
local drafts, expired draft, URL actions and toast stills. These are OpenSight
captures only. The repository README tour supports a stills-only mode; the
header capture optionally records the affected authoring controls. The hero
GIF is left to the completion loop as instructed.
