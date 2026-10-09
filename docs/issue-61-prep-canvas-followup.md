# Issue #61 — Prep canvas follow-up

Implemented from the issue #61 build brief on
`work/issue-61-prep-canvas-followup`. The preparation schema and execution
contracts are unchanged. No dependencies are added.

The canvas supports wheel zoom at the pointer, zoom buttons, reset to 100%,
fit-to-view and dragging its background to pan. Zoom ranges from 0.1% to 200% (including very long pipelines)
and stays in memory while the preparation workspace is mounted, including
step edits and Configure/Preview switches. Focus the canvas to pan with arrow
keys, zoom with +/−, reset with 0 or fit with F. Node controls retain their
selection and branching behavior.

Verification and reference comparison are recorded after the final build.

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
