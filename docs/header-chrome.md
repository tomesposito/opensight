# Header chrome

The shared [app navigation](app-navigation.md) header identifies OpenSight and
the active product section. Inside Analyses, Author uses two full-width,
square-edged bands: the editable analysis title above the blue analysis toolbar.
The toolbar orders File, Edit, Data, Insert, Sheets, Objects, Search, the
Q trigger, Add visual, FIT TO WIDTH, PUBLISH, and NEW LOOK. At desktop widths,
the identity band is 32px high and the menu strip is 36px; title and controls
use 12px type. Q uses a flexible 220–280px pill centered between the menus
and actions. Narrow viewports wrap controls without changing their reading
or keyboard order. Long analysis and dataset names truncate visually while
their full values remain available to editing and accessibility APIs.

The app already supplies its brand in the product navigation. Its analysis
title therefore has no standalone brand separator. Standalone Author retains
the compact OpenSight logo/name block. Neither surface changes dock widths.

Native `details`/`summary` menus keep keyboard activation, exclusive opening,
Escape-to-close with focus restoration, outside-click closure and action
closure. Popovers anchor below the menu, above the sheet, with a themed border,
shadow and surface. `aria-label="Analysis menu"` and the existing selectors
remain available to tours. Q opens the shared right-hand panel above sticky
headers so Close remains clickable. Its dimensions and answer layout are
unchanged. Hosted-service and static-demo disclosures remain visible in flow.

NEW LOOK remains the native Light/Dark select with `aria-label="NEW LOOK"`.
It dispatches the existing `chrome` action, persists in the local draft, and
sets `data-chrome` on the workspace. It does not change analysis themes or
bundle formats. FIT TO WIDTH retains its pressed state and 1200-pixel alternative.
PUBLISH still reports that publishing needs a hosted API; it publishes nothing.

## Colors and contrast

Tokens live in `packages/web/src/style.css`. Both editor themes inherit the
same header colors; only the popover/editor surface colors change. Ratios use
WCAG relative luminance and are rounded here, not in the assertions.

| Header token pair (foreground / background) | Light and dark | Contrast |
| --- | --- | ---: |
| `--header-text` / `--header-bg` | `#ffffff` / `#142536` | 15.58:1 |
| `--header-muted` / `--header-bg` | `#c8eafa` / `#142536` | 12.32:1 |
| `--header-text` / `--header-menu-bg` | `#ffffff` / `#187199` | 5.44:1 |
| `--header-text` / `--header-hover` | `#ffffff` / `#126080` | 6.98:1 |
| `--header-text` / `--header-pressed` | `#ffffff` / `#0b435f` | 10.59:1 |
| `--header-selected-text` / `--header-selected-bg` | `#103e56` / `#e2f2fa` | 9.92:1 |
| `--header-selected-text` / `--header-selected-hover` | `#103e56` / `#c8eafa` | 9.00:1 |

`--header-border` is `#c8eafa`; `--header-focus` is white. Open menus have an
underline as well as a darker background. The active FIT TO WIDTH button has
a pale fill and dark underline; focus rings remain visible in both themes.
The Q trigger uses the pressed background with opaque white text.

| Popover token | Light | Dark |
| --- | --- | --- |
| `--chrome-surface` | `#ffffff` | `#202e40` |
| `--chrome-text` | `#19384a` (12.31:1) | `#e7eef7` (11.77:1) |
| `--chrome-muted` | `#526c7a` (5.55:1) | `#adc0d5` (7.39:1) |
| `--chrome-menu-hover` | `#eaf3f8` (10.95:1) | `#293f55` (9.28:1) |
| `--chrome-border` | `#c9d8de` | `#45566d` |
| `--chrome-menu-shadow` | `#14253633` | `#00000080` |

Text and hint ratios use the surface background; hover ratios use the text
foreground. All tested normal-text pairs exceed 4.5:1. The 20 stylesheet-token
checks in `packages/web/test/header-chrome.test.mjs` run through root `npm test`.
The toolbar integration test also verifies composition, Q submission, theme
persistence, and unchanged analysis serialization. No dependencies were added.

Build the static demo with `npm run build:demo --workspace @opensight/web`.
The artifact is `packages/web/dist/opensight-demo.html`, not a deployed server.
Internal references, screenshots and tour scripts stay outside version control.

## Screenshot validation

The [toolbar/header geometry notes](parity-toolbar-header-gap-notes.md) record
1440×900 light/dark captures, reference-region diffs, responsive checks and
full-suite results. The header tour's 34 computed-color checks have a minimum
contrast of 5.44:1. Keyboard menus, Q, FIT TO WIDTH, PUBLISH, theme persistence,
other-mode chrome and narrow layouts pass with no browser errors or external
requests. Geometry tests run in offline Chromium through root `npm test`.

The compact bands and disclosure spacing move the docks 42px higher while
retaining their 190 / 216 / 758 / 220px desktop widths. The extra product
navigation, visible local-mode disclosures, reference colors and different
canvas content remain measured gaps; visual equivalence is not claimed.
