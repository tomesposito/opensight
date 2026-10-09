# Issue #62 — application chrome

The issue brief is the implementation contract: keep OpenSight colors and
identity, and bring layout, spacing and component patterns closer to the
supplied local QuickSight references. `SOLUTION_DESIGN.md` is unchanged.

## Checkpoints and acceptance

1. Home and shared shell: compact identity band, desktop navigation rail,
   responsive navigation, consistent page spacing and sample/empty-state cards.
2. Analyses: page heading, informational banner and compact collection table;
   preserve device-local draft open, rename, delete and recovery behavior.
3. Dashboards: heading, informational banner and empty collection card;
   retain the existing local-only route and honest publishing limitation.
4. Data: compact section tabs, heading/actions, source cards and preparation
   workspace; preserve the actual connector and transformation capabilities.
5. Author: full-width editing workspace, compact identity/menu hierarchy and
   utility rows; preserve docks, menu behavior, dialogs and both themes.

Each UI checkpoint is rebuilt and captured locally, compared visually to the
references, and recorded in the private gap notes. Tests for new behavior and
browser geometry run through root `npm test`. Final verification includes the
full suite, responsive checks, refreshed README GIF and affected feature media.
Reference images and comparison artifacts stay out of git. No dependencies,
external requests, publication, PRs or changes to product capabilities are
planned. Missing QuickSight capabilities must not be represented by fake data
or working-looking controls.

## Results

Implementation and measured results will be recorded with each checkpoint.

### Home and shared shell

The 48px OpenSight navy identity band replaces the 67px horizontal navigation
header. Landing pages use a 192px left rail (168px from 761–1100px); at 760px
and below, navigation opens from a labeled toggle and closes on selection,
Escape or the backdrop. Author uses that same toggle at all widths, keeping
its full-width canvas. Existing role and mode gates remain authoritative.

Home keeps the pinned synthetic dashboard and explicit local sample opt-in.
Its compact heading, notice, tabs and flat cards follow the landing reference's
content rhythm. At 1440×900 its chart cards start at y=301 instead of y=377.
The 2026 reference's chat-first Home and tasks/activity widgets have no
corresponding shipped capability; no simulated widgets were introduced.

### Analyses

The page now has a single heading, a dismissible OpenSight introduction banner
and a white collection card. Populated drafts use Name / Last updated / Actions
columns, name search and real 25/50-item pagination. Device-local storage and
sample labels remain explicit. Empty and corrupt collections keep their prior
recovery guidance. The Author's small draft disclosure keeps its list format.
Banner dismissal returns keyboard focus to the heading; table overflow stays
inside a labeled scroll region on narrow screens.

Validation: 38 targeted tests passed, including row actions, pagination after
removal, search, corrupt drafts and existing creation/reopen flows. The offline
browser tour exercised dataset selection, save, search, rename, reload, delete,
banner focus, navigation Escape/backdrop, and 1440/1100/760/390px screenshots,
with zero page errors or external requests.

### Dashboards

The existing local-only page now shares the collection heading, introduction
banner and centered empty-state card. The publishing requirement remains visible
after dismissing the banner, and My analyses opens the real draft collection.
No dashboard rows, owners, favorites or publication features are simulated.
Seven targeted behavior tests passed; the real local API browser tour captured
Home and Dashboards at 1440/1100/760/390px and checked dismissal and navigation
without page overflow, page errors or external requests.

### Data

Data preparation and Data sources share the shell's compact secondary tabs and
32/24/16px page gutters. Removing nested outer padding aligns their headings
and actions with the collection pages. Source selection and setup now sit in
one flat card with compact search, connector tiles and form controls; setup
stacks beneath selection at 1100px. The preparation document toolbar, Steps
dock, graph and Configure/Preview panels retain their existing interactions.

The rebuilt demo was compared with the Data and preparation references. The
source page's content height fell from 835px (after the shared shell) to 684px
at 1440px. All 78 targeted shell/connector/preparation tests passed, including
browser bounds at 1440/1100/760/390px. The capture reported zero page errors and
external requests. A new dataset catalog or assistant pane is outside scope.

### Author and dialogs

Author composes the shared navigation and its live title input into one 48px
identity band. Its 36px desktop menu strip follows directly, retaining menu
order, the question trigger and right-aligned canvas/publishing/theme actions.
The product rail stays collapsed while editing. Standalone and embedded Author
keep their own identity band. Failed draft URLs retain product navigation.
The dataset dialog keeps its native focus containment and table/footer pattern,
with OpenSight teal selection and button colors inside the application.

At 1440×900, docks start at y=191 instead of the baseline y=288: 97px more
vertical space. Data / Visuals / sheet / Properties remain 190 / 216 / 758 /
220px. Synthetic-data, device-save and export limitations stay visible. No
saved layout, chart font, chart palette or data semantics changed.

Validation: 66 targeted existing/header tests passed. The browser tour verified
Rename focus, title save/reload, menus, command palette, Q, dataset modal and
navigation in both themes. The band stays 48px and long titles fit at
1920/1440/1100/760/390px; no page overflow, page errors or external requests.

### Review media

Current captures: [Home](images/sample-dashboard.png),
[empty Home](images/home-empty.png), [Analyses](images/analyses.png),
[Dashboards](images/dashboards.png), [Data sources](images/data-sources.png),
[Data preparation](images/data-prep.png), and [Author](images/author.png).
The README hero is refreshed at 960×600, 10fps, 11.3 seconds. Feature captures
include both empty/populated authoring, chart types, properties, menus, shortcuts,
save/recovery, local upload/query, Blaze and Q. The hosted jobs screenshot uses
an explicitly labeled synthetic documentation harness; no jobs or messages run.
Standalone operator, first-run and embed media are unaffected by the app shell.

The real isolated local API tour verified upload → preparation → Blaze refresh
and cached output → live chart → O answer (North 6, South 3), plus missing-source
draft recovery. All tour HTTP traffic was local; external requests were blocked.

Final shell review also covers the setup page's explicit fixture-demo banner and
wrapped developer controls: the rail/backdrop follows the measured identity-band
bottom on resize and scroll, so Home remains reachable. The dedicated browser
check passed at 1440px and 390px before/after scrolling; 58 focused shell and
navigation tests passed. Final rebuilt surface geometry remains unchanged.

### Final verification

Root `TZ=UTC npm test` exited 0: **1,993 passed / 0 failed / 12 skipped /
0 cancelled** (2,005 tests). All skips require live PostgreSQL. Pass totals:
API 304, bundle parser 199, embedding SDK 9, interpreter 32, parity 11,
query engine 502, web 930, root conformance 6. Browser checks also cover Escape from the navigation toggle
itself as well as the links, and no focus change for Escape in the
always-visible desktop rail.

An earlier overlapping capture run exceeded the existing containment test's
3-second execution ceiling (3.89s). The unchanged isolated check passed at
1.41s; no test limits were relaxed. A stopped detached runner was replaced by
an actively attached full run. Final source/demo checks, responsive tours and
media refreshes passed. No new dependencies, reference assets or personal data
were committed; `SOLUTION_DESIGN.md` is untouched. Work stays on the requested
branch; nothing was merged, pushed, published or opened as a PR.
