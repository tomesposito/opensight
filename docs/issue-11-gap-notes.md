# Issue #11 verification and visual review

Work is on `work/issue-11-joins`. The existing right-join increment was retained.
The multi-input/reference and output-mode contract was committed separately in
`SOLUTION_DESIGN.md` before implementation. Checkpoint commits cover the model,
compiler, private hosted resolution, editor, and differential edge cases. No
merge, push, publish, deployment, or issue closure was performed.

## Semantics and boundaries

Pipelines retain version 1 and string source IDs. Primary inputs and join inputs
can reference owned prepared datasets; joins can also reuse earlier step results.
The canvas derives one node per unique input reference, with labeled consumers.
Joins retain explicit aliases and add a literal prefix-all mode. Key types,
case-ambiguous output names, forward references, cycles, expanded graph limits,
and missing/protected dependencies fail explicitly. Prepared inputs resolve the
current saved pipeline without sampling intermediate relations or caching rows.

The hosted API accepts unsaved join previews, persists the references, and checks
ownership, namespace, source security, and engine/connection boundaries. Metadata
writes revalidate dependencies inside the serialized store update. Imports grant
no access and do not automatically save referenced datasets. Upload staging still
expires at restart. Analysis publication and Blaze caching remain follow-ups.
No external dependency was added.

## Browser and screenshot checks

`npm run build:demo --workspace @opensight/web` rebuilt
`packages/web/dist/opensight-demo.html`. A local Chromium tour opened this static
artifact with external HTTP blocked and checked:

- Typed key mismatch errors and disabled Apply; correcting keys permits a full join.
- Two real input nodes and the joined output schema, with an honest hosted-only preview.
- Actual `.qs` download/import preserving the join and both source references.
- A 390-pixel mobile viewport: graph/table scrolling stays inside its container;
  the document has no horizontal overflow.
- Return to the analysis editor; the Data → Visuals → sheet layout remains intact.

Captures are `/tmp/issue11-prep-desktop.png`, `/tmp/issue11-prep-mobile.png`,
`/tmp/issue11-key-error.png`, and `/tmp/issue11-author.png`. Compared against the
existing issue #9 prep captures (`hidden_files/tour-issue9/prep-desktop-editor.png`)
and the supplied `lookfeel-references/qs-author-light-flow.jpg`, the left dock,
typography, borders, primary canvas, and analysis panel order remain consistent.
The available QuickSight reference is an analysis screenshot, not a prep join
canvas. This is a structural comparison; visual fidelity remains unmeasured.
No new unresolved rendering defect was identified.

A separate browser tour used a real localhost API, an isolated synthetic author,
a stub mail transport, and two synthetic CSV uploads. It joined sales to a saved
prepared regions dataset with a full outer join: two East matches, one unmatched
West sale, and one unmatched North region. The UI displayed four live rows before
saving, persisted the typed dataset reference, and reloaded the saved join with
the same result. `/tmp/issue11-prep-hosted.png` captures the result. No page errors
occurred. The browser, development renderer, and API were stopped afterward.
This is local integration verification, not a deployed server.

## Automated verification

Focused checks cover `.qs` round trips and malformed references, the complete
five-by-five key-type validation matrix, all join types with composite, null,
duplicate, unmatched and empty sides, chained/previous/prepared joins, post-join
transforms, parameter isolation, unsampled intermediate results, and memoized
dependency-depth limits. Execution comparisons use real DuckDB and embedded
Postgres (PGlite). HTTP tests cover previews, persistence, dependency updates and
deletion, cross-owner/namespace attempts, cross-engine/connection combinations,
and concurrent cycle creation. Editor tests cover live key/collision errors,
source selection, previous-result reuse, graph nodes, and preview-before-save.

Final root `npm test` exited 0: **1,298 passed / 0 failed /
1 skipped** (1,299 tests total). The only skip is the existing live
Postgres executor because `DATABASE_URL` is unset. All embedded Postgres, DuckDB,
API, web, bundle, SDK, interpreter, and root conformance tests ran.

### Post-reboot verification (2026-09-29)

Resumed from `fb686582` with a clean working tree on `work/issue-11-joins`.
All implementation checkpoints were already complete and were preserved.

The restored process environment sets `TZ=Europe/Paris`. In that environment,
the existing scalar PostgreSQL date-parsing and XLS date tests fail; all new
join checks pass. Both affected test files pass with `TZ=UTC` (105 passed,
0 failed, 0 skipped), matching the UTC verification setting previously recorded
in `roles-ai-settings.md`. Use `TZ=UTC npm test` from the repo root. API tests
also require permission to bind localhost; the filesystem sandbox blocks those
listeners. No test expectations or implementation code were changed.

Fresh root `TZ=UTC npm test` exited 0: **1,298 passed / 0 failed / 1 skipped**
(1,299 total). The only skip remains the live-Postgres executor because
`DATABASE_URL` is unset. DuckDB and embedded Postgres comparisons ran.
`TZ=UTC npm run build:demo --workspace @opensight/web` also exited 0 and rebuilt
`packages/web/dist/opensight-demo.html`. The branch and working-tree diffs pass
`git diff --check`.

The temporary screenshot artifacts and reference paths cited above are absent
from the restored workspace. The recorded pre-reboot visual comparison is
retained; it was not repeated during this verification.
