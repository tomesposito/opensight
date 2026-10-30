# Issue #156 verification and visual comparison

The resolved scope is recorded in [Familiar-surface self-service](familiar-surface.md).
Column rename was included because the existing prep model already has `rename`.
No build item was omitted. No new dependency was added; `SOLUTION_DESIGN.md`
remains unchanged. All commits stay on `work/issue-156-familiar-surface`.

## Full root test result

Root `npm test` exited **0**: **4,402 passed / 0 failed / 0 skipped /
0 cancelled** (4,370 Node tests plus 32 Python tests).

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 912 | 0 | 0 |
| Bundle parser | 199 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 28 | 0 | 0 |
| Python headless SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 523 | 0 | 0 |
| Web | 2,420 | 0 | 0 |
| Root conformance | 88 | 0 | 0 |
| **Total** | **4,402** | **0** | **0** |

The successful run used `TZ=UTC`, `DATABASE_URL`,
`OPENSIGHT_TEST_POSTGRES_CA` and `OPENSIGHT_CHROMIUM`. The shared local Postgres
on port 5433 has SSL disabled, so the final run used an isolated temporary UTF-8
Postgres instance with TLS, leaving that shared server unchanged. The Chromium
launcher supplied its required validated empty WebGL domain allowlist. No test
was disabled or weakened. The local full log and exit status are retained under
`.opensight/issue-156/` (ignored by Git). The temporary database and its TLS
material were removed after verification.

## Behavioral checks

Root-wired tests cover plain/bracketed measure and measure-by-dimension queries,
case-insensitive exact matches, spaces and bracket escaping, unknown fields with
closest suggestions, ambiguous fields, malformed syntax, unsupported roles,
dataset changes and stale catalog selections. Search results serialize and render
through the ordinary visual compiler. Both creation entry points open normal
Author drafts; prepared dataset binding and save/reload are exercised.

The grid tests drive the real step editor from both grid shortcuts and catalog
actions, then execute both resulting pipelines in DuckDB and Postgres (PGlite).
Formula/filter/rename output agrees with independently asserted rows, including
null filtering. Invalid expressions, aggregates, unknown fields, duplicate names,
invalid filter values and actions from an earlier preview are rejected. Preview
row numbering, column reordering, and the absence of cell editors are checked.

## Browser and reference comparison

`packages/web/scripts/capture-familiar-surface.mjs` exercises the rebuilt
single-file demo at 1440px and 390px. Keyboard suggestions, unknown-token rejection,
chart save/reload, and formula/filter/rename actions pass. No document overflow,
browser page errors, or external requests were observed. Prep remains schema-only
in the static demo, with zero fabricated rows and disabled Save pipeline.

Compared with the local `qs-2026/qs-data-prep-new.jpg` reference, the Steps dock,
pipeline canvas and Configure/Preview arrangement remain intact. The grid adds
compact column actions within Preview; it does not introduce floating panels.
Compared with `qs-2026/qs-create-analysis-dialog.jpg`, the existing dataset table,
tabs, pagination and modal controls remain in place. Field exploration appears
below the selected dataset. Existing unavailable catalog metadata stays labeled
as unavailable, and Topics retains its hosted-support explanation.

The new search surface intentionally extends the reference dataset picker.
Existing reference differences remain; no new visual regression was found in
this slice's checks. The footer still says “visual fidelity not measured”; these
manual comparisons do not establish QuickSight parity or a deployed server.

The README Create Analysis and data-prep screenshots were refreshed from the
rebuilt demo. The maintained `capture-readme-tour.mjs` adaptation of the supplied
`readme-gif.mjs` includes field search, grounded correction, formula columns and
column filters. Its 246 frames were assembled with the documented ffmpeg palette
workflow at 960×600 and 10fps. The tour reported zero page errors or external
requests.

## Changed-file inventory

- Preparation: `packages/web/src/DataPrep.tsx`,
  `packages/web/src/PrepPreviewTable.tsx`, `packages/web/src/style.css`.
- Field search and draft creation: `packages/web/src/field-search.ts`,
  `packages/web/src/FieldSearchInput.tsx`,
  `packages/web/src/CreateAnalysisDialog.tsx`, `packages/web/src/Application.tsx`,
  `packages/web/src/Author.tsx`, `packages/web/src/use-local-drafts.ts`.
- Root-wired tests: `packages/web/test/field-search.test.mjs`,
  `packages/web/test/create-analysis-dialog.test.mjs`,
  `packages/web/test/new-analysis-flow.test.mjs`,
  `packages/web/test/data-prep.test.mjs`,
  `packages/web/test/prep-canvas-followup.test.mjs`.
- Documentation: `docs/familiar-surface.md`, `docs/data-prep.md`,
  `docs/calculated-fields.md`, `docs/issue-156-gap-notes.md`, `README.md`,
  `CHANGELOG.md`.
- Captures: `packages/web/scripts/capture-familiar-surface.mjs`,
  `packages/web/scripts/capture-readme-tour.mjs`,
  `docs/images/create-analysis.png`, `docs/images/data-prep.png`,
  `docs/images/opensight-tour.gif`.
