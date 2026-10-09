# Issue #55 empty-state language follow-up

Reference review: `qs-autograph-empty.jpg`, `qs-spaces.jpg` and
`qs-research.jpg` from the October 2026 reference set. Reference images remain
outside the repository. This review does not establish measured visual parity.

Unassigned Author visuals now show their visual type and “Add 1 or more fields
to build a visual.” centered in the card, without an illustration or extra
controls. This covers all 23 supported visual types. Existing source, import
and filter problems still take precedence; partially configured visuals retain
their existing validation.

Empty Home, Analyses and Dashboards share decorative inline SVG artwork in
muted lavender, one guidance sentence and one blue primary action below it.
The existing destinations are retained. Home's explicit sample opt-in and the
empty Analyses page's refresh action remain secondary text controls. Dashboards
still explains that publishing needs a hosted API. Saved analyses and
storage-error recovery keep their existing UI.
The shared local guidance also appears on Author before data is selected.

The Author selects prepared data through an inline dropdown, not a dataset
selection dialog. No new dialog, Topics tab, metadata columns or dataset
creation workflow was added. Promo banners, dependencies, the solution design,
static demo output, merge and publication are outside this follow-up.

## Verification

TypeScript checking and the API and web production builds passed. Build and
root-suite execution used a temporary source copy because the API build invoked
by `npm test` writes embedded HTML under `packages/web/dist`. The original
static output was left untouched.

The final root `npm test` run exited nonzero. Exact reported counts follow;
the API figures include only tests reported before its native Node assertion
abort, so there is no complete full-suite total.

| Workspace | Passed | Failed | Skipped | Cancelled |
| --- | ---: | ---: | ---: | ---: |
| API (incomplete) | 61 | 52 | 4 | — |
| Bundle parser | 199 | 0 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 | 0 |
| O interpreter | 32 | 0 | 0 | 0 |
| Parity | 10 | 1 | 0 | 0 |
| Query engine | 501 | 1 | 2 | 0 |
| Web | 782 | 0 | 0 | 30 |
| Reported root-run subtotal | 1,594 | 54 | 6 | 30 |

All six reported skips require live PostgreSQL. The web cancellations come
from two browser suites whose Chromium startup fails. Parity reports
`spawnSync node EPERM`; the query-engine failure involves a denied socket.
Because the workspace failures prevent the root command's final conformance
step, it was run separately: **4 passed / 2 failed / 0 skipped**, with both
failures reporting denied socket operations. Process-isolated API retries
also stalled and were stopped; they are not included in these counts.

Focused empty-state and navigation tests: **39 passed / 0 failed / 0 skipped**.
Rendered React markup assertions verified:

- Home, Analyses and Dashboards each contain one decorative SVG, one guidance
  sentence and one primary CTA, in that order, with their existing labels.
- Sample opt-in and the hosted publishing notice remain available.
- Every supported Author visual with no assigned fields has a status containing
  its type title and the exact field guidance, without a chart, loading skeleton
  or rendering error. The bar title reads “Bar chart”.
- A source error takes precedence over the unassigned-fields guidance.

CSS specifies centered flex layout, 12px guidance and controls, the editor's
Arial/Helvetica font stack, and spacing in multiples of 4px. Reference review
and markup assertions are not a rendered pixel comparison.

Live capture is blocked in this environment: API and Vite startup both fail
with `listen EPERM`, and the existing Playwright/Chromium tooling fails to
launch because socket operations are denied. No replacement screenshots or
README media were claimed. The full suite also encounters socket/process
restrictions and a Node assertion abort in the combined API run; it is not green.

Checkpoint commits are blocked because the workspace mounts `.git` read-only
(`index.lock`: Read-only file system). Changes remain on
`work/issue-55-empty-first`; nothing was merged or published.
