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

Implementation and verification results will be recorded at each checkpoint.
Demo rebuild, final README media refresh, merge, and publication belong to the
sweep runner per the run brief; this build branch is not pushed.
