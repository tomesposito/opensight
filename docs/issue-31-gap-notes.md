# Issue #31: app navigation verification

Built on `work/issue-31-app-navigation` from `e06aa5a`, following the run brief.
The [navigation contract](app-navigation.md) records the IA, existing access
rules, draft behavior, and fragment/history choice. No dependencies, server
resources, authentication policies, or `SOLUTION_DESIGN.md` changes were needed.

## Browser and visual review

The [navigation harness](../packages/web/scripts/capture-app-navigation.mjs)
uses real Vite, the node:http API, DuckDB, and Chromium. A synthetic origin is
forwarded through Node to loopback because the installed browser restricts direct
loopback navigation. All external requests and WebSockets are blocked. The
hosted checks register synthetic principals in the actual in-memory security
store and authenticate them only in this test transport.

Home → Analyses → Data → Admin works without document reloads. Local, static demo,
and all five hosted roles have the expected links and direct-route denials.
Non-admins cannot reach AI settings or Users. Readers cannot reach authoring,
preparation, sources, or fixture previews. API preview retains its reader path
and is disabled in the static demo. Developer tools appear only under Admin.
The visible header never presents the product as a definition explorer.

A chart is created through Author against the actual API, saved, renamed through
My analyses, and reopened from that list. Its chart renders after Back, Forward,
and reload. Deleting a draft and visiting its old URL gives recovery guidance
without opening a different draft. New analysis starts blank. Desktop and 390px
captures check page overflow. The run reports zero page errors and zero external
requests. The capture harness needed an exact Users heading selector and an explicit
reload when changing test principals: removing only a URL fragment can be a
same-document navigation that retains the old SessionGate. These corrections
make role checks wait for a newly resolved session.

The existing [draft recovery harness](../packages/web/scripts/capture-local-drafts.mjs)
also passes with the new navigation: uploaded file → prepared chart → save →
reload → reopen → rename/delete → API restart → expired-source warning → re-upload
→ reconnect → live prepared chart. No sample sales query replaces uploaded data.
Static save, publish notices, and blocked-storage JSON download still pass, with
zero page errors and zero external requests.

Screenshots were visually compared with the previous README captures and the
provided `qs-editor-newlook.jpg`. The new header has a consistent active section;
Admin's secondary links wrap in normal flow on mobile. Author retains the
Data → Visuals → sheet layout and docked Properties. The app header adds vertical
space above the editor; dense utility chrome and mobile canvas density remain
in the existing #35 polish scope. No new unresolved functional regression was
found. The footer still says visual fidelity is not measured; this review is not
a parity measurement. No GitHub write was made under the run brief's network
constraint; publication belongs to the runner.

Affected screenshots are refreshed: sample dashboard, Author, definition preview,
Data preparation, Data sources, local chart, draft history, and expired-source
recovery. My analyses has a new documentation image. The Blaze image contains
only the unchanged preparation panel; embed and first-run images show unchanged
surfaces. The [README tour capture](../packages/web/scripts/capture-readme-tour.mjs)
is adapted from the supplied `readme-gif.mjs` storyboard and FFmpeg assembly;
it now includes Analyses and Admin. The rebuilt `packages/web/dist` artifact
remains a local static demo, not a deployed server.

## Verification

Evidence lives in ignored `.opensight/issue-31/`: navigation tests, full-suite
logs, demo builds, browser captures, draft recovery captures, and GIF frames.
The first full-suite process was terminated with exit 143 during compilation,
before any test results. The required full suite was restarted after the demo
build completed; its final results are recorded below.

`TZ=UTC DATABASE_URL=postgresql://postgres@localhost:5433/opensight npm test`
from the repository root exits 0: **1,557 passed / 0 failed / 0 skipped**.
No tests were cancelled. All live PostgreSQL tests ran. Strict TypeScript,
package builds, and root conformance ran through the workspace scripts.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 255 | 0 | 0 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 4 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Query engine | 512 | 0 | 0 |
| Web | 554 | 0 | 0 |
| Root conformance | 3 | 0 | 0 |
| **Total** | **1,557** | **0** | **0** |

The web suite includes 18 new navigation tests for mode/role visibility, denied
URLs, route parsing, local draft integration, corruption/identity boundaries,
missing drafts, new-analysis saves, reload, and history. Old dropdown assertions
now exercise navigation links and preserve their original landing/client checks.

`npm run build:demo --workspace @opensight/web` exits 0. The README GIF has
75 frames, 960×600 dimensions, and a 7.5-second duration (FFmpeg/ffprobe checked).
The required full suite covers runtime changes through `693411fc`; subsequent
commits update capture tooling, documentation, and images only. `git diff --check`
passes. No merge, push, deployment, or issue closure is part of this branch.

The final corrected navigation browser run (`browser-final.log`) exits 0 after
the full suite: all five hosted roles, local and static modes, history/reload,
real chart reopen, and mobile checks pass. It records 18 observed
chart requests, zero page errors, and zero external requests. Draft-recovery
acceptance exits 0 with 12 observed prepared queries; the tour capture exits 0
with 75 frames and zero page errors.
