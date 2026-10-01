# Issue #1: author layout

The builder follows the control flow in `AGENTS.md` §4 and retains the
authoring behavior specified in `SOLUTION_DESIGN.md` Phase 1d. The desktop
workspace reads left to right:

1. **Data:** existing dataset picker, field search, typed dimensions/measures,
   calculated-field action, parameters and imported definitions.
2. **Visuals:** visual gallery and ADD, followed by the selected visual's name,
   type picker and field wells. The gallery scrolls within a bounded area so
   its 19 types do not push the wells or sheet below it.
3. **Analysis sheet:** sheet tabs/actions, parameter controls and interaction
   status, then the canvas. It takes the remaining width without the explorer's
   maximum page width. FIT TO WIDTH fills this area; turning it off uses the
   existing 1200-pixel canvas with scrolling confined to its viewport.
4. **Properties:** existing display, formatting, theme, hierarchy, action and
   filter editors, docked on the right.

Each control panel is a native disclosure with its own desktop scroll area.
Panels stay in their columns as the page scrolls; headings stay visible while
their panel content scrolls. Closing a desktop panel reduces its column to a
44-pixel rail with a vertical label, returning the remaining width to the
sheet. The native summary reopens it with a click, Enter or Space.

At 1101–1399 pixels, Data and Visuals start open and Properties starts
collapsed. At 1400 pixels and above, all three start open. In both cases the
sheet receives over half the default workspace width. A user's disclosure
choice survives resizing within the same breakpoint. Crossing a panel's
breakpoint restores that panel's default.

At widths of 1100 pixels or less, panels stack in the same document order
and start collapsed, with horizontal summary labels. Opening a panel takes
space in the page; it does not overlay the sheet. Disclosure state is temporary
and does not change the saved analysis or grid layout.

The import drop zone remains above the workspace, with its file picker and
instructions under **Import bundle**. Dropping a file still works while the
disclosure is closed; import status and the report button remain visible.
The offline preview boundary and device-save status remain visible. Toolbar
menus and the explicitly opened calculated-field/import-report dialogs retain
their existing behavior.

## Selection and semantics

The active sheet's `selectedId` remains the single source of selection.
Clicking a card or its Configure button updates the docked wells, Data field
assignment state and Properties together. Sheet tabs and toolbar navigation
use the same reducer. Removing a visual switches to the reducer's surviving
selection; an empty sheet disables Data assignments and shows the existing
empty editor prompts. The gallery still chooses the type for the next ADD;
the selected visual's type picker edits that visual.

Field destinations, calculation and filter semantics, sheet layouts, storage,
queries and exports are unchanged. NEW LOOK still controls light/dark chrome
independently of analysis themes. PUBLISH still reports that hosted publishing
is unavailable and makes no request. Dataset metadata and additional Properties
features remain separate issues (#3 and #2).

## Verification

`packages/web/test/author-layout.test.mjs` uses the existing React renderer
approach. It checks panel order and containment, card/Configure selection,
field assignment across the docked panels, sheet switching, removal, empty
states, responsive disclosure defaults and preservation of analysis state.
Stylesheet contract checks cover panel docking, bounded gallery scrolling,
canvas overflow containment and the sheet's majority share of default desktop
width, including the space returned by collapsing a panel.
Root `npm test` includes it through the existing web test glob. Existing
toolbar, bundle, controls, interaction and authoring suites cover the retained
behavior. No dependencies were added.

Validation on 2026-09-28 after resuming: root `npm test` exited 0 with **964 passed, 0 failed,
1 skipped**. The skip is the live PostgreSQL executor (`DATABASE_URL` unset).
The full suite ran with local socket access for the API tests.

| Root test stage | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 90 | 0 | 0 |
| Bundle parser | 183 | 0 | 0 |
| Embedding SDK | 4 | 0 | 0 |
| Query engine | 353 | 0 | 1 |
| Web | 331 | 0 | 0 |
| Conformance | 3 | 0 | 0 |

Offline Chromium checks passed at widths 1920, 1440, 1400, 1399, 1366, 1280,
1101, 1100, 1024, 768 and 390 pixels. Checks covered panel separation and order,
the sheet's majority share of default desktop width, no page overflow, space
returned by closing each rail, keyboard reopening, and visible headings during
panel scrolling. Existing checks also passed for empty states, card selection
and docked assignments, keyboard access to the last gallery item, Insert-menu
focus into a collapsed Visuals panel, FIT TO WIDTH without saved-layout changes,
and the honest PUBLISH notice. Light/dark captures used 1440 × 900, 1366 × 768,
1280 × 800 and 390 × 844; there were no page errors or HTTP(S) requests. The
installed Playwright (Apache-2.0) and Chromium tooling was used without adding
a project dependency.

The mobile capture was also checked after scrolling the cards into view:
Chromium's initial full-page capture omitted offscreen card paint, while their
geometry, onscreen rendering and subsequent full-page capture were correct.

Build the offline, standalone demo with:

```sh
npm run build:demo --workspace @opensight/web
```

The local artifact is `packages/web/dist/opensight-demo.html`; choose
**Analyses → Author**. Build output is ignored; current feature screenshots
live in `docs/images/`.

## Look-and-feel gap notes

The local before/after comparison confirms that the gallery and wells no
longer sit above the sheet. Data, Visuals and Properties occupy separate rails,
and the sheet is the widest region. The import disclosure and compact controls
strip leave more room for the sheet. Gallery scrolling keeps all existing
types accessible without requiring the panel to be collapsed to see the canvas.

The private references were available during the resumed review. Visual
comparison with `qs-author-light-flow.jpg` and `qs-editor-newlook.jpg` confirms
the intended Data → Visuals/wells → sheet order, with Properties docked to the
right. The reference editor remains denser; this is a layout comparison, not
a pixel-level fidelity measurement. The reference images and demo captures
are not committed.

The resumed review found that closed panels still reserved their full column
width, and the 598-pixel sheet at 1280 pixels triggered the mobile preview.
Compact rails now return unused width to the sheet. With Properties initially
closed at that viewport, the sheet is 774 pixels wide and retains desktop
authoring controls. Panel headings remain visible while their content scrolls.
The navy toolbar and NEW LOOK light/dark treatment remain intact.

Existing follow-ups #2 (Properties) and #3 (Data metadata/grouping) are outside
this change. No GitHub requests were made under the offline build constraint.
