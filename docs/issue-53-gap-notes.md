# Issue #53 — Command palette

Implemented from the supplied issue brief on `work/issue-53-command-palette`.
No dependencies were added and `SOLUTION_DESIGN.md` is unchanged. See
[Command palette](command-palette.md) for behavior and accessibility details.

## Integration and verification

The application owns one palette provider, scoped by the existing workspace
identity boundary. Navigation commands use the existing route destinations and
visibility checks. Mounted Author and Q components register their available
actions and remove them on unmount. A failed analysis load registers no Author
actions. Author's manual save callback is shared by its button, shortcut and
palette command. Theme and sheet changes use the existing reducer actions; Q&A
uses the panel's shared open handler, including refocusing an already-open panel.

The small matcher ranks substrings, word starts and ordered fuzzy characters,
retaining menu order for ties. The dialog uses a labelled combobox and listbox,
an active descendant, selected options and a result-count status. Arrow keys
wrap; filtering resets selection; empty results and composing/repeated Enter
cannot execute. Tab wraps between Search and Close, and native Escape dismisses.
Selection closes the dialog and restores focus before running its action.
Navigation that removes the original control focuses the persistent Home link.
Save failures preserve storage recovery details and add a failure toast; thrown
or rejected commands also use the existing toast host.

Nineteen new unit/component tests run through the existing web/root test glob.
Together with the existing keyboard and Q tests, the focused run passed
**43 / failed 0 / skipped 0**. Coverage includes matching and ranking, permissions,
registration cleanup, latest draft callbacks, rename/delete sheet updates,
storage errors, native-cancel delegation, selection and dismissal focus,
Tab wrapping, Q refocusing, IME guards, StrictMode listener cleanup and failures.
Browser testing exposed Tab leaving the palette for browser chrome; explicit
wrapping fixed it and is covered by a regression test.

`npm run build:demo --workspace @opensight/web` rebuilt the static demo and embed
artifacts with strict TypeScript checks. Chromium acceptance passed Cmd/Ctrl+K,
filtering and keyboard selection, save/reload, all navigation
destinations, theme changes, sheet jumping and renaming, Home/Author Q&A,
focus restoration, typing/composition/modal guards and context cleanup. The
390px and short-height viewport checks passed. There were **zero page errors
and zero external requests**. Firefox, WebKit and screen-reader speech output
were not exercised.

## Visual comparison and refreshed media

At 1440px, baseline-versus-current screenshots found **zero changed pixels**
on Home, empty Author and populated Author while the palette was closed.
The local QuickSight NEW LOOK reference confirms the compact editor typography,
navy/blue chrome and Data → Visuals/wells → sheet arrangement. The palette uses
12px Arial body text, 13px headings, 4/8px spacing, and the current Author light
or dark treatment. Its modal fits the narrow viewport and scrolls its results.
No new unresolved visual defect was found. No QuickSight command-palette
reference was supplied; palette parity and overall visual fidelity are unmeasured.

`docs/images/command-palette.png` is the new feature capture. The affected
keyboard-shortcuts screenshot was refreshed to show the active palette entry.
Other existing feature screenshots remain representative because their UI did
not change. README links the new behavior doc and screenshot.

The README hero GIF was regenerated against the freshly rebuilt static demo,
using the maintained adaptation of the workspace capture script and its FFmpeg
palette workflow. The tour includes opening the palette, filtering Save draft,
and executing it alongside the existing feature sequence. Capture produced
187 frames with zero page errors; the result is 960×600 at 10fps.

Browser scripts, captures, pixel comparisons, GIF frames and verification logs
remain locally in ignored `.opensight/issue-53/`. External HTTP requests were
blocked during capture. Reference screenshots and private data were not committed.
The demo is a static artifact, not a deployed server.

## Final full-suite results

`TZ=UTC npm test` from the repository root exited **0**:
**1,840 passed / 0 failed / 12 skipped / 0 cancelled**. All skips require live
PostgreSQL with `DATABASE_URL`; no web test was skipped. Workspace builds and
strict TypeScript checks passed. The full run completed without a retry.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 303 | 0 | 10 |
| Bundle parser | 199 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 500 | 0 | 2 |
| Web | 780 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| **Total** | **1,840** | **0** | **12** |

`git diff bb9e7b58 --check` is clean. Checkpoint commits remain on the requested
work branch. Nothing was merged, pushed or published.
