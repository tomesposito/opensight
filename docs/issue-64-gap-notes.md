# Issue #64 — landing and navigation structure

The issue #64 brief is the build contract for this navigation change. The five
local QuickSight references were reviewed: Home, My stuff, Spaces, My folders,
and Shared folders. Reference images are not repository artifacts.
`SOLUTION_DESIGN.md` is unchanged. OpenSight keeps its navy/teal identity.

## Reference mapping

| Reference entry | OpenSight destination / treatment |
| --- | --- |
| New chat | Omitted: O questions require a dashboard/analysis context; there is no global chat surface. |
| Search | Opens the existing #53 command palette; searches available routes and contextual commands. |
| My stuff | New `#/my-stuff` entry screen with links to available collections and actual pages visited this session. No staged assets, tasks, metrics, or favorites. |
| Spaces | Omitted: no knowledge-space surface. |
| Research | Omitted: no research surface. |
| Chat agents | Omitted: no agent-management surface. |
| Apps | Omitted: no app catalog. |
| Flows | Omitted: no workflow surface; schedules/alerts remain under More. |
| Analyses | Existing `#/analyses` device-local draft collection, with Author links. Existing build gate applies. |
| Dashboards | Existing `#/dashboards` honest publishing empty state; existing local-only visibility applies. |
| Data | Existing `#/data/preparation` and Data sources subnavigation, with the existing build gate. |
| My folders | New `#/folders/mine` informational empty state. Folder browsing is not implemented in this UI; links to existing folder/sharing guidance. |
| Shared folders | New `#/folders/shared` informational empty state, with the same explicit limitation. No claim that a hosted account has zero folders. |
| More | Expandable rail group containing the existing Admin and developer destinations with unchanged permission gates. |
| Recents | Below the primary rail links: up to five distinct pages visited in this session, newest first; empty before any previous visit. No persisted history or synthetic items. Author draft IDs are not retained as recent pages. |

Home remains available through the OpenSight brand, breadcrumb, and command
palette at `#/home`; its existing empty local/sample demo behavior is preserved.
My stuff does not replace or redirect an existing deep link. All legacy route
paths, draft URLs, invitation handling, and denied-route errors stay intact.

The top band provides a Home/section/page breadcrumb and an account disclosure
with the real hosted identity/sign-out action, or explicit local/demo context.
The rail keeps the existing small-screen and Author overlay behavior, closing
on navigation, backdrop click, and Escape. Long rail contents scroll.

## Scope and verification

No new dependencies, API operations, editor-menu changes (#65–#69), global chat,
folder CRUD, or hosted resource listing are included. Session recents contain
navigation locations, not asset activity. Existing role gates also filter
recents and command-palette destinations.

Checkpoints:

- Reference mapping recorded before implementation.
- Added My stuff and folder entry routes, retaining all legacy paths. The 26
  focused route tests passed, including hosted-reader bypass checks, draft
  restoration, reload, Back/Forward, honest folder guidance, and session recents.
- Implemented ordered rail links, Search, More, Recents, breadcrumb, and account
  disclosure. Command-palette indexing includes every permitted destination,
  preserving existing command IDs. Shared capture navigation follows the new
  rail and opens its responsive overlay when needed.

- Focused navigation, command-palette, account, and responsive geometry checks:
  **114 passed / 0 failed / 0 skipped**. Viewports cover 1920, 1440, 1100,
  760, and 390px; account controls also fit at 320px. A short viewport test
  verifies scrolling to the last recent link.
- The first full run found one inherited landing assertion that searched the
  entire DOM for developer links. The links now live in collapsed More. The
  assertion now verifies that they remain inside that hidden group and outside
  landing content. The six landing tests pass.

## Final full-suite verification

Root `npm test` completed with **exit 0** on 2026-10-09:
**2,079 passed / 0 failed / 12 skipped** (2,091 total).
All twelve skips require live PostgreSQL (`DATABASE_URL` is unset); there are no
other skips. The web suite passed all 1,013 tests and the root conformance suite
passed all seven. Browser captures ran between the two full-suite runs, never
alongside the containment timing tests. `git diff --check` passed.

The build is ready for the sweep runner. Checkpoint commits preserve the
reference mapping, route implementation, rail implementation, and visual/test
verification separately. No new dependencies or changes to `SOLUTION_DESIGN.md`
were introduced.

## Visual comparison

`node packages/web/scripts/capture-nav-rail.mjs` passed against a real local API
and Vite, producing nine captures with **0 page errors / 0 external requests**.
The walkthrough exercises rail routes, Search, More, account disclosure, Author,
mobile collapse and Escape focus, Back/Forward, and deep-link reload. Captures
live under ignored `.opensight/issue-64/browser/`; the sanitized My stuff view is
also recorded as `docs/images/navigation-rail.png`.

Compared the captures with the local Home, My stuff, Spaces, My folders, and
Shared folders references. The retained entries follow the reference order;
More precedes Recents, and the top band carries breadcrumb and account controls.
OpenSight retains its navy header, teal selection, and existing page gutters.
The desktop rail stays clear of the content; the 390px rail overlays and closes
after navigation. The new folder pages and account disclosure fit without
horizontal overflow. Author retains its full-width canvas and editable title.

The reference's global-chat/knowledge surfaces, activity widgets, and folder
tables are intentionally absent under the mapping above. Folder browsing remains
an explicit limitation, not an empty fetched collection. This is a structural
sanity check, not a pixel-fidelity measurement. No reference image was copied into
the repository. Follow-up editor menu issues #65–#69 remain outside this change.

Demo rebuild, final README media refresh, merge, and publication belong to the
sweep runner per the run brief; this build branch is not pushed.
