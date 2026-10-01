# Header chrome

The shared [app navigation](app-navigation.md) header identifies OpenSight and
the active product section. Inside Analyses, Author uses two full-width,
square-edged bands: the editable analysis title above the blue analysis toolbar.
The toolbar orders File, Edit, Data, Insert, Sheets, Objects, Search, the
existing Q form, FIT TO WIDTH, PUBLISH, and NEW LOOK. Narrow viewports wrap
controls without changing their reading or keyboard order.

Native `details`/`summary` menus keep keyboard activation, exclusive opening,
Escape-to-close with focus restoration, outside-click closure and action
closure. Popovers anchor below the menu, above the sheet, with a themed border,
shadow and surface. `aria-label="Analysis menu"` and the existing selectors
remain available to tours. Q answers and hosted-service disclosures stay in
the document flow below the toolbar.

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
The Q field uses the pressed background with opaque white placeholder text.

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

The private 1440×900 tour captures light/dark headers, both File popovers, an
Author overview and a full-page view. Its 46 computed-color checks have a
minimum text contrast of 5.44:1. Keyboard menus, Q, FIT TO WIDTH, PUBLISH,
theme persistence, other-mode chrome and narrow layouts pass with no browser
errors or external requests.

Compared with the prior data-panel tour, the sheet/docks start 167 pixels
higher; the four columns retain their 190 / 216 / 758 / 220 pixel widths.
No new visual regression was found. The QuickSight reference remains denser
and uses different typography and data; full visual fidelity is not claimed.

Final root `npm test` on 2026-09-28 exited 0: **1,089 passed / 0 failed /
1 skipped**. The only skip is the live PostgreSQL executor without
`DATABASE_URL`. The API suites ran with localhost socket access.
