# Issue #278 — prep Window and append dedupe

Built on `work/issue-278-window-append-dedupe` from `b6f180c9` under the
supplied run brief. No dependencies, AWS calls, external network access, merge,
push or changes to `SOLUTION_DESIGN.md`. No #279/#280 scope was implemented.

## Behavior and boundaries

[Dataset preparation](data-prep.md#window-configuration-278) documents the exact
structured and advanced shapes, the ten functions, bounds, types, explicit
partition/order semantics, null placement and the two-step recipe. Advanced
mode uses `{name, expression}` with the entire OVER clause inside the expression.
A dedicated bounded parser accepts only the supported calls and frames; it
never changes the ordinary calculated-field expression language or forwards raw
SQL. Append's optional `duplicates` is `keep` or `dedupe`; omission preserves
existing UNION ALL SQL. Both modes retain the identical-name/type schema check.

The compiler follows the brief's explicit nonempty-order validation rule:
`PREP_WINDOW_ORDER_REQUIRED` rejects every function without its own order. This
is **not proof of unique ordering**: existing column metadata carries no unique
keys. Authors must supply unique tie-breakers for deterministic row numbers and
row-relative calculations. This limitation is disclosed in the UI and semantics
doc; data-dependent tie rejection is not implemented. The brief's broader
"guarantee" wording cannot be established by the specified metadata-only rule.

Both dialects support every function. The tests execute DuckDB and local PGlite
(Postgres), including nulls, tied ranks, mixed directions, type preservation,
frames, offsets, quoting and grammar rejection. Integer arguments are capped at
2,147,483,647 for the common native dialect range. Moving bounds default to zero;
the structured editor starts a moving window at one row before/current row.
SUM/AVG use the same floating-point casts and DECIMAL result convention as the
existing aggregate compiler. NULLS LAST is explicit for both directions.

Blaze policy is unchanged: a window is a single-input CTE transform and stays on
the direct path. A policy regression covers the window/filter recipe. Existing
upstream requirements still apply. The recipe helper avoids name collisions and
insertion validates the 50-step budget atomically before changing the draft.

## Visual review

Rebuilt `packages/web/dist/opensight-demo.html` and embed artifacts with
`npm run build:demo --workspace @opensight/web`. The local static demo still
shows schema-only previews and the need for a local/hosted API; it was not
presented as a deployed server.

Compared captures with the prior `docs/images/data-prep.png` and supplied
`lookfeel-references/qs-2026/qs-data-prep-new.jpg`: the left grouped step picker,
dotted graph canvas and bottom Configure/Preview panel remain intact. Window
configuration uses the existing compact form controls and reorderable column
lists. The advanced toggle's checkbox alignment was corrected during review.
Existing differences in navigation, chrome, spacing and graph layout remain;
QuickSight visual fidelity is not measured. No new visual defect was identified
for a separate issue; no remote issue was filed under the no-network instruction.

The README hero GIF was regenerated with a local adaptation of
`~/workspace/tools/screenshots/readme-gif.mjs` against the rebuilt demo, using its
FFmpeg palette workflow. `docs/images/data-prep.png` now includes Window and the
recipe in the picker and the two-step graph. Browser checks cover the recipe's
missing-order error, structured controls, advanced validation, append duplicates,
the honest static preview, no horizontal overflow, no page errors and no external
HTTP requests. Temporary scripts/captures are in the ignored
`.opensight/issue-278-verification/` directory.

## Verification

Final focused run: **118 passed / 0 failed / 0 skipped**. It includes bundle
validation, shared prep/window/branch/executor tests, canvas/editor/recipe tests,
and Blaze policy. Log: `/tmp/issue-278-focused.log`. All new tests are picked up
by existing package test globs in root `npm test`. Strict TypeScript and the
static demo/embed builds passed.

Full root `npm test` exited **0** with `TZ=UTC`, `TMPDIR=/tmp`, `DATABASE_URL`
unset and `OPENSIGHT_CHROMIUM` pointing to the installed Playwright headless
shell. Node reporters total **5,603 passed / 0 failed / 37 skipped** (5,640 tests,
zero cancelled/todo). The Python SDK also passed **32/32**. Combined root totals:
**5,635 passed / 0 failed / 37 skipped** (5,672 tests).

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,461 | 0 | 35 |
| Bundle parser | 211 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| TypeScript headless SDK | 28 | 0 | 0 |
| Python headless SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 854 | 0 | 2 |
| Web | 2,729 | 0 | 0 |
| Root conformance/site | 110 | 0 | 0 |
| **Total including Python** | **5,635** | **0** | **37** |

All skips are live-Postgres checks: 36 need `DATABASE_URL` and one needs a live
TLS PostgreSQL server. No browser tests skipped. Local loopback/browser execution
required the sandbox override. The first foreground attempt received SIGTERM
during API tests before producing totals; the complete persistent rerun above
is the reported result. Its log and exit status are retained at
`/tmp/issue-278-npm-test.log` and `/tmp/issue-278-npm-test.exit`.

## Checkpoints

- `2fcd0ca4` — item 1: window step types and validation.
- `afb404bd` — item 2: bounded parser, shared SQL compiler and direct-path policy test.
- `58a38e72` — item 3: opt-in full-row append dedupe.
- `a30e8a37` — item 4: canvas configurator, recipe, icon and configuration/execution tests.
- `42ea6f6b` — follow-up item 4: atomic recipe step-budget guard and toggle alignment.
- Item 5 checkpoint: semantics, changelog, visual artifacts and verification record.

## Changed files

- Parser: `packages/bundle-parser/src/prep.ts`, `packages/bundle-parser/test/prep.test.mjs`.
- Compiler: `packages/query-engine/src/prep.ts`, `packages/query-engine/src/prep-window.ts`, `packages/query-engine/test/prep.test.mjs`, `packages/query-engine/test/prep-window.test.mjs`.
- Direct-path policy regression: `packages/api/test/blaze-policy.test.mjs`.
- Canvas: `packages/web/src/data-prep.ts`, `packages/web/src/DataPrep.tsx`, `packages/web/src/PrepStepEditor.tsx`, `packages/web/src/PrepWindowEditor.tsx`, `packages/web/src/PrepIcons.tsx`, `packages/web/src/style.css`.
- Web tests: `packages/web/test/data-prep.test.mjs`, `packages/web/test/prep-canvas-followup.test.mjs`, `packages/web/test/prep-window.test.mjs`.
- Capture expectations: `packages/web/scripts/capture-prep-canvas.mjs`, `packages/web/scripts/capture-prep-canvas-followup.mjs`.
- Documentation and images: `README.md`, `CHANGELOG.md`, `docs/data-prep.md`, `docs/issue-278-gap-notes.md`, `docs/images/data-prep.png`, `docs/images/opensight-tour.gif`.
