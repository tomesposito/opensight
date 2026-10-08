# Toolbar/header geometry parity

This sweep implements the toolbar/header geometry spec item. It does not open
an issue, publish, or change `SOLUTION_DESIGN.md`. Private references and all
comparison captures remain untracked; README stills contain only OpenSight.

## Baseline measurement

The clean starting branch points at master `d27a7f54`. The #43 and #45 gap
notes and #44 parity report were reviewed. `docs/issue-44-gap-notes.md` is
absent from the checkout and Git history; #44's commits and baseline provide
its available evidence.

The rebuilt offline demo was captured in Chromium at 1440×900, light and dark,
using `packages/web/scripts/capture-toolbar-header.mjs`. Both themes share
the same header geometry and colors. Baseline: **0 page errors / 0 external
requests**; no horizontal overflow at 1100, 760 or 390px in either theme.

| Geometry (CSS px, 1440px wide) | Before |
| --- | ---: |
| Product navigation above editor | 113 |
| Identity band height | 50 |
| Analysis name input x / height | 35 / 32 |
| Menu strip height | 44 |
| Menu padding vertical / horizontal | 14 / 10 |
| Gap between menus | 4 |
| Q entry x / width / height | 403.48 / 420 / 30 |
| FIT TO WIDTH x / width | 1102.69 / 97.98 |
| PUBLISH x / width | 1204.67 / 70.63 |
| NEW LOOK group x / width | 1287.30 / 136.70 |
| Strip bottom → dock top | 123.30 |
| Dock top | 330.30 |
| Dock columns | 190 / 216 / 758 / 220 |

Reference measurements are approximate (classic is a compressed video image).
At source width 1206px, classic's identity/menu bands occupy approximately
y=104–123 / 123–148; new-look y=8–34 / 34–67. Uniform width normalization
to 1440px gives identity heights **22.7 / 31.0px**, menu heights **29.9 /
39.4px**. New-look's Q entry spans approximately x=500–687 (223.3px wide
normalized), with center x=708.7px normalized. The classic Q entry is not
legible enough for a reliable control measurement. New-look's NEW LOOK
control is on its separate action row; OpenSight preserves the existing
menu order and native Light/Dark selector.

The shared product/section navigation and visible static-demo disclosures
account for additional vertical offsets. They must remain usable and honest.
Dock widths, gallery shape, canvas content and Q answer layout are outside
this sweep.
