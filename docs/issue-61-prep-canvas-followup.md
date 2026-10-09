# Issue #61 — Prep canvas follow-up

Implemented from the issue #61 build brief on
`work/issue-61-prep-canvas-followup`. The preparation schema and execution
contracts are unchanged. No dependencies are added.

The canvas supports wheel zoom at the pointer, zoom buttons, reset to 100%,
fit-to-view and dragging its background to pan. Zoom ranges from 0.1% to 200%
(including very long pipelines) and stays in memory while the preparation workspace is mounted, including
step edits and Configure/Preview switches. Focus the canvas to pan with arrow
keys, zoom with +/−, reset with 0 or fit with F. Node controls retain their
selection and branching behavior.

Steps search matches transformation names (including Add data), ignores case
and surrounding whitespace, and retains only groups containing matches.
No matches shows a clear message. Escape clears the search and focuses the
Steps dock without changing the pipeline or current editor.

Selected columns in Select, Group by (Aggregate/Pivot) and Unpivot can be
reordered by dragging or Alt + Up/Down. Their order is part of the applied
step and portable bundle. Unselected fields stay below the selected list.

Join table columns can be reordered for browsing (also while filtered), or
dropped onto their own side of a join-key pair. Wrong-side, unknown-column,
incompatible-type, external and stale-source drops do nothing. A half-filled
pair remains a real draft entry and blocks Apply. Dragging a key handle moves
the complete pair, preserving the AND semantics and existing pairing. Click
and select controls remain available for keyboard assignment. Blue insertion
lines mark list drops; an outline marks a valid key destination.

Preview headers can be dragged or moved with Alt + Left/Right. This changes
only preview presentation, with cells always resolved by column name. The UI
explains that Select columns changes dataset output order. Browser-list and
preview order are session-local and do not rewrite pipeline metadata.

## Demo capture and remaining gaps

`capture-prep-canvas-followup.mjs` drives the rebuilt static demo using real
pointer and native drag events. It covers button/wheel zoom, background pan,
fit/reset, node selection, search/empty state/Escape focus, filtered-column
ordering, key assignment and pair reordering, visible drop indicators,
wrong-side/type refusal, preview ordering, persisted Select order, tabs,
branch geometry and append mismatch refusal. Desktop (1440px) and mobile
(390px) checks report no page overflow, page errors or external HTTP requests.
The workspace keeps the 12px Arial system stack. Private synthetic tour
artifacts are in ignored `.opensight/issue-61/browser/`.

Viewed the supplied QuickSight reference locally and compared it with the
fresh Configure, drop-indicator and mobile captures. No reference image was
copied, committed or linked into the repository. Search, canvas view controls,
typed column lists and paired-key drops now fill the three requested gaps.
OpenSight still has taller product navigation, dataset actions, Apply/output
controls, staging and explicit API/Blaze notices. Connectors remain straight
with labeled links to earlier-step right sources; the reference uses curved
connections. Editor controls and help text use more space. On narrow screens
the tables stack; the canvas is clipped within its viewport and can be panned
or fitted. Native HTML dragging targets desktop pointers; existing click,
select and keyboard controls remain usable without dragging.

These are qualitative findings, not a measured visual-parity claim. Static
rows still require a local or hosted API, and append schema mismatch stays
fail-closed under issue #19. Further visual refinement remains follow-up
prep parity work. No network issue creation or phase-plan/design-file edit
was made under this brief's explicit restrictions. The rebuilt static demo
is a local artifact, not a deployed server.


## Files and verification

| Area | Files |
| --- | --- |
| Canvas | `packages/web/src/PrepGraph.tsx`, `PrepViewport.tsx` |
| Search and preview | `packages/web/src/DataPrep.tsx`, `PrepPreviewTable.tsx` |
| Column editors | `packages/web/src/PrepStepEditor.tsx`, `PrepJoinEditor.tsx`, `PrepColumns.tsx`, `prep-column-drag.ts` |
| Styling | `packages/web/src/style.css` |
| Tests | `packages/web/test/prep-canvas-followup.test.mjs` |
| Capture scripts | `packages/web/scripts/capture-prep-canvas-followup.mjs`, `capture-readme-tour.mjs` |
| Documentation/media | This document, `docs/images/data-prep.png`, `docs/images/opensight-tour.gif` |

- Strict TypeScript and focused checks:
  `node node_modules/typescript/bin/tsc -p packages/web/test/tsconfig.json`
  followed by
  `node --test --test-isolation=none packages/web/test/prep-canvas-followup.test.mjs packages/web/test/data-prep.test.mjs`:
  **37 passed / 0 failed / 0 skipped**.
- `npm run build:demo --workspace @opensight/web`: passed, including strict
  TypeScript and the embed build.
- `node packages/web/scripts/capture-prep-canvas-followup.mjs`: passed;
  the final tour also checks that Fit contains all nodes in a branched graph.
- `OPENSIGHT_SCREENSHOT_OUTPUT=.opensight/issue-61/gif node packages/web/scripts/capture-readme-tour.mjs`:
  passed with zero page errors and external requests. This maintained
  adaptation of the supplied README capture script runs against the rebuilt
  demo and now includes the issue #61 interactions.
- Both documented ffmpeg palette/assembly commands passed. The refreshed
  README hero has 251 frames at 960×600, 10fps, 25.1 seconds. The prep feature
  screenshot is refreshed from the final Configure capture.

Full-suite logs and exact totals are retained in ignored
`.opensight/issue-61/verification/`; the suite runs without concurrent browser
capture or GIF assembly.
