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
