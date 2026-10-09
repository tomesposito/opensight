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
